import * as store from '../store.js';
import { state } from '../state.js';
import { STARTERS, STEP_KINDS, summary, estimateSeconds, clock } from '../routines.js';
import { WORKOUT_TYPES, INTENSITY } from '../scoring.js';
import { ALL_EXERCISES } from '../data.js';
import { $, $$, esc, icon, label, toast, haptic, stepper, bindSteppers } from '../ui.js';
import { weightUnit, toDisplayWeight, fromDisplayWeight, fmtWeight } from '../units.js';
import { startSession, sessionBanner } from './player.js';

let tab = 'mine';
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');

function stepLines(r, u) {
  return r.steps.filter((s) => s.kind !== 'rest').slice(0, 4).map((s) => (s.kind === 'sets'
    ? `${esc(s.name)} <span class="muted">${s.sets}×${s.reps}${s.weightKg ? ` @ ${fmtWeight(s.weightKg, u, 0)}` : ''}</span>`
    : `${esc(s.name)} <span class="muted">${clock(s.seconds)}</span>`)).join('<br>')
    + (r.steps.filter((s) => s.kind !== 'rest').length > 4 ? '<br><span class="muted">…</span>' : '');
}

function routineCard(r, mode) {
  const u = state.user.units;
  return `
    <article class="card routine" data-id="${esc(r.id)}">
      <div class="routine-head">
        <span class="item-ico">${icon(r.type, 20)}</span>
        <div class="grow">
          <h3>${esc(r.name)}</h3>
          <span class="muted small">${summary(r)}${mode === 'friends' ? ` · by ${esc(r.ownerName || 'a friend')}` : ''}${r.uses ? ` · done ${r.uses}×` : ''}</span>
        </div>
        ${mode === 'mine' ? `<button class="share-pill ${r.shared ? 'on' : ''}" data-share="${esc(r.id)}" aria-pressed="${r.shared}">${icon(r.shared ? 'globe' : 'lock', 14)} ${r.shared ? 'Shared' : 'Private'}</button>` : ''}
      </div>
      <p class="routine-steps small">${stepLines(r, u)}</p>
      ${r.notes ? `<p class="muted small">${esc(r.notes)}</p>` : ''}
      <div class="routine-actions">
        <button class="btn primary" data-start="${esc(r.id)}">${icon('play', 18)} Start</button>
        ${mode === 'mine' ? `<a class="btn" href="#/routine?id=${encodeURIComponent(r.id)}">${icon('edit', 16)} Edit</a>` : `<button class="btn" data-copy="${esc(r.id)}">${icon('save', 16)} Save a copy</button>`}
      </div>
    </article>`;
}

export async function viewRoutines(app, stale) {
  const [mine, friends] = await Promise.all([store.myRoutines(), store.sharedRoutines()]);
  if (stale()) return;
  const lists = { mine, friends, starters: STARTERS };
  const shown = lists[tab];

  app.innerHTML = `
    <a class="back" href="#/train">${icon('left', 18)} Train</a>
    <div class="page-head">
      <div>${label('Routines')}<h1>Workouts</h1></div>
      <a class="btn primary" href="#/routine">${icon('plus', 18)} New</a>
    </div>
    ${sessionBanner()}
    <div class="seg period">
      <button data-tab="mine" class="${tab === 'mine' ? 'on' : ''}">Mine${mine.length ? ` (${mine.length})` : ''}</button>
      <button data-tab="friends" class="${tab === 'friends' ? 'on' : ''}">Friends${friends.length ? ` (${friends.length})` : ''}</button>
      <button data-tab="starters" class="${tab === 'starters' ? 'on' : ''}">Starters</button>
    </div>
    ${shown.length ? shown.map((r) => routineCard(r, tab)).join('') : `
      <div class="card empty">
        ${tab === 'mine'
          ? `<p>No routines yet. Build one, or start from a ready-made one.</p><div class="row gap wrap" style="justify-content:center"><a class="btn primary" href="#/routine">${icon('plus', 18)} Build a routine</a><button class="btn" data-tab="starters">See starters</button></div>`
          : '<p>No shared routines yet. When a friend shares one, it shows up here.</p>'}
      </div>`}`;

  const find = (id) => [...mine, ...friends, ...STARTERS].find((r) => r.id === id);
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; state.rerender(); }));
  $$('[data-start]').forEach((b) => b.addEventListener('click', () => startSession(find(b.dataset.start))));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const r = find(b.dataset.copy);
    b.disabled = true;
    try {
      await store.saveRoutine(state.user, { ...r, shared: false, copiedFrom: r.id.startsWith('starter-') ? null : r.id });
      haptic(15);
      toast(`Saved “${r.name}” to your routines`);
      tab = 'mine';
      state.rerender();
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
  }));
  $$('[data-share]').forEach((b) => b.addEventListener('click', async () => {
    const r = find(b.dataset.share);
    try {
      await store.setRoutineShared(r, !r.shared);
      toast(r.shared ? 'Now private' : 'Shared with friends');
      state.rerender();
    } catch (err) { toast(err.message, 'bad'); }
  }));
}

// ---------- builder ----------

const REST_CHIPS = [0, 30, 45, 60, 90, 120, 180];
const TIME_CHIPS = [20, 30, 45, 60, 90, 120, 300];

export async function viewRoutineEdit(app, stale) {
  const u = state.user.units;
  const id = params().get('id');
  const from = params().get('from');
  let r = null;
  if (id) r = await store.getRoutine(id);
  else if (from) r = STARTERS.find((x) => x.id === from);
  if (stale()) return;
  const editing = Boolean(id);
  const draft = {
    name: r?.name || '', type: r?.type || 'Weightlifting', intensity: r?.intensity || 'moderate', rounds: r?.rounds || 1,
    notes: r?.notes || '', shared: Boolean(r?.shared && editing),
    steps: (r?.steps || [{ kind: 'sets', name: '', sets: 3, reps: 10, weightKg: null, restSec: 60 }])
      .map((s) => ({ ...s, weight: s.weightKg ? toDisplayWeight(s.weightKg, u) : '' })),
  };

  const stepCard = (s, i) => {
    const head = `
      <div class="step-head">
        <span class="step-badge ${s.kind}">${i + 1} · ${STEP_KINDS[s.kind]}</span>
        <div class="step-tools">
          <button type="button" class="icon-btn small" data-move="${i},-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('upChev', 16)}</button>
          <button type="button" class="icon-btn small" data-move="${i},1" ${i === draft.steps.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 16)}</button>
          <button type="button" class="icon-btn small" data-dup="${i}" aria-label="Duplicate">${icon('copy', 16)}</button>
          <button type="button" class="icon-btn small danger" data-del="${i}" aria-label="Remove">${icon('trash', 16)}</button>
        </div>
      </div>`;
    if (s.kind === 'sets') {
      return `<div class="step-card" data-i="${i}">${head}
        <input class="st-name" list="rt-ex" value="${esc(s.name)}" placeholder="Exercise, e.g. Squat" aria-label="Exercise">
        <div class="step-grid">
          <label>Sets<input class="st-sets" type="number" inputmode="numeric" min="1" max="20" value="${s.sets}"></label>
          <label>Reps<input class="st-reps" type="number" inputmode="numeric" min="1" max="100" value="${s.reps}"></label>
          <label>${weightUnit(u)}<input class="st-weight" type="number" inputmode="decimal" min="0" step="any" value="${s.weight}" placeholder="opt."></label>
          <label>Rest s<input class="st-rest" type="number" inputmode="numeric" min="0" max="900" value="${s.restSec}"></label>
        </div>
        <div class="chips tight">${REST_CHIPS.map((x) => `<button type="button" class="chip ${x === Number(s.restSec) ? 'on' : ''}" data-rest="${i},${x}">${x ? `${x}s rest` : 'No rest'}</button>`).join('')}</div>
      </div>`;
    }
    return `<div class="step-card ${s.kind}" data-i="${i}">${head}
      ${s.kind === 'timed' ? `<input class="st-name" list="rt-ex" value="${esc(s.name)}" placeholder="What, e.g. Plank" aria-label="Timed move">` : ''}
      <div class="step-grid two">
        <label>Seconds<input class="st-seconds" type="number" inputmode="numeric" min="5" max="7200" value="${s.seconds}"></label>
        <span class="step-clock num">${clock(s.seconds)}</span>
      </div>
      <div class="chips tight">${TIME_CHIPS.map((x) => `<button type="button" class="chip ${x === Number(s.seconds) ? 'on' : ''}" data-secs="${i},${x}">${clock(x)}</button>`).join('')}</div>
    </div>`;
  };

  const draw = () => {
    app.innerHTML = `
      <a class="back" href="#/routines">${icon('left', 18)} Routines</a>
      ${label(editing ? 'Edit routine' : 'New routine')}
      <h1 class="page-title">${editing ? esc(draft.name || 'Routine') : 'Build a routine'}</h1>
      <form id="rt-form" class="stack" novalidate>
        <section class="card stack">
          <label>Name<input name="name" maxlength="60" value="${esc(draft.name)}" placeholder="Monday Legs" required></label>
          <div class="fields">
            <label>Type<select name="type">${WORKOUT_TYPES.map((t) => `<option ${t.name === draft.type ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>
            <label>Effort<select name="intensity">${Object.entries(INTENSITY).map(([k, v]) => `<option value="${k}" ${k === draft.intensity ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
          </div>
          <div><span class="field-label">Rounds <span class="opt">repeat every step this many times</span></span>${stepper('rounds', draft.rounds, { min: 1, max: 30 })}</div>
          <label>Notes <span class="opt">optional</span><textarea name="notes" rows="2" maxlength="500" placeholder="Tips, tempo, what to focus on">${esc(draft.notes)}</textarea></label>
        </section>

        <section>
          <div class="row between head">${label(`Steps · ${draft.steps.length}`)}<span class="muted small" id="rt-est"></span></div>
          <div id="rt-steps">${draft.steps.map(stepCard).join('')}</div>
          <div class="add-steps">
            <button type="button" class="btn ghost" data-add="sets">${icon('train', 18)} Exercise</button>
            <button type="button" class="btn ghost" data-add="timed">${icon('timer', 18)} Timed</button>
            <button type="button" class="btn ghost" data-add="rest">${icon('hourglass', 18)} Rest</button>
          </div>
        </section>

        <section class="card">
          <label class="toggle"><span><b>Share with friends</b><small class="muted">They can start it or save a copy. You'll hear when someone does it.</small></span>
            <input type="checkbox" name="shared" ${draft.shared ? 'checked' : ''}><i aria-hidden="true"></i></label>
        </section>
        <p class="form-error" id="rt-error"></p>
        <button class="btn primary big full" type="submit">${icon('check', 20)} ${editing ? 'Save changes' : 'Save routine'}</button>
        ${editing ? `<button type="button" class="btn ghost-danger full" id="rt-delete">${icon('trash', 18)} Delete routine</button>` : ''}
      </form>
      <datalist id="rt-ex">${ALL_EXERCISES.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
    bindSteppers(app);
    estimate();
  };

  // Copy what's on screen back into the draft before any redraw.
  const readDraft = () => {
    const f = $('#rt-form', app);
    if (!f) return;
    Object.assign(draft, { name: f.name.value, type: f.type.value, intensity: f.intensity.value, rounds: Number(f.rounds.value) || 1, notes: f.notes.value, shared: f.shared.checked });
    $$('.step-card', app).forEach((card) => {
      const s = draft.steps[Number(card.dataset.i)];
      const v = (c) => $(c, card)?.value;
      if (s.kind === 'sets') Object.assign(s, { name: v('.st-name'), sets: v('.st-sets'), reps: v('.st-reps'), weight: v('.st-weight'), restSec: v('.st-rest') });
      else Object.assign(s, { name: s.kind === 'timed' ? v('.st-name') : undefined, seconds: v('.st-seconds') });
    });
  };
  const toRoutine = () => ({
    ...draft,
    steps: draft.steps.map((s) => (s.kind === 'sets' ? { ...s, weightKg: fromDisplayWeight(s.weight, u) } : s)),
  });
  const estimate = () => {
    readDraft();
    const el = $('#rt-est', app);
    try { if (el) el.textContent = `~${Math.max(1, Math.round(estimateSeconds(toRoutine()) / 60))} min total`; } catch { /* half-typed */ }
    $$('.step-card', app).forEach((card) => {
      const c = $('.step-clock', card);
      if (c) c.textContent = clock(Number($('.st-seconds', card).value) || 0);
    });
  };

  draw();
  // #app outlives this page, so every listener is removed as soon as the user navigates away.
  const off = new AbortController();
  const { signal } = off;
  window.addEventListener('hashchange', () => off.abort(), { once: true });
  app.addEventListener('input', estimate, { signal });
  app.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !$('#rt-form', app)) return;
    const d = t.dataset;
    if (t.id === 'rt-delete') {
      if (!confirm(`Delete “${draft.name}”? Friends you shared it with lose it too.`)) return;
      await store.deleteRoutine(id);
      toast('Routine deleted');
      location.hash = '#/routines';
    } else if (d.add) {
      readDraft();
      const lastSets = [...draft.steps].reverse().find((s) => s.kind === 'sets');
      draft.steps.push(d.add === 'sets' ? { kind: 'sets', name: '', sets: lastSets?.sets || 3, reps: lastSets?.reps || 10, weight: '', restSec: lastSets?.restSec ?? 60 }
        : d.add === 'timed' ? { kind: 'timed', name: '', seconds: 30 } : { kind: 'rest', seconds: 30 });
      draw();
      $$('.step-card', app).pop()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $$('.st-name', app).pop()?.focus();
    } else if (d.move) {
      readDraft();
      const [i, dir] = d.move.split(',').map(Number);
      [draft.steps[i], draft.steps[i + dir]] = [draft.steps[i + dir], draft.steps[i]];
      draw();
    } else if (d.dup) {
      readDraft();
      draft.steps.splice(Number(d.dup) + 1, 0, { ...draft.steps[Number(d.dup)] });
      draw();
    } else if (d.del) {
      readDraft();
      if (draft.steps.length === 1) { toast('A routine needs at least one step', 'bad'); return; }
      draft.steps.splice(Number(d.del), 1);
      draw();
    } else if (d.rest) {
      readDraft();
      const [i, v] = d.rest.split(',').map(Number);
      draft.steps[i].restSec = v;
      draw();
    } else if (d.secs) {
      readDraft();
      const [i, v] = d.secs.split(',').map(Number);
      draft.steps[i].seconds = v;
      draw();
    }
  }, { signal });
  app.addEventListener('submit', async (e) => {
    if (e.target.id !== 'rt-form') return;
    e.preventDefault();
    readDraft();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const newId = await store.saveRoutine(state.user, toRoutine(), id);
      haptic(15);
      toast(editing ? 'Routine saved' : `“${draft.name}” saved${draft.shared ? ' and shared' : ''}`);
      tab = 'mine';
      location.hash = '#/routines';
      return newId;
    } catch (err) {
      $('#rt-error', app).textContent = err.message;
      btn.disabled = false;
    }
    return null;
  }, { signal });
}
