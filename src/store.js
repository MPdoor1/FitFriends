// Data layer: Firebase Auth for accounts, Firestore for everything else.
//
// Firestore layout
//   users/{pid}                 profile + all-time stats (xp, workouts, minutes, calories, goalDays, types)
//   users/{pid}/workouts/{id}   one workout
//   users/{pid}/foods/{id}      one food entry
//   days/{pid}_{date}           per-user daily totals; the Arena reads these instead of every entry
//   config/private              optional { inviteCode }; only admins can read or change it
//   banned/{pid}                members removed by an admin
//   logins/{username}           { profileId, email }: which Firebase login a username currently uses
//   resets/{pid}                admin-issued password reset ticket { codeHash, expires }
//   aliases/{authUid}           { profileId }: a login created by a password reset, acting as that profile
//
// pid is the profile id: the Firebase uid of the member's first login. A password reset creates a new
// login (Firebase can't change someone else's password without a server) and points it at the same pid.
import { initializeApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut as fbSignOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where,
  orderBy, limit, runTransaction, increment, serverTimestamp, deleteDoc, writeBatch, Timestamp,
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
const SUPERSEDED = 'This password was reset. Sign in with your new password.';
const friendly = (err) => new Error(AUTH_ERRORS[err.code] || err.message || 'Something went wrong.');

export const COLORS = ['#c8ff2e', '#ff6b3d', '#3dd6ff', '#ff4d8d', '#a78bfa', '#ffc53d', '#3dffa8', '#f2f3f5'];

function profileFrom(snap) {
  const d = snap.data();
  return {
    id: snap.id,
    username: d.username,
    displayName: d.displayName,
    color: d.color,
    role: d.role || 'member',
    isAdmin: d.role === 'admin',
    joined: d.createdAt?.toDate?.() || null,
    calorieGoal: d.calorieGoal,
    weightKg: d.weightKg,
    units: d.units || 'imperial',
    sex: d.sex || null,
    birthYear: d.birthYear || null,
    heightCm: d.heightCm || null,
    activity: d.activity || 'moderate',
    goalPace: d.goalPace ?? 0,
    goalWeightKg: d.goalWeightKg ?? null,
    proteinGoal: d.proteinGoal ?? null,
    carbsGoal: d.carbsGoal ?? null,
    fatGoal: d.fatGoal ?? null,
    waterGoal: d.waterGoal ?? 8,
    onboarded: Boolean(d.onboarded),
    bestStreak: d.bestStreak || 0,
    stats: { xp: 0, workouts: 0, minutes: 0, calories: 0, goalDays: 0, types: {}, ...d.stats },
  };
}

// ---------- auth ----------

let profileId = null;
const pid = () => profileId;

// Works out which profile a Firebase login belongs to. Returns { profile } or { reason }.
async function resolveProfile(fbUser) {
  const alias = await getDoc(doc(db, 'aliases', fbUser.uid)).catch(() => null);
  const id = alias?.exists() ? alias.data().profileId : fbUser.uid;
  const snap = await getDoc(doc(db, 'users', id)).catch(() => null);
  if (!snap?.exists()) return { reason: 'This account is not active. Ask the group admin.' };
  if ((snap.data().authUid || id) !== fbUser.uid) return { reason: SUPERSEDED };
  profileId = id;
  return { profile: profileFrom(snap) };
}

async function loginEmail(username) {
  const snap = await getDoc(doc(db, 'logins', username)).catch(() => null);
  return snap?.exists() ? snap.data().email : emailFor(username);
}

export function onUser(callback) {
  return onAuthStateChanged(auth, async (fbUser) => {
    profileId = null;
    if (!fbUser) return callback(null);
    const { profile } = await resolveProfile(fbUser);
    callback(profile || null);
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
  const i = [...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', cred.user.uid), {
      username,
      displayName: String(displayName || '').trim().slice(0, 40) || username,
      color: COLORS[i],
      calorieGoal: 2000,
      weightKg: 70,
      units: 'imperial',
      onboarded: false,
      invite: String(inviteCode || '').trim(),
      bestStreak: 0,
      stats: { xp: 0, workouts: 0, minutes: 0, calories: 0, goalDays: 0, types: {} },
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'logins', username), { profileId: cred.user.uid, email: emailFor(username) });
    await batch.commit();
  } catch (err) {
    // Profile was rejected (wrong invite code): remove the login so the username stays free.
    await cred.user.delete().catch(() => {});
    throw friendly(err);
  }
  profileId = cred.user.uid;
  return getProfile();
}

export async function signIn({ username, password }) {
  username = String(username || '').trim().toLowerCase();
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, await loginEmail(username), password);
  } catch (err) {
    // After a reset the old password still opens the old login; say so instead of "wrong password".
    const wrongPassword = ['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(err.code);
    if (wrongPassword && (await loginEmail(username)) !== emailFor(username)) {
      const old = await signInWithEmailAndPassword(auth, emailFor(username), password).catch(() => null);
      if (old) { await fbSignOut(auth); throw new Error(SUPERSEDED); }
    }
    throw friendly(err);
  }
  const { profile, reason } = await resolveProfile(cred.user);
  if (!profile) {
    await fbSignOut(auth);
    throw new Error(reason);
  }
  return profile;
}

// Finishes an admin-issued reset: makes a new login with the new password and moves the profile onto it.
export async function completeReset({ username, code, password }) {
  username = String(username || '').trim().toLowerCase();
  code = normalizeCode(code);
  const login = await getDoc(doc(db, 'logins', username)).catch(() => null);
  if (!login?.exists() || !code) throw new Error('That reset code is not right or has expired.');
  const id = login.data().profileId;
  const email = `${username}+r${Date.now().toString(36)}@users.fitfriends.app`;
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) { throw friendly(err); }
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'aliases', cred.user.uid), { profileId: id, code });
    batch.delete(doc(db, 'resets', id));
    batch.update(doc(db, 'users', id), { authUid: cred.user.uid });
    batch.set(doc(db, 'logins', username), { profileId: id, email });
    await batch.commit();
  } catch {
    await cred.user.delete().catch(() => {});
    throw new Error('That reset code is not right or has expired.');
  }
  profileId = id;
  return getProfile();
}

export const signOut = () => { profileId = null; return fbSignOut(auth); };

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

const userRef = (id = pid()) => doc(db, 'users', id);
const dayRef = (date, id = pid()) => doc(db, 'days', `${id}_${date}`);

export async function getProfile(id = pid()) {
  const snap = await getDoc(userRef(id));
  if (!snap.exists()) throw new Error('Profile not found.');
  return profileFrom(snap);
}

const ACTIVITIES = ['sedentary', 'light', 'moderate', 'very', 'athlete'];
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// Saves only the fields given; each is checked so bad input never reaches the database.
export async function updateProfile(changes) {
  const c = changes;
  const patch = {};
  const num = (k, lo, hi, digits = 0) => {
    if (!(k in c)) return;
    if (c[k] === null || c[k] === '') { patch[k] = null; return; }
    const v = Number(c[k]);
    if (!inRange(v, lo, hi)) throw new Error(`${k} looks off.`);
    patch[k] = Math.round(v * 10 ** digits) / 10 ** digits;
  };
  if ('displayName' in c) patch.displayName = String(c.displayName || '').trim().slice(0, 40) || 'Friend';
  if ('color' in c && /^#[0-9a-f]{6}$/i.test(c.color)) patch.color = c.color;
  if ('units' in c) patch.units = c.units === 'metric' ? 'metric' : 'imperial';
  if ('sex' in c) patch.sex = ['male', 'female'].includes(c.sex) ? c.sex : null;
  if ('activity' in c && ACTIVITIES.includes(c.activity)) patch.activity = c.activity;
  if ('onboarded' in c) patch.onboarded = Boolean(c.onboarded);
  num('calorieGoal', 800, 6000);
  num('weightKg', 25, 300, 2);
  num('goalWeightKg', 25, 300, 2);
  num('heightCm', 90, 250, 1);
  num('birthYear', 1920, new Date().getFullYear() - 8);
  num('goalPace', -2, 2, 2);
  num('proteinGoal', 0, 600);
  num('carbsGoal', 0, 1200);
  num('fatGoal', 0, 400);
  num('waterGoal', 0, 30);
  await updateDoc(userRef(), patch);
  return getProfile();
}

// ---------- body weight ----------

export async function listWeights() {
  const snap = await getDocs(query(collection(db, 'users', pid(), 'weights'), orderBy('date')));
  return snap.docs.map((d) => d.data());
}

// One weigh-in per day; logging again on the same day replaces it. The latest one drives burn estimates.
export async function addWeight(date, kg) {
  if (!isDate(date)) throw new Error('Pick a date.');
  if (!inRange(kg, 25, 300)) throw new Error('That weight looks off.');
  kg = Math.round(kg * 100) / 100;
  await setDoc(doc(db, 'users', pid(), 'weights', date), { date, kg, createdAt: serverTimestamp() });
  await syncCurrentWeight();
}

export async function deleteWeight(date) {
  await deleteDoc(doc(db, 'users', pid(), 'weights', date));
  await syncCurrentWeight();
}

async function syncCurrentWeight() {
  const snap = await getDocs(query(collection(db, 'users', pid(), 'weights'), orderBy('date', 'desc'), limit(1)));
  if (!snap.empty) await updateDoc(userRef(), { weightKg: snap.docs[0].data().kg });
}

// ---------- days ----------

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function emptyDay(date) {
  return { uid: pid(), date, wPoints: 0, wMinutes: 0, wCalories: 0, wCount: 0, types: {}, foodCalories: 0, foodCount: 0, foodPoints: 0, water: 0 };
}
const dayData = (snap, date) => ({ ...emptyDay(date), ...(snap.exists() ? snap.data() : {}) });

export async function getDay(date) {
  return dayData(await getDoc(dayRef(date)), date);
}

// Own daily totals between two dates (inclusive), keyed by date.
export async function myDays(from, to) {
  const snap = await getDocs(query(collection(db, 'days'), where('date', '>=', from), where('date', '<=', to)));
  const out = {};
  for (const d of snap.docs) if (d.data().uid === pid()) out[d.data().date] = d.data();
  return out;
}

export async function setWater(date, glasses) {
  await runTransaction(db, async (tx) => {
    const ref = dayRef(date);
    const d = dayData(await tx.get(ref), date);
    tx.set(ref, { ...d, water: Math.max(0, Math.min(30, glasses)) });
  });
}

// Pure helpers: how a workout or a food change moves a day's totals.
function dayWithWorkout(d, w, sign) {
  return {
    ...d,
    wPoints: d.wPoints + sign * w.points,
    wMinutes: d.wMinutes + sign * w.durationMin,
    wCalories: d.wCalories + sign * w.calories,
    wCount: d.wCount + sign,
    types: { ...d.types, [w.type]: (d.types?.[w.type] || 0) + sign },
  };
}
function dayWithFood(d, deltaCalories, deltaCount, goal) {
  const foodCalories = Math.max(0, d.foodCalories + deltaCalories);
  const foodCount = Math.max(0, d.foodCount + deltaCount);
  const foodPoints = foodCount > 0 ? goalDayPoints(Math.max(foodCalories, 1), goal) : 0;
  return { ...d, foodCalories, foodCount, foodPoints };
}
const hit = (p) => (p >= GOAL_DAY_POINTS ? 1 : 0);

// Adds up user stat increments; several changes to the same counter are merged into one.
function statsUpdate(changes) {
  const sum = {};
  for (const [k, v] of changes) if (v) sum[k] = (sum[k] || 0) + v;
  return Object.fromEntries(Object.entries(sum).filter(([, v]) => v).map(([k, v]) => [k, increment(v)]));
}
const workoutStats = (w, sign) => [
  ['stats.xp', sign * w.points], ['stats.workouts', sign], ['stats.minutes', sign * w.durationMin],
  ['stats.calories', sign * w.calories], [`stats.types.${w.type}`, sign],
];

// ---------- workouts ----------

function cleanWorkout(me, input) {
  const duration = Math.round(Number(input.durationMin));
  const distance = input.distanceKm === '' || input.distanceKm == null ? null : Math.round(Number(input.distanceKm) * 1000) / 1000;
  const avgHr = input.avgHr === '' || input.avgHr == null ? null : Math.round(Number(input.avgHr));
  if (!isDate(input.date)) throw new Error('Pick a date.');
  if (!(duration >= 1 && duration <= 600)) throw new Error('Duration must be 1–600 minutes.');
  if (distance !== null && !(distance >= 0 && distance <= 1000)) throw new Error('Distance looks off.');
  if (avgHr !== null && !(avgHr >= 40 && avgHr <= 230)) throw new Error('Heart rate should be 40–230 bpm.');
  const exercises = (input.exercises || [])
    .map((ex) => ({
      name: String(ex.name || '').trim().slice(0, 60),
      sets: (ex.sets || [])
        .map((s) => ({ reps: Math.round(Number(s.reps) || 0), weightKg: Math.round((Number(s.weightKg) || 0) * 100) / 100 }))
        .filter((s) => s.reps > 0 && s.reps <= 1000 && s.weightKg >= 0 && s.weightKg <= 700)
        .slice(0, 30),
    }))
    .filter((ex) => ex.name && ex.sets.length)
    .slice(0, 30);
  return {
    date: input.date,
    type: input.type,
    intensity: input.intensity,
    durationMin: duration,
    distanceKm: distance,
    avgHr,
    exercises,
    notes: String(input.notes || '').trim().slice(0, 500),
    calories: workoutCalories(input.type, input.intensity, duration, me.weightKg),
    points: workoutPoints(input.intensity, duration),
  };
}

export async function addWorkout(me, input) {
  const workout = cleanWorkout(me, input);
  const ref = doc(collection(db, 'users', pid(), 'workouts'));
  await runTransaction(db, async (tx) => {
    const day = await tx.get(dayRef(workout.date));
    tx.set(ref, { ...workout, createdAt: serverTimestamp() });
    tx.set(day.ref, dayWithWorkout(dayData(day, workout.date), workout, 1));
    tx.update(userRef(), statsUpdate(workoutStats(workout, 1)));
  });
  return { id: ref.id, ...workout };
}

export async function updateWorkout(me, old, input) {
  const next = cleanWorkout(me, input);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', pid(), 'workouts', old.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('That workout was deleted.');
    const prev = snap.data();
    const oldDay = await tx.get(dayRef(prev.date));
    const newDay = prev.date === next.date ? oldDay : await tx.get(dayRef(next.date));
    if (prev.date === next.date) {
      tx.set(oldDay.ref, dayWithWorkout(dayWithWorkout(dayData(oldDay, prev.date), prev, -1), next, 1));
    } else {
      tx.set(oldDay.ref, dayWithWorkout(dayData(oldDay, prev.date), prev, -1));
      tx.set(newDay.ref, dayWithWorkout(dayData(newDay, next.date), next, 1));
    }
    tx.update(ref, next);
    const update = statsUpdate([...workoutStats(prev, -1), ...workoutStats(next, 1)]);
    if (Object.keys(update).length) tx.update(userRef(), update);
  });
  return { id: old.id, ...next };
}

export async function deleteWorkout(w) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', pid(), 'workouts', w.id);
    const [snap, day] = [await tx.get(ref), await tx.get(dayRef(w.date))];
    if (!snap.exists()) return;
    tx.delete(ref);
    tx.set(day.ref, dayWithWorkout(dayData(day, w.date), snap.data(), -1));
    tx.update(userRef(), statsUpdate(workoutStats(snap.data(), -1)));
  });
}

export async function listWorkouts(max = 400) {
  const snap = await getDocs(query(collection(db, 'users', pid(), 'workouts'), orderBy('date', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function workoutsOn(date) {
  const snap = await getDocs(query(collection(db, 'users', pid(), 'workouts'), where('date', '==', date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- food ----------

const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];
const r1 = (n) => Math.round(n * 10) / 10;

// A food entry stores the per-serving values and the totals for the servings eaten.
function cleanFood(input) {
  const name = String(input.name || '').trim().slice(0, 80);
  const servings = Number(input.servings ?? 1);
  const per = {
    calories: Math.round(Number(input.per?.calories ?? input.calories)),
    proteinG: r1(Number(input.per?.proteinG ?? input.proteinG) || 0),
    carbsG: r1(Number(input.per?.carbsG ?? input.carbsG) || 0),
    fatG: r1(Number(input.per?.fatG ?? input.fatG) || 0),
  };
  if (!isDate(input.date)) throw new Error('Pick a date.');
  if (!name) throw new Error('What did you eat?');
  if (!(servings > 0 && servings <= 20)) throw new Error('Servings must be between 0 and 20.');
  if (!(per.calories >= 0 && per.calories <= 5000)) throw new Error('Calories must be 0–5,000.');
  if ([per.proteinG, per.carbsG, per.fatG].some((g) => g < 0 || g > 500)) throw new Error('Macros look off.');
  return {
    date: input.date,
    meal: MEAL_KEYS.includes(input.meal) ? input.meal : 'snack',
    name,
    serving: String(input.serving || '').trim().slice(0, 40),
    servings: Math.round(servings * 100) / 100,
    per,
    calories: Math.round(per.calories * servings),
    proteinG: r1(per.proteinG * servings),
    carbsG: r1(per.carbsG * servings),
    fatG: r1(per.fatG * servings),
  };
}

export async function addFood(me, input) {
  const food = cleanFood(input);
  const ref = doc(collection(db, 'users', pid(), 'foods'));
  await runTransaction(db, async (tx) => {
    const daySnap = await tx.get(dayRef(food.date));
    const d = dayData(daySnap, food.date);
    const nd = dayWithFood(d, food.calories, 1, me.calorieGoal);
    tx.set(ref, { ...food, createdAt: serverTimestamp() });
    tx.set(daySnap.ref, nd);
    const update = statsUpdate([['stats.xp', nd.foodPoints - d.foodPoints], ['stats.goalDays', hit(nd.foodPoints) - hit(d.foodPoints)]]);
    if (Object.keys(update).length) tx.update(userRef(), update);
  });
  return { id: ref.id, ...food };
}

// Change servings or meal of an entry.
export async function updateFood(me, old, changes) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', pid(), 'foods', old.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('That entry was deleted.');
    const prev = snap.data();
    const next = cleanFood({ ...prev, per: prev.per || { calories: prev.calories, proteinG: prev.proteinG, carbsG: prev.carbsG, fatG: prev.fatG }, servings: prev.servings || 1, ...changes });
    const daySnap = await tx.get(dayRef(prev.date));
    const d = dayData(daySnap, prev.date);
    const nd = dayWithFood(d, next.calories - prev.calories, 0, me.calorieGoal);
    tx.update(ref, next);
    tx.set(daySnap.ref, nd);
    const update = statsUpdate([['stats.xp', nd.foodPoints - d.foodPoints], ['stats.goalDays', hit(nd.foodPoints) - hit(d.foodPoints)]]);
    if (Object.keys(update).length) tx.update(userRef(), update);
  });
}

export async function deleteFood(me, f) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', pid(), 'foods', f.id);
    const [snap, daySnap] = [await tx.get(ref), await tx.get(dayRef(f.date))];
    if (!snap.exists()) return;
    const d = dayData(daySnap, f.date);
    const nd = dayWithFood(d, -snap.data().calories, -1, me.calorieGoal);
    tx.delete(ref);
    tx.set(daySnap.ref, nd);
    const update = statsUpdate([['stats.xp', nd.foodPoints - d.foodPoints], ['stats.goalDays', hit(nd.foodPoints) - hit(d.foodPoints)]]);
    if (Object.keys(update).length) tx.update(userRef(), update);
  });
}

export async function foodsOn(date) {
  const snap = await getDocs(query(collection(db, 'users', pid(), 'foods'), where('date', '==', date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

// Copies every entry of one meal to another day.
export async function copyMeal(me, fromDate, meal, toDate) {
  const items = (await foodsOn(fromDate)).filter((f) => f.meal === meal);
  for (const f of items) await addFood(me, { ...f, date: toDate });
  return items.length;
}

// Foods this member logged before, newest first, one per name, with per-serving values.
export async function recentFoods() {
  const snap = await getDocs(query(collection(db, 'users', pid(), 'foods'), orderBy('createdAt', 'desc'), limit(80)));
  const seen = new Map();
  for (const d of snap.docs) {
    const f = d.data();
    const key = f.name.toLowerCase();
    if (seen.has(key)) continue;
    const per = f.per || { calories: f.calories, proteinG: f.proteinG || 0, carbsG: f.carbsG || 0, fatG: f.fatG || 0 };
    seen.set(key, { name: f.name, serving: f.serving || '1 serving', ...per });
  }
  return [...seen.values()].slice(0, 20);
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
    if (best > u.bestStreak && u.id === pid()) updateDoc(userRef(), { bestStreak: best }).catch(() => {});

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
  return { board, meId: pid() };
}

// ---------- admin ----------

export async function getInviteCode() {
  const snap = await getDoc(doc(db, 'config', 'private'));
  return snap.exists() ? snap.data().inviteCode || '' : '';
}

// An empty code removes the requirement, so anyone with the link can join.
export async function setInviteCode(code) {
  code = String(code || '').trim().slice(0, 60);
  if (code) await setDoc(doc(db, 'config', 'private'), { inviteCode: code });
  else await deleteDoc(doc(db, 'config', 'private'));
}

export async function listMembers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(profileFrom).sort((a, b) => (a.joined || 0) - (b.joined || 0));
}

export async function setRole(memberId, role) {
  if (memberId === pid()) throw new Error('You cannot change your own role.');
  await updateDoc(userRef(memberId), { role: role === 'admin' ? 'admin' : 'member' });
}

// Blocks the account and deletes the member's data. Their login stays, but the rules treat it as locked out.
export async function removeMember(memberId) {
  if (memberId === pid()) throw new Error('You cannot remove yourself.');
  await setDoc(doc(db, 'banned', memberId), { at: serverTimestamp() });
  const [workouts, foods, days] = await Promise.all([
    getDocs(collection(db, 'users', memberId, 'workouts')),
    getDocs(collection(db, 'users', memberId, 'foods')),
    getDocs(query(collection(db, 'days'), where('uid', '==', memberId))),
  ]);
  const refs = [...workouts.docs, ...foods.docs, ...days.docs].map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await deleteDoc(userRef(memberId));
}

// Reset codes look like K7PM-29QX: no 0/O or 1/I/L, so they are easy to read out.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const RESET_HOURS = 24;

// Creates a one-time code the member uses on the sign-in screen. Only its hash is stored.
export async function issueReset(member) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  const batch = writeBatch(db);
  batch.set(doc(db, 'resets', member.id), {
    codeHash: await sha256Hex(code),
    expires: Timestamp.fromMillis(Date.now() + RESET_HOURS * 3600 * 1000),
    createdAt: serverTimestamp(),
  });
  // Members who joined before logins/ existed still sign in with their original address.
  const login = await getDoc(doc(db, 'logins', member.username));
  if (!login.exists()) batch.set(doc(db, 'logins', member.username), { profileId: member.id, email: emailFor(member.username) });
  await batch.commit();
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
