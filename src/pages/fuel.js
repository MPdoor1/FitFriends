import * as store from '../store.js';
import { state } from '../state.js';
import { FOODS, FOOD_CATEGORIES } from '../data.js';
import { goalsFor } from '../nutrition.js';
import {
  $, $$, esc, fmt, fmt1, icon, label, localDate, shiftDate, prettyDate, dayLetter, datesBetween,
  toast, haptic, openSheet, closeSheet, stepper, bindSteppers, barChart, bindCharts, meter,
} from '../ui.js';

export const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
export const mealForNow = () => {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
};
const totals = (foods) => foods.reduce((t, f) => ({
  calories: t.calories + f.calories, protein: t.protein + (f.proteinG || 0), carbs: t.carbs + (f.carbsG || 0), fat: t.fat + (f.fatG || 0),
}), { calories: 0, protein: 0, carbs: 0, fat: 0 });

// ---------- shared pieces ----------

export function calorieRing(eaten, budget) {
  const pct = Math.min(eaten / Math.max(budget, 1), 1);
  const over = eaten > budget;
  const r = 70;
  const c = 2 * Math.PI * r;
  return `
    <div class="ring-wrap">
      <svg viewBox="0 0 180 180" class="ring">
        <circle cx="90" cy="90" r="${r}" class="ring-bg"/>
        <circle cx="90" cy="90" r="${r}" class="ring-fg ${over ? 'over' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
      </svg>
      <div class="ring-label"><strong class="num">${fmt(Math.abs(budget - eaten))}</strong><span>${over ? 'kcal over' : 'kcal left'}</span></div>
    </div>`;
}

export function macroBlock(t, goals) {
  return `
    <div class="macros">
      ${meter('Protein', t.protein, goals.protein, { color: '#3dd6ff' })}
      ${meter('Carbs', t.carbs, goals.carbs, { color: '#ffc53d' })}
      ${meter('Fat', t.fat, goals.fat, { color: '#ff4d8d' })}
    </div>`;
}

// Tappable glasses of water. Tap a glass to fill up to it; tap the last full one to empty it.
export function waterCard(date, glasses, goal) {
  const n = Math.max(goal, glasses, 1);
  return `
    <section class="card water" data-water-date="${date}" data-water="${glasses}">
      <div class="row between head">${label('Water')}<span class="num muted"><b class="water-count">${glasses}</b> / ${goal} glasses</span></div>
      <div class="glasses">
        ${Array.from({ length: n }, (_, i) => `<button type="button" class="glass ${i < glasses ? 'full' : ''}" data-glass="${i + 1}" aria-label="${i + 1} glasses">${icon('water', 22)}</button>`).join('')}
      </div>
      <div class="water-actions">
        <button type="button" class="icon-btn" data-water-step="-1" aria-label="One less glass">${icon('minus', 18)}</button>
        <span class="muted small">1 glass = 8 oz / 250 ml</span>
        <button type="button" class="icon-btn accent" data-water-step="1" aria-label="One more glass">${icon('plus', 18)}</button>
      </div>
    </section>`;
}

export function bindWater(root) {
  $$('.water', root).forEach((card) => {
    const date = card.dataset.waterDate;
    let current = Number(card.dataset.water);
    let timer;
    const set = (n) => {
      current = Math.max(0, Math.min(30, n));
      $$('.glass', card).forEach((g) => g.classList.toggle('full', Number(g.dataset.glass) <= current));
      $('.water-count', card).textContent = current;
      haptic(8);
      // Save after a short pause so quick taps become one write.
      clearTimeout(timer);
      timer = setTimeout(() => store.setWater(date, current).catch((e) => toast(e.message, 'bad')), 500);
    };
    $$('.glass', card).forEach((g) => g.addEventListener('click', () => {
      const n = Number(g.dataset.glass);
      set(n === current ? n - 1 : n);
    }));
    $$('[data-water-step]', card).forEach((b) => b.addEventListener('click', () => set(current + Number(b.dataset.waterStep))));
  });
}

// ---------- add food sheet ----------

const macroLine = (f, servings = 1) => `${fmt(f.proteinG * servings)}P · ${fmt(f.carbsG * servings)}C · ${fmt(f.fatG * servings)}F`;
const SERVING_CHIPS = [0.5, 1, 1.5, 2, 3];
const fraction = (n) => ({ 0.25: '¼', 0.5: '½', 0.75: '¾', 1.5: '1½', 2.5: '2½' }[n] || String(n));

export async function openFoodSheet({ date = localDate(), meal = mealForNow() } = {}) {
  const recent = await store.recentFoods().catch(() => []);
  let category = null;
  let picked = null;

  const resultRow = (f, i, list) => `
    <button type="button" class="food-row" data-pick="${list}:${i}">
      <span class="food-main"><strong>${esc(f.name)}</strong><span class="muted small">${esc(f.serving)} · ${macroLine(f)}</span></span>
      <span class="num food-kcal">${fmt(f.calories)}</span>
      <span class="food-add">${icon('plus', 18)}</span>
    </button>`;

  const html = `
    <div id="fs-search-view">
      <div class="search">${icon('search', 18)}<input id="fs-q" type="search" placeholder="Search foods" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips scroll" id="fs-cats">
        <button type="button" class="chip on" data-cat="">All</button>
        ${FOOD_CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div id="fs-results"></div>
      <button type="button" class="btn ghost full" id="fs-custom">${icon('edit', 18)} Enter my own food</button>
    </div>
    <div id="fs-detail" hidden></div>`;

  openSheet({
    title: `Add to ${MEALS.find(([k]) => k === meal)[1].toLowerCase()}`,
    html,
    onMount(sheet) {
      const results = $('#fs-results', sheet);
      const q = $('#fs-q', sheet);
      const lists = { r: recent, d: FOODS };

      const draw = () => {
        const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const match = (f) => words.every((w) => f.name.toLowerCase().includes(w));
        const mine = recent.filter(match).filter(() => !category);
        const db = FOODS.filter((f) => match(f) && (!category || f.category === category));
        results.innerHTML = `
          ${mine.length ? `<h3 class="sub">${words.length ? 'Your foods' : 'Recent'}</h3>${mine.slice(0, words.length ? 20 : 8).map((f) => resultRow(f, recent.indexOf(f), 'r')).join('')}` : ''}
          ${db.length ? `<h3 class="sub">${category || (words.length ? 'Food list' : 'Popular foods')}</h3>${db.slice(0, words.length || category ? 60 : 25).map((f) => resultRow(f, FOODS.indexOf(f), 'd')).join('')}` : ''}
          ${!mine.length && !db.length ? `<p class="empty">No match for “${esc(q.value)}”. Add it as your own food below.</p>` : ''}`;
      };
      q.addEventListener('input', draw);
      $$('[data-cat]', sheet).forEach((b) => b.addEventListener('click', () => {
        category = b.dataset.cat || null;
        $$('[data-cat]', sheet).forEach((x) => x.classList.toggle('on', x === b));
        draw();
      }));
      results.addEventListener('click', (e) => {
        const row = e.target.closest('[data-pick]');
        if (!row) return;
        const [list, i] = row.dataset.pick.split(':');
        picked = lists[list][Number(i)];
        showDetail(picked);
      });
      $('#fs-custom', sheet).addEventListener('click', () => showDetail(null));

      const showDetail = (food) => {
        $('#fs-search-view', sheet).hidden = true;
        const d = $('#fs-detail', sheet);
        d.hidden = false;
        const custom = !food;
        d.innerHTML = `
          <button type="button" class="back" id="fs-back">${icon('left', 18)} Back to search</button>
          <form id="fs-form" class="stack">
            ${custom ? `
              <label>Food name<input name="name" required maxlength="80" placeholder="Grandma's lasagna"></label>
              <label>Serving <span class="opt">optional</span><input name="serving" maxlength="40" placeholder="1 plate"></label>
              <div class="fields four">
                <label>Calories<input name="calories" type="number" inputmode="numeric" min="0" max="5000" required></label>
                <label>Protein g<input name="proteinG" type="number" inputmode="decimal" min="0" step="any"></label>
                <label>Carbs g<input name="carbsG" type="number" inputmode="decimal" min="0" step="any"></label>
                <label>Fat g<input name="fatG" type="number" inputmode="decimal" min="0" step="any"></label>
              </div>` : `
              <div class="food-title"><h3>${esc(food.name)}</h3><span class="muted">${esc(food.serving)} per serving</span></div>`}
            <div>
              <span class="field-label">Servings</span>
              ${stepper('servings', 1, { step: 0.25, min: 0.25, max: 20, decimals: 2 })}
              <div class="chips tight">${SERVING_CHIPS.map((n) => `<button type="button" class="chip ${n === 1 ? 'on' : ''}" data-serv="${n}">${fraction(n)}</button>`).join('')}</div>
            </div>
            <div>
              <span class="field-label">Meal</span>
              <div class="seg">${MEALS.map(([k, l]) => `<button type="button" data-meal="${k}" class="${k === meal ? 'on' : ''}">${l}</button>`).join('')}</div>
            </div>
            <div class="food-totals" id="fs-totals"></div>
            <button class="btn primary big full" type="submit">Add food</button>
          </form>`;
        bindSteppers(d);
        const f = $('#fs-form', d);
        let chosenMeal = meal;
        const per = () => (custom ? {
          calories: Number(f.calories.value) || 0, proteinG: Number(f.proteinG.value) || 0, carbsG: Number(f.carbsG.value) || 0, fatG: Number(f.fatG.value) || 0,
        } : food);
        const update = () => {
          const s = Number(f.servings.value) || 0;
          const p = per();
          $('#fs-totals', d).innerHTML = `
            <div><b class="num">${fmt(p.calories * s)}</b><span>kcal</span></div>
            <div><b class="num">${fmt1(p.proteinG * s)}g</b><span>protein</span></div>
            <div><b class="num">${fmt1(p.carbsG * s)}g</b><span>carbs</span></div>
            <div><b class="num">${fmt1(p.fatG * s)}g</b><span>fat</span></div>`;
          $$('[data-serv]', d).forEach((c) => c.classList.toggle('on', Number(c.dataset.serv) === s));
        };
        f.addEventListener('input', update);
        $$('[data-serv]', d).forEach((c) => c.addEventListener('click', () => { f.servings.value = c.dataset.serv; update(); haptic(5); }));
        $$('[data-meal]', d).forEach((b) => b.addEventListener('click', () => {
          chosenMeal = b.dataset.meal;
          $$('[data-meal]', d).forEach((x) => x.classList.toggle('on', x === b));
        }));
        $('#fs-back', d).addEventListener('click', () => { d.hidden = true; $('#fs-search-view', sheet).hidden = false; });
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = f.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            const p = per();
            const entry = await store.addFood(state.user, {
              date, meal: chosenMeal, name: custom ? f.name.value : food.name,
              serving: custom ? f.serving.value : food.serving, servings: f.servings.value,
              per: { calories: p.calories, proteinG: p.proteinG, carbsG: p.carbsG, fatG: p.fatG },
            });
            closeSheet();
            haptic(15);
            toast(`Added ${entry.name} · ${fmt(entry.calories)} kcal`);
            state.rerender();
          } catch (err) {
            toast(err.message, 'bad');
            btn.disabled = false;
          }
        });
        update();
        if (custom) f.name.focus();
      };

      draw();
    },
  });
}

// ---------- edit entry sheet ----------

function openEntrySheet(entry) {
  const per = entry.per || { calories: entry.calories, proteinG: entry.proteinG || 0, carbsG: entry.carbsG || 0, fatG: entry.fatG || 0 };
  let meal = entry.meal;
  openSheet({
    title: entry.name,
    html: `
      <form id="fe-form" class="stack">
        <p class="muted">${esc(entry.serving || '1 serving')} per serving · ${fmt(per.calories)} kcal</p>
        <div><span class="field-label">Servings</span>${stepper('servings', entry.servings || 1, { step: 0.25, min: 0.25, max: 20, decimals: 2 })}</div>
        <div><span class="field-label">Meal</span><div class="seg">${MEALS.map(([k, l]) => `<button type="button" data-meal="${k}" class="${k === meal ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="food-totals" id="fe-totals"></div>
        <button class="btn primary big full" type="submit">Save</button>
        <button class="btn ghost-danger full" type="button" id="fe-delete">${icon('trash', 18)} Delete entry</button>
      </form>`,
    onMount(sheet) {
      bindSteppers(sheet);
      const f = $('#fe-form', sheet);
      const update = () => {
        const s = Number(f.servings.value) || 0;
        $('#fe-totals', sheet).innerHTML = `
          <div><b class="num">${fmt(per.calories * s)}</b><span>kcal</span></div>
          <div><b class="num">${fmt1(per.proteinG * s)}g</b><span>protein</span></div>
          <div><b class="num">${fmt1(per.carbsG * s)}g</b><span>carbs</span></div>
          <div><b class="num">${fmt1(per.fatG * s)}g</b><span>fat</span></div>`;
      };
      f.addEventListener('input', update);
      $$('[data-meal]', sheet).forEach((b) => b.addEventListener('click', () => {
        meal = b.dataset.meal;
        $$('[data-meal]', sheet).forEach((x) => x.classList.toggle('on', x === b));
      }));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await store.updateFood(state.user, entry, { servings: f.servings.value, meal });
          closeSheet();
          toast('Updated');
          state.rerender();
        } catch (err) { toast(err.message, 'bad'); }
      });
      $('#fe-delete', sheet).addEventListener('click', async () => {
        try {
          await store.deleteFood(state.user, entry);
          closeSheet();
          state.rerender();
          toast(`${entry.name} removed`, {
            action: 'Undo',
            onAction: async () => { await store.addFood(state.user, { ...entry, per }); state.rerender(); },
          });
        } catch (err) { toast(err.message, 'bad'); }
      });
      update();
    },
  });
}

// ---------- page ----------

let foodDate = null;

export async function viewFuel(app, stale) {
  const today = localDate();
  foodDate ||= today;
  const date = foodDate;
  const yesterday = shiftDate(date, -1);
  const [foods, day, prevFoods, days] = await Promise.all([
    store.foodsOn(date), store.getDay(date), store.foodsOn(yesterday), store.myDays(shiftDate(date, -13), date),
  ]);
  if (stale()) return;
  const goals = goalsFor(state.user);
  const t = totals(foods);
  const budget = goals.calories + day.wCalories;
  const chartDays = datesBetween(shiftDate(date, -13), date);
  const logged = chartDays.filter((d) => d !== today && days[d]?.foodCalories > 0);
  const avg = logged.length ? logged.reduce((s, d) => s + days[d].foodCalories, 0) / logged.length : 0;
  const onTarget = logged.filter((d) => days[d].foodPoints >= 25).length;

  app.innerHTML = `
    <div class="page-head">
      <div>${label('Fuel')}<h1>Calories</h1></div>
      <button class="btn primary" id="add-food">${icon('plus', 18)} Add</button>
    </div>

    <div class="date-nav card slim">
      <button class="icon-btn" id="prev-day" aria-label="Previous day">${icon('left', 20)}</button>
      <button class="date-label" id="pick-date"><strong>${prettyDate(date)}</strong>${date !== today ? '<span class="muted small">Tap for today</span>' : ''}</button>
      <button class="icon-btn" id="next-day" aria-label="Next day" ${date >= today ? 'disabled' : ''}>${icon('right', 20)}</button>
    </div>

    <section class="card">
      <div class="ring-row">
        ${calorieRing(t.calories, budget)}
        <dl class="kv">
          <div><dt>Goal</dt><dd class="num">${fmt(goals.calories)}</dd></div>
          <div><dt>Food</dt><dd class="num">−${fmt(t.calories)}</dd></div>
          <div><dt>Exercise</dt><dd class="num">+${fmt(day.wCalories)}</dd></div>
        </dl>
      </div>
      ${macroBlock(t, goals)}
      <p class="muted small tip">${icon('info', 14)} Finish the day at 70–105% of your goal for <b>+25 pts</b>. Logging anything earns +5.</p>
    </section>

    ${MEALS.map(([k, name]) => {
      const items = foods.filter((f) => f.meal === k);
      const mt = totals(items);
      const prevItems = prevFoods.filter((f) => f.meal === k);
      return `
        <section class="card meal">
          <div class="meal-head">
            <h3>${name}</h3>
            <span class="num muted">${items.length ? `${fmt(mt.calories)} kcal` : ''}</span>
          </div>
          ${items.length ? `<ul class="list">${items.map((f) => `
            <li><button type="button" class="food-entry" data-entry="${esc(f.id)}">
              <span class="food-main"><strong>${esc(f.name)}</strong><span class="muted small">${f.servings && f.servings !== 1 ? `${fraction(f.servings)} × ` : ''}${esc(f.serving || 'serving')} · ${fmt(f.proteinG)}P ${fmt(f.carbsG)}C ${fmt(f.fatG)}F</span></span>
              <span class="num food-kcal">${fmt(f.calories)}</span>
            </button></li>`).join('')}</ul>` : ''}
          <div class="meal-actions">
            <button type="button" class="btn small-btn ghost" data-add-meal="${k}">${icon('plus', 16)} Add food</button>
            ${!items.length && prevItems.length ? `<button type="button" class="btn small-btn ghost" data-copy="${k}">${icon('copy', 16)} Same as ${date === today ? 'yesterday' : prettyDate(yesterday)} (${fmt(totals(prevItems).calories)})</button>` : ''}
          </div>
        </section>`;
    }).join('')}

    ${waterCard(date, day.water || 0, goals.water)}

    <section class="card">
      <div class="row between head">${label('Last 14 days')}<span class="muted small">Goal ${fmt(goals.calories)} kcal</span></div>
      ${barChart(chartDays.map((d) => {
        const v = days[d]?.foodCalories || 0;
        return { label: dayLetter(d), value: v, dim: !v, color: v > goals.calories * 1.05 ? 'var(--hot)' : 'var(--accent)', tip: `${prettyDate(d)}: ${fmt(v)} kcal${days[d]?.foodPoints >= 25 ? ' · on target' : ''}` };
      }), { goal: goals.calories })}
      ${logged.length ? `<div class="mini-stats"><div><b class="num">${fmt(avg)}</b><span>Avg kcal / day logged</span></div><div><b class="num">${onTarget}/${logged.length}</b><span>Days on target</span></div></div>` : ''}
    </section>`;

  bindCharts(app);
  bindWater(app);
  $('#add-food').addEventListener('click', () => openFoodSheet({ date }));
  $$('[data-add-meal]').forEach((b) => b.addEventListener('click', () => openFoodSheet({ date, meal: b.dataset.addMeal })));
  $$('[data-entry]').forEach((b) => b.addEventListener('click', () => openEntrySheet(foods.find((f) => f.id === b.dataset.entry))));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const n = await store.copyMeal(state.user, yesterday, b.dataset.copy, date);
      haptic(15);
      toast(`Copied ${n} item${n === 1 ? '' : 's'}`);
      state.rerender();
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
  }));
  $('#prev-day').addEventListener('click', () => { foodDate = shiftDate(foodDate, -1); state.rerender(); });
  $('#next-day').addEventListener('click', () => { foodDate = shiftDate(foodDate, 1); state.rerender(); });
  $('#pick-date').addEventListener('click', () => { foodDate = today; state.rerender(); });
}
