'use strict';

// ---------- tiny utilities ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString();

function localDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
function weekStart(dateStr = localDate()) {
  const d = new Date(`${dateStr}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return shiftDate(dateStr, -dow);
}
function monthStart(dateStr = localDate()) {
  return `${dateStr.slice(0, 8)}01`;
}
function prettyDate(dateStr) {
  const today = localDate();
  if (dateStr === today) return 'Today';
  if (dateStr === shiftDate(today, -1)) return 'Yesterday';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    state.user = null;
    if (location.hash !== '#/login') location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

function burst(emoji = '🎉') {
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = i % 3 ? emoji : '✨';
    s.style.left = `${40 + Math.random() * 20}vw`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}vw`);
    s.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    s.style.animationDelay = `${Math.random() * 0.15}s`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1600);
  }
}

// ---------- state & data ----------

const state = { user: null, config: null };

const COMMON_FOODS = [
  ['🍳', 'Eggs (2 large)', 140, 12], ['🥣', 'Oatmeal (1 cup)', 160, 6], ['🍌', 'Banana', 105, 1],
  ['🍎', 'Apple', 95, 0], ['🥛', 'Greek yogurt', 130, 17], ['🍞', 'Toast w/ butter', 170, 4],
  ['☕', 'Latte (16oz)', 190, 12], ['🥤', 'Protein shake', 160, 30], ['🥪', 'Turkey sandwich', 350, 24],
  ['🥗', 'Chicken salad', 400, 35], ['🍗', 'Chicken breast (6oz)', 280, 52], ['🍚', 'Rice (1 cup)', 205, 4],
  ['🍝', 'Pasta (2 cups)', 440, 16], ['🍕', 'Pizza slice', 285, 12], ['🍔', 'Burger', 550, 30],
  ['🌯', 'Burrito', 700, 30], ['🍣', 'Sushi roll', 350, 12], ['🥩', 'Steak (8oz)', 540, 60],
  ['🥜', 'Peanut butter (2 tbsp)', 190, 7], ['🧀', 'Cheese (1oz)', 110, 7], ['🍫', 'Chocolate bar', 230, 3],
  ['🍪', 'Cookie', 150, 2], ['🍺', 'Beer', 150, 2], ['🍷', 'Glass of wine', 125, 0],
  ['🥑', 'Avocado (half)', 120, 1], ['🥔', 'Fries (medium)', 365, 4], ['🥨', 'Chips (1oz)', 155, 2],
];

const MEALS = [['breakfast', '🌅 Breakfast'], ['lunch', '☀️ Lunch'], ['dinner', '🌙 Dinner'], ['snack', '🍿 Snacks']];
const AVATARS = ['🏃', '🚴', '🏋️', '🧘', '🏊', '⛹️', '🤸', '🥊', '🦁', '🐯', '🦊', '🐻', '🐼', '🦄', '🐸', '🐙', '🦖', '🚀', '⚡', '🔥', '🌟', '🤖', '👑', '🥑'];
const COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#84cc16', '#f97316', '#14b8a6'];
const typeIcon = (name) => state.config?.workoutTypes.find((t) => t.name === name)?.icon || '💪';
const typeMet = (name) => state.config?.workoutTypes.find((t) => t.name === name)?.met || 5;
const INTENSITY = { light: { met: 0.75, pts: 1, label: '🙂 Light' }, moderate: { met: 1, pts: 1.5, label: '😤 Moderate' }, hard: { met: 1.3, pts: 2, label: '🥵 Hard' } };

// ---------- router ----------

const routes = { login: viewLogin, home: viewHome, workouts: viewWorkouts, food: viewFood, arena: viewArena, profile: viewProfile };

async function render() {
  const name = (location.hash.replace(/^#\//, '').split('?')[0]) || 'home';
  if (!state.user && name !== 'login') { location.hash = '#/login'; return; }
  if (state.user && name === 'login') { location.hash = '#/home'; return; }
  $('#topbar').hidden = !state.user;
  if (state.user) $('#nav-avatar').textContent = state.user.avatar;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  const view = routes[name] || viewHome;
  app.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await view();
  } catch (e) {
    app.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

// ---------- login / register ----------

async function viewLogin() {
  let mode = 'login';
  const draw = () => {
    app.innerHTML = `
      <section class="auth">
        <div class="auth-hero">
          <div class="auth-logo">💪</div>
          <h1>FitFriends</h1>
          <p>Log workouts, count calories, and race your friends to the top.</p>
        </div>
        <div class="card auth-card">
          <div class="seg">
            <button type="button" data-mode="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button>
            <button type="button" data-mode="register" class="${mode === 'register' ? 'on' : ''}">Create account</button>
          </div>
          <form id="auth-form" class="stack">
            <label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" autocapitalize="none"></label>
            ${mode === 'register' ? '<label>Display name<input name="displayName" maxlength="40" placeholder="What friends see"></label>' : ''}
            <label>Password<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="4"></label>
            ${mode === 'register' && state.config.inviteRequired ? '<label>Invite code<input name="inviteCode" required placeholder="Ask the group"></label>' : ''}
            <p class="form-error" id="auth-error"></p>
            <button class="btn primary big" type="submit">${mode === 'login' ? 'Sign in' : 'Join the crew'}</button>
          </form>
        </div>
      </section>`;
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; draw(); }));
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        const { user } = await api(mode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body });
        state.user = user;
        if (mode === 'register') burst('💪');
        location.hash = '#/home';
      } catch (err) {
        $('#auth-error').textContent = err.message;
      }
    });
  };
  draw();
}

// ---------- home ----------

function calorieRing(eaten, goal, burned) {
  const budget = goal + burned;
  const pct = Math.min(eaten / budget, 1);
  const over = eaten > budget;
  const r = 70;
  const c = 2 * Math.PI * r;
  return `
    <div class="ring-wrap">
      <svg viewBox="0 0 180 180" class="ring">
        <circle cx="90" cy="90" r="${r}" class="ring-bg"/>
        <circle cx="90" cy="90" r="${r}" class="ring-fg ${over ? 'over' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
      </svg>
      <div class="ring-label">
        <strong>${fmt(Math.abs(budget - eaten))}</strong>
        <span>${over ? 'over' : 'left'}</span>
      </div>
    </div>`;
}

async function viewHome() {
  const today = localDate();
  const s = await api(`/api/summary?today=${today}&from=${weekStart(today)}`);
  const me = s.me;
  const lvl = me.level;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const medal = ['🥇', '🥈', '🥉'][s.rank - 1] || '🏅';
  app.innerHTML = `
    <section class="hello">
      <div class="avatar big" style="--c:${me.color}">${esc(me.avatar)}</div>
      <div>
        <p class="muted">${greet},</p>
        <h1>${esc(me.displayName)}</h1>
      </div>
    </section>

    <section class="card level-card">
      <div class="row between">
        <div><span class="lvl-badge">LVL ${lvl.number}</span> <strong>${esc(lvl.title)}</strong></div>
        <span class="muted">${fmt(me.totalXp)} XP</span>
      </div>
      <div class="xpbar"><div style="width:${Math.round(lvl.progress * 100)}%"></div></div>
      <p class="muted small">${fmt(lvl.toNext)} XP to level ${lvl.number + 1}</p>
    </section>

    <section class="tiles">
      <a class="tile" href="#/arena"><span class="tile-ico">${medal}</span><strong>${s.rank}/${s.players}</strong><span>Weekly rank</span></a>
      <div class="tile"><span class="tile-ico">🔥</span><strong>${me.streak}</strong><span>Day streak</span></div>
      <div class="tile"><span class="tile-ico">⭐</span><strong>${fmt(me.points)}</strong><span>Pts this week</span></div>
      <div class="tile"><span class="tile-ico">⏱️</span><strong>${fmt(me.minutes)}</strong><span>Min this week</span></div>
    </section>

    <section class="grid2">
      <div class="card">
        <div class="row between"><h2>Calories today</h2><a href="#/food" class="link">Log food →</a></div>
        <div class="ring-row">
          ${calorieRing(s.eaten, s.goal, s.burned)}
          <ul class="kv">
            <li><span>🎯 Goal</span><strong>${fmt(s.goal)}</strong></li>
            <li><span>🍽️ Eaten</span><strong>${fmt(s.eaten)}</strong></li>
            <li><span>🔥 Burned</span><strong>+${fmt(s.burned)}</strong></li>
          </ul>
        </div>
      </div>
      <div class="card">
        <div class="row between"><h2>Today's workouts</h2><a href="#/workouts" class="link">Add →</a></div>
        ${s.todaysWorkouts.length ? `<ul class="list">${s.todaysWorkouts.map(workoutItem).join('')}</ul>`
          : `<div class="empty"><p>No workout yet today.</p><a class="btn primary" href="#/workouts">Log a workout</a></div>`}
      </div>
    </section>`;
}

function workoutItem(w, withDelete = false) {
  return `
    <li class="item">
      <span class="item-ico">${typeIcon(w.type)}</span>
      <div class="item-main">
        <strong>${esc(w.type)}</strong>
        <span class="muted small">${w.duration_min} min · ${esc(w.intensity)}${w.distance_km ? ` · ${w.distance_km} km` : ''} · ${fmt(w.calories)} cal</span>
        ${w.notes ? `<span class="note">${esc(w.notes)}</span>` : ''}
      </div>
      <span class="pts">+${w.points}</span>
      ${withDelete ? `<button class="icon-btn" data-del="${w.id}" aria-label="Delete">✕</button>` : ''}
    </li>`;
}

// ---------- workouts ----------

async function viewWorkouts() {
  const { workouts } = await api('/api/workouts');
  const types = state.config.workoutTypes;
  const form = { type: types[0].name, intensity: 'moderate' };

  const grouped = {};
  for (const w of workouts) (grouped[w.date] ||= []).push(w);

  app.innerHTML = `
    <h1 class="page-title">Workouts</h1>
    <section class="card">
      <h2>Log a workout</h2>
      <form id="w-form" class="stack">
        <div class="type-grid">
          ${types.map((t) => `<button type="button" class="type-btn ${t.name === form.type ? 'on' : ''}" data-type="${esc(t.name)}"><span>${t.icon}</span>${esc(t.name)}</button>`).join('')}
        </div>
        <div class="seg" id="intensity">
          ${Object.entries(INTENSITY).map(([k, v]) => `<button type="button" data-int="${k}" class="${k === form.intensity ? 'on' : ''}">${v.label}</button>`).join('')}
        </div>
        <div class="row gap wrap">
          <label class="grow">Minutes<input name="durationMin" type="number" min="1" max="600" value="30" required inputmode="numeric"></label>
          <label class="grow">Distance (km, optional)<input name="distanceKm" type="number" min="0" step="0.1" inputmode="decimal"></label>
          <label class="grow">Date<input name="date" type="date" value="${localDate()}" max="${localDate()}" required></label>
        </div>
        <label>What did you do? (optional)<input name="notes" maxlength="500" placeholder="e.g. 5x5 squats, bench; easy 5k along the river"></label>
        <div class="preview" id="w-preview"></div>
        <button class="btn primary big" type="submit">Save workout</button>
      </form>
    </section>
    <section class="card">
      <h2>History</h2>
      ${workouts.length ? Object.entries(grouped).map(([date, ws]) => `
        <h3 class="day-head">${prettyDate(date)} <span class="muted small">${ws.reduce((s, w) => s + w.points, 0)} pts</span></h3>
        <ul class="list">${ws.map((w) => workoutItem(w, true)).join('')}</ul>`).join('')
        : '<p class="empty">Your workouts will show up here.</p>'}
    </section>`;

  const f = $('#w-form');
  const preview = () => {
    const mins = Math.min(Number(f.durationMin.value) || 0, 600);
    const cal = Math.round(typeMet(form.type) * INTENSITY[form.intensity].met * state.user.weightKg * (mins / 60));
    const pts = Math.round(Math.min(mins, 300) * INTENSITY[form.intensity].pts);
    $('#w-preview').innerHTML = `<span>🔥 ~${fmt(cal)} cal</span><span>⭐ +${fmt(pts)} pts</span>`;
  };
  $$('.type-btn').forEach((b) => b.addEventListener('click', () => {
    form.type = b.dataset.type;
    $$('.type-btn').forEach((x) => x.classList.toggle('on', x === b));
    preview();
  }));
  $$('[data-int]').forEach((b) => b.addEventListener('click', () => {
    form.intensity = b.dataset.int;
    $$('[data-int]').forEach((x) => x.classList.toggle('on', x === b));
    preview();
  }));
  f.durationMin.addEventListener('input', preview);
  preview();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(f)), type: form.type, intensity: form.intensity };
    try {
      const { workout } = await api('/api/workouts', { method: 'POST', body });
      burst(typeIcon(workout.type));
      toast(`Nice! +${workout.points} points`);
      viewWorkouts();
    } catch (err) { toast(err.message, 'bad'); }
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this workout?')) return;
    await api(`/api/workouts/${b.dataset.del}`, { method: 'DELETE' });
    viewWorkouts();
  }));
}

// ---------- food ----------

let foodDate = null;

async function viewFood() {
  foodDate ||= localDate();
  const [{ foods, burned, goal }, { recent }] = await Promise.all([
    api(`/api/foods?date=${foodDate}`),
    api('/api/foods/recent'),
  ]);
  const eaten = foods.reduce((s, f) => s + f.calories, 0);
  const protein = foods.reduce((s, f) => s + (f.protein_g || 0), 0);
  const budget = goal + burned;
  const pct = Math.min((eaten / budget) * 100, 100);
  const hour = new Date().getHours();
  const defaultMeal = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack';

  app.innerHTML = `
    <h1 class="page-title">Calories</h1>
    <section class="card">
      <div class="date-nav">
        <button class="icon-btn" id="prev-day" aria-label="Previous day">‹</button>
        <strong>${prettyDate(foodDate)}</strong>
        <button class="icon-btn" id="next-day" aria-label="Next day" ${foodDate >= localDate() ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal-bar"><div class="${eaten > budget ? 'over' : ''}" style="width:${pct}%"></div></div>
      <div class="cal-stats">
        <div><strong>${fmt(eaten)}</strong><span>eaten</span></div>
        <div><strong>${fmt(goal)}</strong><span>goal</span></div>
        <div><strong>+${fmt(burned)}</strong><span>burned</span></div>
        <div class="${eaten > budget ? 'bad' : 'good'}"><strong>${fmt(Math.abs(budget - eaten))}</strong><span>${eaten > budget ? 'over' : 'left'}</span></div>
        <div><strong>${fmt(protein)}g</strong><span>protein</span></div>
      </div>
      <p class="muted small">Land between 70% and 105% of your goal for <strong>+25 pts</strong>. Logging anything earns +5.</p>
    </section>

    <section class="card">
      <h2>Add food</h2>
      <form id="f-form" class="stack">
        <div class="row gap wrap">
          <label class="grow2">Food<input name="name" required maxlength="80" placeholder="e.g. Chicken burrito" list="food-suggest"></label>
          <label class="grow">Calories<input name="calories" type="number" min="0" max="5000" required inputmode="numeric"></label>
          <label class="grow">Protein g<input name="proteinG" type="number" min="0" max="500" step="0.1" inputmode="decimal"></label>
          <label class="grow">Meal<select name="meal">${MEALS.map(([k, l]) => `<option value="${k}" ${k === defaultMeal ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <datalist id="food-suggest">${COMMON_FOODS.map(([, n]) => `<option value="${esc(n)}">`).join('')}</datalist>
        <button class="btn primary big" type="submit">Add</button>
      </form>
      ${recent.length ? `<h3 class="sub">Your recent</h3><div class="chips">${recent.map((r) => `<button class="chip" data-quick='${esc(JSON.stringify([r.name, r.calories, r.protein_g]))}'>${esc(r.name)} <em>${r.calories}</em></button>`).join('')}</div>` : ''}
      <h3 class="sub">Quick add</h3>
      <div class="chips">${COMMON_FOODS.map(([i, n, c, p]) => `<button class="chip" data-quick='${esc(JSON.stringify([n, c, p]))}'>${i} ${esc(n)} <em>${c}</em></button>`).join('')}</div>
    </section>

    <section class="card">
      ${MEALS.map(([k, label]) => {
        const items = foods.filter((f) => f.meal === k);
        if (!items.length) return '';
        return `<h3 class="day-head">${label} <span class="muted small">${fmt(items.reduce((s, f) => s + f.calories, 0))} cal</span></h3>
          <ul class="list">${items.map((f) => `
            <li class="item">
              <div class="item-main"><strong>${esc(f.name)}</strong>${f.protein_g ? `<span class="muted small">${f.protein_g}g protein</span>` : ''}</div>
              <span class="pts cal">${fmt(f.calories)}</span>
              <button class="icon-btn" data-del="${f.id}" aria-label="Delete">✕</button>
            </li>`).join('')}</ul>`;
      }).join('') || '<p class="empty">Nothing logged for this day yet.</p>'}
    </section>`;

  const f = $('#f-form');
  const add = async (body) => {
    try {
      await api('/api/foods', { method: 'POST', body: { ...body, date: foodDate } });
      toast(`Added ${body.name}`);
      viewFood();
    } catch (err) { toast(err.message, 'bad'); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); add(Object.fromEntries(new FormData(f))); });
  f.name.addEventListener('change', () => {
    const match = COMMON_FOODS.find(([, n]) => n === f.name.value);
    if (match) { f.calories.value = match[2]; f.proteinG.value = match[3]; }
  });
  $$('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    const [name, calories, proteinG] = JSON.parse(b.dataset.quick);
    add({ name, calories, proteinG: proteinG ?? '', meal: f.meal.value });
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/foods/${b.dataset.del}`, { method: 'DELETE' });
    viewFood();
  }));
  $('#prev-day').addEventListener('click', () => { foodDate = shiftDate(foodDate, -1); viewFood(); });
  $('#next-day').addEventListener('click', () => { foodDate = shiftDate(foodDate, 1); viewFood(); });
}

// ---------- arena (competition) ----------

let arenaPeriod = 'week';

async function viewArena() {
  const today = localDate();
  const from = arenaPeriod === 'week' ? weekStart(today) : arenaPeriod === 'month' ? monthStart(today) : '0000-01-01';
  const { board, meId } = await api(`/api/leaderboard?today=${today}&from=${from}&to=${today}`);
  const leader = Math.max(...board.map((p) => p.points), 1);
  const podium = [board[1], board[0], board[2]];
  const periodLabel = { week: 'this week', month: 'this month', all: 'all time' }[arenaPeriod];

  const statRow = (key, label, icon, unit = '') => {
    const max = Math.max(...board.map((p) => p[key]), 1);
    return `
      <div class="cmp">
        <h3>${icon} ${label}</h3>
        ${board.map((p) => `
          <div class="cmp-row ${p.id === meId ? 'me' : ''}">
            <span class="cmp-name">${esc(p.avatar)} ${esc(p.displayName)}</span>
            <div class="cmp-track"><div class="cmp-fill" style="--w:${(p[key] / max) * 100}%; --c:${p.color}"></div></div>
            <span class="cmp-val">${fmt(p[key])}${unit}</span>
          </div>`).join('')}
      </div>`;
  };

  // Daily points heat strip for the current week.
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(today), i));
  const heat = arenaPeriod === 'week' ? `
    <section class="card">
      <h2>Daily grind</h2>
      <div class="heat" style="--cols:${weekDays.length}">
        <span></span>${weekDays.map((d) => `<span class="heat-day">${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('')}
        ${board.map((p) => `
          <span class="heat-name">${esc(p.avatar)}</span>
          ${weekDays.map((d) => {
            const v = p.daily[d] || 0;
            const a = v ? Math.min(0.25 + v / 120, 1) : 0;
            return `<span class="heat-cell ${d > today ? 'future' : ''}" style="--c:${p.color}; --a:${a}" title="${esc(p.displayName)} · ${d}: ${v} pts">${v || ''}</span>`;
          }).join('')}`).join('')}
      </div>
    </section>` : '';

  app.innerHTML = `
    <h1 class="page-title">🏆 The Arena</h1>
    <div class="seg period">
      ${['week', 'month', 'all'].map((p) => `<button data-period="${p}" class="${p === arenaPeriod ? 'on' : ''}">${{ week: 'This week', month: 'This month', all: 'All time' }[p]}</button>`).join('')}
    </div>

    <section class="card race-card">
      <div class="row between"><h2>The Race</h2><span class="muted small">points ${periodLabel}</span></div>
      <div class="race">
        ${board.map((p, i) => `
          <div class="lane ${p.id === meId ? 'me' : ''}" style="--c:${p.color}">
            <span class="lane-rank">${i + 1}</span>
            <div class="lane-track">
              <div class="runner" style="--pos:${(p.points / leader) * 100}%">
                ${i === 0 && p.points > 0 ? '<span class="crown">👑</span>' : ''}
                <span class="runner-ava">${esc(p.avatar)}</span>
                <span class="runner-tag">${esc(p.displayName)} · ${fmt(p.points)}</span>
              </div>
            </div>
            <span class="finish">🏁</span>
          </div>`).join('')}
      </div>
    </section>

    <section class="card podium-card">
      <div class="podium">
        ${podium.map((p, i) => p ? `
          <div class="pod pod-${[2, 1, 3][i]}" style="--c:${p.color}">
            <div class="avatar" style="--c:${p.color}">${esc(p.avatar)}</div>
            <strong>${esc(p.displayName)}</strong>
            <span class="muted small">LVL ${p.level.number} ${esc(p.level.title)}</span>
            <div class="pod-block"><span>${['🥈', '🥇', '🥉'][i]}</span>${fmt(p.points)}</div>
          </div>` : '<div class="pod empty-pod"></div>').join('')}
      </div>
    </section>

    ${heat}

    <section class="card">
      <h2>Head to head <span class="muted small">${periodLabel}</span></h2>
      ${statRow('minutes', 'Minutes moved', '⏱️')}
      ${statRow('workouts', 'Workouts', '🏋️')}
      ${statRow('caloriesBurned', 'Calories burned', '🔥')}
      ${statRow('goalDays', 'Calorie target days', '🎯')}
      ${statRow('streak', 'Current streak', '⚡', 'd')}
    </section>

    <section class="card">
      <h2>Trophy cabinet</h2>
      <div class="players">
        ${board.map((p) => `
          <div class="player ${p.id === meId ? 'me' : ''}" style="--c:${p.color}">
            <div class="row gap">
              <div class="avatar" style="--c:${p.color}">${esc(p.avatar)}</div>
              <div class="grow">
                <strong>${esc(p.displayName)}</strong>
                <div class="muted small">LVL ${p.level.number} · ${fmt(p.totalXp)} XP${p.favorite ? ` · loves ${typeIcon(p.favorite)} ${esc(p.favorite)}` : ''}</div>
                <div class="xpbar slim"><div style="width:${Math.round(p.level.progress * 100)}%"></div></div>
              </div>
            </div>
            <div class="badges">${p.badges.map((b) => `<span class="badge ${b.earned ? 'earned' : ''}" title="${esc(b.name)}: ${esc(b.desc)}">${b.icon}</span>`).join('')}</div>
          </div>`).join('')}
      </div>
    </section>

    <section class="card rules">
      <h2>How scoring works</h2>
      <ul>
        <li>⭐ Workouts: <strong>1 pt/min</strong> light, <strong>1.5</strong> moderate, <strong>2</strong> hard</li>
        <li>🎯 Finish a day at 70–105% of your calorie goal: <strong>+25</strong></li>
        <li>🍽️ Log any food that day: <strong>+5</strong></li>
        <li>📈 All-time points are your XP and set your level</li>
      </ul>
    </section>`;

  $$('[data-period]').forEach((b) => b.addEventListener('click', () => { arenaPeriod = b.dataset.period; viewArena(); }));
  // Animate runners from the start line on each visit.
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.race, .cmp').forEach((el) => el.classList.add('go'))));
}

// ---------- profile ----------

async function viewProfile() {
  const today = localDate();
  const { board, meId } = await api(`/api/leaderboard?today=${today}`);
  const me = board.find((p) => p.id === meId);
  const u = state.user;
  app.innerHTML = `
    <h1 class="page-title">Profile</h1>
    <section class="card">
      <form id="p-form" class="stack">
        <div class="row gap">
          <div class="avatar big" id="ava-preview" style="--c:${u.color}">${esc(u.avatar)}</div>
          <label class="grow">Display name<input name="displayName" value="${esc(u.displayName)}" maxlength="40"></label>
        </div>
        <div><span class="label">Avatar</span><div class="picker">${AVATARS.map((a) => `<button type="button" class="pick ${a === u.avatar ? 'on' : ''}" data-ava="${a}">${a}</button>`).join('')}</div></div>
        <div><span class="label">Color</span><div class="picker">${COLORS.map((c) => `<button type="button" class="swatch ${c === u.color ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="row gap wrap">
          <label class="grow">Daily calorie goal<input name="calorieGoal" type="number" min="800" max="6000" value="${u.calorieGoal}"></label>
          <label class="grow">Weight (kg) <span class="muted small">for burn estimates</span><input name="weightKg" type="number" min="25" max="300" step="0.1" value="${u.weightKg}"></label>
        </div>
        <button class="btn primary" type="submit">Save profile</button>
      </form>
    </section>

    <section class="card">
      <h2>Badges</h2>
      <div class="badge-list">
        ${me.badges.map((b) => `<div class="badge-row ${b.earned ? 'earned' : ''}"><span class="badge ${b.earned ? 'earned' : ''}">${b.icon}</span><div><strong>${esc(b.name)}</strong><div class="muted small">${esc(b.desc)}</div></div></div>`).join('')}
      </div>
      <p class="muted small">Best streak: ${me.bestStreak} days · ${fmt(me.minutes)} lifetime minutes · ${fmt(me.workouts)} workouts</p>
    </section>

    <section class="card">
      <h2>Change password</h2>
      <form id="pw-form" class="stack">
        <div class="row gap wrap">
          <label class="grow">Current<input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <label class="grow">New<input name="newPassword" type="password" required minlength="4" autocomplete="new-password"></label>
        </div>
        <button class="btn" type="submit">Update password</button>
      </form>
    </section>

    <button class="btn danger" id="logout">Sign out</button>
    <p class="muted small center">Signed in as @${esc(u.username)}</p>`;

  const pick = { avatar: u.avatar, color: u.color };
  $$('[data-ava]').forEach((b) => b.addEventListener('click', () => {
    pick.avatar = b.dataset.ava;
    $$('[data-ava]').forEach((x) => x.classList.toggle('on', x === b));
    $('#ava-preview').textContent = pick.avatar;
  }));
  $$('[data-color]').forEach((b) => b.addEventListener('click', () => {
    pick.color = b.dataset.color;
    $$('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    $('#ava-preview').style.setProperty('--c', pick.color);
  }));
  $('#p-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/profile', { method: 'PUT', body: { ...Object.fromEntries(new FormData(e.target)), ...pick } });
      state.user = user;
      $('#nav-avatar').textContent = user.avatar;
      toast('Profile saved');
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      toast('Password updated');
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.user = null;
    location.hash = '#/login';
  });
}

// ---------- boot ----------

(async function boot() {
  state.config = await api('/api/config');
  try {
    state.user = (await api('/api/me')).user;
  } catch { state.user = null; }
  render();
})();
