// Today page widgets: every block on the home screen is one of these, and members pick and order their own.
import * as store from '../store.js';
import { state } from '../state.js';
import { INTENSITY } from '../scoring.js';
import { STARTERS, summary, intervalRoutine, countdownRoutine } from '../routines.js';
import {
  $, $$, esc, fmt, icon, label, avatar, localDate, shiftDate, weekStart, prettyDate, shortDate, dayLetter, datesBetween,
  toast, pointsPop, haptic, openSheet, closeSheet, stepper, bindSteppers, barChart, lineChart, meter,
} from '../ui.js';
import { toDisplayWeight, weightUnit, fmtWeight } from '../units.js';
import { openWorkoutSheet, workoutRow, bindWorkoutRows, personalRecords } from './train.js';
import { openFoodSheet, calorieRing, macroBlock, waterCard, bindWater, MEALS, mealForNow } from './fuel.js';
import { openWeightSheet } from './body.js';
import { startSession } from './player.js';

export const WIDGET_GROUPS = [
  ['log', 'Fast logging'],
  ['today', 'Today'],
  ['train', 'Training'],
  ['body', 'Body'],
  ['compete', 'Progress & Arena'],
];

export const DEFAULT_WIDGETS = ['quick', 'checklist', 'calories', 'water', 'quickFoods', 'training', 'repeat', 'streak', 'weekGoal', 'week', 'weight', 'arena', 'level'];

// ---------- shared actions ----------

let waterPending = null;
// Adds glasses without needing the water widget on screen; quick taps are merged into one save.
function addWater(ctx, n) {
  const card = $('.water[data-water-date]');
  if (card) {
    $(`[data-water-step="${n > 0 ? 1 : -1}"]`, card).click();
    toast(`${$('.water-count', card).textContent} of ${ctx.goals.water} glasses`);
    return;
  }
  ctx.day.water = Math.max(0, Math.min(30, (ctx.day.water || 0) + n));
  haptic(8);
  toast(`${ctx.day.water} of ${ctx.goals.water} glasses`);
  $$('[data-water-count]').forEach((el) => { el.textContent = ctx.day.water; });
  clearTimeout(waterPending);
  waterPending = setTimeout(() => store.setWater(ctx.today, ctx.day.water).then(() => state.rerender()).catch((e) => toast(e.message, 'bad')), 600);
}

async function logAgain(w) {
  const { id, date, createdAt, calories, points, ...template } = w;
  const saved = await store.addWorkout(state.user, { ...template, date: localDate() });
  haptic(15);
  pointsPop(saved.points);
  state.rerender();
  toast(`Logged ${saved.type} · ${saved.durationMin} min`, {
    action: 'Undo',
    onAction: async () => { await store.deleteWorkout(saved); state.rerender(); },
  });
}

async function quickFood(f, meal = mealForNow()) {
  const entry = await store.addFood(state.user, {
    date: localDate(), meal, name: f.name, serving: f.serving, servings: 1,
    per: { calories: f.calories, proteinG: f.proteinG || 0, carbsG: f.carbsG || 0, fatG: f.fatG || 0 },
  });
  haptic(12);
  state.rerender();
  toast(`${f.name} added to ${MEALS.find(([k]) => k === meal)[1].toLowerCase()}`, {
    action: 'Undo',
    onAction: async () => { await store.deleteFood(state.user, entry); state.rerender(); },
  });
}

// Runs a home-screen shortcut (#/home?do=water and friends) once the page is drawn.
export function runShortcut(action, ctx) {
  ({
    water: () => addWater(ctx, 1),
    food: () => openFoodSheet({ date: ctx.today }),
    workout: () => openWorkoutSheet(),
    weight: () => openWeightSheet(),
    fast: () => toggleFast(),
  })[action]?.();
}

async function toggleFast(hours) {
  const on = state.user.fastStart;
  const changes = on ? { fastStart: null } : { fastStart: Date.now(), ...(hours ? { fastHours: hours } : {}) };
  try {
    if (on) {
      const h = (Date.now() - on) / 3.6e6;
      toast(`Fast ended at ${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`);
    } else toast('Fast started');
    haptic(15);
    state.user = await store.updateProfile(changes);
    state.rerender();
  } catch (e) { toast(e.message, 'bad'); }
}

const hm = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// ---------- small building blocks ----------

const head = (title, right = '') => `<div class="row between head">${label(title)}${right}</div>`;
const tile = (id, title, body, extra = '') => `<button type="button" class="card tile" data-tile="${id}" ${extra}>${label(title)}${body}</button>`;

function ringSmall(frac, cls = '') {
  const r = 26;
  const c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 64 64" class="mini-ring ${cls}"><circle cx="32" cy="32" r="${r}" class="ring-bg"/><circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(Math.max(frac, 0), 1))}"/></svg>`;
}

// ---------- the widgets ----------
// needs: extra data to load. size: 'half' widgets sit two to a row.

export const WIDGETS = {
  quick: {
    name: 'Quick log', group: 'log', icon: 'plus', desc: 'Workout, food, weight and water buttons',
    render: () => `
      <section class="quick">
        <button type="button" class="quick-btn" data-q="workout">${icon('train', 22)}<span>Workout</span></button>
        <button type="button" class="quick-btn" data-q="food">${icon('fuel', 22)}<span>Food</span></button>
        <button type="button" class="quick-btn" data-q="weight">${icon('scale', 22)}<span>Weight</span></button>
        <button type="button" class="quick-btn" data-q="water">${icon('water', 22)}<span>+1 Water</span></button>
      </section>`,
    bind: (el, ctx) => $$('[data-q]', el).forEach((b) => b.addEventListener('click', () => runShortcut(b.dataset.q, ctx))),
  },

  quickFoods: {
    name: 'Quick foods', group: 'log', icon: 'repeat', desc: 'One tap re-logs a food you eat often', needs: ['recentFoods'],
    render: (ctx) => `
      <section class="card">
        ${head('Quick foods', `<span class="muted small">Adds to ${MEALS.find(([k]) => k === mealForNow())[1].toLowerCase()}</span>`)}
        ${ctx.recentFoods.length ? `<div class="qf-grid">${ctx.recentFoods.slice(0, 8).map((f, i) => `
          <button type="button" class="qf" data-qf="${i}"><span class="qf-name">${esc(f.name)}</span><span class="num muted">${fmt(f.calories)} kcal</span>${icon('plus', 16)}</button>`).join('')}</div>`
          : '<p class="muted small">Foods you log show up here for one-tap logging.</p>'}
      </section>`,
    bind: (el, ctx) => $$('[data-qf]', el).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await quickFood(ctx.recentFoods[Number(b.dataset.qf)]); } catch (e) { toast(e.message, 'bad'); b.disabled = false; }
    })),
  },

  quickAdd: {
    name: 'Quick calories', group: 'log', icon: 'hash', desc: 'Type a number and add it, no searching',
    render: () => `
      <section class="card">
        ${head('Quick calories')}
        <form class="qa-form">
          <label>kcal<input name="kcal" type="number" inputmode="numeric" min="1" max="5000" placeholder="350" required></label>
          <label>Protein g<input name="protein" type="number" inputmode="numeric" min="0" max="500" placeholder="0"></label>
          <button class="btn primary" type="submit">${icon('plus', 18)} Add</button>
        </form>
        <div class="chips tight">${MEALS.map(([k, l]) => `<button type="button" class="chip ${k === mealForNow() ? 'on' : ''}" data-qa-meal="${k}">${l}</button>`).join('')}</div>
      </section>`,
    bind: (el, ctx) => {
      let meal = mealForNow();
      $$('[data-qa-meal]', el).forEach((b) => b.addEventListener('click', () => {
        meal = b.dataset.qaMeal;
        $$('[data-qa-meal]', el).forEach((c) => c.classList.toggle('on', c === b));
      }));
      $('form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          await quickFood({ name: 'Quick add', serving: `${f.kcal.value} kcal`, calories: Number(f.kcal.value), proteinG: Number(f.protein.value) || 0 }, meal);
          f.reset();
        } catch (err) { toast(err.message, 'bad'); }
      });
    },
  },

  meals: {
    name: 'Meals', group: 'log', icon: 'fuel', desc: 'Each meal with a + button and "same as yesterday"', needs: ['yesterdayFoods'],
    render: (ctx) => `
      <section class="card">
        ${head('Meals', `<a href="#/fuel" class="link">Food log ${icon('right', 16)}</a>`)}
        <ul class="meal-rows">${MEALS.map(([k, l]) => {
          const items = ctx.foods.filter((f) => f.meal === k);
          const yest = ctx.yesterdayFoods.filter((f) => f.meal === k);
          return `
          <li>
            <span class="grow"><strong>${l}</strong><span class="muted small">${items.length ? `${items.length} item${items.length === 1 ? '' : 's'} · ${esc(items.map((f) => f.name).slice(0, 2).join(', '))}${items.length > 2 ? '…' : ''}` : 'Nothing yet'}</span></span>
            ${!items.length && yest.length ? `<button type="button" class="btn small-btn" data-copy-meal="${k}">${icon('copy', 14)} Yesterday's</button>` : ''}
            <span class="num">${fmt(items.reduce((s, f) => s + f.calories, 0))}</span>
            <button type="button" class="icon-btn accent" data-add-meal="${k}" aria-label="Add to ${l}">${icon('plus', 18)}</button>
          </li>`;
        }).join('')}</ul>
      </section>`,
    bind: (el, ctx) => {
      $$('[data-add-meal]', el).forEach((b) => b.addEventListener('click', () => openFoodSheet({ date: ctx.today, meal: b.dataset.addMeal })));
      $$('[data-copy-meal]', el).forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const n = await store.copyMeal(state.user, shiftDate(ctx.today, -1), b.dataset.copyMeal, ctx.today);
          toast(`Copied ${n} item${n === 1 ? '' : 's'} from yesterday`);
          state.rerender();
        } catch (e) { toast(e.message, 'bad'); b.disabled = false; }
      }));
    },
  },

  water: {
    name: 'Water', group: 'log', icon: 'water', desc: 'Tap glasses to log water',
    render: (ctx) => waterCard(ctx.today, ctx.day.water || 0, ctx.goals.water),
    bind: (el) => bindWater(el),
  },

  checklist: {
    name: 'Daily checklist', group: 'today', icon: 'check', desc: 'The day\'s habits, each one tap away',
    render: (ctx) => {
      const items = checklistItems(ctx);
      const done = items.filter((i) => i.done).length;
      return `
      <section class="card">
        ${head('Today\'s checklist', `<span class="num muted">${done} / ${items.length}</span>`)}
        <div class="bar thin"><div style="width:${(done / items.length) * 100}%"></div></div>
        <ul class="checklist">${items.map((it, i) => `
          <li class="${it.done ? 'done' : ''}">
            <span class="tick">${it.done ? icon('check', 16) : ''}</span>
            <span class="grow"><b>${it.label}</b><span class="muted small">${it.detail}</span></span>
            ${!it.done && it.action ? `<button type="button" class="btn small-btn" data-check="${i}">${it.cta}</button>` : ''}
          </li>`).join('')}</ul>
      </section>`;
    },
    bind: (el, ctx) => {
      const items = checklistItems(ctx);
      $$('[data-check]', el).forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.check)].action()));
    },
  },

  calories: {
    name: 'Calories & macros', group: 'today', icon: 'flame', desc: 'Ring with calories left plus protein, carbs and fat',
    render: (ctx) => `
      <section class="card">
        ${head('Calories today', `<a href="#/fuel" class="link">Food log ${icon('right', 16)}</a>`)}
        <div class="ring-row">
          ${calorieRing(ctx.eaten.calories, ctx.budget)}
          <dl class="kv">
            <div><dt>Goal</dt><dd class="num">${fmt(ctx.goals.calories)}</dd></div>
            <div><dt>Food</dt><dd class="num">−${fmt(ctx.eaten.calories)}</dd></div>
            <div><dt>Exercise</dt><dd class="num">+${fmt(ctx.day.wCalories)}</dd></div>
          </dl>
        </div>
        ${macroBlock(ctx.eaten, ctx.goals)}
      </section>`,
  },

  macros: {
    name: 'Macros', group: 'today', icon: 'gauge', desc: 'Protein, carbs and fat bars on their own',
    render: (ctx) => `<section class="card">${head('Macros', `<span class="muted small">${fmt(ctx.goals.protein - ctx.eaten.protein)} g protein to go</span>`)}${macroBlock(ctx.eaten, ctx.goals)}</section>`,
  },

  caloriesLeft: {
    name: 'Calories left', group: 'today', icon: 'flame', size: 'half', desc: 'Small tile: what\'s left today; tap to log food',
    render: (ctx) => {
      const left = ctx.budget - ctx.eaten.calories;
      return tile('caloriesLeft', 'Calories left', `
        <strong class="num big-num ${left < 0 ? 'bad' : ''}">${fmt(Math.abs(left))}</strong>
        <span class="muted small">${left < 0 ? 'kcal over' : `of ${fmt(ctx.budget)} kcal`}</span>
        <div class="bar thin"><div style="width:${Math.min(100, (ctx.eaten.calories / Math.max(ctx.budget, 1)) * 100)}%"></div></div>`);
    },
    bind: (el, ctx) => $('[data-tile]', el).addEventListener('click', () => openFoodSheet({ date: ctx.today })),
  },

  protein: {
    name: 'Protein', group: 'today', icon: 'target', size: 'half', desc: 'Small tile: grams of protein vs goal',
    render: (ctx) => tile('protein', 'Protein', `
      <div class="tile-ring">${ringSmall(ctx.eaten.protein / Math.max(ctx.goals.protein, 1), 'blue')}<span class="num">${Math.round((ctx.eaten.protein / Math.max(ctx.goals.protein, 1)) * 100)}%</span></div>
      <span class="muted small"><b class="num">${fmt(ctx.eaten.protein)}</b> / ${fmt(ctx.goals.protein)} g</span>`),
    bind: (el, ctx) => $('[data-tile]', el).addEventListener('click', () => openFoodSheet({ date: ctx.today })),
  },

  burned: {
    name: 'Burned today', group: 'today', icon: 'zap', size: 'half', desc: 'Small tile: exercise calories and minutes',
    render: (ctx) => tile('burned', 'Burned today', `
      <strong class="num big-num">${fmt(ctx.day.wCalories)}</strong>
      <span class="muted small">kcal · ${fmt(ctx.day.wMinutes)} min trained</span>`),
    bind: (el) => $('[data-tile]', el).addEventListener('click', () => openWorkoutSheet()),
  },

  waterTile: {
    name: 'Water tile', group: 'today', icon: 'water', size: 'half', desc: 'Small tile: tap to add a glass',
    render: (ctx) => tile('waterTile', 'Water', `
      <strong class="num big-num"><span data-water-count>${ctx.day.water || 0}</span><small>/${ctx.goals.water}</small></strong>
      <span class="muted small">${icon('plus', 14)} Tap to add a glass</span>`),
    bind: (el, ctx) => $('[data-tile]', el).addEventListener('click', () => addWater(ctx, 1)),
  },

  pointsToday: {
    name: 'Points today', group: 'today', icon: 'zap', size: 'half', desc: 'Small tile: points earned today',
    render: (ctx) => tile('pointsToday', 'Points today', `
      <strong class="num big-num">${fmt((ctx.day.wPoints || 0) + (ctx.day.foodPoints || 0))}</strong>
      <span class="muted small">${fmt(ctx.me.points)} this week</span>`, 'data-href="#/arena"'),
    bind: (el) => $('[data-tile]', el).addEventListener('click', () => { location.hash = '#/arena'; }),
  },

  training: {
    name: 'Training today', group: 'today', icon: 'train', desc: 'Today\'s workouts with edit and repeat',
    render: (ctx) => `
      <section class="card">
        ${head('Training today', `<button class="link" data-add-workout>Add ${icon('plus', 16)}</button>`)}
        ${ctx.workouts.length ? `<ul class="list">${ctx.workouts.map((w) => workoutRow(w, ctx.u)).join('')}</ul>`
          : `<div class="empty"><p>Nothing logged yet today.</p><button class="btn primary" data-add-workout>${icon('plus', 18)} Log a workout</button></div>`}
      </section>`,
    bind: (el, ctx) => {
      bindWorkoutRows(el, ctx.workouts);
      $$('[data-add-workout]', el).forEach((b) => b.addEventListener('click', () => openWorkoutSheet()));
    },
  },

  repeat: {
    name: 'Repeat a workout', group: 'train', icon: 'repeat', desc: 'Your recent workouts: log one again in one tap', needs: ['history'],
    render: (ctx) => {
      const list = recentDistinct(ctx.history);
      return `
      <section class="card">
        ${head('Log again')}
        ${list.length ? `<ul class="repeat-rows">${list.map((w, i) => `
          <li>
            <span class="item-ico">${icon(w.type, 20)}</span>
            <span class="grow"><strong>${esc(w.routineName || w.type)}</strong><span class="muted small">${w.durationMin} min · ${esc(INTENSITY[w.intensity]?.label || '')}${w.exercises?.length ? ` · ${w.exercises.length} exercises` : ''} · ${shortDate(w.date)}</span></span>
            <button type="button" class="icon-btn" data-rep-edit="${i}" aria-label="Change and log">${icon('edit', 16)}</button>
            <button type="button" class="btn small-btn primary" data-rep="${i}">${icon('plus', 14)} Log</button>
          </li>`).join('')}</ul>`
          : '<p class="muted small">Workouts you log show up here so you can repeat them with one tap.</p>'}
      </section>`;
    },
    bind: (el, ctx) => {
      const list = recentDistinct(ctx.history);
      $$('[data-rep]', el).forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await logAgain(list[Number(b.dataset.rep)]); } catch (e) { toast(e.message, 'bad'); b.disabled = false; }
      }));
      $$('[data-rep-edit]', el).forEach((b) => b.addEventListener('click', () => {
        const { id, date, ...template } = list[Number(b.dataset.repEdit)];
        openWorkoutSheet({ template });
      }));
    },
  },

  routines: {
    name: 'Start a routine', group: 'train', icon: 'library', desc: 'Your routines (or starters) with a Start button', needs: ['routines'],
    render: (ctx) => `
      <section class="card">
        ${head('Routines', `<a href="#/routines" class="link">All ${icon('right', 16)}</a>`)}
        <ul class="repeat-rows">${ctx.routineList.map((r, i) => `
          <li>
            <span class="item-ico">${icon(r.type, 20)}</span>
            <span class="grow"><strong>${esc(r.name)}</strong><span class="muted small">${summary(r)}</span></span>
            <button type="button" class="btn small-btn primary" data-start-r="${i}">${icon('play', 14)} Start</button>
          </li>`).join('')}</ul>
      </section>`,
    bind: (el, ctx) => $$('[data-start-r]', el).forEach((b) => b.addEventListener('click', () => startSession(ctx.routineList[Number(b.dataset.startR)]))),
  },

  timers: {
    name: 'Quick timers', group: 'train', icon: 'timer', desc: 'Start Tabata, intervals or a countdown in one tap',
    render: () => `
      <section class="card">
        ${head('Quick timers', `<a href="#/timers" class="link">More ${icon('right', 16)}</a>`)}
        <div class="timer-grid">
          ${QUICK_TIMERS.map(([l, sub], i) => `<button type="button" class="timer-btn" data-qt="${i}"><b>${l}</b><span class="muted small">${sub}</span></button>`).join('')}
        </div>
      </section>`,
    bind: (el) => $$('[data-qt]', el).forEach((b) => b.addEventListener('click', () => QUICK_TIMERS[Number(b.dataset.qt)][2]())),
  },

  weekGoal: {
    name: 'Weekly goal', group: 'train', icon: 'goal', size: 'half', desc: 'Small tile: workouts this week vs your goal',
    render: (ctx) => {
      const week = datesBetween(weekStart(ctx.today), shiftDate(weekStart(ctx.today), 6));
      const n = week.reduce((s, d) => s + (ctx.days[d]?.wCount ? 1 : 0), 0);
      const goal = state.user.workoutGoal;
      return tile('weekGoal', 'Weekly goal', `
        <strong class="num big-num ${n >= goal ? 'good' : ''}">${n}<small>/${goal}</small></strong>
        <span class="muted small">${n >= goal ? 'Goal reached' : `${goal - n} more day${goal - n === 1 ? '' : 's'} to go`}</span>
        <span class="week-dots">${week.map((d) => `<i class="${ctx.days[d]?.wCount ? 'on' : ''} ${d === ctx.today ? 'today' : ''}" title="${dayLetter(d)}"></i>`).join('')}</span>`);
    },
    bind: (el) => $('[data-tile]', el).addEventListener('click', openGoalSheet),
  },

  streak: {
    name: 'Streak', group: 'train', icon: 'flame', size: 'half', desc: 'Small tile: current and best workout streak',
    render: (ctx) => tile('streak', 'Streak', `
      <strong class="num big-num hot">${icon('flame', 26)}${ctx.me.streak}</strong>
      <span class="muted small">${ctx.me.streak === 1 ? 'day' : 'days'} · best ${ctx.me.bestStreak}</span>
      <span class="muted small">${ctx.workouts.length ? 'Done for today' : ctx.me.streak ? 'Train today to keep it' : 'Start one today'}</span>`),
    bind: (el, ctx) => $('[data-tile]', el).addEventListener('click', () => (ctx.workouts.length ? (location.hash = '#/train') : openWorkoutSheet())),
  },

  week: {
    name: 'This week chart', group: 'train', icon: 'calendar', desc: 'Minutes trained each day this week',
    render: (ctx) => {
      const week = datesBetween(weekStart(ctx.today), shiftDate(weekStart(ctx.today), 6));
      return `
      <section class="card">
        ${head('This week', '<span class="muted small">Minutes per day</span>')}
        ${barChart(week.map((d) => {
          const x = ctx.days[d] || {};
          return { label: dayLetter(d), value: x.wMinutes || 0, dim: d > ctx.today || !x.wMinutes, tip: `${prettyDate(d)}: ${x.wMinutes || 0} min · ${fmt(x.wCalories)} kcal burned · ${fmt(x.foodCalories)} kcal eaten` };
        }), { unit: ' min', height: 120 })}
      </section>`;
    },
  },

  calendar: {
    name: 'Activity calendar', group: 'train', icon: 'calendar', desc: 'Last 5 weeks, darker means more minutes',
    render: (ctx) => {
      const start = shiftDate(weekStart(ctx.today), -28);
      const dates = datesBetween(start, shiftDate(weekStart(ctx.today), 6));
      const max = Math.max(30, ...dates.map((d) => ctx.days[d]?.wMinutes || 0));
      const active = dates.filter((d) => d <= ctx.today && ctx.days[d]?.wCount).length;
      return `
      <section class="card">
        ${head('Activity', `<span class="muted small">${active} active day${active === 1 ? '' : 's'} in 5 weeks</span>`)}
        <div class="heat">
          ${dates.slice(0, 7).map((d) => `<span class="heat-l">${dayLetter(d)}</span>`).join('')}
          ${dates.map((d) => {
            const m = ctx.days[d]?.wMinutes || 0;
            const lvl = d > ctx.today ? 'future' : m ? `l${Math.min(4, Math.ceil((m / max) * 4))}` : '';
            return `<span class="heat-c ${lvl} ${d === ctx.today ? 'today' : ''}" title="${prettyDate(d)}: ${m} min"></span>`;
          }).join('')}
        </div>
      </section>`;
    },
  },

  prs: {
    name: 'Personal records', group: 'train', icon: 'medal', desc: 'Your latest lifting bests', needs: ['history'],
    render: (ctx) => {
      const prs = Object.values(personalRecords(ctx.history)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
      return `
      <section class="card">
        ${head('Records', `<a href="#/train" class="link">All ${icon('right', 16)}</a>`)}
        ${prs.length ? `<ul class="pr-list">${prs.map((p) => `
          <li><span class="pr-name">${esc(p.name)}</span><span class="num pr-set">${fmtWeight(p.set.weightKg, ctx.u, 1)} × ${p.set.reps}</span><span class="muted small">${shortDate(p.date)}</span></li>`).join('')}</ul>`
          : '<p class="muted small">Log sets with weight and your best lifts show up here.</p>'}
      </section>`;
    },
  },

  weight: {
    name: 'Weight', group: 'body', icon: 'scale', desc: 'Latest weigh-in, 30-day trend and a Log button',
    render: (ctx) => {
      const { u } = ctx;
      const recent = ctx.weights.filter((w) => w.date >= shiftDate(ctx.today, -30));
      const latest = ctx.weights[ctx.weights.length - 1];
      const monthAgo = recent[0];
      return `
      <section class="card weight-card">
        ${head('Weight', `<span class="row gap"><button class="link" data-log-weight>Log ${icon('plus', 16)}</button><a href="#/body" class="link">Details ${icon('right', 16)}</a></span>`)}
        ${latest ? `
          <div class="weight-mini">
            <div><strong class="num">${toDisplayWeight(latest.kg, u)}</strong><span class="muted"> ${weightUnit(u)}</span>
              ${monthAgo && monthAgo !== latest ? `<div class="muted small">${latest.kg <= monthAgo.kg ? '−' : '+'}${Math.abs(toDisplayWeight(latest.kg - monthAgo.kg, u))} ${weightUnit(u)} in 30 days</div>` : ''}
              ${state.user.goalWeightKg != null ? `<div class="muted small">Goal ${toDisplayWeight(state.user.goalWeightKg, u)} ${weightUnit(u)}</div>` : ''}
            </div>
            ${recent.length > 1 ? `<div class="spark">${lineChart(recent.map((w) => ({ date: w.date, value: toDisplayWeight(w.kg, u) })), { height: 70, unit: weightUnit(u) })}</div>` : ''}
          </div>` : '<p class="muted">No weigh-ins yet. Tap <b>Log</b> to add one.</p>'}
      </section>`;
    },
    bind: (el) => $('[data-log-weight]', el).addEventListener('click', openWeightSheet),
  },

  weighIn: {
    name: 'Weigh-in tile', group: 'body', icon: 'scale', size: 'half', desc: 'Small tile: last weigh-in; tap to log',
    render: (ctx) => {
      const latest = ctx.weights[ctx.weights.length - 1];
      const ago = latest ? Math.round((new Date(`${ctx.today}T12:00`) - new Date(`${latest.date}T12:00`)) / 864e5) : null;
      return tile('weighIn', 'Weight', latest ? `
        <strong class="num big-num">${toDisplayWeight(latest.kg, ctx.u)}<small>${weightUnit(ctx.u)}</small></strong>
        <span class="muted small">${ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : `${ago} days ago`} · tap to log</span>`
        : `<strong class="num big-num">–</strong><span class="muted small">Tap to log your weight</span>`);
    },
    bind: (el) => $('[data-tile]', el).addEventListener('click', openWeightSheet),
  },

  goalWeight: {
    name: 'Goal progress', group: 'body', icon: 'target', desc: 'How far you are from your goal weight',
    render: (ctx) => {
      const me = state.user;
      const first = ctx.weights[0];
      const latest = ctx.weights[ctx.weights.length - 1];
      if (me.goalWeightKg == null || !latest) {
        return `<section class="card">${head('Goal weight')}<p class="muted small">Set a goal weight in <a class="link" href="#/setup">Setup</a> and log a weigh-in to track progress.</p></section>`;
      }
      const total = first.kg - me.goalWeightKg;
      const done = first.kg - latest.kg;
      const frac = total ? Math.max(0, Math.min(1, done / total)) : 1;
      const left = Math.abs(latest.kg - me.goalWeightKg);
      return `
      <section class="card">
        ${head('Goal weight', `<span class="num muted">${Math.round(frac * 100)}%</span>`)}
        <div class="bar"><div style="width:${frac * 100}%"></div></div>
        <div class="row between small goal-ends"><span class="muted">Start ${fmtWeight(first.kg, ctx.u)}</span><b>${left < 0.3 ? 'Goal reached' : `${fmtWeight(left, ctx.u)} to go`}</b><span class="muted">Goal ${fmtWeight(me.goalWeightKg, ctx.u)}</span></div>
      </section>`;
    },
  },

  fasting: {
    name: 'Fasting timer', group: 'body', icon: 'hourglass', desc: 'Start and stop a fast; shows time and progress',
    render: () => {
      const me = state.user;
      if (!me.fastStart) {
        return `
        <section class="card">
          ${head('Fasting', `<span class="muted small">Last goal ${me.fastHours}h</span>`)}
          <div class="chips">${[12, 14, 16, 18, 20, 24].map((h) => `<button type="button" class="chip ${h === me.fastHours ? 'on' : ''}" data-fast-h="${h}">${h}h</button>`).join('')}</div>
          <button type="button" class="btn primary full fast-go" data-fast-start>${icon('play', 18)} Start ${me.fastHours}h fast</button>
        </section>`;
      }
      const goalMs = me.fastHours * 3.6e6;
      const el = Date.now() - me.fastStart;
      return `
      <section class="card fast-on">
        ${head('Fasting', `<span class="muted small">Goal ${me.fastHours}h</span>`)}
        <div class="fast-row">
          <div class="fast-ring">${ringSmall(el / goalMs)}</div>
          <div class="grow">
            <strong class="num big-num" data-fast-el>${hm(el)}</strong>
            <span class="muted small" data-fast-left>${el >= goalMs ? 'Goal reached' : `${hm(goalMs - el)} to go`} · ends ${new Date(me.fastStart + goalMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <button type="button" class="btn" data-fast-stop>${icon('flag', 16)} End</button>
        </div>
      </section>`;
    },
    bind: (el) => {
      let hours = state.user.fastHours;
      $$('[data-fast-h]', el).forEach((b) => b.addEventListener('click', () => {
        hours = Number(b.dataset.fastH);
        $$('[data-fast-h]', el).forEach((c) => c.classList.toggle('on', c === b));
        $('[data-fast-start]', el).innerHTML = `${icon('play', 18)} Start ${hours}h fast`;
      }));
      $('[data-fast-start]', el)?.addEventListener('click', () => toggleFast(hours));
      $('[data-fast-stop]', el)?.addEventListener('click', () => toggleFast());
      if (state.user.fastStart) {
        const id = setInterval(() => {
          const out = $('[data-fast-el]');
          if (!out || !state.user.fastStart) return clearInterval(id);
          out.textContent = hm(Date.now() - state.user.fastStart);
        }, 15000);
      }
    },
  },

  arena: {
    name: 'Arena standings', group: 'compete', icon: 'arena', desc: 'Top of the leaderboard and the gap to the next spot',
    render: (ctx) => {
      const { board, me, rank } = ctx;
      const above = board[rank - 2];
      return `
      <a class="card arena-mini" href="#/arena">
        ${head('Arena this week', `<span class="link">Open ${icon('right', 16)}</span>`)}
        <ol class="mini-board">${board.slice(0, 3).map((p, i) => `
          <li class="${p.id === me.id ? 'me' : ''}"><span class="num rank">${i + 1}</span>${avatar(p)}<span class="grow">${esc(p.displayName)}</span><span class="num">${fmt(p.points)}</span></li>`).join('')}
          ${rank > 3 ? `<li class="me"><span class="num rank">${rank}</span>${avatar(me)}<span class="grow">${esc(me.displayName)}</span><span class="num">${fmt(me.points)}</span></li>` : ''}
        </ol>
        <p class="muted small">${board.length < 2 ? 'Invite friends to start a race.' : rank === 1 ? `You lead by ${fmt(me.points - (board[1]?.points || 0))} pts.` : `${fmt(above.points - me.points + 1)} pts to pass ${esc(above.displayName.split(' ')[0])}.`}</p>
      </a>`;
    },
  },

  level: {
    name: 'Level', group: 'compete', icon: 'star', desc: 'Your level and XP to the next one',
    render: (ctx) => {
      const lvl = ctx.me.level;
      return `
      <section class="card level">
        <div class="row between">
          <div class="level-name"><span class="lvl">LV ${lvl.number}</span>${esc(lvl.title)}</div>
          <span class="num muted">${fmt(ctx.me.totalXp)} XP</span>
        </div>
        <div class="bar"><div style="width:${Math.round(lvl.progress * 100)}%"></div></div>
        <p class="muted small">${fmt(lvl.toNext)} XP to level ${lvl.number + 1}</p>
      </section>`;
    },
  },

  stats: {
    name: 'Week stats', group: 'compete', icon: 'trend', desc: 'Rank, streak, points and minutes',
    render: (ctx) => `
      <section class="stats four">
        <a class="stat" href="#/arena">${icon('arena', 18)}<strong class="num">${ctx.rank}<small>/${ctx.board.length}</small></strong><span>Weekly rank</span></a>
        <div class="stat">${icon('flame', 18)}<strong class="num">${ctx.me.streak}</strong><span>Day streak</span></div>
        <div class="stat">${icon('zap', 18)}<strong class="num">${fmt(ctx.me.points)}</strong><span>Points this week</span></div>
        <div class="stat">${icon('timer', 18)}<strong class="num">${fmt(ctx.me.minutes)}</strong><span>Minutes this week</span></div>
      </section>`,
  },

  badges: {
    name: 'Badges', group: 'compete', icon: 'medal', desc: 'Badges earned and the next ones to unlock',
    render: (ctx) => {
      const got = ctx.me.badges.filter((b) => b.earned);
      const next = ctx.me.badges.filter((b) => !b.earned).slice(0, 2);
      return `
      <a class="card" href="#/me">
        ${head('Badges', `<span class="num muted">${got.length} / ${ctx.me.badges.length}</span>`)}
        <div class="badge-strip">${got.slice(-6).map((b) => `<span class="badge-dot" title="${esc(b.name)}">${icon(b.icon, 18)}</span>`).join('') || '<span class="muted small">None yet</span>'}</div>
        ${next.length ? `<p class="muted small">Next: ${next.map((b) => `<b>${esc(b.name)}</b> (${esc(b.desc)})`).join(', ')}</p>` : ''}
      </a>`;
    },
  },
};

const QUICK_TIMERS = [
  ['Tabata', '20s/10s × 8', () => startSession(intervalRoutine(20, 10, 8))],
  ['30 / 30', '× 10 rounds', () => startSession(intervalRoutine(30, 30, 10))],
  ['EMOM 10', '1 min × 10', () => startSession(intervalRoutine(60, 0, 10))],
  ['Rest 90s', 'Between sets', () => startSession(countdownRoutine(90))],
  ['5 min', 'Countdown', () => startSession(countdownRoutine(300))],
  ['Stop\u00adwatch', 'With laps', () => { location.hash = '#/timers'; }],
];

// Latest workouts, one per kind (same routine, or same type and length).
function recentDistinct(history) {
  const seen = new Set();
  const out = [];
  for (const w of history) {
    const key = w.routineName || `${w.type}|${w.durationMin}|${(w.exercises || []).map((e) => e.name).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length === 4) break;
  }
  return out;
}

function checklistItems(ctx) {
  const { eaten, goals, day, workouts, weights, today } = ctx;
  const latest = weights[weights.length - 1];
  const weighed = latest && latest.date >= shiftDate(today, -6);
  const inZone = eaten.calories >= ctx.goals.calories * 0.7 && eaten.calories <= ctx.goals.calories * 1.05;
  return [
    { label: 'Log food', done: ctx.foods.length > 0, detail: ctx.foods.length ? `${ctx.foods.length} items · ${fmt(eaten.calories)} kcal` : '+5 pts for logging anything', cta: 'Add', action: () => openFoodSheet({ date: today }) },
    { label: 'Drink water', done: (day.water || 0) >= goals.water, detail: `${day.water || 0} of ${goals.water} glasses`, cta: '+1', action: () => addWater(ctx, 1) },
    { label: 'Train', done: workouts.length > 0, detail: workouts.length ? `${workouts.reduce((s, w) => s + w.durationMin, 0)} min done` : ctx.me.streak ? `Keeps your ${ctx.me.streak}-day streak` : 'Any workout counts', cta: 'Log', action: () => openWorkoutSheet() },
    { label: 'Hit protein', done: eaten.protein >= goals.protein * 0.9, detail: `${fmt(eaten.protein)} of ${fmt(goals.protein)} g`, cta: 'Add', action: () => openFoodSheet({ date: today }) },
    { label: 'Land in your calorie zone', done: inZone, detail: `${fmt(goals.calories * 0.7)}–${fmt(goals.calories * 1.05)} kcal for +25 pts`, cta: null },
    { label: 'Weigh in this week', done: Boolean(weighed), detail: latest ? `Last: ${prettyDate(latest.date)}` : 'No weigh-ins yet', cta: 'Log', action: openWeightSheet },
  ];
}

function openGoalSheet() {
  openSheet({
    title: 'Weekly workout goal',
    html: `
      <form id="goal-form" class="stack">
        <div><span class="field-label">Days with a workout each week</span>${stepper('goal', state.user.workoutGoal, { min: 1, max: 7, unit: 'days' })}</div>
        <button class="btn primary big full" type="submit">Save goal</button>
      </form>`,
    onMount(sheet) {
      bindSteppers(sheet);
      $('#goal-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          state.user = await store.updateProfile({ workoutGoal: Number(e.target.goal.value) });
          closeSheet();
          state.rerender();
        } catch (err) { toast(err.message, 'bad'); }
      });
    },
  });
}

// ---------- choosing widgets ----------

export const myWidgets = () => (state.user.widgets || DEFAULT_WIDGETS).filter((id) => WIDGETS[id]);

export function openWidgetEditor() {
  let list = myWidgets();
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        state.user = await store.updateProfile({ widgets: list });
        state.rerender();
      } catch (e) { toast(e.message, 'bad'); }
    }, 400);
  };

  const draw = (sheet) => {
    const body = $('#we-body', sheet);
    body.innerHTML = `
      <p class="muted small">Your Today page, top to bottom. Small tiles sit two to a row.</p>
      <ul class="we-list">${list.map((id, i) => `
        <li>
          <span class="we-ico">${icon(WIDGETS[id].icon, 18)}</span>
          <span class="grow"><b>${esc(WIDGETS[id].name)}</b>${WIDGETS[id].size === 'half' ? '<span class="muted small"> · small</span>' : ''}</span>
          <button type="button" class="icon-btn" data-we-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('upChev', 18)}</button>
          <button type="button" class="icon-btn" data-we-down="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 18)}</button>
          <button type="button" class="icon-btn danger-text" data-we-remove="${i}" aria-label="Remove">${icon('minus', 18)}</button>
        </li>`).join('') || '<li class="muted">Nothing here. Add widgets below.</li>'}</ul>
      ${WIDGET_GROUPS.map(([g, title]) => {
        const avail = Object.entries(WIDGETS).filter(([id, w]) => w.group === g && !list.includes(id));
        return avail.length ? `
          <h3 class="sub">${title}</h3>
          <ul class="we-list add">${avail.map(([id, w]) => `
            <li>
              <span class="we-ico">${icon(w.icon, 18)}</span>
              <span class="grow"><b>${esc(w.name)}</b><span class="muted small">${esc(w.desc)}</span></span>
              <button type="button" class="icon-btn accent" data-we-add="${id}" aria-label="Add ${esc(w.name)}">${icon('plus', 18)}</button>
            </li>`).join('')}</ul>` : '';
      }).join('')}
      <div class="row gap we-foot">
        <button type="button" class="btn" data-we-reset>${icon('reset', 16)} Default layout</button>
        <button type="button" class="btn" data-we-all>${icon('plus', 16)} Add all</button>
      </div>`;
    const change = (next) => { list = next; haptic(8); draw(sheet); save(); };
    $$('[data-we-up]', body).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.weUp); const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; change(n);
    }));
    $$('[data-we-down]', body).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.weDown); const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; change(n);
    }));
    $$('[data-we-remove]', body).forEach((b) => b.addEventListener('click', () => change(list.filter((_, i) => i !== Number(b.dataset.weRemove)))));
    $$('[data-we-add]', body).forEach((b) => b.addEventListener('click', () => {
      change([...list, b.dataset.weAdd]);
      toast(`${WIDGETS[b.dataset.weAdd].name} added at the bottom`);
    }));
    $('[data-we-reset]', body).addEventListener('click', () => change([...DEFAULT_WIDGETS]));
    $('[data-we-all]', body).addEventListener('click', () => change([...list, ...Object.keys(WIDGETS).filter((id) => !list.includes(id))]));
  };

  openSheet({
    title: 'Customize Today',
    html: '<div id="we-body" class="we"></div>',
    onMount: draw,
  });
}

// What each widget needs beyond the basics.
export async function loadExtras(ids, ctx) {
  const needs = new Set(ids.flatMap((id) => WIDGETS[id].needs || []));
  const [history, recentFoods, yesterdayFoods, mine] = await Promise.all([
    needs.has('history') ? store.listWorkouts(60) : [],
    needs.has('recentFoods') ? store.recentFoods().catch(() => []) : [],
    needs.has('yesterdayFoods') ? store.foodsOn(shiftDate(ctx.today, -1)) : [],
    needs.has('routines') ? store.myRoutines().catch(() => []) : [],
  ]);
  Object.assign(ctx, { history, recentFoods, yesterdayFoods, routineList: [...mine, ...STARTERS].slice(0, Math.max(3, Math.min(mine.length, 5))) });
}
