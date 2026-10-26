import * as store from '../store.js';
import { state } from '../state.js';
import { goalsFor } from '../nutrition.js';
import {
  $, $$, esc, fmt, icon, label, avatar, localDate, shiftDate, weekStart, prettyDate, dayLetter, datesBetween,
  barChart, lineChart, bindCharts,
} from '../ui.js';
import { toDisplayWeight, weightUnit } from '../units.js';
import { openWorkoutSheet, workoutRow, bindWorkoutRows } from './train.js';
import { openFoodSheet, calorieRing, macroBlock, waterCard, bindWater } from './fuel.js';
import { openWeightSheet } from './body.js';
import { sessionBanner } from './player.js';

export async function viewToday(app, stale) {
  const today = localDate();
  const u = state.user.units;
  const [{ board, meId }, day, workouts, foods, weights, days] = await Promise.all([
    store.leaderboard({ from: weekStart(today), today }),
    store.getDay(today),
    store.workoutsOn(today),
    store.foodsOn(today),
    store.listWeights(),
    store.myDays(weekStart(today), today),
  ]);
  if (stale()) return;
  const me = board.find((p) => p.id === meId);
  const goals = goalsFor(state.user);
  const rank = board.indexOf(me) + 1;
  const lvl = me.level;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const t = foods.reduce((a, f) => ({ calories: a.calories + f.calories, protein: a.protein + (f.proteinG || 0), carbs: a.carbs + (f.carbsG || 0), fat: a.fat + (f.fatG || 0) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const budget = goals.calories + day.wCalories;
  const recentWeights = weights.filter((w) => w.date >= shiftDate(today, -30));
  const latest = weights[weights.length - 1];
  const monthAgo = recentWeights[0];
  const week = datesBetween(weekStart(today), shiftDate(weekStart(today), 6));

  app.innerHTML = `
    <section class="hello">
      <div>
        ${label(esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })))}
        <h1>${greet}, ${esc(me.displayName.split(' ')[0])}</h1>
      </div>
      <a href="#/me" aria-label="Profile">${avatar(me, 'lg')}</a>
    </section>

    ${state.user.onboarded ? '' : `
    <a class="card setup-banner" href="#/setup">
      ${icon('calc', 24)}
      <div><strong>Set up your goals</strong><span class="muted small">One minute: get a calorie and protein target made for you.</span></div>
      ${icon('right', 20)}
    </a>`}

    ${sessionBanner()}

    <section class="quick">
      <button type="button" class="quick-btn" id="q-workout">${icon('train', 22)}<span>Workout</span></button>
      <button type="button" class="quick-btn" id="q-food">${icon('fuel', 22)}<span>Food</span></button>
      <button type="button" class="quick-btn" id="q-weight">${icon('scale', 22)}<span>Weight</span></button>
      <button type="button" class="quick-btn" id="q-water">${icon('water', 22)}<span>+1 Water</span></button>
    </section>

    <section class="card">
      <div class="row between head">${label('Calories today')}<a href="#/fuel" class="link">Food log ${icon('right', 16)}</a></div>
      <div class="ring-row">
        ${calorieRing(t.calories, budget)}
        <dl class="kv">
          <div><dt>Goal</dt><dd class="num">${fmt(goals.calories)}</dd></div>
          <div><dt>Food</dt><dd class="num">−${fmt(t.calories)}</dd></div>
          <div><dt>Exercise</dt><dd class="num">+${fmt(day.wCalories)}</dd></div>
        </dl>
      </div>
      ${macroBlock(t, goals)}
    </section>

    ${waterCard(today, day.water || 0, goals.water)}

    <section class="card">
      <div class="row between head">${label('Training today')}<button class="link" id="add-workout">Add ${icon('plus', 16)}</button></div>
      ${workouts.length ? `<ul class="list">${workouts.map((w) => workoutRow(w, u)).join('')}</ul>`
        : `<div class="empty"><p>Nothing logged yet today.</p><button class="btn primary" id="first-workout">${icon('plus', 18)} Log a workout</button></div>`}
    </section>

    <section class="card">
      <div class="row between head">${label('This week')}<span class="muted small">Minutes per day</span></div>
      ${barChart(week.map((d) => {
        const x = days[d] || {};
        return { label: dayLetter(d), value: x.wMinutes || 0, dim: d > today || !x.wMinutes, tip: `${prettyDate(d)}: ${x.wMinutes || 0} min · ${fmt(x.wCalories)} kcal burned · ${fmt(x.foodCalories)} kcal eaten` };
      }), { unit: ' min', height: 120 })}
    </section>

    <a class="card weight-card" href="#/body">
      <div class="row between head">${label('Weight')}<span class="link">Details ${icon('right', 16)}</span></div>
      ${latest ? `
        <div class="weight-mini">
          <div><strong class="num">${toDisplayWeight(latest.kg, u)}</strong><span class="muted"> ${weightUnit(u)}</span>
            ${monthAgo && monthAgo !== latest ? `<div class="muted small">${latest.kg <= monthAgo.kg ? '−' : '+'}${Math.abs(toDisplayWeight(latest.kg - monthAgo.kg, u))} ${weightUnit(u)} in 30 days</div>` : ''}
            ${state.user.goalWeightKg != null ? `<div class="muted small">Goal ${toDisplayWeight(state.user.goalWeightKg, u)} ${weightUnit(u)}</div>` : ''}
          </div>
          ${recentWeights.length > 1 ? `<div class="spark">${lineChart(recentWeights.map((w) => ({ date: w.date, value: toDisplayWeight(w.kg, u) })), { height: 70, unit: weightUnit(u) })}</div>` : ''}
        </div>` : `<p class="muted">No weigh-ins yet. Tap <b>Weight</b> above to log one.</p>`}
    </a>

    <section class="card level">
      <div class="row between">
        <div class="level-name"><span class="lvl">LV ${lvl.number}</span>${esc(lvl.title)}</div>
        <span class="num muted">${fmt(me.totalXp)} XP</span>
      </div>
      <div class="bar"><div style="width:${Math.round(lvl.progress * 100)}%"></div></div>
      <p class="muted small">${fmt(lvl.toNext)} XP to level ${lvl.number + 1}</p>
    </section>

    <section class="stats four">
      <a class="stat" href="#/arena">${icon('arena', 18)}<strong class="num">${rank}<small>/${board.length}</small></strong><span>Weekly rank</span></a>
      <div class="stat">${icon('flame', 18)}<strong class="num">${me.streak}</strong><span>Day streak</span></div>
      <div class="stat">${icon('zap', 18)}<strong class="num">${fmt(me.points)}</strong><span>Points this week</span></div>
      <div class="stat">${icon('timer', 18)}<strong class="num">${fmt(me.minutes)}</strong><span>Minutes this week</span></div>
    </section>`;

  bindCharts(app);
  bindWater(app);
  bindWorkoutRows(app, workouts);
  // The weight card is a link; keep taps on its chart from navigating away.
  $('.weight-card .spark')?.addEventListener('click', (e) => e.preventDefault());
  $('#q-workout').addEventListener('click', () => openWorkoutSheet());
  $('#q-food').addEventListener('click', () => openFoodSheet({ date: today }));
  $('#q-weight').addEventListener('click', openWeightSheet);
  $('#q-water').addEventListener('click', () => $('.water [data-water-step="1"]', app).click());
  $('#add-workout').addEventListener('click', () => openWorkoutSheet());
  $('#first-workout')?.addEventListener('click', () => openWorkoutSheet());
}
