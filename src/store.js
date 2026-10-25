// Data layer: Firebase Auth for accounts, Firestore for everything else.
//
// Firestore layout
//   users/{uid}                 profile + all-time stats (xp, workouts, minutes, calories, goalDays, types)
//   users/{uid}/workouts/{id}   one workout
//   users/{uid}/foods/{id}      one food entry
//   days/{uid}_{date}           per-user daily totals; the Arena reads these instead of every entry
//   config/private              optional { inviteCode }; readable only by security rules
import { initializeApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut as fbSignOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where,
  orderBy, limit, runTransaction, increment, serverTimestamp,
} from 'firebase/firestore/lite';
import { firebaseConfig } from './firebase-config.js';
import {
  workoutCalories, workoutPoints, goalDayPoints, GOAL_DAY_POINTS, levelFor, badgesFor,
} from './scoring.js';

export const configured = !firebaseConfig.apiKey.startsWith('PASTE');
const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');

const fbApp = initializeApp(useEmulator ? { ...firebaseConfig, apiKey: 'emulator' } : firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
export const isReady = configured || useEmulator;

// Firebase Auth needs an email, so usernames map to a made-up address that is never emailed.
const emailFor = (username) => `${username}@users.fitfriends.app`;

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'That username is taken.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection. Check your internet.',
  'permission-denied': 'That invite code is not right. Ask the group for it.',
};
const friendly = (err) => new Error(AUTH_ERRORS[err.code] || err.message || 'Something went wrong.');

const AVATARS = ['🏃', '🚴', '🏋️', '🧘', '🏊', '⛹️', '🤸', '🥊'];
const COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#84cc16'];

function profileFrom(snap) {
  const d = snap.data();
  return {
    id: snap.id,
    username: d.username,
    displayName: d.displayName,
    avatar: d.avatar,
    color: d.color,
    calorieGoal: d.calorieGoal,
    weightKg: d.weightKg,
    bestStreak: d.bestStreak || 0,
    stats: { xp: 0, workouts: 0, minutes: 0, calories: 0, goalDays: 0, types: {}, ...d.stats },
  };
}

// ---------- auth ----------

export function onUser(callback) {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) return callback(null);
    const snap = await getDoc(doc(db, 'users', fbUser.uid)).catch(() => null);
    callback(snap?.exists() ? profileFrom(snap) : null);
  });
}

export async function signUp({ username, password, displayName, inviteCode }) {
  username = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) throw new Error('Username must be 3-30 characters: letters, numbers, _ . -');
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, emailFor(username), password);
  } catch (err) { throw friendly(err); }
  // Starting look comes from the username so friends usually differ; everyone can change it in Profile.
  const i = [...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATARS.length;
  try {
    await setDoc(doc(db, 'users', cred.user.uid), {
      username,
      displayName: String(displayName || '').trim().slice(0, 40) || username,
      avatar: AVATARS[i],
      color: COLORS[i],
      calorieGoal: 2000,
      weightKg: 70,
      invite: String(inviteCode || '').trim(),
      bestStreak: 0,
      stats: { xp: 0, workouts: 0, minutes: 0, calories: 0, goalDays: 0, types: {} },
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Profile was rejected (wrong invite code): remove the login so the username stays free.
    await cred.user.delete().catch(() => {});
    throw friendly(err);
  }
  return getProfile(cred.user.uid);
}

export async function signIn({ username, password }) {
  username = String(username || '').trim().toLowerCase();
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, emailFor(username), password);
  } catch (err) { throw friendly(err); }
  const profile = await getProfile(cred.user.uid).catch(() => null);
  if (!profile) {
    await fbSignOut(auth);
    throw new Error('This account was never finished. Create it again with the invite code.');
  }
  return profile;
}

export const signOut = () => fbSignOut(auth);

export async function changePassword(current, next) {
  const user = auth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
  } catch {
    throw new Error('Current password is wrong.');
  }
  try {
    await updatePassword(user, next);
  } catch (err) { throw friendly(err); }
}

// ---------- profile ----------

const uid = () => auth.currentUser.uid;
const userRef = (id = uid()) => doc(db, 'users', id);
const dayRef = (date, id = uid()) => doc(db, 'days', `${id}_${date}`);

export async function getProfile(id = uid()) {
  const snap = await getDoc(userRef(id));
  if (!snap.exists()) throw new Error('Profile not found.');
  return profileFrom(snap);
}

export async function updateProfile(me, changes) {
  const goal = Math.round(Number(changes.calorieGoal));
  const weight = Number(changes.weightKg);
  await updateDoc(userRef(), {
    displayName: String(changes.displayName || '').trim().slice(0, 40) || me.displayName,
    avatar: changes.avatar || me.avatar,
    color: /^#[0-9a-f]{6}$/i.test(changes.color) ? changes.color : me.color,
    calorieGoal: goal >= 800 && goal <= 6000 ? goal : me.calorieGoal,
    weightKg: weight >= 25 && weight <= 300 ? weight : me.weightKg,
  });
  return getProfile();
}

// ---------- workouts ----------

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function addWorkout(me, input) {
  const duration = Math.round(Number(input.durationMin));
  const distance = input.distanceKm === '' || input.distanceKm == null ? null : Number(input.distanceKm);
  if (!isDate(input.date)) throw new Error('Pick a date.');
  if (!(duration >= 1 && duration <= 600)) throw new Error('Duration must be 1-600 minutes.');
  if (distance !== null && !(distance >= 0 && distance <= 1000)) throw new Error('Distance looks off.');

  const workout = {
    date: input.date,
    type: input.type,
    intensity: input.intensity,
    durationMin: duration,
    distanceKm: distance,
    notes: String(input.notes || '').trim().slice(0, 500),
    calories: workoutCalories(input.type, input.intensity, duration, me.weightKg),
    points: workoutPoints(input.intensity, duration),
  };
  const ref = doc(collection(db, 'users', uid(), 'workouts'));
  await runTransaction(db, async (tx) => {
    const day = await tx.get(dayRef(workout.date));
    tx.set(ref, { ...workout, createdAt: serverTimestamp() });
    applyWorkoutToDay(tx, day, workout, 1);
  });
  return { id: ref.id, ...workout };
}

export async function deleteWorkout(w) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', uid(), 'workouts', w.id);
    const [snap, day] = [await tx.get(ref), await tx.get(dayRef(w.date))];
    if (!snap.exists()) return;
    tx.delete(ref);
    applyWorkoutToDay(tx, day, snap.data(), -1);
  });
}

function applyWorkoutToDay(tx, daySnap, w, sign) {
  const d = daySnap.exists() ? daySnap.data() : emptyDay(w.date);
  tx.set(daySnap.ref, {
    ...d,
    wPoints: d.wPoints + sign * w.points,
    wMinutes: d.wMinutes + sign * w.durationMin,
    wCalories: d.wCalories + sign * w.calories,
    wCount: d.wCount + sign,
    types: { ...d.types, [w.type]: (d.types?.[w.type] || 0) + sign },
  });
  tx.update(userRef(), {
    'stats.xp': increment(sign * w.points),
    'stats.workouts': increment(sign),
    'stats.minutes': increment(sign * w.durationMin),
    'stats.calories': increment(sign * w.calories),
    [`stats.types.${w.type}`]: increment(sign),
  });
}

function emptyDay(date) {
  return { uid: uid(), date, wPoints: 0, wMinutes: 0, wCalories: 0, wCount: 0, types: {}, foodCalories: 0, foodCount: 0, foodPoints: 0 };
}

export async function listWorkouts() {
  const snap = await getDocs(query(collection(db, 'users', uid(), 'workouts'), orderBy('date', 'desc'), limit(150)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function workoutsOn(date) {
  const snap = await getDocs(query(collection(db, 'users', uid(), 'workouts'), where('date', '==', date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- food ----------

export async function addFood(me, input) {
  const calories = Math.round(Number(input.calories));
  const protein = input.proteinG === '' || input.proteinG == null ? null : Number(input.proteinG);
  const name = String(input.name || '').trim().slice(0, 80);
  if (!isDate(input.date)) throw new Error('Pick a date.');
  if (!name) throw new Error('What did you eat?');
  if (!(calories >= 0 && calories <= 5000)) throw new Error('Calories must be 0-5000.');
  if (protein !== null && !(protein >= 0 && protein <= 500)) throw new Error('Protein looks off.');
  const food = {
    date: input.date,
    meal: ['breakfast', 'lunch', 'dinner', 'snack'].includes(input.meal) ? input.meal : 'snack',
    name,
    calories,
    proteinG: protein,
  };
  const ref = doc(collection(db, 'users', uid(), 'foods'));
  await runTransaction(db, async (tx) => {
    const day = await tx.get(dayRef(food.date));
    tx.set(ref, { ...food, createdAt: serverTimestamp() });
    applyFoodToDay(tx, day, food.calories, 1, me.calorieGoal);
  });
  return { id: ref.id, ...food };
}

export async function deleteFood(me, f) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', uid(), 'foods', f.id);
    const [snap, day] = [await tx.get(ref), await tx.get(dayRef(f.date))];
    if (!snap.exists()) return;
    tx.delete(ref);
    applyFoodToDay(tx, day, snap.data().calories, -1, me.calorieGoal);
  });
}

// Recomputes the day's food points against the current goal and moves the user's XP by the difference.
function applyFoodToDay(tx, daySnap, calories, sign, goal) {
  const d = daySnap.exists() ? daySnap.data() : emptyDay(daySnap.id.split('_').pop());
  const foodCalories = d.foodCalories + sign * calories;
  const foodCount = d.foodCount + sign;
  const foodPoints = foodCount > 0 ? goalDayPoints(Math.max(foodCalories, 1), goal) : 0;
  const hit = (p) => (p >= GOAL_DAY_POINTS ? 1 : 0);
  tx.set(daySnap.ref, { ...d, foodCalories, foodCount, foodPoints });
  tx.update(userRef(), {
    'stats.xp': increment(foodPoints - d.foodPoints),
    'stats.goalDays': increment(hit(foodPoints) - hit(d.foodPoints)),
  });
}

export async function foodsOn(date) {
  const snap = await getDocs(query(collection(db, 'users', uid(), 'foods'), where('date', '==', date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

export async function recentFoods() {
  const snap = await getDocs(query(collection(db, 'users', uid(), 'foods'), orderBy('createdAt', 'desc'), limit(60)));
  const seen = new Map();
  for (const d of snap.docs) {
    const f = d.data();
    const key = `${f.name}|${f.calories}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()].slice(0, 12);
}

export async function getDay(date) {
  const snap = await getDoc(dayRef(date));
  return snap.exists() ? snap.data() : emptyDay(date);
}

// ---------- competition ----------

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

const STREAK_WINDOW_DAYS = 60;

// from = null means all time (uses each user's stored totals instead of reading every day).
export async function leaderboard({ from, today }) {
  const windowStart = addDays(today, -STREAK_WINDOW_DAYS);
  const readFrom = from && from < windowStart ? from : windowStart;
  const [usersSnap, daysSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'days'), where('date', '>=', readFrom), where('date', '<=', today))),
  ]);
  const daysBy = {};
  for (const d of daysSnap.docs) (daysBy[d.data().uid] ||= []).push(d.data());

  const board = usersSnap.docs.map((snap) => {
    const u = profileFrom(snap);
    const days = daysBy[u.id] || [];
    const { current, best } = streaks(new Set(days.filter((d) => d.wCount > 0).map((d) => d.date)), today);
    const bestStreak = Math.max(u.bestStreak, best);
    if (best > u.bestStreak && u.id === auth.currentUser?.uid) updateDoc(userRef(), { bestStreak: best }).catch(() => {});

    let period;
    if (from) {
      const inPeriod = days.filter((d) => d.date >= from);
      const sum = (k) => inPeriod.reduce((s, d) => s + (d[k] || 0), 0);
      const types = {};
      for (const d of inPeriod) for (const [t, n] of Object.entries(d.types || {})) types[t] = (types[t] || 0) + n;
      period = {
        points: sum('wPoints') + sum('foodPoints'),
        workouts: sum('wCount'),
        minutes: sum('wMinutes'),
        caloriesBurned: sum('wCalories'),
        goalDays: inPeriod.filter((d) => d.foodPoints >= GOAL_DAY_POINTS).length,
        types,
        daily: Object.fromEntries(inPeriod.map((d) => [d.date, d.wPoints + d.foodPoints])),
      };
    } else {
      const s = u.stats;
      period = { points: s.xp, workouts: s.workouts, minutes: s.minutes, caloriesBurned: s.calories, goalDays: s.goalDays, types: s.types, daily: {} };
    }
    const favorite = Object.entries(period.types).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const typesTried = Object.values(u.stats.types).filter((n) => n > 0).length;

    return {
      ...u,
      ...period,
      favorite,
      streak: current,
      bestStreak,
      totalXp: u.stats.xp,
      level: levelFor(Math.max(u.stats.xp, 0)),
      badges: badgesFor({ ...u.stats, bestStreak, types: typesTried }),
    };
  });
  board.sort((a, b) => b.points - a.points || b.minutes - a.minutes);
  return { board, meId: auth.currentUser?.uid };
}
