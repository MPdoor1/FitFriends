import * as store from '../store.js';
import { state } from '../state.js';
import { goalsFor } from '../nutrition.js';
import { $, $$, esc, icon, label, avatar, localDate, shiftDate, weekStart, bindCharts } from '../ui.js';
import { sessionBanner } from './player.js';
import { trackBanner } from './track.js';
import { WIDGETS, myWidgets, loadExtras, openWidgetEditor, runShortcut } from './widgets.js';

export async function viewToday(app, stale) {
  const today = localDate();
  const ids = myWidgets();
  const ctx = { today, u: state.user.units };
  const [{ board, meId }, day, workouts, foods, weights, days] = await Promise.all([
    store.leaderboard({ from: weekStart(today), today }),
    store.getDay(today),
    store.workoutsOn(today),
    store.foodsOn(today),
    store.listWeights(),
    store.myDays(shiftDate(weekStart(today), -28), today),
    loadExtras(ids, ctx),
  ]);
  if (stale()) return;
  const me = board.find((p) => p.id === meId);
  const goals = goalsFor(state.user);
  const eaten = foods.reduce((a, f) => ({ calories: a.calories + f.calories, protein: a.protein + (f.proteinG || 0), carbs: a.carbs + (f.carbsG || 0), fat: a.fat + (f.fatG || 0) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  Object.assign(ctx, { board, me, rank: board.indexOf(me) + 1, day, workouts, foods, weights, days, goals, eaten, budget: goals.calories + day.wCalories });

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';

  app.innerHTML = `
    <section class="hello">
      <div>
        ${label(esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })))}
        <h1>${greet}, ${esc(me.displayName.split(' ')[0])}</h1>
      </div>
      <div class="row gap">
        <button type="button" class="icon-btn" id="customize" aria-label="Customize widgets">${icon('settings', 20)}</button>
        <a href="#/me" aria-label="Profile">${avatar(me, 'lg')}</a>
      </div>
    </section>

    ${state.user.onboarded ? '' : `
    <a class="card setup-banner" href="#/setup">
      ${icon('calc', 24)}
      <div><strong>Set up your goals</strong><span class="muted small">One minute: get a calorie and protein target made for you.</span></div>
      ${icon('right', 20)}
    </a>`}

    ${sessionBanner()}
    ${trackBanner()}

    <div class="widgets">
      ${ids.map((id) => `<div class="w ${WIDGETS[id].size === 'half' ? 'half' : ''}" data-widget="${id}">${WIDGETS[id].render(ctx)}</div>`).join('')}
    </div>

    <button type="button" class="btn ghost full" id="customize-2">${icon('settings', 18)} Customize widgets</button>`;

  bindCharts(app);
  for (const id of ids) {
    const el = $(`[data-widget="${id}"]`, app);
    try { WIDGETS[id].bind?.(el, ctx); } catch (e) { console.error(id, e); }
  }
  // The weight card's chart sits inside links elsewhere; keep taps on it from navigating.
  $$('.spark', app).forEach((s) => s.addEventListener('click', (e) => e.preventDefault()));
  $('#customize').addEventListener('click', openWidgetEditor);
  $('#customize-2').addEventListener('click', openWidgetEditor);

  // Home-screen shortcuts land here as #/home?do=water etc.
  const action = new URLSearchParams(location.hash.split('?')[1] || '').get('do');
  if (action) {
    history.replaceState(null, '', '#/home');
    runShortcut(action, ctx);
  }
}
