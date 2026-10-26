import * as store from '../store.js';
import { state } from '../state.js';
import {
  $, $$, esc, icon, label, localDate, shiftDate, prettyDate, toast, haptic, openSheet, closeSheet,
  stepper, bindSteppers, lineChart, bindCharts,
} from '../ui.js';
import { weightUnit, toDisplayWeight, fromDisplayWeight, fmtWeight, imperial } from '../units.js';

export async function openWeightSheet() {
  const u = state.user.units;
  const today = localDate();
  const start = toDisplayWeight(state.user.weightKg, u) || (imperial(u) ? 160 : 72);
  openSheet({
    title: 'Log weight',
    html: `
      <form id="wt-form" class="stack">
        <div><span class="field-label">Weight</span>${stepper('weight', start, { step: imperial(u) ? 0.2 : 0.1, min: 20, max: 700, unit: weightUnit(u), decimals: 1 })}</div>
        <label>Date<input type="date" name="date" value="${today}" max="${today}"></label>
        <p class="hint">${icon('info', 14)} Weigh in at the same time each day (morning works best). One entry per day; logging again replaces it.</p>
        <button class="btn primary big full" type="submit">Save weight</button>
      </form>`,
    onMount(sheet) {
      bindSteppers(sheet);
      const f = $('#wt-form', sheet);
      f.weight.select();
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await store.addWeight(f.date.value, fromDisplayWeight(f.weight.value, u));
          state.user = await store.getProfile();
          closeSheet();
          haptic(15);
          toast(`Logged ${f.weight.value} ${weightUnit(u)}`);
          state.rerender();
        } catch (err) { toast(err.message, 'bad'); }
      });
    },
  });
}

let range = '3m';
const RANGES = { '1m': ['1M', 30], '3m': ['3M', 91], '1y': ['1Y', 365], all: ['All', null] };

// Change over a period, colored by whether it moves toward the goal.
function changeChip(deltaKg, me) {
  const u = me.units;
  if (deltaKg == null || Math.abs(deltaKg) < 0.05) return '<span class="delta">±0</span>';
  const wantDown = me.goalWeightKg != null ? me.goalWeightKg < me.weightKg : (me.goalPace || 0) < 0;
  const wantUp = me.goalWeightKg != null ? me.goalWeightKg > me.weightKg : (me.goalPace || 0) > 0;
  const good = (deltaKg < 0 && wantDown) || (deltaKg > 0 && wantUp);
  const bad = (deltaKg < 0 && wantUp) || (deltaKg > 0 && wantDown);
  return `<span class="delta ${good ? 'good' : bad ? 'bad' : ''}">${icon(deltaKg < 0 ? 'downRight' : 'up', 14)}${deltaKg > 0 ? '+' : '−'}${Math.abs(toDisplayWeight(deltaKg, u))} ${weightUnit(u)}</span>`;
}

export async function viewBody(app, stale) {
  const me = state.user;
  const u = me.units;
  const weights = await store.listWeights();
  if (stale()) return;
  const today = localDate();
  const days = RANGES[range][1];
  const shown = days ? weights.filter((w) => w.date >= shiftDate(today, -days)) : weights;
  const latest = weights[weights.length - 1];
  const first = shown[0];
  const weekAgo = [...weights].reverse().find((w) => w.date <= shiftDate(today, -7));
  const bmi = me.heightCm && latest ? latest.kg / (me.heightCm / 100) ** 2 : null;
  const toGo = me.goalWeightKg != null && latest ? latest.kg - me.goalWeightKg : null;

  app.innerHTML = `
    <a class="back" href="#/home">${icon('left', 18)} Today</a>
    <div class="page-head">
      <div>${label('Body')}<h1>Weight</h1></div>
      <button class="btn primary" id="log-weight">${icon('plus', 18)} Log</button>
    </div>

    <section class="card">
      <div class="weight-now">
        <div><strong class="num big">${latest ? toDisplayWeight(latest.kg, u) : '–'}</strong><span class="unit">${weightUnit(u)}</span></div>
        <div class="weight-deltas">
          ${weekAgo ? `<div>${changeChip(latest.kg - weekAgo.kg, me)}<span class="muted small">this week</span></div>` : ''}
          ${first && latest && first !== latest ? `<div>${changeChip(latest.kg - first.kg, me)}<span class="muted small">${RANGES[range][0] === 'All' ? 'all time' : `in ${RANGES[range][0]}`}</span></div>` : ''}
        </div>
      </div>
      <div class="seg small period">${Object.entries(RANGES).map(([k, [l]]) => `<button data-range="${k}" class="${k === range ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${lineChart(shown.map((w) => ({ date: w.date, value: toDisplayWeight(w.kg, u) })), { goal: me.goalWeightKg != null ? toDisplayWeight(me.goalWeightKg, u) : null, unit: weightUnit(u) })}
      ${!weights.length ? `<div class="empty"><p>Log your first weigh-in to start the chart.</p></div>` : ''}
    </section>

    <section class="stats four">
      <div class="stat">${icon('goal', 18)}<strong class="num">${me.goalWeightKg != null ? toDisplayWeight(me.goalWeightKg, u) : '–'}</strong><span>Goal (${weightUnit(u)})</span></div>
      <div class="stat">${icon('target', 18)}<strong class="num">${toGo != null ? Math.abs(toDisplayWeight(toGo, u)) : '–'}</strong><span>${toGo != null ? (Math.abs(toGo) < 0.25 ? 'At goal' : `${weightUnit(u)} to ${toGo > 0 ? 'lose' : 'gain'}`) : 'Set a goal'}</span></div>
      <div class="stat">${icon('scale', 18)}<strong class="num">${weights.length ? toDisplayWeight(weights[0].kg, u) : '–'}</strong><span>Starting (${weightUnit(u)})</span></div>
      <div class="stat">${icon('ruler', 18)}<strong class="num">${bmi ? bmi.toFixed(1) : '–'}</strong><span>${bmi ? 'BMI' : 'BMI (add height)'}</span></div>
    </section>

    <section class="card">
      ${label('Goal weight')}
      <form id="goal-form" class="inline-form">
        ${stepper('goal', me.goalWeightKg != null ? toDisplayWeight(me.goalWeightKg, u) : (latest ? toDisplayWeight(latest.kg, u) : ''), { step: 1, min: 20, max: 700, unit: weightUnit(u), decimals: 1 })}
        <button class="btn primary" type="submit">Save</button>
      </form>
    </section>

    <section class="card">
      ${label('History')}
      ${weights.length ? `<ul class="list">${[...weights].reverse().slice(0, 60).map((w, i, arr) => {
        const prev = arr[i + 1];
        return `<li class="item"><div class="item-main"><strong class="num">${fmtWeight(w.kg, u)}</strong><span class="muted small">${prettyDate(w.date)}</span></div>${prev ? changeChip(w.kg - prev.kg, me) : ''}<button class="icon-btn" data-del-weight="${w.date}" aria-label="Delete">${icon('x', 16)}</button></li>`;
      }).join('')}</ul>` : '<p class="empty">No weigh-ins yet.</p>'}
    </section>`;

  bindCharts(app);
  bindSteppers(app);
  $('#log-weight').addEventListener('click', openWeightSheet);
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; state.rerender(); }));
  $('#goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.user = await store.updateProfile({ goalWeightKg: fromDisplayWeight(e.target.goal.value, u) });
      toast('Goal saved');
      state.rerender();
    } catch (err) { toast(err.message, 'bad'); }
  });
  $$('[data-del-weight]').forEach((b) => b.addEventListener('click', async () => {
    const w = weights.find((x) => x.date === b.dataset.delWeight);
    await store.deleteWeight(w.date);
    state.user = await store.getProfile();
    state.rerender();
    toast(`Removed ${prettyDate(w.date)}`, {
      action: 'Undo',
      onAction: async () => { await store.addWeight(w.date, w.kg); state.user = await store.getProfile(); state.rerender(); },
    });
  }));
}
