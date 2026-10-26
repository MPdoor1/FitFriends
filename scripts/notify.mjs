// Sends FitFriends reminders and Arena alerts. Runs every 15 minutes from .github/workflows/notify.yml.
//
//   GOOGLE_KEY  service account JSON (GitHub secret). Without it, uses the Firestore emulator and
//               prints messages instead of sending them.
//   DRY_RUN=1   print what would be sent, and change nothing.
//   NOW=...     pretend it is this time (ISO string), for testing.
//
// State lives in notifyState/{pid} (and notifyState/_global). No client can read it: the rules have no match.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const DRY = process.env.DRY_RUN === '1';
const key = process.env.GOOGLE_KEY ? JSON.parse(process.env.GOOGLE_KEY) : null;
const SEND = Boolean(key) && !DRY;
initializeApp(key ? { credential: cert(key), projectId: key.project_id } : { projectId: 'fitfriends-b83fa' });
const db = getFirestore();
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const DEFAULT_TZ = 'America/New_York';
const MAX_PER_RUN = 3;

// ---------- time helpers ----------

function local(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) + Number(parts.minute) / 60, weekday: parts.weekday };
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const mondayOf = (dateStr) => addDays(dateStr, -((new Date(`${dateStr}T12:00:00Z`).getUTCDay() + 6) % 7));
const first = (name) => String(name || 'Someone').split(' ')[0];
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ---------- load everything once ----------

const [usersSnap, bannedSnap, globalSnap] = await Promise.all([
  db.collection('users').get(),
  db.collection('banned').get(),
  db.doc('notifyState/_global').get(),
]);
const banned = new Set(bannedSnap.docs.map((d) => d.id));
const users = usersSnap.docs.filter((d) => !banned.has(d.id)).map((d) => ({ id: d.id, ...d.data() }));
const lastRun = globalSnap.exists ? globalSnap.data().lastRun.toDate() : new Date(now.getTime() - 15 * 60000);
const since = new Date(Math.max(lastRun.getTime(), now.getTime() - 2 * 3600000)); // never look back more than 2h

const oldest = addDays(local(DEFAULT_TZ).date, -16);
const daysSnap = await db.collection('days').where('date', '>=', oldest).get();
const days = {};
for (const d of daysSnap.docs) days[d.id] = d.data();
const dayOf = (pid, date) => days[`${pid}_${date}`] || {};
const pointsBetween = (pid, from, to) => {
  let t = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const x = dayOf(pid, d); t += (x.wPoints || 0) + (x.foodPoints || 0); }
  return t;
};
function streak(pid, today) {
  let n = 0;
  for (let d = addDays(today, -1); (dayOf(pid, d).wCount || 0) > 0; d = addDays(d, -1)) n++;
  return n;
}

// New workouts from anyone since the last run, for friend activity alerts.
const fresh = [];
await Promise.all(users.map(async (u) => {
  const snap = await db.collection(`users/${u.id}/workouts`).where('createdAt', '>', Timestamp.fromDate(since)).get();
  for (const w of snap.docs) fresh.push({ by: u, ...w.data() });
}));

// ---------- decide ----------

const outbox = [];
let checked = 0;

for (const u of users) {
  const devices = (await db.collection(`users/${u.id}/devices`).get()).docs;
  const stateRef = db.doc(`notifyState/${u.id}`);
  const st = (await stateRef.get()).data() || {};
  const sent = { ...(st.sent || {}) };
  const tz = u.tz || DEFAULT_TZ;
  const L = local(tz);
  const h = L.hour;
  const prefs = { workout: true, meals: true, water: true, arena: true, weekly: true, friends: true, ...(u.notify || {}) };
  const quiet = h < 8 || h >= 22;
  const today = dayOf(u.id, L.date);
  const msgs = [];
  const once = (k, ok, make) => { if (ok && sent[k] !== L.date) { const m = make(); if (m) { msgs.push({ ...m, key: k }); } } };

  // Arena standings for this person's week. Always recorded, so overnight changes don't pile up.
  const monday = mondayOf(L.date);
  const ranking = users.map((x) => ({ id: x.id, name: x.displayName, pts: pointsBetween(x.id, monday, L.date) }))
    .sort((a, b) => b.pts - a.pts);
  const order = ranking.map((r) => r.id);
  const myRank = order.indexOf(u.id) + 1;
  // Last run's order, minus anyone removed since, so a removal never reads as a pass.
  const prev = st.rank?.week === monday ? st.rank.order.filter((id) => order.includes(id)) : null;

  if (devices.length && !quiet) {
    checked++;
    if (prefs.meals) {
      once('lunch', h >= 13 && h < 15 && !(today.foodCount > 0), () => ({
        title: 'Nothing in your food log yet', body: 'Tap to log breakfast or lunch. Logging anything earns +5 pts.', url: './#/fuel', tag: 'meals',
      }));
      if (h >= 19.5 && h < 21.5 && sent.dinner !== L.date) {
        const dinner = await db.collection(`users/${u.id}/foods`).where('date', '==', L.date).get();
        const hasDinner = dinner.docs.some((f) => f.data().meal === 'dinner');
        const left = (u.calorieGoal || 2000) + (today.wCalories || 0) - (today.foodCalories || 0);
        once('dinner', !hasDinner, () => ({
          title: "What's for dinner?", body: left > 0 ? `You have ${fmt(left)} kcal left today. Log dinner to stay on target.` : 'Log dinner so your day counts.', url: './#/fuel', tag: 'meals',
        }));
      }
    }
    if (prefs.water) {
      const goal = u.waterGoal ?? 8;
      once('water', goal > 0 && h >= 15 && h < 17 && (today.water || 0) < goal / 2, () => ({
        title: 'Water check', body: `${today.water || 0} of ${goal} glasses so far. Grab one now.`, url: './#/home', tag: 'water',
      }));
    }
    if (prefs.workout) {
      const s = streak(u.id, L.date);
      once('workout', h >= 18 && h < 20.5 && !(today.wCount > 0), () => ({
        title: 'No workout yet today',
        body: s > 0 ? `Keep your ${s}-day streak alive. Even 20 minutes counts.` : 'Even a 20-minute walk counts. Log it for points.',
        url: './#/train', tag: 'workout',
      }));
    }
    if (prefs.weekly) {
      once('weekly', L.weekday === 'Mon' && h >= 8 && h < 12, () => {
        const from = addDays(monday, -7);
        const to = addDays(monday, -1);
        const last = users.map((x) => ({ id: x.id, name: x.displayName, pts: pointsBetween(x.id, from, to) })).sort((a, b) => b.pts - a.pts);
        if (!last.some((r) => r.pts > 0)) return null;
        const r = last.findIndex((x) => x.id === u.id) + 1;
        const me = last[r - 1];
        const winner = last[0];
        return {
          title: "Last week's results",
          body: r === 1 ? `You won the week with ${fmt(me.pts)} pts!` : `You finished #${r} of ${last.length} with ${fmt(me.pts)} pts. ${first(winner.name)} won with ${fmt(winner.pts)}.`,
          url: './#/arena', tag: 'weekly',
        };
      });
    }
    if (prefs.arena && prev && users.length > 1) {
      const wasAhead = new Set(prev.slice(prev.indexOf(u.id) + 1));
      const passer = ranking.slice(0, myRank - 1).find((r) => wasAhead.has(r.id) && r.pts > 0);
      if (passer) {
        const gap = passer.pts - ranking[myRank - 1].pts;
        msgs.push({ key: null, title: `${first(passer.name)} just passed you`, body: `You're #${myRank} of ${users.length} this week. ${fmt(gap + 1)} pts to take it back.`, url: './#/arena', tag: 'arena' });
      } else if (myRank === 1 && prev[0] !== u.id && ranking[0].pts > 0) {
        msgs.push({ key: null, title: "You're in first place!", body: `${fmt(ranking[0].pts)} pts this week. Keep it up.`, url: './#/arena', tag: 'arena' });
      }
    }
    if (prefs.friends) {
      const theirs = fresh.filter((w) => w.by.id !== u.id);
      if (theirs.length === 1 || theirs.length === 2) {
        for (const w of theirs) {
          const dist = w.distanceKm ? ` · ${(u.units === 'metric' ? w.distanceKm : w.distanceKm / 1.609344).toFixed(1)} ${u.units === 'metric' ? 'km' : 'mi'}` : '';
          msgs.push({ key: null, title: `${first(w.by.displayName)} logged ${w.type}`, body: `${w.durationMin} min${dist} · +${w.points} pts`, url: './#/arena', tag: `friend-${w.by.id}` });
        }
      } else if (theirs.length > 2) {
        const names = [...new Set(theirs.map((w) => first(w.by.displayName)))];
        msgs.push({ key: null, title: `${theirs.length} new workouts`, body: `${names.slice(0, 3).join(', ')} ${names.length > 1 ? 'have' : 'has'} been training. Check the Arena.`, url: './#/arena', tag: 'friends' });
      }
    }
  }

  for (const m of msgs.slice(0, MAX_PER_RUN)) {
    outbox.push({ user: u, devices, m });
    if (m.key) sent[m.key] = L.date;
  }
  // Forget day markers older than a week.
  for (const k of Object.keys(sent)) if (sent[k] < addDays(L.date, -7)) delete sent[k];
  if (!DRY) await stateRef.set({ sent, rank: { week: monday, order } });
}

// ---------- send ----------

let delivered = 0;
for (const { user, devices, m } of outbox) {
  const tokens = devices.map((d) => d.data().token);
  if (!SEND) {
    console.log(`[${DRY ? 'dry' : 'emulator'}] ${user.displayName} (${tokens.length} device): ${m.title} | ${m.body}`);
    continue;
  }
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title: m.title, body: m.body, url: m.url, tag: m.tag },
    webpush: { headers: { Urgency: 'high', TTL: '3600' } },
  });
  delivered += res.successCount;
  // Remove phones that uninstalled or turned notifications off.
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('invalid-argument')) {
      return devices[i].ref.delete();
    }
    if (r.error) console.warn(`send failed for ${user.displayName}: ${code}`);
    return null;
  }));
}

if (!DRY) await db.doc('notifyState/_global').set({ lastRun: Timestamp.fromDate(now) });
console.log(`${users.length} members, ${checked} with notifications on, ${outbox.length} message(s) queued, ${delivered} delivered${DRY ? ' (dry run)' : ''}.`);
