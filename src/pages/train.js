import * as store from '../store.js';
import { state } from '../state.js';
import { WORKOUT_TYPES, INTENSITY, workoutCalories, workoutPoints } from '../scoring.js';
import { ALL_EXERCISES, DISTANCE_TYPES, STRENGTH_TYPES } from '../data.js';
import {
  $, $$, esc, fmt, icon, label, localDate, shiftDate, weekStart, prettyDate, dayLetter, shortDate, datesBetween,
  toast, pointsPop, haptic, openSheet, closeSheet, stepper, bindSteppers, barChart, bindCharts,
} from '../ui.js';
import { weightUnit, toDisplayWeight, fromDisplayWeight, distUnit, toDisplayDist, fromDisplayDist, fmtDist, fmtWeight, paceText } from '../units.js';
import { sessionBanner } from './player.js';
import { trackBanner, routeMap, openRouteSheet, openGpxImport, routeSvg } from './track.js';

const clockPace = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const INTENSITY_HINTS = { light: 'Easy, could chat', moderate: 'Working, a bit breathless', hard: 'All out, can barely talk' };

// Epley estimate of a one-rep max.
const est1rm = (s) => (s.reps === 1 ? s.weightKg : s.weightKg * (1 + s.reps / 30));
const volumeKg = (exercises) => (exercises || []).reduce((t, ex) => t + ex.sets.reduce((u, s) => u + s.reps * s.weightKg, 0), 0);

// Best set per exercise across workouts: { name: { set, e1rm, date } }.
export function personalRecords(workouts, excludeId = null) {
  const prs = {};
  for (const w of workouts) {
    if (w.id === excludeId) continue;
    for (const ex of w.exercises || []) {
      for (const s of ex.sets) {
        if (!s.weightKg) continue;
        const key = ex.name.toLowerCase();
        const e = est1rm(s);
        if (!prs[key] || e > prs[key].e1rm) prs[key] = { name: ex.name, set: s, e1rm: e, date: w.date };
      }
    }
  }
  return prs;
}

function lastTimeFor(workouts, name, excludeId) {
  const key = name.trim().toLowerCase();
  for (const w of workouts) {
    if (w.id === excludeId) continue;
    const ex = (w.exercises || []).find((e) => e.name.toLowerCase() === key);
    if (ex) return { date: w.date, sets: ex.sets };
  }
  return null;
}

function setsSummary(sets, units) {
  if (!sets.length) return '';
  const same = sets.every((s) => s.reps === sets[0].reps && s.weightKg === sets[0].weightKg);
  const w = (s) => (s.weightKg ? ` @ ${toDisplayWeight(s.weightKg, units)} ${weightUnit(units)}` : '');
  if (same) return `${sets.length}×${sets[0].reps}${w(sets[0])}`;
  return sets.map((s) => `${s.reps}${s.weightKg ? `×${toDisplayWeight(s.weightKg, units)}` : ''}`).join(', ') + (sets.some((s) => s.weightKg) ? ` ${weightUnit(units)}` : ' reps');
}

// ---------- workout sheet ----------

// Opens the log/edit panel. Pass workout to edit, or template (no id) to prefill a repeat.
export async function openWorkoutSheet({ workout = null, template = null } = {}) {
  const u = state.user.units;
  const editing = Boolean(workout?.id);
  const src = workout || template || {};
  const history = await store.listWorkouts(200).catch(() => []);
  const today = localDate();
  const form = {
    type: src.type || 'Running',
    intensity: src.intensity || 'moderate',
    date: editing ? src.date : today,
    durationMin: src.durationMin || 30,
    distance: src.distanceKm != null ? toDisplayDist(src.distanceKm, u) : '',
    avgHr: src.avgHr || '',
    notes: src.notes || '',
    exercises: (src.exercises || []).map((ex) => ({ name: ex.name, sets: ex.sets.map((s) => ({ reps: s.reps, weight: s.weightKg ? toDisplayWeight(s.weightKg, u) : '' })) })),
  };
  const showExercises = () => form.exercises.length > 0 || STRENGTH_TYPES.includes(form.type);
  if (STRENGTH_TYPES.includes(form.type) && !form.exercises.length) form.exercises.push({ name: '', sets: [{ reps: 8, weight: '' }] });

  const exerciseNames = [...new Set([...history.flatMap((w) => (w.exercises || []).map((e) => e.name)), ...ALL_EXERCISES])];

  const exerciseCard = (ex, i) => {
    const last = ex.name ? lastTimeFor(history, ex.name, workout?.id) : null;
    return `
      <div class="ex-card" data-ex="${i}">
        <div class="ex-head">
          <input class="ex-name" list="ex-list" value="${esc(ex.name)}" placeholder="Exercise, e.g. Bench Press" aria-label="Exercise name">
          <button type="button" class="icon-btn" data-remove-ex="${i}" aria-label="Remove exercise">${icon('trash', 16)}</button>
        </div>
        ${last ? `<p class="ex-last">${icon('history', 14)} Last time (${shortDate(last.date)}): ${esc(setsSummary(last.sets, u))}</p>` : ''}
        <div class="sets">
          <div class="set-row set-head"><span>Set</span><span>Reps</span><span>${weightUnit(u)}</span><span></span></div>
          ${ex.sets.map((s, j) => `
            <div class="set-row" data-set="${j}">
              <span class="set-n num">${j + 1}</span>
              <input class="set-reps" type="number" inputmode="numeric" min="1" value="${s.reps}" aria-label="Reps">
              <input class="set-weight" type="number" inputmode="decimal" min="0" step="any" value="${s.weight}" placeholder="BW" aria-label="Weight">
              <button type="button" class="icon-btn small" data-remove-set="${j}" aria-label="Remove set">${icon('x', 14)}</button>
            </div>`).join('')}
        </div>
        <button type="button" class="btn small-btn ghost" data-add-set="${i}">${icon('plus', 16)} Add set</button>
      </div>`;
  };

  const html = `
    <form id="ws-form" class="stack" novalidate>
      <div class="type-grid compact" role="radiogroup" aria-label="Workout type">
        ${WORKOUT_TYPES.map((t) => `<button type="button" role="radio" aria-checked="${t.name === form.type}" class="type-btn ${t.name === form.type ? 'on' : ''}" data-type="${esc(t.name)}">${icon(t.name, 20)}<span>${esc(t.name)}</span></button>`).join('')}
      </div>

      <div>
        <span class="field-label">How hard?</span>
        <div class="seg tall" role="radiogroup">
          ${Object.entries(INTENSITY).map(([k, v]) => `<button type="button" data-int="${k}" class="${k === form.intensity ? 'on' : ''}"><b>${v.label}</b><small>${INTENSITY_HINTS[k]}</small></button>`).join('')}
        </div>
      </div>

      <div>
        <span class="field-label">Duration</span>
        ${stepper('durationMin', form.durationMin, { step: 5, min: 1, max: 600, unit: 'min' })}
        <div class="chips tight">${[15, 30, 45, 60, 90].map((m) => `<button type="button" class="chip" data-mins="${m}">${m} min</button>`).join('')}</div>
      </div>

      <div id="dist-block" ${DISTANCE_TYPES.includes(form.type) ? '' : 'hidden'}>
        <span class="field-label">Distance <span class="opt">optional</span></span>
        ${stepper('distance', form.distance, { step: 0.5, min: 0, max: 600, unit: distUnit(u), decimals: 2 })}
        <p class="hint" id="pace"></p>
      </div>

      <div id="ex-block" ${showExercises() ? '' : 'hidden'}>
        <span class="field-label">Exercises</span>
        <div id="ex-list-wrap"></div>
        <button type="button" class="btn ghost full" id="add-ex">${icon('plus', 18)} Add exercise</button>
      </div>
      <button type="button" class="btn ghost full" id="show-ex" ${showExercises() ? 'hidden' : ''}>${icon('plus', 18)} Add sets &amp; reps</button>

      <div>
        <span class="field-label">When</span>
        <div class="chips tight">
          <button type="button" class="chip ${form.date === today ? 'on' : ''}" data-date="${today}">Today</button>
          <button type="button" class="chip ${form.date === shiftDate(today, -1) ? 'on' : ''}" data-date="${shiftDate(today, -1)}">Yesterday</button>
          <input type="date" name="date" value="${form.date}" max="${today}" class="date-inline" aria-label="Date">
        </div>
      </div>

      <details class="more" ${form.avgHr || form.notes ? 'open' : ''}>
        <summary>${icon('down', 18)} More details</summary>
        <div class="stack">
          <label>Average heart rate <span class="opt">bpm, optional</span><input name="avgHr" type="number" inputmode="numeric" min="40" max="230" value="${form.avgHr}"></label>
          <label>Notes<textarea name="notes" rows="2" maxlength="500" placeholder="How did it feel? Route, splits, anything.">${esc(form.notes)}</textarea></label>
        </div>
      </details>
      <datalist id="ex-list">${exerciseNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    </form>`;

  const footer = `
    <div class="sheet-summary" id="ws-summary"></div>
    <button class="btn primary big full" id="ws-save">${editing ? 'Save changes' : 'Log workout'}</button>`;

  openSheet({
    title: editing ? 'Edit workout' : 'Log a workout',
    html,
    footer,
    onMount(sheet) {
      const f = $('#ws-form', sheet);
      bindSteppers(sheet);

      const readExercises = () => {
        form.exercises = $$('.ex-card', sheet).map((card) => ({
          name: $('.ex-name', card).value,
          sets: $$('.set-row[data-set]', card).map((row) => ({ reps: $('.set-reps', row).value, weight: $('.set-weight', row).value })),
        }));
      };
      const drawExercises = () => {
        $('#ex-list-wrap', sheet).innerHTML = form.exercises.map(exerciseCard).join('');
        summary();
      };
      const summary = () => {
        const mins = Math.min(Number(f.durationMin.value) || 0, 600);
        const kcal = workoutCalories(form.type, form.intensity, mins, state.user.weightKg);
        const pts = workoutPoints(form.intensity, mins);
        readExercisesSafe();
        const vol = form.exercises.reduce((t, ex) => t + ex.sets.reduce((s, x) => s + (Number(x.reps) || 0) * (Number(x.weight) || 0), 0), 0);
        const sets = form.exercises.reduce((t, ex) => t + ex.sets.filter((x) => Number(x.reps) > 0).length, 0);
        $('#ws-summary', sheet).innerHTML = `
          <span>${icon('flame', 16)}<b class="num">~${fmt(kcal)}</b> kcal</span>
          <span>${icon('zap', 16)}<b class="num">+${fmt(pts)}</b> pts</span>
          ${sets ? `<span>${icon('train', 16)}<b class="num">${sets}</b> sets${vol ? ` · <b class="num">${fmt(vol)}</b> ${weightUnit(u)}` : ''}</span>` : ''}`;
        const dist = Number(f.distance.value);
        $('#pace', sheet).textContent = dist > 0 && mins > 0 ? `Pace ${paceText(form.type, mins, fromDisplayDist(dist, u), u)}` : '';
      };
      const readExercisesSafe = () => { if ($$('.ex-card', sheet).length) readExercises(); };

      $$('.type-btn', sheet).forEach((b) => b.addEventListener('click', () => {
        form.type = b.dataset.type;
        $$('.type-btn', sheet).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
        $('#dist-block', sheet).hidden = !DISTANCE_TYPES.includes(form.type);
        if (STRENGTH_TYPES.includes(form.type) && !form.exercises.length) {
          form.exercises.push({ name: '', sets: [{ reps: 8, weight: '' }] });
          drawExercises();
        }
        $('#ex-block', sheet).hidden = !showExercises();
        $('#show-ex', sheet).hidden = showExercises();
        summary();
        haptic(5);
      }));
      $$('[data-int]', sheet).forEach((b) => b.addEventListener('click', () => {
        form.intensity = b.dataset.int;
        $$('[data-int]', sheet).forEach((x) => x.classList.toggle('on', x === b));
        summary();
      }));
      $$('[data-mins]', sheet).forEach((b) => b.addEventListener('click', () => { f.durationMin.value = b.dataset.mins; summary(); haptic(5); }));
      $$('[data-date]', sheet).forEach((b) => b.addEventListener('click', () => {
        f.date.value = b.dataset.date;
        $$('[data-date]', sheet).forEach((x) => x.classList.toggle('on', x === b));
      }));
      f.date.addEventListener('change', () => $$('[data-date]', sheet).forEach((x) => x.classList.toggle('on', x.dataset.date === f.date.value)));
      f.addEventListener('input', summary);

      $('#show-ex', sheet).addEventListener('click', () => {
        form.exercises.push({ name: '', sets: [{ reps: 10, weight: '' }] });
        $('#ex-block', sheet).hidden = false;
        $('#show-ex', sheet).hidden = true;
        drawExercises();
        $('.ex-name', sheet)?.focus();
      });
      $('#add-ex', sheet).addEventListener('click', () => {
        readExercises();
        form.exercises.push({ name: '', sets: [{ reps: 10, weight: '' }] });
        drawExercises();
        $$('.ex-name', sheet).pop()?.focus();
      });
      $('#ex-list-wrap', sheet).addEventListener('click', (e) => {
        const card = e.target.closest('.ex-card');
        if (!card) return;
        const i = Number(card.dataset.ex);
        if (e.target.closest('[data-add-set]')) {
          readExercises();
          const sets = form.exercises[i].sets;
          sets.push({ ...(sets[sets.length - 1] || { reps: 10, weight: '' }) });
          drawExercises();
          haptic(5);
        } else if (e.target.closest('[data-remove-set]')) {
          readExercises();
          form.exercises[i].sets.splice(Number(e.target.closest('[data-remove-set]').dataset.removeSet), 1);
          if (!form.exercises[i].sets.length) form.exercises.splice(i, 1);
          drawExercises();
        } else if (e.target.closest('[data-remove-ex]')) {
          readExercises();
          form.exercises.splice(i, 1);
          drawExercises();
        }
      });
      // Show "last time" once a known exercise name is picked.
      $('#ex-list-wrap', sheet).addEventListener('change', (e) => {
        if (e.target.classList.contains('ex-name')) { readExercises(); drawExercises(); }
      });
      drawExercises();

      $('#ws-save', sheet.parentElement).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        readExercisesSafe();
        const input = {
          type: form.type,
          intensity: form.intensity,
          date: f.date.value,
          durationMin: f.durationMin.value,
          distanceKm: DISTANCE_TYPES.includes(form.type) && Number(f.distance.value) > 0 ? fromDisplayDist(f.distance.value, u) : null,
          avgHr: f.avgHr.value,
          notes: f.notes.value,
          exercises: form.exercises.map((ex) => ({ name: ex.name, sets: ex.sets.map((s) => ({ reps: s.reps, weightKg: fromDisplayWeight(s.weight, u) || 0 })) })),
          // A GPS route stays with the workout it was recorded on.
          ...(editing && workout.route ? { route: workout.route, splits: workout.splits, splitUnit: workout.splitUnit, elevGainM: workout.elevGainM } : {}),
        };
        btn.disabled = true;
        try {
          const saved = editing ? await store.updateWorkout(state.user, workout, input) : await store.addWorkout(state.user, input);
          closeSheet();
          haptic(20);
          // Personal records: compare against everything logged before this workout.
          const before = personalRecords(history, saved.id);
          const now = personalRecords([saved]);
          const newPrs = Object.entries(now).filter(([k, v]) => before[k] && v.e1rm > before[k].e1rm + 0.01);
          if (!editing) pointsPop(saved.points);
          if (newPrs.length) {
            const [, pr] = newPrs[0];
            toast(`New record: ${pr.name} ${fmtWeight(pr.set.weightKg, u, 1)} × ${pr.set.reps}`);
          } else {
            toast(editing ? 'Workout updated' : `${saved.type} logged · +${saved.points} pts`);
          }
          state.rerender();
        } catch (err) {
          toast(err.message, 'bad');
          btn.disabled = false;
        }
      });
      summary();
    },
  });
}

// ---------- page ----------

let typeFilter = 'All';
let expanded = null;

export async function viewTrain(app, stale) {
  const u = state.user.units;
  const today = localDate();
  const from = shiftDate(today, -13);
  const [workouts, days] = await Promise.all([store.listWorkouts(), store.myDays(shiftDate(today, -30), today)]);
  if (stale()) return;

  const wk = datesBetween(weekStart(today), today).map((d) => days[d]).filter(Boolean);
  const sum = (arr, k) => arr.reduce((t, d) => t + (d[k] || 0), 0);
  const chartDays = datesBetween(from, today);
  const prs = Object.values(personalRecords(workouts)).sort((a, b) => b.date.localeCompare(a.date));
  const monthTypes = {};
  for (const w of workouts.filter((x) => x.date >= shiftDate(today, -29))) monthTypes[w.type] = (monthTypes[w.type] || 0) + w.durationMin;
  const typeRows = Object.entries(monthTypes).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxType = Math.max(...typeRows.map(([, m]) => m), 1);
  const presentTypes = ['All', ...new Set(workouts.map((w) => w.type))];
  const shown = workouts.filter((w) => typeFilter === 'All' || w.type === typeFilter);
  const grouped = {};
  for (const w of shown) (grouped[w.date] ||= []).push(w);

  app.innerHTML = `
    <div class="page-head">
      <div>${label('Train')}<h1>Workouts</h1></div>
      <div class="row gap"><button class="btn" id="import-gpx" aria-label="Import GPX">${icon('download', 18)} GPX</button><button class="btn primary" id="log-workout">${icon('plus', 18)} Log</button></div>
    </div>

    ${sessionBanner()}
    ${trackBanner()}
    <section class="train-tools">
      <a class="tool-btn wide" href="#/track">${icon('route', 24)}<span><b>Track a run</b><small>GPS map, pace &amp; splits</small></span></a>
      <a class="tool-btn" href="#/routines">${icon('library', 24)}<span><b>Routines</b><small>Build, start &amp; share</small></span></a>
      <a class="tool-btn" href="#/timers">${icon('timer', 24)}<span><b>Timers</b><small>Intervals, countdown, stopwatch</small></span></a>
    </section>

    <section class="stats four">
      <div class="stat">${icon('train', 18)}<strong class="num">${sum(wk, 'wCount')}</strong><span>Workouts this week</span></div>
      <div class="stat">${icon('timer', 18)}<strong class="num">${fmt(sum(wk, 'wMinutes'))}</strong><span>Minutes this week</span></div>
      <div class="stat">${icon('flame', 18)}<strong class="num">${fmt(sum(wk, 'wCalories'))}</strong><span>kcal burned this week</span></div>
      <div class="stat">${icon('zap', 18)}<strong class="num">${fmt(sum(wk, 'wPoints'))}</strong><span>Training points</span></div>
    </section>

    <section class="card">
      <div class="row between head">${label('Last 14 days')}<span class="muted small">Tap a bar</span></div>
      ${barChart(chartDays.map((d) => {
        const x = days[d] || {};
        return { label: dayLetter(d), value: x.wMinutes || 0, dim: !x.wMinutes, tip: `${prettyDate(d)}: ${x.wMinutes || 0} min · ${x.wCount || 0} workout${x.wCount === 1 ? '' : 's'} · ${fmt(x.wCalories)} kcal` };
      }), { unit: ' min' })}
    </section>

    ${prs.length ? `
    <section class="card">
      ${label('Personal records')}
      <ul class="pr-list">
        ${prs.slice(0, 8).map((p) => `
          <li><span class="pr-name">${esc(p.name)}</span><span class="num pr-set">${fmtWeight(p.set.weightKg, u, 1)} × ${p.set.reps}</span><span class="muted small">est. 1RM ${fmtWeight(p.e1rm, u, 0)} · ${shortDate(p.date)}</span></li>`).join('')}
      </ul>
    </section>` : ''}

    ${typeRows.length ? `
    <section class="card">
      ${label('Last 30 days by type')}
      ${typeRows.map(([t, m]) => `
        <div class="type-row">
          <span class="type-ico">${icon(t, 16)}</span><span class="type-name">${esc(t)}</span>
          <div class="cmp-track"><div class="cmp-fill grow-in" style="--w:${(m / maxType) * 100}%; --c:var(--accent)"></div></div>
          <span class="num">${fmt(m)} min</span>
        </div>`).join('')}
    </section>` : ''}

    <section class="card">
      <div class="row between head">${label('History')}<span class="muted small">${shown.length} workout${shown.length === 1 ? '' : 's'}</span></div>
      ${presentTypes.length > 2 ? `<div class="chips scroll">${presentTypes.map((t) => `<button class="chip ${t === typeFilter ? 'on' : ''}" data-filter="${esc(t)}">${t === 'All' ? '' : icon(t, 14)} ${esc(t)}</button>`).join('')}</div>` : ''}
      ${shown.length ? Object.entries(grouped).map(([date, ws]) => `
        <h3 class="day-head">${prettyDate(date)} <span class="num muted">${ws.reduce((s, w) => s + w.points, 0)} pts</span></h3>
        <ul class="list">${ws.map((w) => workoutRow(w, u)).join('')}</ul>`).join('')
        : `<div class="empty"><p>No workouts yet. Your first one is a tap away.</p><button class="btn primary" id="log-first">${icon('plus', 18)} Log a workout</button></div>`}
    </section>`;

  bindCharts(app);
  requestAnimationFrame(() => $$('.grow-in', app).forEach((el) => el.classList.add('go')));
  $('#log-workout').addEventListener('click', () => openWorkoutSheet());
  $('#import-gpx').addEventListener('click', openGpxImport);
  $('#log-first')?.addEventListener('click', () => openWorkoutSheet());
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { typeFilter = b.dataset.filter; state.rerender(); }));
  bindWorkoutRows(app, workouts);
}

export function workoutRow(w, u) {
  const open = expanded === w.id;
  const vol = volumeKg(w.exercises);
  return `
    <li class="item expandable ${open ? 'open' : ''}" data-w="${esc(w.id)}">
      <button type="button" class="item-top" data-toggle="${esc(w.id)}" aria-expanded="${open}">
        ${w.route ? routeSvg(w.route, 'route-thumb', 38) : `<span class="item-ico">${icon(w.type, 20)}</span>`}
        <span class="item-main">
          <strong>${esc(w.type)}</strong>
          ${w.routineName ? `<span class="routine-tag small">${icon('library', 12)} ${esc(w.routineName)}</span>` : ''}
          <span class="muted small">${w.durationMin} min · ${esc(INTENSITY[w.intensity]?.label || w.intensity)}${w.distanceKm ? ` · ${fmtDist(w.distanceKm, u)}` : ''}${w.exercises?.length ? ` · ${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'}` : ''}</span>
        </span>
        <span class="pts num">+${w.points}</span>
      </button>
      ${open ? `
      <div class="item-detail">
        ${w.route ? `<button type="button" class="route-mini" data-route-map="${esc(w.id)}" aria-label="Open map and splits"></button>` : ''}
        <div class="detail-grid">
          <div><span>Calories</span><b class="num">${fmt(w.calories)}</b></div>
          ${w.distanceKm ? `<div><span>Distance</span><b class="num">${fmtDist(w.distanceKm, u)}</b></div><div><span>${['Cycling', 'Rowing'].includes(w.type) ? 'Speed' : 'Pace'}</span><b class="num">${paceText(w.type, w.durationMin, w.distanceKm, u)}</b></div>` : ''}
          ${w.elevGainM ? `<div><span>Climb</span><b class="num">${u === 'metric' ? `${w.elevGainM} m` : `${fmt(w.elevGainM * 3.28084)} ft`}</b></div>` : ''}
          ${w.splits?.length ? `<div><span>Best ${w.splitUnit || 'mi'}</span><b class="num">${clockPace(Math.min(...w.splits))}</b></div>` : ''}
          ${w.avgHr ? `<div><span>Avg HR</span><b class="num">${w.avgHr} bpm</b></div>` : ''}
          ${vol ? `<div><span>Volume</span><b class="num">${fmtWeight(vol, u, 0)}</b></div>` : ''}
        </div>
        ${(w.exercises || []).map((ex) => `<div class="ex-line"><b>${esc(ex.name)}</b><span class="muted">${esc(setsSummary(ex.sets, u))}</span></div>`).join('')}
        ${w.notes ? `<p class="note">${esc(w.notes)}</p>` : ''}
        <div class="item-actions">
          ${w.route ? `<button class="btn small-btn" data-route-open="${esc(w.id)}">${icon('route', 16)} Map &amp; splits</button>` : ''}
          <button class="btn small-btn" data-edit="${esc(w.id)}">${icon('edit', 16)} Edit</button>
          <button class="btn small-btn" data-repeat="${esc(w.id)}">${icon('repeat', 16)} Do again</button>
          <button class="btn small-btn danger-text" data-delete="${esc(w.id)}">${icon('trash', 16)} Delete</button>
        </div>
      </div>` : ''}
    </li>`;
}

export function bindWorkoutRows(root, workouts) {
  const find = (id) => workouts.find((w) => w.id === id);
  $$('[data-toggle]', root).forEach((b) => b.addEventListener('click', () => {
    expanded = expanded === b.dataset.toggle ? null : b.dataset.toggle;
    state.rerender();
  }));
  $$('[data-route-map]', root).forEach((el) => {
    const w = find(el.dataset.routeMap);
    requestAnimationFrame(() => routeMap(el, w.route, { interactive: false }));
    el.addEventListener('click', () => openRouteSheet(w));
  });
  $$('[data-route-open]', root).forEach((b) => b.addEventListener('click', () => openRouteSheet(find(b.dataset.routeOpen))));
  $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => openWorkoutSheet({ workout: find(b.dataset.edit) })));
  $$('[data-repeat]', root).forEach((b) => b.addEventListener('click', () => {
    const { id, date, ...template } = find(b.dataset.repeat);
    openWorkoutSheet({ template });
  }));
  $$('[data-delete]', root).forEach((b) => b.addEventListener('click', async () => {
    const w = find(b.dataset.delete);
    b.disabled = true;
    try {
      await store.deleteWorkout(w);
      expanded = null;
      state.rerender();
      toast(`${w.type} deleted`, {
        action: 'Undo',
        onAction: async () => {
          await store.addWorkout(state.user, { ...w, distanceKm: w.distanceKm });
          state.rerender();
        },
      });
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
  }));
}
