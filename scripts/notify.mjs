// Sends FitFriends reminders, progress alerts, Arena updates and friend activity.
// Runs every 15 minutes from .github/workflows/notify.yml. What exists is defined in src/notify-catalog.js.
//
//   GOOGLE_KEY  service account JSON (GitHub secret). Without it, uses the Firestore emulator and
//               prints messages instead of sending them.
//   DRY_RUN=1   print what would be sent, and change nothing.
//   NOW=...     pretend it is this time (ISO string), for testing.
//
// Bookkeeping lives in notifyState/{pid} and notifyState/_global; no client can read it.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { notifyPrefs, isQuiet, NUDGES } from '../src/notify-catalog.js';
import { levelFor, badgesFor } from '../src/scoring.js';
import { summary as routineSummary } from '../src/routines.js';

const DRY = process.env.DRY_RUN === '1';
const key = process.env.GOOGLE_KEY ? JSON.parse(process.env.GOOGLE_KEY) : null;
const SEND = Boolean(key) && !DRY;
initializeApp(key ? { credential: cert(key), projectId: key.project_id } : { projectId: 'fitfriends-b83fa' });
const db = getFirestore();
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const DEFAULT_TZ = 'America/New_York';
const MAX_PER_RUN = 4;
const LB = 2.20462;

// ---------- helpers ----------

function local(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) + Number(p.minute) / 60, weekday: p.weekday, day: Number(p.day) };
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysApart = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const mondayOf = (dateStr) => addDays(dateStr, -((new Date(`${dateStr}T12:00:00Z`).getUTCDay() + 6) % 7));
const first = (name) => String(name || 'Someone').split(' ')[0];
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const imperial = (u) => u.units !== 'metric';
const wt = (kg, u, d = 1) => `${(Math.round((imperial(u) ? kg * LB : kg) * 10 ** d) / 10 ** d).toLocaleString('en-US')} ${imperial(u) ? 'lb' : 'kg'}`;
const dist = (km, u) => `${(imperial(u) ? km / 1.609344 : km).toFixed(1)} ${imperial(u) ? 'mi' : 'km'}`;
const e1rm = (s) => (s.reps === 1 ? s.weightKg : s.weightKg * (1 + s.reps / 30));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- load ----------

const [usersSnap, bannedSnap, globalSnap] = await Promise.all([
  db.collection('users').get(), db.collection('banned').get(), db.doc('notifyState/_global').get(),
]);
const banned = new Set(bannedSnap.docs.map((d) => d.id));
const users = usersSnap.docs.filter((d) => !banned.has(d.id)).map((d) => ({ id: d.id, ...d.data() }));
const byId = Object.fromEntries(users.map((u) => [u.id, u]));
const lastRun = globalSnap.exists ? globalSnap.data().lastRun.toDate() : new Date(now.getTime() - 15 * 60000);
const since = new Date(Math.max(lastRun.getTime(), now.getTime() - 2 * 3600000)); // never look back more than 2h

const today0 = local(DEFAULT_TZ).date;
const daysSnap = await db.collection('days').where('date', '>=', addDays(today0, -45)).get();
const days = {};
for (const d of daysSnap.docs) days[d.id] = d.data();
const dayOf = (pid, date) => days[`${pid}_${date}`] || {};
const sumDays = (pid, from, to, f) => { let t = 0; for (let d = from; d <= to; d = addDays(d, 1)) t += f(dayOf(pid, d)); return t; };
const pts = (x) => (x.wPoints || 0) + (x.foodPoints || 0);
// Ties break by id so the order doesn't flip between runs.
const standings = (from, to) => users.map((x) => ({ id: x.id, name: x.displayName, pts: sumDays(x.id, from, to, pts) }))
  .sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
const ARENA_MIN = 30; // ignore tiny early-week moves like a 5-point breakfast
const streakBefore = (pid, date) => { let n = 0; for (let d = addDays(date, -1); (dayOf(pid, d).wCount || 0) > 0; d = addDays(d, -1)) n++; return n; };

const nudgeSnap = await db.collection('nudges').where('date', '>=', addDays(today0, -1)).get();
const pendingNudges = nudgeSnap.docs.filter((d) => !d.data().delivered && byId[d.data().to] && byId[d.data().from]);

// Fresh workouts since the last run, plus new lifting records.
const fresh = [];
const friendPrs = [];
await Promise.all(users.map(async (u) => {
  const snap = await db.collection(`users/${u.id}/workouts`).where('createdAt', '>', Timestamp.fromDate(since)).get();
  const mine = snap.docs.map((w) => ({ id: w.id, by: u, ...w.data() }));
  fresh.push(...mine);
  if (!mine.some((w) => w.exercises?.length)) return;
  const all = (await db.collection(`users/${u.id}/workouts`).orderBy('date', 'desc').limit(300).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const freshIds = new Set(mine.map((w) => w.id));
  const best = {};
  for (const w of all) {
    if (freshIds.has(w.id)) continue;
    for (const ex of w.exercises || []) for (const s of ex.sets) if (s.weightKg) best[ex.name.toLowerCase()] = Math.max(best[ex.name.toLowerCase()] || 0, e1rm(s));
  }
  for (const w of mine) {
    for (const ex of w.exercises || []) {
      const top = ex.sets.filter((s) => s.weightKg).sort((a, b) => e1rm(b) - e1rm(a))[0];
      const prev = best[ex.name.toLowerCase()];
      if (top && prev && e1rm(top) > prev + 0.01) friendPrs.push({ by: u, name: ex.name, set: top });
    }
  }
}));
const newMembers = users.filter((u) => u.createdAt?.toDate?.() > since);
const newlyShared = (await db.collection('routines').where('shared', '==', true).get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((r) => r.sharedAt?.toDate?.() > since && byId[r.owner]);

// ---------- pass 1: each member's own level, badge and weight news ----------

const milestones = []; // shared with friends: { by, title, body }
const states = {};

for (const u of users) {
  const st = (await db.doc(`notifyState/${u.id}`).get()).data() || {};
  const devices = (await db.collection(`users/${u.id}/devices`).get()).docs;
  const prefs = notifyPrefs(u);
  const L = local(u.tz || DEFAULT_TZ);
  const quiet = isQuiet(L.hour, prefs);
  const own = [];
  const stats = { xp: 0, workouts: 0, minutes: 0, calories: 0, goalDays: 0, types: {}, ...(u.stats || {}) };
  const level = levelFor(Math.max(stats.xp, 0));
  const earned = badgesFor({ ...stats, bestStreak: u.bestStreak || 0, types: Object.values(stats.types).filter((n) => n > 0).length }).filter((b) => b.earned);
  const [firstW, lastW] = await Promise.all([
    db.collection(`users/${u.id}/weights`).orderBy('date').limit(1).get(),
    db.collection(`users/${u.id}/weights`).orderBy('date', 'desc').limit(1).get(),
  ]);
  const start = firstW.docs[0]?.data();
  const latest = lastW.docs[0]?.data();
  const seen = st.seen;
  // Hold personal news during quiet hours so it arrives in the morning instead of being lost.
  const hold = devices.length > 0 && quiet;
  // Where weight progress stands now: whole 5 lb / 2 kg steps toward the goal, and whether it's reached.
  const goal = u.goalWeightKg;
  const dir = start && latest ? (goal != null ? Math.sign(goal - start.kg) : Math.sign(u.goalPace || 0)) : 0;
  const stepKg = imperial(u) ? 5 / LB : 2;
  const steps = dir ? Math.max(0, Math.floor(((latest.kg - start.kg) * dir) / stepKg + 1e-9)) : 0;
  const atGoal = dir && goal != null && (latest.kg - goal) * dir >= -0.2;
  // First time we see someone, record their current progress without announcing old news.
  const nextSeen = seen
    ? { level: level.number, badges: earned.map((b) => b.id), wm: seen.wm || 0, goalReached: seen.goalReached ?? null }
    : { level: level.number, badges: earned.map((b) => b.id), wm: steps, goalReached: atGoal ? goal : null };

  if (seen && !hold) {
    if (level.number > seen.level) {
      own.push({ type: 'levelUp', title: 'Level up!', body: `You're now LV ${level.number} · ${level.title}. ${fmt(level.toNext)} XP to the next one.`, url: './#/home', tag: 'level' });
      milestones.push({ by: u, title: `${first(u.displayName)} reached LV ${level.number}`, body: `${level.title}. Send a nudge to say nice work.` });
    }
    for (const b of earned.filter((x) => !(seen.badges || []).includes(x.id))) {
      own.push({ type: 'badge', title: `Badge unlocked: ${b.name}`, body: `${b.desc}. See it in your profile.`, url: './#/me', tag: `badge-${b.id}` });
      milestones.push({ by: u, title: `${first(u.displayName)} earned ${b.name}`, body: `${b.desc}.` });
    }
    if (dir && start.date !== latest.date) {
      {
        if (steps > (seen.wm || 0)) {
          const left = goal != null ? Math.abs(goal - latest.kg) : null;
          own.push({ type: 'weightMilestone', title: `${dir < 0 ? 'Down' : 'Up'} ${wt(steps * stepKg, u, 0)}`, body: `Since you started.${left != null && left > 0.2 ? ` ${wt(left, u)} to your goal.` : ''}`, url: './#/body', tag: 'weight' });
          nextSeen.wm = steps;
        }
        if (atGoal && seen.goalReached !== goal) {
          own.push({ type: 'weightMilestone', title: 'Goal weight reached!', body: `${wt(latest.kg, u)}. Set a new goal or hold it steady.`, url: './#/body', tag: 'weight-goal' });
          nextSeen.goalReached = goal;
        }
      }
    }
  }
  states[u.id] = { st, devices, prefs, L, quiet, own, latest, seen: hold && seen ? seen : nextSeen };
}

// ---------- pass 2: what each member with notifications gets ----------

const outbox = [];
let checked = 0;

for (const u of users) {
  const { st, devices, prefs, L, quiet, own, latest } = states[u.id];
  const sent = { ...(st.sent || {}) };
  const h = L.hour;
  const today = dayOf(u.id, L.date);
  const monday = mondayOf(L.date);
  const ranking = standings(monday, L.date);
  const order = ranking.map((r) => r.id);
  const myRank = order.indexOf(u.id) + 1;
  const prev = st.rank?.week === monday ? st.rank.order.filter((id) => order.includes(id)) : null;
  const msgs = [];
  const add = (type, m) => { if (prefs[type]) msgs.push({ type, ...m }); };
  const daily = (type, when, make) => {
    if (!prefs[type] || !when || sent[type] === L.date) return;
    const m = make();
    if (m) msgs.push({ type, key: type, ...m });
  };

  if (devices.length && !quiet) {
    checked++;
    // Nudges first: they're personal.
    for (const n of pendingNudges.filter((x) => x.data().to === u.id)) {
      const d = n.data();
      add('nudges', { title: `${first(byId[d.from].displayName)} ${d.msg === 'cheer' ? 'cheered you on' : 'nudged you'}`, body: NUDGES[d.msg].body, url: './#/arena', tag: `nudge-${d.from}`, nudge: n.ref });
    }
    // Arena moves.
    if (prev && users.length > 1) {
      const wasAhead = new Set(prev.slice(prev.indexOf(u.id) + 1));
      const passer = ranking.slice(0, myRank - 1).find((r) => wasAhead.has(r.id) && r.pts >= ARENA_MIN);
      if (passer) {
        add('arenaPassed', { title: `${first(passer.name)} just passed you`, body: `You're #${myRank} of ${users.length} this week. ${fmt(passer.pts - ranking[myRank - 1].pts + 1)} pts to take it back.`, url: './#/arena', tag: 'arena' });
      } else if (myRank === 1 && prev[0] !== u.id && ranking[0].pts >= ARENA_MIN) {
        add('arenaFirst', { title: "You're in first place!", body: `${fmt(ranking[0].pts)} pts this week. Keep it up.`, url: './#/arena', tag: 'arena' });
      }
    }
    // Personal progress from pass 1.
    for (const m of own) add(m.type, m);
    daily('goalHit', h >= 21 && h < 22 && (today.foodPoints || 0) >= 25, () => ({ title: 'Target hit', body: `${fmt(today.foodCalories)} kcal today: right in your zone. +25 pts.`, url: './#/fuel', tag: 'goal' }));

    // Reminders.
    const yesterday = dayOf(u.id, addDays(L.date, -1));
    const goalKcal = u.calorieGoal || 2000;
    daily('morning', h >= 7.5 && h < 9.5, () => ({
      title: `Good morning, ${first(u.displayName)}`,
      body: yesterday.wMinutes || yesterday.foodCalories
        ? `Yesterday: ${fmt(yesterday.wMinutes || 0)} min trained, ${fmt(yesterday.foodCalories || 0)} kcal eaten. Today's target: ${fmt(goalKcal)} kcal.`
        : `New day, fresh points. Today's target: ${fmt(goalKcal)} kcal.`,
      url: './#/home', tag: 'morning',
    }));
    daily('breakfast', h >= 9 && h < 10.5 && !(today.foodCount > 0), () => ({ title: 'Breakfast logged?', body: "Start today's log: it's +5 pts the moment you add anything.", url: './#/fuel', tag: 'meals' }));
    daily('lunch', h >= 13 && h < 15 && !(today.foodCount > 0), () => ({ title: 'Nothing in your food log yet', body: 'Tap to log breakfast or lunch. Logging anything earns +5 pts.', url: './#/fuel', tag: 'meals' }));
    if (prefs.dinner && h >= 19.5 && h < 21.5 && sent.dinner !== L.date) {
      const foods = await db.collection(`users/${u.id}/foods`).where('date', '==', L.date).get();
      const left = goalKcal + (today.wCalories || 0) - (today.foodCalories || 0);
      daily('dinner', !foods.docs.some((f) => f.data().meal === 'dinner'), () => ({
        title: "What's for dinner?", body: left > 0 ? `You have ${fmt(left)} kcal left today. Log dinner to stay on target.` : 'Log dinner so your day counts.', url: './#/fuel', tag: 'meals',
      }));
    }
    daily('eveningLog', h >= 21 && h < 22 && today.foodCount > 0 && (today.foodCalories || 0) < goalKcal * 0.7, () => ({
      title: `${fmt(goalKcal - today.foodCalories)} kcal under target`, body: 'Log anything you missed. Landing 70–105% of your goal is +25 pts.', url: './#/fuel', tag: 'meals',
    }));
    const waterGoal = u.waterGoal ?? 8;
    daily('waterAm', waterGoal > 0 && h >= 11 && h < 12.5 && !(today.water > 0), () => ({ title: 'First glass of water?', body: 'Nothing logged yet today. Tap a glass in FitFriends.', url: './#/home', tag: 'water' }));
    daily('waterPm', waterGoal > 0 && h >= 15 && h < 17 && (today.water || 0) < waterGoal / 2, () => ({ title: 'Water check', body: `${today.water || 0} of ${waterGoal} glasses so far. Grab one now.`, url: './#/home', tag: 'water' }));
    const streak = streakBefore(u.id, L.date);
    daily('workout', h >= 18 && h < 20.5 && !(today.wCount > 0), () => ({
      title: 'No workout yet today', body: streak > 0 ? `Keep your ${streak}-day streak alive. Even 20 minutes counts.` : 'Even a 20-minute walk counts. Log it for points.', url: './#/train', tag: 'workout',
    }));
    daily('streakSaver', h >= 20.75 && h < 21.75 && streak >= 2 && !(today.wCount > 0), () => ({
      title: `Last call for your ${streak}-day streak`, body: 'Log any workout before midnight to keep it going.', url: './#/train', tag: 'workout',
    }));
    if (prefs.weighIn && h >= 8 && h < 10 && (!sent.weighIn || daysApart(sent.weighIn, L.date) >= 3)) {
      const gap = latest ? daysApart(latest.date, L.date) : null;
      if (gap === null || gap > 7) {
        msgs.push({ type: 'weighIn', key: 'weighIn', title: 'Time to weigh in', body: gap === null ? 'Log your first weigh-in to start your chart.' : `It's been ${gap} days. A quick morning weigh-in keeps your chart honest.`, url: './#/body', tag: 'weight' });
      }
    }

    // Recaps and Arena timing.
    daily('weekly', L.weekday === 'Mon' && h >= 8 && h < 12, () => {
      const last = standings(addDays(monday, -7), addDays(monday, -1));
      if (!last.some((r) => r.pts > 0)) return null;
      const r = last.findIndex((x) => x.id === u.id) + 1;
      return {
        title: "Last week's results",
        body: r === 1 ? `You won the week with ${fmt(last[0].pts)} pts!` : `You finished #${r} of ${last.length} with ${fmt(last[r - 1].pts)} pts. ${first(last[0].name)} won with ${fmt(last[0].pts)}.`,
        url: './#/arena', tag: 'weekly',
      };
    });
    daily('weeklySummary', L.weekday === 'Sun' && h >= 19 && h < 21, () => {
      const w = sumDays(u.id, monday, L.date, (x) => x.wCount || 0);
      const m = sumDays(u.id, monday, L.date, (x) => x.wMinutes || 0);
      const onTarget = sumDays(u.id, monday, L.date, (x) => ((x.foodPoints || 0) >= 25 ? 1 : 0));
      if (!w && !onTarget) return { title: 'Your week', body: 'A quiet one. Tomorrow starts a fresh week and a fresh race.', url: './#/home', tag: 'summary' };
      return { title: 'Your week', body: `${w} workout${w === 1 ? '' : 's'} · ${fmt(m)} min · ${onTarget} day${onTarget === 1 ? '' : 's'} on target · #${myRank} in the Arena`, url: './#/arena', tag: 'summary' };
    });
    daily('arenaClose', L.weekday === 'Sun' && h >= 12 && h < 18 && myRank > 1, () => {
      const above = ranking[myRank - 2];
      const gap = above.pts - ranking[myRank - 1].pts;
      return gap > 0 && gap <= 40 ? { title: `Final day: ${fmt(gap)} pts behind ${first(above.name)}`, body: 'One solid workout flips it.', url: './#/arena', tag: 'arena' } : null;
    });
    if (prefs.monthly && L.day === 1 && h >= 9 && h < 12 && sent.monthly !== L.date) {
      const end = addDays(L.date, -1);
      const startM = `${end.slice(0, 8)}01`;
      const w = sumDays(u.id, startM, end, (x) => x.wCount || 0);
      const m = sumDays(u.id, startM, end, (x) => x.wMinutes || 0);
      const logged = sumDays(u.id, startM, end, (x) => ((x.foodCount || 0) > 0 ? 1 : 0));
      const kcal = sumDays(u.id, startM, end, (x) => ((x.foodCount || 0) > 0 ? x.foodCalories || 0 : 0));
      // Change from the last weigh-in before the month (or the month's first) to the month's last.
      const [inMonth, before] = await Promise.all([
        db.collection(`users/${u.id}/weights`).where('date', '>=', startM).where('date', '<=', end).orderBy('date').get(),
        db.collection(`users/${u.id}/weights`).where('date', '<', startM).orderBy('date', 'desc').limit(1).get(),
      ]);
      const ws = [...before.docs, ...inMonth.docs].map((d) => d.data());
      const change = inMonth.size && ws.length > 1 ? ws[ws.length - 1].kg - ws[0].kg : null;
      if (w || logged) {
        const parts = [`${w} workout${w === 1 ? '' : 's'}`, `${fmt(m)} min`];
        if (logged) parts.push(`avg ${fmt(kcal / logged)} kcal`);
        if (change != null && Math.abs(change) >= 0.1) parts.push(`${change < 0 ? 'down' : 'up'} ${wt(Math.abs(change), u)}`);
        msgs.push({ type: 'monthly', key: 'monthly', title: `${MONTHS[Number(end.slice(5, 7)) - 1]} recap`, body: parts.join(' · '), url: './#/home', tag: 'monthly' });
      }
    }

    // What friends are up to.
    for (const p of friendPrs.filter((x) => x.by.id !== u.id)) {
      add('friendPr', { title: `${first(p.by.displayName)} set a new record`, body: `${p.name} ${wt(p.set.weightKg, u, 0)} × ${p.set.reps}`, url: './#/arena', tag: `pr-${p.by.id}` });
    }
    for (const m of milestones.filter((x) => x.by.id !== u.id)) add('friendMilestone', { ...m, by: undefined, url: './#/arena', tag: `ms-${m.by.id}` });
    for (const n of newMembers.filter((x) => x.id !== u.id)) add('newMember', { title: `${first(n.displayName)} joined FitFriends`, body: 'Say hi with a nudge from the Arena.', url: './#/arena', tag: `join-${n.id}` });
    for (const r of newlyShared.filter((x) => x.owner !== u.id)) {
      add('friendRoutine', { title: `${first(byId[r.owner].displayName)} shared a routine: ${r.name}`, body: `${routineSummary(r)}. Start it from Train → Routines.`, url: './#/routines', tag: `routine-${r.id}` });
    }
    for (const w of fresh.filter((x) => x.routineOwner === u.id && x.by.id !== u.id)) {
      add('routineUsed', { title: `${first(w.by.displayName)} did your ${w.routineName || 'routine'}`, body: `${w.durationMin} min · +${w.points} pts`, url: './#/arena', tag: `used-${w.by.id}` });
    }
    // A workout of your own routine already got its own alert above.
    const theirs = fresh.filter((w) => w.by.id !== u.id && w.routineOwner !== u.id);
    if (theirs.length === 1 || theirs.length === 2) {
      for (const w of theirs) add('friendWorkout', { title: `${first(w.by.displayName)} logged ${w.type}`, body: `${w.durationMin} min${w.distanceKm ? ` · ${dist(w.distanceKm, u)}` : ''} · +${w.points} pts`, url: './#/arena', tag: `friend-${w.by.id}` });
    } else if (theirs.length > 2) {
      const names = [...new Set(theirs.map((w) => first(w.by.displayName)))];
      add('friendWorkout', { title: `${theirs.length} new workouts`, body: `${names.slice(0, 3).join(', ')} ${names.length > 1 ? 'have' : 'has'} been training. Check the Arena.`, url: './#/arena', tag: 'friends' });
    }
  }

  // Older queued news goes first. Anything over the per-run limit waits for the next run instead of being lost;
  // daily reminders simply retry while their window is open, and nudges stay pending until delivered.
  const nowMs = now.getTime();
  const queued = devices.length && !quiet ? (st.queue || []).filter((q) => nowMs - q.at < 8 * 3600000 && prefs[q.type]) : [];
  const all = [...queued, ...msgs];
  const sendNow = all.slice(0, MAX_PER_RUN);
  const overflow = all.slice(MAX_PER_RUN).filter((m) => !m.key && !m.nudge).map(({ type, title, body, url, tag, at }) => ({ type, title, body, url, tag, at: at || nowMs }));
  const queue = devices.length && !quiet ? overflow.slice(0, 12) : (st.queue || []);
  for (const m of sendNow) {
    outbox.push({ user: u, devices, m });
    if (m.key) sent[m.key] = L.date;
  }
  for (const k of Object.keys(sent)) if (sent[k] < addDays(L.date, -10)) delete sent[k];
  if (!DRY) await db.doc(`notifyState/${u.id}`).set({ sent, rank: { week: monday, order }, seen: states[u.id].seen, queue });
}

// ---------- send ----------

// Plain HTTPS instead of HTTP/2: works through proxies and is plenty fast for a small group.
const messaging = getMessaging();
messaging.enableLegacyHttpTransport();
let delivered = 0;
for (const { user, devices, m } of outbox) {
  if (!SEND) {
    console.log(`[${DRY ? 'dry' : 'emulator'}] ${user.displayName} (${devices.length} device) ${m.type}: ${m.title} | ${m.body}`);
  } else {
    const res = await messaging.sendEachForMulticast({
      tokens: devices.map((d) => d.data().token),
      data: { title: m.title, body: m.body, url: m.url, tag: m.tag },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } },
    });
    delivered += res.successCount;
    // Remove phones that uninstalled or turned notifications off.
    await Promise.all(res.responses.map((r, i) => {
      const code = r.error?.code || '';
      if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) return devices[i].ref.delete();
      if (r.error) console.warn(`send failed for ${user.displayName}: ${code}`);
      return null;
    }));
  }
  if (m.nudge && !DRY) await m.nudge.update({ delivered: true });
}

if (!DRY) await db.doc('notifyState/_global').set({ lastRun: Timestamp.fromDate(now) });
console.log(`${users.length} members, ${checked} reachable now, ${outbox.length} message(s), ${delivered} delivered${SEND ? '' : DRY ? ' (dry run)' : ' (emulator)'}.`);
