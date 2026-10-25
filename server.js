const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const db = require('./db');
const { WORKOUT_TYPES, INTENSITY, workoutCalories, workoutPoints, goalDayPoints, levelFor, badgesFor } = require('./scoring');

const app = express();
app.use(express.json({ limit: '50kb' }));

// Optional: set INVITE_CODE in Azure app settings so only friends who know it can sign up.
const INVITE_CODE = process.env.INVITE_CODE || '';
const SESSION_COOKIE = 'ff_session';
const SESSION_DAYS = 60;

// ---------- helpers ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  });
}

function requireAuth(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE);
  const user = token && db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.created_at > datetime('now', ?)
  `).get(token, `-${SESSION_DAYS} days`);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    color: u.color,
    calorieGoal: u.calorie_goal,
    weightKg: u.weight_kg,
  };
}

// ---------- auth ----------

app.get('/api/config', (req, res) => {
  res.json({ inviteRequired: Boolean(INVITE_CODE), workoutTypes: WORKOUT_TYPES, intensities: Object.keys(INTENSITY) });
});

app.post('/api/register', (req, res) => {
  const username = clean(req.body.username, 30).toLowerCase();
  const password = String(req.body.password ?? '');
  const displayName = clean(req.body.displayName, 40) || username;
  if (INVITE_CODE && clean(req.body.inviteCode, 100) !== INVITE_CODE) {
    return res.status(403).json({ error: 'That invite code is not right. Ask the group for it.' });
  }
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-30 characters: letters, numbers, _ . -' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'That username is taken.' });
  }
  const avatars = ['🏃', '🚴', '🏋️', '🧘', '🏊', '⛹️', '🤸', '🥊'];
  const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#84cc16'];
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const info = db.prepare('INSERT INTO users (username, password_hash, display_name, avatar, color) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), displayName, avatars[count % avatars.length], colors[count % colors.length]);
  startSession(req, res, info.lastInsertRowid);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

app.post('/api/login', (req, res) => {
  const username = clean(req.body.username, 30).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !checkPassword(String(req.body.password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.put('/api/profile', requireAuth, (req, res) => {
  const u = req.user;
  const displayName = clean(req.body.displayName, 40) || u.display_name;
  const avatar = clean(req.body.avatar, 8) || u.avatar;
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : u.color;
  const goal = Math.round(Number(req.body.calorieGoal));
  const weight = Number(req.body.weightKg);
  db.prepare('UPDATE users SET display_name = ?, avatar = ?, color = ?, calorie_goal = ?, weight_kg = ? WHERE id = ?').run(
    displayName, avatar, color,
    goal >= 800 && goal <= 6000 ? goal : u.calorie_goal,
    weight >= 25 && weight <= 300 ? weight : u.weight_kg,
    u.id,
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

app.put('/api/password', requireAuth, (req, res) => {
  if (!checkPassword(String(req.body.currentPassword ?? ''), req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is wrong.' });
  }
  const next = String(req.body.newPassword ?? '');
  if (next.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// ---------- workouts ----------

app.get('/api/workouts', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(req.user.id);
  res.json({ workouts: rows });
});

app.post('/api/workouts', requireAuth, (req, res) => {
  const { date, type, intensity } = req.body;
  const duration = Math.round(Number(req.body.durationMin));
  const distance = req.body.distanceKm === '' || req.body.distanceKm == null ? null : Number(req.body.distanceKm);
  if (!isDate(date)) return res.status(400).json({ error: 'Pick a date.' });
  if (!WORKOUT_TYPES.some((t) => t.name === type)) return res.status(400).json({ error: 'Pick a workout type.' });
  if (!INTENSITY[intensity]) return res.status(400).json({ error: 'Pick an intensity.' });
  if (!(duration >= 1 && duration <= 600)) return res.status(400).json({ error: 'Duration must be 1-600 minutes.' });
  if (distance !== null && !(distance >= 0 && distance <= 1000)) return res.status(400).json({ error: 'Distance looks off.' });

  const calories = workoutCalories(type, intensity, duration, req.user.weight_kg);
  const points = workoutPoints(intensity, duration);
  const info = db.prepare(`
    INSERT INTO workouts (user_id, date, type, duration_min, intensity, distance_km, notes, calories, points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, date, type, duration, intensity, distance, clean(req.body.notes, 500), calories, points);
  res.json({ workout: db.prepare('SELECT * FROM workouts WHERE id = ?').get(info.lastInsertRowid) });
});

app.delete('/api/workouts/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- food / calories ----------

app.get('/api/foods', requireAuth, (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : null;
  if (!date) return res.status(400).json({ error: 'Missing date.' });
  const foods = db.prepare('SELECT * FROM foods WHERE user_id = ? AND date = ? ORDER BY id').all(req.user.id, date);
  const burned = db.prepare('SELECT COALESCE(SUM(calories), 0) AS c FROM workouts WHERE user_id = ? AND date = ?').get(req.user.id, date).c;
  res.json({ foods, burned, goal: req.user.calorie_goal });
});

app.get('/api/foods/recent', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT name, calories, protein_g, COUNT(*) AS uses FROM foods WHERE user_id = ?
    GROUP BY name, calories ORDER BY MAX(id) DESC LIMIT 12
  `).all(req.user.id);
  res.json({ recent: rows });
});

app.post('/api/foods', requireAuth, (req, res) => {
  const { date } = req.body;
  const meal = ['breakfast', 'lunch', 'dinner', 'snack'].includes(req.body.meal) ? req.body.meal : 'snack';
  const name = clean(req.body.name, 80);
  const calories = Math.round(Number(req.body.calories));
  const protein = req.body.proteinG === '' || req.body.proteinG == null ? null : Number(req.body.proteinG);
  if (!isDate(date)) return res.status(400).json({ error: 'Pick a date.' });
  if (!name) return res.status(400).json({ error: 'What did you eat?' });
  if (!(calories >= 0 && calories <= 5000)) return res.status(400).json({ error: 'Calories must be 0-5000.' });
  if (protein !== null && !(protein >= 0 && protein <= 500)) return res.status(400).json({ error: 'Protein looks off.' });
  const info = db.prepare('INSERT INTO foods (user_id, date, meal, name, calories, protein_g) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, date, meal, name, calories, protein);
  res.json({ food: db.prepare('SELECT * FROM foods WHERE id = ?').get(info.lastInsertRowid) });
});

app.delete('/api/foods/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM foods WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- stats & competition ----------

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function streaks(dateSet, today) {
  let current = 0;
  let day = dateSet.has(today) ? today : addDays(today, -1);
  while (dateSet.has(day)) { current++; day = addDays(day, -1); }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...dateSet].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best };
}

// Per-user, per-day food totals, with points for days that land near the calorie goal.
function goalDays(user, from, to) {
  const days = db.prepare(`
    SELECT date, SUM(calories) AS total FROM foods WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date
  `).all(user.id, from, to);
  return days.map((d) => ({ date: d.date, total: d.total, points: goalDayPoints(d.total, user.calorie_goal) }));
}

function userStats(user, from, to, today) {
  const all = db.prepare('SELECT date, type, duration_min, calories, points FROM workouts WHERE user_id = ?').all(user.id);
  const inPeriod = all.filter((w) => w.date >= from && w.date <= to);
  const periodFood = goalDays(user, from, to);
  const allFood = goalDays(user, '0000-01-01', '9999-12-31');

  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const { current, best } = streaks(new Set(all.map((w) => w.date)), today);
  const totalXp = sum(all, 'points') + sum(allFood, 'points');
  const typeCounts = {};
  for (const w of inPeriod) typeCounts[w.type] = (typeCounts[w.type] || 0) + 1;
  const favorite = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const daily = {};
  for (const w of inPeriod) daily[w.date] = (daily[w.date] || 0) + w.points;
  for (const f of periodFood) daily[f.date] = (daily[f.date] || 0) + f.points;

  return {
    ...publicUser(user),
    points: sum(inPeriod, 'points') + sum(periodFood, 'points'),
    workouts: inPeriod.length,
    minutes: sum(inPeriod, 'duration_min'),
    caloriesBurned: sum(inPeriod, 'calories'),
    goalDays: periodFood.filter((f) => f.points >= 25).length,
    streak: current,
    bestStreak: best,
    favorite,
    daily,
    totalXp,
    level: levelFor(totalXp),
    badges: badgesFor({
      workouts: all.length,
      minutes: sum(all, 'duration_min'),
      bestStreak: best,
      goalDays: allFood.filter((f) => f.points >= 25).length,
      types: new Set(all.map((w) => w.type)).size,
      calories: sum(all, 'calories'),
    }),
  };
}

app.get('/api/leaderboard', requireAuth, (req, res) => {
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const from = isDate(req.query.from) ? req.query.from : '0000-01-01';
  const to = isDate(req.query.to) ? req.query.to : '9999-12-31';
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const board = users.map((u) => userStats(u, from, to, today)).sort((a, b) => b.points - a.points || b.minutes - a.minutes);
  res.json({ board, meId: req.user.id });
});

app.get('/api/summary', requireAuth, (req, res) => {
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const from = isDate(req.query.from) ? req.query.from : today;
  const me = userStats(req.user, from, today, today);
  const eaten = db.prepare('SELECT COALESCE(SUM(calories), 0) AS c FROM foods WHERE user_id = ? AND date = ?').get(req.user.id, today).c;
  const todays = db.prepare('SELECT * FROM workouts WHERE user_id = ? AND date = ? ORDER BY id').all(req.user.id, today);
  const users = db.prepare('SELECT * FROM users').all();
  const ranking = users.map((u) => userStats(u, from, today, today)).sort((a, b) => b.points - a.points || b.minutes - a.minutes);
  res.json({
    me,
    eaten,
    burned: todays.reduce((s, w) => s + w.calories, 0),
    goal: req.user.calorie_goal,
    todaysWorkouts: todays,
    rank: ranking.findIndex((r) => r.id === req.user.id) + 1,
    players: ranking.length,
  });
});

// ---------- static frontend ----------

app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FitFriends running on http://localhost:${port}`));
