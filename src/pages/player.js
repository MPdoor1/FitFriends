// Live workout mode: walks through a routine step by step with timers, then logs it.
// The session lives in localStorage so closing the app (or the phone killing it) doesn't lose progress.
// All timing uses timestamps, so a locked screen or a background tab never makes timers drift.
import * as store from '../store.js';
import { state } from '../state.js';
import { flatten, clock, intervalRoutine, countdownRoutine } from '../routines.js';
import { INTENSITY, workoutCalories, workoutPoints } from '../scoring.js';
import {
  $, $$, esc, fmt, icon, label, localDate, toast, pointsPop, haptic, openSheet, closeSheet, stepper, bindSteppers,
} from '../ui.js';
import { weightUnit, toDisplayWeight, fromDisplayWeight, fmtWeight, imperial } from '../units.js';

const KEY = 'ff-session';
const PREFS_KEY = 'ff-player';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

let session = read(KEY);
const prefs = { sound: true, voice: false, vibrate: true, ...(read(PREFS_KEY) || {}) };
let history = [];

const save = () => write(KEY, session);
export const activeSession = () => (session && !session.discarded ? session : null);

// ---------- sound, voice, vibration, wake lock ----------

let audio = null;
function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function beep(freq = 880, dur = 0.12, gain = 0.25) {
  if (!prefs.sound || !audio) return;
  try {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch { /* audio unavailable */ }
}
function say(text) {
  if (!prefs.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}
const buzz = (p) => { if (prefs.vibrate) haptic(p); };

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); wakeLock?.addEventListener?.('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
}
function releaseAwake() { try { wakeLock?.release(); } catch { /* already released */ } wakeLock = null; }

// ---------- session control ----------

function describe(it) {
  if (!it) return '';
  if (it.kind === 'set') return `${it.name}, set ${it.set} of ${it.sets}, ${it.reps} reps`;
  if (it.kind === 'rest') return `Rest ${it.seconds} seconds`;
  return `${it.name}, ${it.seconds >= 60 ? `${Math.round(it.seconds / 60)} minutes` : `${it.seconds} seconds`}`;
}

function enter(i, at = Date.now(), quiet = false) {
  const it = session.items[i];
  session.i = i;
  session.phase = 'work';
  session.paused = false;
  session.remaining = null;
  session.endsAt = it.kind === 'set' ? null : at + it.seconds * 1000;
  session.beepAt = null;
  save();
  if (!quiet) { say(describe(it)); buzz(15); }
}

function next(at = Date.now(), quiet = false) {
  if (session.i + 1 >= session.items.length) return finish(quiet);
  enter(session.i + 1, at, quiet);
}

function finish(quiet = false) {
  if (session.paused) { session.pausedMs += Date.now() - session.pauseStart; session.paused = false; }
  session.finished = true;
  session.endedAt = session.endedAt || Date.now();
  session.endsAt = null;
  save();
  if (!quiet) { beep(1320, 0.5, 0.3); say('Workout complete. Nice work.'); buzz([60, 40, 60]); }
  releaseAwake();
}

function startRest(at = Date.now()) {
  const it = session.items[session.i];
  session.phase = 'rest';
  session.endsAt = at + it.rest * 1000;
  session.beepAt = null;
  save();
  say(`Rest ${it.rest} seconds. Next: ${describe(session.items[session.i + 1])}`);
}

// Moves past every phase that ended while the app wasn't looking. Returns true if anything changed.
function catchUp() {
  if (!session || session.finished || session.paused) return false;
  let changed = false;
  let guard = 0;
  while (session.endsAt && Date.now() >= session.endsAt && guard++ < 500) {
    const endedAt = session.endsAt;
    const quiet = Date.now() - endedAt > 1500; // long gone: skip the fanfare
    if (!quiet) { beep(1320, 0.35, 0.3); buzz(30); }
    next(endedAt, quiet);
    changed = true;
    if (session.finished) break;
  }
  return changed;
}

export function startSession(routine) {
  if (activeSession() && !activeSession().finished && !confirm(`You have "${activeSession().routine.name}" in progress. Replace it?`)) return;
  unlockAudio();
  session = {
    routine, items: flatten(routine), i: 0, phase: 'work', endsAt: null, remaining: null, paused: false,
    startedAt: Date.now(), pausedMs: 0, pauseStart: null, results: {}, finished: false,
  };
  enter(0);
  location.hash = '#/play';
}

const elapsedMs = () => {
  if (!session) return 0;
  const end = session.finished ? session.endedAt : Date.now();
  return end - session.startedAt - session.pausedMs - (session.paused ? Date.now() - session.pauseStart : 0);
};

function togglePause() {
  if (session.paused) {
    session.pausedMs += Date.now() - session.pauseStart;
    if (session.remaining != null) session.endsAt = Date.now() + session.remaining;
    session.paused = false;
    session.remaining = null;
  } else {
    session.paused = true;
    session.pauseStart = Date.now();
    if (session.endsAt) session.remaining = session.endsAt - Date.now();
  }
  save();
}

function addTime(sec) {
  if (session.paused && session.remaining != null) session.remaining = Math.max(1000, session.remaining + sec * 1000);
  else if (session.endsAt) session.endsAt = Math.max(Date.now() + 1000, session.endsAt + sec * 1000);
  save();
}

export function sessionBanner() {
  const s = activeSession();
  if (!s) return '';
  return `
    <a class="card resume-banner" href="#/play">
      ${icon(s.finished ? 'check' : 'play', 22)}
      <div><strong>${s.finished ? 'Workout finished: save it' : 'Workout in progress'}</strong><span class="muted small">${esc(s.routine.name)} · ${clock(elapsedMs() / 1000)}</span></div>
      ${icon('right', 20)}
    </a>`;
}

// ---------- results → workout ----------

function exercisesFrom(s) {
  const out = [];
  s.items.forEach((it, i) => {
    const r = s.results[i];
    if (it.kind !== 'set' || !r) return;
    let ex = out.find((e) => e.name === it.name);
    if (!ex) out.push((ex = { name: it.name, sets: [] }));
    ex.sets.push({ reps: r.reps, weightKg: r.weightKg || 0 });
  });
  return out;
}

const lastWeightFor = (name) => {
  const key = name.toLowerCase();
  for (const w of history) {
    const ex = (w.exercises || []).find((e) => e.name.toLowerCase() === key);
    if (ex?.sets.length) return ex.sets[ex.sets.length - 1];
  }
  return null;
};

// ---------- view ----------

const ring = (frac) => {
  const r = 108;
  const c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 240 240" class="pl-ring"><circle cx="120" cy="120" r="${r}" class="bg"/><circle cx="120" cy="120" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" data-c="${c}"/></svg>`;
};

export async function viewPlayer(app) {
  if (!activeSession()) {
    app.innerHTML = `
      <section class="player empty-player">
        <h1>No workout running</h1>
        <p class="muted">Start a routine or a timer.</p>
        <a class="btn primary big full" href="#/routines">${icon('library', 20)} Routines</a>
        <a class="btn big full" href="#/timers">${icon('timer', 20)} Timers</a>
      </section>`;
    return;
  }
  history = await store.listWorkouts(150).catch(() => []);
  catchUp();
  if (!session.finished) keepAwake();
  draw(app);

  const tickId = setInterval(() => tick(app), 200);
  const onVisible = () => { if (document.visibilityState === 'visible' && session && !session.finished) { keepAwake(); if (catchUp()) draw(app); } };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('hashchange', () => {
    clearInterval(tickId);
    document.removeEventListener('visibilitychange', onVisible);
    releaseAwake();
  }, { once: true });
}

function tick(app) {
  if (!session || session.finished || !$('.player', app)) return;
  const el = $('#pl-elapsed', app);
  if (el) el.textContent = clock(elapsedMs() / 1000);
  if (session.paused || !session.endsAt) return;
  const left = session.endsAt - Date.now();
  if (left <= 0) {
    catchUp();
    draw(app);
    return;
  }
  const secs = Math.ceil(left / 1000);
  const t = $('#pl-time', app);
  if (t) t.textContent = clock(left / 1000);
  const fg = $('.pl-ring .fg', app);
  if (fg) {
    const total = session.phase === 'rest' ? session.items[session.i].rest * 1000 : session.items[session.i].seconds * 1000;
    fg.style.strokeDashoffset = Number(fg.dataset.c) * (1 - Math.max(0, left) / total);
  }
  if (secs <= 3 && session.beepAt !== secs) {
    session.beepAt = secs;
    beep(880, 0.12);
    buzz(8);
  }
}

function draw(app) {
  const s = session;
  if (s.finished) return drawFinish(app);
  const u = state.user.units;
  const it = s.items[s.i];
  const upcoming = s.items[s.i + 1];
  const rounds = s.routine.rounds || 1;
  const pct = (s.i / s.items.length) * 100;
  const timedPhase = s.phase === 'rest' || it.kind !== 'set';
  const totalMs = s.phase === 'rest' ? it.rest * 1000 : (it.seconds || 0) * 1000;
  const left = s.paused ? s.remaining : s.endsAt ? s.endsAt - Date.now() : 0;
  const isRest = s.phase === 'rest' || it.kind === 'rest';
  const last = it.kind === 'set' ? lastWeightFor(it.name) : null;
  const done = s.results[s.i];
  const startWeight = done?.weightKg ?? it.weightKg ?? last?.weightKg ?? null;

  let main;
  if (timedPhase) {
    main = `
      <div class="pl-stage ${isRest ? 'rest' : 'work'}">
        <span class="pl-kicker">${isRest ? 'Rest' : it.kind === 'timed' ? 'Go' : ''}</span>
        <h1 class="pl-name">${esc(isRest ? (upcoming ? `Next: ${upcoming.name}` : 'Rest') : it.name)}</h1>
        <div class="pl-clock">
          ${ring(totalMs ? Math.max(0, left) / totalMs : 0)}
          <div class="pl-clock-text"><strong class="num" id="pl-time">${clock(left / 1000)}</strong>${s.paused ? '<span>Paused</span>' : ''}</div>
        </div>
        <div class="pl-adjust">
          <button class="btn small-btn" data-add="-15">−15s</button>
          <button class="btn small-btn" data-add="15">+15s</button>
        </div>
      </div>`;
  } else {
    main = `
      <div class="pl-stage work">
        <span class="pl-kicker">Set ${it.set} of ${it.sets}</span>
        <h1 class="pl-name">${esc(it.name)}</h1>
        <p class="pl-target">Target ${it.reps} reps${it.weightKg ? ` · ${fmtWeight(it.weightKg, u)}` : ''}</p>
        ${last ? `<p class="ex-last">${icon('history', 14)} Last time: ${last.reps} × ${last.weightKg ? fmtWeight(last.weightKg, u) : 'bodyweight'}</p>` : ''}
        <div class="pl-inputs">
          <div><span class="field-label">Reps done</span>${stepper('reps', done?.reps ?? it.reps, { min: 0, max: 200 })}</div>
          <div><span class="field-label">Weight (${weightUnit(u)})</span>${stepper('weight', startWeight != null ? toDisplayWeight(startWeight, u) : '', { step: imperial(u) ? 5 : 2.5, min: 0, max: 1500, decimals: 1 })}</div>
        </div>
      </div>`;
  }

  const mainBtn = timedPhase
    ? `<button class="pl-main-btn" id="pl-pause">${icon(s.paused ? 'play' : 'pause', 34)}<span>${s.paused ? 'Resume' : 'Pause'}</span></button>`
    : `<button class="pl-main-btn done" id="pl-done">${icon('check', 34)}<span>Done set</span></button>`;

  app.innerHTML = `
    <section class="player">
      <header class="pl-top">
        <button class="icon-btn" id="pl-exit" aria-label="End workout">${icon('x', 20)}</button>
        <div class="pl-title"><b>${esc(s.routine.name)}</b><span class="muted small">${rounds > 1 ? `Round ${it.round} of ${rounds} · ` : ''}Step ${s.i + 1} of ${s.items.length}</span></div>
        <span class="num pl-elapsed" id="pl-elapsed">${clock(elapsedMs() / 1000)}</span>
      </header>
      <div class="pl-progress"><div style="width:${pct}%"></div></div>
      ${main}
      <div class="pl-next">${upcoming ? `<span class="muted small">Up next</span><b>${esc(upcoming.kind === 'set' ? `${upcoming.name} · set ${upcoming.set}` : upcoming.name)}</b>${upcoming.seconds ? `<span class="num">${clock(upcoming.seconds)}</span>` : ''}` : '<b>Last one. Finish strong.</b>'}</div>
      <footer class="pl-controls">
        <button class="pl-side" id="pl-prev" ${s.i === 0 && s.phase === 'work' ? 'disabled' : ''}>${icon('prev', 24)}<span>Back</span></button>
        ${mainBtn}
        <button class="pl-side" id="pl-skip">${icon('skip', 24)}<span>${s.phase === 'rest' ? 'Skip rest' : 'Skip'}</span></button>
      </footer>
      <div class="pl-prefs">
        <button class="chip ${prefs.sound ? 'on' : ''}" data-pref="sound">${icon(prefs.sound ? 'sound' : 'mute', 14)} Beeps</button>
        <button class="chip ${prefs.voice ? 'on' : ''}" data-pref="voice">${icon('voice', 14)} Voice</button>
        <button class="chip ${prefs.vibrate ? 'on' : ''}" data-pref="vibrate">${icon('phone', 14)} Vibrate</button>
      </div>
    </section>`;

  bindSteppers(app);
  const act = (fn) => () => { unlockAudio(); fn(); draw(app); };
  $('#pl-pause')?.addEventListener('click', act(togglePause));
  $('#pl-done')?.addEventListener('click', act(() => {
    s.results[s.i] = {
      reps: Math.max(0, Math.round(Number($('[name=reps]', app).value) || 0)),
      weightKg: fromDisplayWeight($('[name=weight]', app).value, u) || 0,
    };
    buzz(15);
    if (it.rest > 0 && upcoming) startRest(); else next();
    save();
  }));
  $('#pl-skip').addEventListener('click', act(() => next()));
  $('#pl-prev').addEventListener('click', act(() => {
    if (s.phase === 'rest') { s.phase = 'work'; s.endsAt = null; save(); } else if (s.i > 0) enter(s.i - 1);
  }));
  $$('[data-add]', app).forEach((b) => b.addEventListener('click', act(() => addTime(Number(b.dataset.add)))));
  $$('[data-pref]', app).forEach((b) => b.addEventListener('click', act(() => {
    prefs[b.dataset.pref] = !prefs[b.dataset.pref];
    write(PREFS_KEY, prefs);
    if (b.dataset.pref === 'voice' && prefs.voice) say('Voice on');
  })));
  $('#pl-exit').addEventListener('click', () => openSheet({
    title: 'End workout?',
    html: `
      <div class="options">
        <button class="option" id="ex-finish"><strong>Finish and save</strong><span class="muted">Log what you've done so far</span>${icon('check', 20)}</button>
        <button class="option" id="ex-keep"><strong>Keep going</strong><span class="muted">Back to the workout</span>${icon('play', 20)}</button>
        <button class="option" id="ex-discard"><strong>Discard</strong><span class="muted">Throw this session away</span>${icon('trash', 20)}</button>
      </div>`,
    onMount(sheet) {
      $('#ex-finish', sheet).addEventListener('click', () => { closeSheet(); finish(true); draw(app); });
      $('#ex-keep', sheet).addEventListener('click', closeSheet);
      $('#ex-discard', sheet).addEventListener('click', () => { closeSheet(); discard(); });
    },
  }));
}

function discard() {
  const timer = session?.routine.kind === 'timer';
  session = null;
  write(KEY, null);
  releaseAwake();
  location.hash = timer ? '#/timers' : '#/train';
}

function drawFinish(app) {
  const s = session;
  const u = state.user.units;
  const ex = exercisesFrom(s);
  const mins = Math.max(1, Math.round(elapsedMs() / 60000));
  const setsDone = ex.reduce((t, e) => t + e.sets.length, 0);
  const volume = ex.reduce((t, e) => t + e.sets.reduce((v, x) => v + x.reps * x.weightKg, 0), 0);
  const timer = s.routine.kind === 'timer';
  let intensity = s.routine.intensity || 'moderate';
  const type = s.routine.type || 'Other';
  const estimate = () => `
    <div><b class="num">~${fmt(workoutCalories(type, intensity, mins, state.user.weightKg))}</b><span>kcal</span></div>
    <div><b class="num">+${workoutPoints(intensity, mins)}</b><span>points</span></div>`;

  app.innerHTML = `
    <section class="player finish">
      <div class="finish-hero">${icon('flag', 40)}<h1>${timer ? 'Time!' : 'Workout done'}</h1><p class="muted">${esc(s.routine.name)}</p></div>
      <div class="finish-stats">
        <div><b class="num">${clock(elapsedMs() / 1000)}</b><span>time</span></div>
        ${setsDone ? `<div><b class="num">${setsDone}</b><span>sets</span></div>` : ''}
        ${volume ? `<div><b class="num">${fmtWeight(volume, u, 0)}</b><span>volume</span></div>` : ''}
        <div id="fin-est" class="contents">${estimate()}</div>
      </div>
      ${ex.length ? `<div class="card">${ex.map((e) => `<div class="ex-line"><b>${esc(e.name)}</b><span class="muted">${e.sets.map((x) => `${x.reps}${x.weightKg ? `×${toDisplayWeight(x.weightKg, u)}` : ''}`).join(', ')}</span></div>`).join('')}</div>` : ''}
      <div class="card stack">
        <div><span class="field-label">How hard was it?</span>
          <div class="seg">${Object.entries(INTENSITY).map(([k, v]) => `<button type="button" data-int="${k}" class="${k === intensity ? 'on' : ''}">${v.label}</button>`).join('')}</div>
        </div>
        <label>Notes<textarea id="fin-notes" rows="2" maxlength="500" placeholder="How did it feel?"></textarea></label>
      </div>
      <button class="btn ${timer ? '' : 'primary'} big full" id="fin-save">${icon('check', 20)} ${timer ? 'Log as a workout' : 'Save to my log'}</button>
      ${timer ? '<button class="btn primary big full" id="fin-done">Done</button>' : ''}
      <button class="btn ghost-danger full" id="fin-discard">${timer ? 'Close without logging' : 'Discard workout'}</button>
    </section>`;

  $$('[data-int]', app).forEach((b) => b.addEventListener('click', () => {
    intensity = b.dataset.int;
    $$('[data-int]', app).forEach((x) => x.classList.toggle('on', x === b));
    $('#fin-est', app).innerHTML = estimate();
  }));
  $('#fin-done')?.addEventListener('click', discard);
  $('#fin-discard').addEventListener('click', () => { if (timer || confirm('Discard this workout? It will not be logged.')) discard(); });
  $('#fin-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const r = s.routine;
    const friendsRoutine = r.owner && r.owner !== state.user.id;
    try {
      const w = await store.addWorkout(state.user, {
        type, intensity, date: localDate(), durationMin: mins, exercises: ex,
        notes: $('#fin-notes', app).value || (timer ? r.name : `Routine: ${r.name}`),
        routineId: r.id || null, routineName: timer ? null : r.name, routineOwner: friendsRoutine ? r.owner : null,
      });
      if (friendsRoutine && r.shared) store.countRoutineUse(r.id);
      session = null;
      write(KEY, null);
      pointsPop(w.points);
      toast(`${w.type} logged · +${w.points} pts`);
      location.hash = '#/train';
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  });
}

// ---------- timers page ----------

const SW_KEY = 'ff-stopwatch';
let sw = { running: false, startedAt: 0, before: 0, laps: [], ...(read(SW_KEY) || {}) };
const swElapsed = () => sw.before + (sw.running ? Date.now() - sw.startedAt : 0);
let timerTab = 'intervals';
const iv = { work: 20, rest: 10, rounds: 8 };
const cd = { min: 5, sec: 0 };
const IV_PRESETS = [['Tabata', 20, 10, 8], ['30 / 30', 30, 30, 10], ['40 / 20', 40, 20, 8], ['EMOM 10', 60, 0, 10], ['Sprints', 15, 45, 10]];

export async function viewTimers(app) {
  const banner = sessionBanner();
  const ivTotal = iv.rounds * iv.work + (iv.rounds - 1) * iv.rest;
  app.innerHTML = `<div id="timers">
    <a class="back" href="#/train">${icon('left', 18)} Train</a>
    ${label('Timers')}
    <h1 class="page-title">Timers</h1>
    ${banner}
    <div class="seg period">
      ${[['intervals', 'Intervals'], ['countdown', 'Countdown'], ['stopwatch', 'Stopwatch']].map(([k, l]) => `<button data-tab="${k}" class="${k === timerTab ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    ${timerTab === 'intervals' ? `
      <section class="card stack">
        <div class="chips">${IV_PRESETS.map(([n, w, r, k]) => `<button class="chip ${iv.work === w && iv.rest === r && iv.rounds === k ? 'on' : ''}" data-iv="${w},${r},${k}">${n}</button>`).join('')}</div>
        <div><span class="field-label">Work</span>${stepper('work', iv.work, { step: 5, min: 5, max: 900, unit: 'sec' })}</div>
        <div><span class="field-label">Rest</span>${stepper('rest', iv.rest, { step: 5, min: 0, max: 900, unit: 'sec' })}</div>
        <div><span class="field-label">Rounds</span>${stepper('rounds', iv.rounds, { min: 1, max: 99 })}</div>
        <p class="muted small" id="iv-total">Total ${clock(ivTotal)}</p>
        <button class="btn primary big full" id="iv-start">${icon('play', 20)} Start intervals</button>
      </section>` : ''}
    ${timerTab === 'countdown' ? `
      <section class="card stack">
        <div class="chips">${[1, 2, 3, 5, 10, 15, 20, 30].map((m) => `<button class="chip ${cd.min === m && !cd.sec ? 'on' : ''}" data-cd="${m}">${m} min</button>`).join('')}</div>
        <div class="fields">
          <div><span class="field-label">Minutes</span>${stepper('min', cd.min, { min: 0, max: 240 })}</div>
          <div><span class="field-label">Seconds</span>${stepper('sec', cd.sec, { step: 5, min: 0, max: 55 })}</div>
        </div>
        <button class="btn primary big full" id="cd-start">${icon('play', 20)} Start countdown</button>
      </section>` : ''}
    ${timerTab === 'stopwatch' ? `
      <section class="card stopwatch">
        <strong class="num sw-time" id="sw-time">${swText(swElapsed())}</strong>
        <div class="row gap sw-buttons">
          <button class="btn big ${sw.running ? '' : 'primary'}" id="sw-go">${icon(sw.running ? 'pause' : 'play', 20)} ${sw.running ? 'Pause' : sw.before ? 'Resume' : 'Start'}</button>
          <button class="btn big" id="sw-lap" ${sw.running ? '' : 'disabled'}>${icon('flag', 20)} Lap</button>
          <button class="btn big" id="sw-reset" ${sw.running || !sw.before ? 'disabled' : ''}>${icon('reset', 20)} Reset</button>
        </div>
        ${sw.laps.length ? `<ol class="laps">${sw.laps.map((t, i) => `<li><span>Lap ${i + 1}</span><span class="num">${swText(t - (sw.laps[i - 1] || 0))}</span><span class="num muted">${swText(t)}</span></li>`).reverse().join('')}</ol>` : ''}
      </section>` : ''}</div>`;

  bindSteppers(app);
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { timerTab = b.dataset.tab; viewTimers(app); }));
  $$('[data-iv]').forEach((b) => b.addEventListener('click', () => { [iv.work, iv.rest, iv.rounds] = b.dataset.iv.split(',').map(Number); viewTimers(app); }));
  $$('[data-cd]').forEach((b) => b.addEventListener('click', () => { cd.min = Number(b.dataset.cd); cd.sec = 0; viewTimers(app); }));
  const val = (n) => Number($(`[name=${n}]`, app)?.value) || 0;
  $('#timers').addEventListener('input', () => {
    if (timerTab === 'intervals') {
      iv.work = Math.max(5, val('work')); iv.rest = Math.max(0, val('rest')); iv.rounds = Math.max(1, val('rounds'));
      $('#iv-total').textContent = `Total ${clock(iv.rounds * iv.work + (iv.rounds - 1) * iv.rest)}`;
    } else if (timerTab === 'countdown') { cd.min = val('min'); cd.sec = val('sec'); }
  });
  $('#iv-start')?.addEventListener('click', () => startSession(intervalRoutine(iv.work, iv.rest, iv.rounds)));
  $('#cd-start')?.addEventListener('click', () => {
    const total = cd.min * 60 + cd.sec;
    if (total < 5) { toast('Set at least 5 seconds', 'bad'); return; }
    startSession(countdownRoutine(total));
  });
  if (timerTab === 'stopwatch') {
    const id = setInterval(() => { const el = $('#sw-time'); if (!el) return clearInterval(id); el.textContent = swText(swElapsed()); }, 50);
    window.addEventListener('hashchange', () => clearInterval(id), { once: true });
    const persist = () => write(SW_KEY, sw);
    $('#sw-go').addEventListener('click', () => {
      if (sw.running) { sw.before = swElapsed(); sw.running = false; } else { sw.startedAt = Date.now(); sw.running = true; }
      persist(); haptic(10); viewTimers(app);
    });
    $('#sw-lap').addEventListener('click', () => { sw.laps.push(swElapsed()); persist(); haptic(8); viewTimers(app); });
    $('#sw-reset').addEventListener('click', () => { sw = { running: false, startedAt: 0, before: 0, laps: [] }; persist(); viewTimers(app); });
  }
}

const swText = (ms) => {
  const cs = Math.floor(ms / 10) % 100;
  return `${clock(ms / 1000 - (ms % 1000) / 1000)}.${String(cs).padStart(2, '0')}`;
};

