import * as store from './store.js';
import { WORKOUT_TYPES, INTENSITY } from './scoring.js';
import { icon } from './icons.js';

// ---------- utilities ----------

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
  return shiftDate(dateStr, -((d.getDay() + 6) % 7)); // Monday
}
const monthStart = (dateStr = localDate()) => `${dateStr.slice(0, 8)}01`;
function prettyDate(dateStr) {
  const today = localDate();
  if (dateStr === today) return 'Today';
  if (dateStr === shiftDate(today, -1)) return 'Yesterday';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// Big "+90" that floats up when points are earned.
function pointsPop(points) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = `+${points}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatar = (p, cls = '') => `<span class="ava ${cls}" style="--c:${esc(p.color)}">${esc(initials(p.displayName))}</span>`;
const label = (text) => `<span class="eyebrow">${text}</span>`;

// ---------- install / standalone detection ----------

const install = {
  prompt: null,
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: /android/i.test(navigator.userAgent),
};
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.prompt = e;
  if (currentRoute() === 'install') render();
});
window.addEventListener('appinstalled', () => {
  install.prompt = null;
  toast('Installed. Open FitFriends from your home screen.');
  buildNav();
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---------- state & data ----------

const state = { user: null, authBusy: false };

const COMMON_FOODS = [
  ['Eggs (2 large)', 140, 12], ['Oatmeal (1 cup)', 160, 6], ['Banana', 105, 1], ['Apple', 95, 0],
  ['Greek yogurt', 130, 17], ['Toast with butter', 170, 4], ['Latte (16 oz)', 190, 12], ['Protein shake', 160, 30],
  ['Turkey sandwich', 350, 24], ['Chicken salad', 400, 35], ['Chicken breast (6 oz)', 280, 52], ['Rice (1 cup)', 205, 4],
  ['Pasta (2 cups)', 440, 16], ['Pizza slice', 285, 12], ['Burger', 550, 30], ['Burrito', 700, 30],
  ['Sushi roll', 350, 12], ['Steak (8 oz)', 540, 60], ['Peanut butter (2 tbsp)', 190, 7], ['Cheese (1 oz)', 110, 7],
  ['Chocolate bar', 230, 3], ['Cookie', 150, 2], ['Beer', 150, 2], ['Glass of wine', 125, 0],
  ['Avocado (half)', 120, 1], ['Fries (medium)', 365, 4], ['Chips (1 oz)', 155, 2],
];
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
const typeMet = (name) => WORKOUT_TYPES.find((t) => t.name === name)?.met || 5;

// ---------- router & nav ----------

const routes = {
  login: viewLogin, install: viewInstall, home: viewHome, train: viewTrain, fuel: viewFuel,
  arena: viewArena, me: viewMe, admin: viewAdmin,
};
const PUBLIC_ROUTES = ['login', 'install'];
const currentRoute = () => location.hash.replace(/^#\//, '').split('?')[0] || 'home';

function buildNav() {
  const items = [['home', 'home', 'Today'], ['train', 'train', 'Train'], ['fuel', 'fuel', 'Fuel'], ['arena', 'arena', 'Arena'], ['me', 'user', 'Me']];
  if (!install.standalone) items.push(['install', 'download', 'Install']);
  $('#nav').innerHTML = items.map(([route, ico, text]) => `<a href="#/${route}" data-route="${route}">${icon(ico, 22)}<span>${text}</span></a>`).join('');
  $('#nav').style.setProperty('--n', items.length);
  highlightNav();
}
function highlightNav() {
  const name = currentRoute();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name || (name === 'admin' && a.dataset.route === 'me')));
}

async function render() {
  if (!store.isReady) { app.innerHTML = '<div class="card">Firebase is not configured.</div>'; return; }
  let name = currentRoute();
  if (!routes[name]) name = 'home';
  if (!state.user && !PUBLIC_ROUTES.includes(name)) { location.hash = '#/login'; return; }
  if (state.user && name === 'login') { location.hash = '#/home'; return; }
  if (name === 'admin' && !state.user?.isAdmin) { location.hash = '#/me'; return; }
  document.body.classList.toggle('signed-in', Boolean(state.user));
  $('#topbar').hidden = !state.user;
  highlightNav();
  app.innerHTML = '<div class="loading"><span></span></div>';
  try {
    await routes[name]();
  } catch (e) {
    console.error(e);
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
          <svg class="auth-mark" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="var(--accent)"/><path d="M92 284h84l34-92 50 160 40-112 26 44h94" fill="none" stroke="var(--bg)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <h1 class="wordmark">FitFriends</h1>
          <p>Train. Eat right. Beat your friends.</p>
        </div>
        <div class="card">
          <div class="seg">
            <button type="button" data-mode="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button>
            <button type="button" data-mode="register" class="${mode === 'register' ? 'on' : ''}">Create account</button>
          </div>
          <form id="auth-form" class="stack">
            <label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
            ${mode === 'register' ? '<label>Display name<input name="displayName" maxlength="40" placeholder="What friends see" autocomplete="nickname"></label>' : ''}
            <label>Password<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="6"></label>
            ${mode === 'register' ? '<label>Invite code<input name="inviteCode" placeholder="Ask the group admin" autocapitalize="none" autocorrect="off"></label>' : ''}
            <p class="form-error" id="auth-error" role="alert"></p>
            <button class="btn primary big" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
        </div>
        ${install.standalone ? '' : `<a class="install-link" href="#/install">${icon('download', 18)}<span>Install the app on your phone</span>${icon('right', 18)}</a>`}
      </section>`;
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; draw(); }));
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      state.authBusy = true;
      try {
        state.user = await (mode === 'login' ? store.signIn(body) : store.signUp(body));
        location.hash = '#/home';
      } catch (err) {
        $('#auth-error').textContent = err.message;
      } finally {
        btn.disabled = false;
        state.authBusy = false;
      }
    });
  };
  draw();
}

// ---------- install ----------

async function viewInstall() {
  const back = state.user ? '' : `<a class="back" href="#/login">${icon('left', 18)} Back to sign in</a>`;
  const appTile = `
    <div class="install-app">
      <img src="icons/icon-192.png" alt="" width="64" height="64">
      <div><strong>FitFriends</strong><span class="muted">Full screen, its own icon, opens like a normal app.</span></div>
    </div>`;
  let body;
  if (install.standalone) {
    body = `<div class="card done">${icon('check', 28)}<div><strong>You're in the app.</strong><p class="muted">FitFriends is installed on this device.</p></div></div>`;
  } else if (install.prompt) {
    body = `<div class="card">${appTile}<button class="btn primary big" id="do-install">${icon('download', 20)} Install FitFriends</button></div>`;
  } else if (install.ios) {
    body = `
      <div class="card">
        ${appTile}
        <ol class="steps">
          <li><span class="step-n">1</span><div>Open this page in <strong>Safari</strong> and tap <span class="key">${icon('share', 18)} Share</span> in the toolbar.</div></li>
          <li><span class="step-n">2</span><div>Scroll down and tap <span class="key">${icon('squarePlus', 18)} Add to Home Screen</span>.</div></li>
          <li><span class="step-n">3</span><div>Tap <strong>Add</strong>. FitFriends now sits on your home screen.</div></li>
        </ol>
      </div>`;
  } else if (install.android) {
    body = `
      <div class="card">
        ${appTile}
        <ol class="steps">
          <li><span class="step-n">1</span><div>Open this page in <strong>Chrome</strong> and tap the <strong>three-dot menu</strong> at the top right.</div></li>
          <li><span class="step-n">2</span><div>Tap <span class="key">${icon('phone', 18)} Install app</span> or <strong>Add to Home screen</strong>.</div></li>
          <li><span class="step-n">3</span><div>Confirm with <strong>Install</strong>.</div></li>
        </ol>
      </div>`;
  } else {
    body = `
      <div class="card">
        ${appTile}
        <p>Open <strong>${esc(location.origin + location.pathname)}</strong> on your phone, then come back to this tab for the steps.</p>
        <p class="muted">On a computer with Chrome or Edge, use the install icon at the right of the address bar.</p>
      </div>`;
  }
  app.innerHTML = `
    ${back}
    ${label('Install')}
    <h1 class="page-title">Put FitFriends on your home screen</h1>
    ${body}`;
  $('#do-install')?.addEventListener('click', async () => {
    install.prompt.prompt();
    const { outcome } = await install.prompt.userChoice;
    install.prompt = null;
    if (outcome === 'accepted') toast('Installing…');
    render();
  });
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
      <div class="ring-label"><strong class="num">${fmt(Math.abs(budget - eaten))}</strong><span>${over ? 'kcal over' : 'kcal left'}</span></div>
    </div>`;
}

async function viewHome() {
  const today = localDate();
  const [{ board, meId }, day, todaysWorkouts] = await Promise.all([
    store.leaderboard({ from: weekStart(today), today }),
    store.getDay(today),
    store.workoutsOn(today),
  ]);
  const me = board.find((p) => p.id === meId);
  const rank = board.indexOf(me) + 1;
  const lvl = me.level;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  app.innerHTML = `
    <section class="hello">
      <div>
        ${label(esc(dateLine))}
        <h1>${greet}, ${esc(me.displayName.split(' ')[0])}</h1>
      </div>
      ${avatar(me, 'lg')}
    </section>

    <section class="card level">
      <div class="row between">
        <div class="level-name"><span class="lvl">LV ${lvl.number}</span>${esc(lvl.title)}</div>
        <span class="num muted">${fmt(me.totalXp)} XP</span>
      </div>
      <div class="bar"><div style="width:${Math.round(lvl.progress * 100)}%"></div></div>
      <p class="muted small">${fmt(lvl.toNext)} XP to level ${lvl.number + 1}</p>
    </section>

    <section class="stats">
      <a class="stat" href="#/arena">${icon('arena', 18)}<strong class="num">${rank}<small>/${board.length}</small></strong><span>Weekly rank</span></a>
      <div class="stat">${icon('flame', 18)}<strong class="num">${me.streak}</strong><span>Day streak</span></div>
      <div class="stat">${icon('zap', 18)}<strong class="num">${fmt(me.points)}</strong><span>Points this week</span></div>
      <div class="stat">${icon('timer', 18)}<strong class="num">${fmt(me.minutes)}</strong><span>Minutes this week</span></div>
    </section>

    <section class="grid2">
      <div class="card">
        <div class="row between head">${label('Calories today')}<a href="#/fuel" class="link">Log food ${icon('right', 16)}</a></div>
        <div class="ring-row">
          ${calorieRing(day.foodCalories, me.calorieGoal, day.wCalories)}
          <dl class="kv">
            <div><dt>Goal</dt><dd class="num">${fmt(me.calorieGoal)}</dd></div>
            <div><dt>Eaten</dt><dd class="num">${fmt(day.foodCalories)}</dd></div>
            <div><dt>Burned</dt><dd class="num">+${fmt(day.wCalories)}</dd></div>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="row between head">${label('Training today')}<a href="#/train" class="link">Add ${icon('plus', 16)}</a></div>
        ${todaysWorkouts.length ? `<ul class="list">${todaysWorkouts.map((w) => workoutItem(w)).join('')}</ul>`
          : `<div class="empty"><p>Nothing logged yet today.</p><a class="btn primary" href="#/train">${icon('plus', 18)} Log a workout</a></div>`}
      </div>
    </section>`;
}

function workoutItem(w, withDelete = false) {
  return `
    <li class="item">
      <span class="item-ico">${icon(w.type, 20)}</span>
      <div class="item-main">
        <strong>${esc(w.type)}</strong>
        <span class="muted small">${w.durationMin} min · ${esc(INTENSITY[w.intensity]?.label || w.intensity)}${w.distanceKm ? ` · ${w.distanceKm} km` : ''} · ${fmt(w.calories)} kcal</span>
        ${w.notes ? `<span class="note">${esc(w.notes)}</span>` : ''}
      </div>
      <span class="pts num">+${w.points}</span>
      ${withDelete ? `<button class="icon-btn" data-del="${esc(w.id)}" aria-label="Delete workout">${icon('x', 18)}</button>` : ''}
    </li>`;
}

// ---------- train ----------

async function viewTrain() {
  const workouts = await store.listWorkouts();
  const form = { type: WORKOUT_TYPES[0].name, intensity: 'moderate' };
  const grouped = {};
  for (const w of workouts) (grouped[w.date] ||= []).push(w);

  app.innerHTML = `
    ${label('Train')}
    <h1 class="page-title">Log a workout</h1>
    <section class="card">
      <form id="w-form" class="stack">
        <div class="type-grid" role="radiogroup" aria-label="Workout type">
          ${WORKOUT_TYPES.map((t) => `<button type="button" role="radio" aria-checked="${t.name === form.type}" class="type-btn ${t.name === form.type ? 'on' : ''}" data-type="${esc(t.name)}">${icon(t.name, 22)}<span>${esc(t.name)}</span></button>`).join('')}
        </div>
        <div class="seg" role="radiogroup" aria-label="Intensity">
          ${Object.entries(INTENSITY).map(([k, v]) => `<button type="button" data-int="${k}" class="${k === form.intensity ? 'on' : ''}">${v.label}</button>`).join('')}
        </div>
        <div class="fields">
          <label>Minutes<input name="durationMin" type="number" min="1" max="600" value="30" required inputmode="numeric"></label>
          <label>Distance (km)<input name="distanceKm" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Optional"></label>
          <label class="span2">Date<input name="date" type="date" value="${localDate()}" max="${localDate()}" required></label>
        </div>
        <label>Notes<input name="notes" maxlength="500" placeholder="5x5 squats, easy 5k, etc."></label>
        <div class="preview" id="w-preview"></div>
        <button class="btn primary big" type="submit">Save workout</button>
      </form>
    </section>
    <section class="card">
      ${label('History')}
      ${workouts.length ? Object.entries(grouped).map(([date, ws]) => `
        <h3 class="day-head">${prettyDate(date)} <span class="num muted">${ws.reduce((s, w) => s + w.points, 0)} pts</span></h3>
        <ul class="list">${ws.map((w) => workoutItem(w, true)).join('')}</ul>`).join('')
        : '<p class="empty">Your workouts will show up here.</p>'}
    </section>`;

  const f = $('#w-form');
  const preview = () => {
    const mins = Math.min(Number(f.durationMin.value) || 0, 600);
    const cal = Math.round(typeMet(form.type) * INTENSITY[form.intensity].met * state.user.weightKg * (mins / 60));
    const pts = Math.round(Math.min(mins, 300) * INTENSITY[form.intensity].points);
    $('#w-preview').innerHTML = `<span>${icon('flame', 16)} <b class="num">~${fmt(cal)}</b> kcal</span><span>${icon('zap', 16)} <b class="num">+${fmt(pts)}</b> pts</span>`;
  };
  $$('.type-btn').forEach((b) => b.addEventListener('click', () => {
    form.type = b.dataset.type;
    $$('.type-btn').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
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
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const workout = await store.addWorkout(state.user, { ...Object.fromEntries(new FormData(f)), type: form.type, intensity: form.intensity });
      pointsPop(workout.points);
      toast(`${workout.type} saved`);
      viewTrain();
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this workout?')) return;
    await store.deleteWorkout(workouts.find((w) => w.id === b.dataset.del));
    viewTrain();
  }));
}

// ---------- fuel ----------

let foodDate = null;

async function viewFuel() {
  foodDate ||= localDate();
  const [foods, day, recent] = await Promise.all([store.foodsOn(foodDate), store.getDay(foodDate), store.recentFoods()]);
  const goal = state.user.calorieGoal;
  const eaten = foods.reduce((s, f) => s + f.calories, 0);
  const protein = foods.reduce((s, f) => s + (f.proteinG || 0), 0);
  const budget = goal + day.wCalories;
  const over = eaten > budget;
  const hour = new Date().getHours();
  const defaultMeal = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack';
  const chip = (name, cal, protein) => `<button type="button" class="chip" data-quick="${esc(JSON.stringify([name, cal, protein ?? '']))}">${esc(name)}<em class="num">${cal}</em></button>`;

  app.innerHTML = `
    ${label('Fuel')}
    <h1 class="page-title">Calories</h1>
    <section class="card">
      <div class="date-nav">
        <button class="icon-btn" id="prev-day" aria-label="Previous day">${icon('left', 20)}</button>
        <strong>${prettyDate(foodDate)}</strong>
        <button class="icon-btn" id="next-day" aria-label="Next day" ${foodDate >= localDate() ? 'disabled' : ''}>${icon('right', 20)}</button>
      </div>
      <div class="meter"><div class="${over ? 'over' : ''}" style="width:${Math.min((eaten / budget) * 100, 100)}%"></div></div>
      <div class="cal-stats">
        <div><strong class="num">${fmt(eaten)}</strong><span>Eaten</span></div>
        <div><strong class="num">${fmt(goal)}</strong><span>Goal</span></div>
        <div><strong class="num">+${fmt(day.wCalories)}</strong><span>Burned</span></div>
        <div class="${over ? 'bad' : 'good'}"><strong class="num">${fmt(Math.abs(budget - eaten))}</strong><span>${over ? 'Over' : 'Left'}</span></div>
        <div><strong class="num">${fmt(protein)}g</strong><span>Protein</span></div>
      </div>
      <p class="muted small">Finish the day at 70–105% of your goal for <b>+25 pts</b>. Logging anything earns +5.</p>
    </section>

    <section class="card">
      ${label('Add food')}
      <form id="f-form" class="stack">
        <label>Food<input name="name" required maxlength="80" placeholder="Chicken burrito" list="food-suggest" autocomplete="off"></label>
        <div class="fields three">
          <label>Calories<input name="calories" type="number" min="0" max="5000" required inputmode="numeric"></label>
          <label>Protein (g)<input name="proteinG" type="number" min="0" max="500" step="0.1" inputmode="decimal"></label>
          <label>Meal<select name="meal">${MEALS.map(([k, l]) => `<option value="${k}" ${k === defaultMeal ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <datalist id="food-suggest">${COMMON_FOODS.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
        <button class="btn primary big" type="submit">Add food</button>
      </form>
      ${recent.length ? `<h3 class="sub">Recent</h3><div class="chips">${recent.map((r) => chip(r.name, r.calories, r.proteinG)).join('')}</div>` : ''}
      <h3 class="sub">Quick add</h3>
      <div class="chips">${COMMON_FOODS.map(([n, c, p]) => chip(n, c, p)).join('')}</div>
    </section>

    <section class="card">
      ${label(`Logged · ${prettyDate(foodDate)}`)}
      ${MEALS.map(([k, name]) => {
        const items = foods.filter((f) => f.meal === k);
        if (!items.length) return '';
        return `<h3 class="day-head">${name} <span class="num muted">${fmt(items.reduce((s, f) => s + f.calories, 0))} kcal</span></h3>
          <ul class="list">${items.map((f) => `
            <li class="item">
              <div class="item-main"><strong>${esc(f.name)}</strong>${f.proteinG ? `<span class="muted small">${f.proteinG}g protein</span>` : ''}</div>
              <span class="num cal">${fmt(f.calories)}</span>
              <button class="icon-btn" data-del="${esc(f.id)}" aria-label="Delete food">${icon('x', 18)}</button>
            </li>`).join('')}</ul>`;
      }).join('') || '<p class="empty">Nothing logged for this day yet.</p>'}
    </section>`;

  const f = $('#f-form');
  const add = async (body) => {
    try {
      await store.addFood(state.user, { ...body, date: foodDate });
      toast(`Added ${body.name}`);
      viewFuel();
    } catch (err) { toast(err.message, 'bad'); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); add(Object.fromEntries(new FormData(f))); });
  f.name.addEventListener('change', () => {
    const match = COMMON_FOODS.find(([n]) => n === f.name.value);
    if (match) { f.calories.value = match[1]; f.proteinG.value = match[2]; }
  });
  $$('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    const [name, calories, proteinG] = JSON.parse(b.dataset.quick);
    b.disabled = true;
    add({ name, calories, proteinG, meal: f.meal.value });
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await store.deleteFood(state.user, foods.find((x) => x.id === b.dataset.del));
    viewFuel();
  }));
  $('#prev-day').addEventListener('click', () => { foodDate = shiftDate(foodDate, -1); viewFuel(); });
  $('#next-day').addEventListener('click', () => { foodDate = shiftDate(foodDate, 1); viewFuel(); });
}

// ---------- arena ----------

let arenaPeriod = 'week';

async function viewArena() {
  const today = localDate();
  const from = arenaPeriod === 'week' ? weekStart(today) : arenaPeriod === 'month' ? monthStart(today) : null;
  const { board, meId } = await store.leaderboard({ from, today });
  const leader = Math.max(...board.map((p) => p.points), 1);
  const periodLabel = { week: 'This week', month: 'This month', all: 'All time' }[arenaPeriod];
  const podium = [[board[1], 2], [board[0], 1], [board[2], 3]];

  const statRow = (key, title, ico, unit = '') => {
    const max = Math.max(...board.map((p) => p[key]), 1);
    return `
      <div class="cmp">
        <h3>${icon(ico, 16)} ${title}</h3>
        ${board.map((p) => `
          <div class="cmp-row ${p.id === meId ? 'me' : ''}">
            <span class="cmp-name">${avatar(p, 'xs')}${esc(p.displayName.split(' ')[0])}</span>
            <div class="cmp-track"><div class="cmp-fill" style="--w:${(p[key] / max) * 100}%; --c:${esc(p.color)}"></div></div>
            <span class="num cmp-val">${fmt(p[key])}${unit}</span>
          </div>`).join('')}
      </div>`;
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(today), i));
  const heat = arenaPeriod === 'week' ? `
    <section class="card">
      ${label('Daily grind')}
      <div class="heat" style="--cols:7">
        <span></span>${weekDays.map((d) => `<span class="heat-day">${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('')}
        ${board.map((p) => `
          <span class="heat-name">${avatar(p, 'xs')}</span>
          ${weekDays.map((d) => {
            const v = p.daily[d] || 0;
            const a = v ? Math.min(0.3 + v / 120, 1) : 0;
            return `<span class="heat-cell ${d > today ? 'future' : ''} ${v ? 'on' : ''}" style="--c:${esc(p.color)}; --a:${a}" title="${esc(p.displayName)} · ${d}: ${v} pts">${v || ''}</span>`;
          }).join('')}`).join('')}
      </div>
    </section>` : '';

  app.innerHTML = `
    ${label('Arena')}
    <h1 class="page-title">Leaderboard</h1>
    <div class="seg period">
      ${['week', 'month', 'all'].map((p) => `<button data-period="${p}" class="${p === arenaPeriod ? 'on' : ''}">${{ week: 'Week', month: 'Month', all: 'All time' }[p]}</button>`).join('')}
    </div>

    <section class="card race-card">
      <div class="row between head">${label('The race')}<span class="muted small">Points · ${periodLabel}</span></div>
      <div class="race">
        ${board.map((p, i) => `
          <div class="lane ${p.id === meId ? 'me' : ''}" style="--c:${esc(p.color)}; --pos:${(p.points / leader).toFixed(4)}">
            <span class="lane-rank num">${i + 1}</span>
            <div class="lane-track">
              <div class="trail"></div>
              <div class="runner">
                ${i === 0 && p.points > 0 ? `<span class="crown">${icon('crown', 14)}</span>` : ''}
                ${avatar(p, 'run')}
              </div>
            </div>
            <span class="lane-pts num">${fmt(p.points)}</span>
          </div>`).join('')}
      </div>
      <div class="race-names">${board.map((p, i) => `<span>${i + 1}. ${esc(p.displayName)}</span>`).join('')}</div>
    </section>

    <section class="card podium-card">
      <div class="podium">
        ${podium.map(([p, place]) => p ? `
          <div class="pod pod-${place}" style="--c:${esc(p.color)}">
            ${avatar(p, place === 1 ? 'lg' : 'md')}
            <strong>${esc(p.displayName)}</strong>
            <span class="muted small">LV ${p.level.number} ${esc(p.level.title)}</span>
            <div class="pod-block"><span class="place num">${place}</span><span class="num">${fmt(p.points)}</span></div>
          </div>` : '<div class="pod"></div>').join('')}
      </div>
    </section>

    ${heat}

    <section class="card">
      <div class="row between head">${label('Head to head')}<span class="muted small">${periodLabel}</span></div>
      ${statRow('minutes', 'Minutes moved', 'timer')}
      ${statRow('workouts', 'Workouts', 'train')}
      ${statRow('caloriesBurned', 'Calories burned', 'flame')}
      ${statRow('goalDays', 'Calorie target days', 'target')}
      ${statRow('streak', 'Current streak', 'trend', 'd')}
    </section>

    <section class="card">
      ${label('Trophy cabinet')}
      <div class="players">
        ${board.map((p) => `
          <div class="player ${p.id === meId ? 'me' : ''}" style="--c:${esc(p.color)}">
            <div class="row gap">
              ${avatar(p, 'md')}
              <div class="grow">
                <strong>${esc(p.displayName)}</strong>
                <div class="muted small">LV ${p.level.number} · ${fmt(p.totalXp)} XP${p.favorite ? ` · ${esc(p.favorite)}` : ''}</div>
                <div class="bar slim"><div style="width:${Math.round(p.level.progress * 100)}%"></div></div>
              </div>
            </div>
            <div class="badges">${p.badges.map((b) => `<span class="badge ${b.earned ? 'earned' : ''}" title="${esc(b.name)}: ${esc(b.desc)}">${icon(b.icon, 18)}</span>`).join('')}</div>
          </div>`).join('')}
      </div>
    </section>

    <section class="card rules">
      ${label('Scoring')}
      <ul>
        <li><span>Workout</span><b>1 pt/min light · 1.5 moderate · 2 hard</b></li>
        <li><span>Day at 70–105% of calorie goal</span><b>+25</b></li>
        <li><span>Any food logged that day</span><b>+5</b></li>
        <li><span>Level</span><b>All-time points = XP</b></li>
      </ul>
    </section>`;

  $$('[data-period]').forEach((b) => b.addEventListener('click', () => { arenaPeriod = b.dataset.period; viewArena(); }));
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.race, .cmp').forEach((el) => el.classList.add('go'))));
}

// ---------- me ----------

async function viewMe() {
  const { board, meId } = await store.leaderboard({ from: null, today: localDate() });
  const me = board.find((p) => p.id === meId);
  const u = state.user;
  app.innerHTML = `
    ${label('Profile')}
    <section class="me-head">
      ${avatar(u, 'xl')}
      <div>
        <h1>${esc(u.displayName)}</h1>
        <span class="muted">@${esc(u.username)}${u.isAdmin ? ' · <span class="tag">Admin</span>' : ''}</span>
      </div>
    </section>

    ${u.isAdmin ? `<a class="card link-card" href="#/admin">${icon('shield', 22)}<div><strong>Admin panel</strong><span class="muted small">Members, roles and the invite code</span></div>${icon('right', 20)}</a>` : ''}
    ${install.standalone ? '' : `<a class="card link-card" href="#/install">${icon('download', 22)}<div><strong>Install the app</strong><span class="muted small">Add FitFriends to your home screen</span></div>${icon('right', 20)}</a>`}

    <section class="card">
      ${label('Your details')}
      <form id="p-form" class="stack">
        <label>Display name<input name="displayName" value="${esc(u.displayName)}" maxlength="40"></label>
        <div><span class="field-label">Color</span><div class="swatches">${store.COLORS.map((c) => `<button type="button" class="swatch ${c === u.color ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>
        <div class="fields">
          <label>Daily calorie goal<input name="calorieGoal" type="number" min="800" max="6000" value="${u.calorieGoal}" inputmode="numeric"></label>
          <label>Weight (kg)<input name="weightKg" type="number" min="25" max="300" step="0.1" value="${u.weightKg}" inputmode="decimal"></label>
        </div>
        <button class="btn primary" type="submit">Save changes</button>
      </form>
    </section>

    <section class="card">
      ${label('Badges')}
      <div class="badge-list">
        ${me.badges.map((b) => `<div class="badge-row ${b.earned ? 'earned' : ''}"><span class="badge ${b.earned ? 'earned' : ''}">${icon(b.icon, 18)}</span><div><strong>${esc(b.name)}</strong><div class="muted small">${esc(b.desc)}</div></div></div>`).join('')}
      </div>
      <p class="muted small">Best streak ${me.bestStreak} days · ${fmt(me.minutes)} lifetime minutes · ${fmt(me.workouts)} workouts</p>
    </section>

    <section class="card">
      ${label('Change password')}
      <form id="pw-form" class="stack">
        <div class="fields">
          <label>Current<input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <label>New<input name="newPassword" type="password" required minlength="6" autocomplete="new-password"></label>
        </div>
        <button class="btn" type="submit">Update password</button>
      </form>
    </section>

    <button class="btn ghost-danger" id="logout">${icon('logout', 18)} Sign out</button>`;

  let color = u.color;
  $$('[data-color]').forEach((b) => b.addEventListener('click', () => {
    color = b.dataset.color;
    $$('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    $('.me-head .ava').style.setProperty('--c', color);
  }));
  $('#p-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.user = await store.updateProfile(state.user, { ...Object.fromEntries(new FormData(e.target)), color });
      toast('Saved');
      viewMe();
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { currentPassword, newPassword } = Object.fromEntries(new FormData(e.target));
      await store.changePassword(currentPassword, newPassword);
      e.target.reset();
      toast('Password updated');
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#logout').addEventListener('click', async () => {
    await store.signOut();
    state.user = null;
    location.hash = '#/login';
  });
}

// ---------- admin ----------

async function viewAdmin() {
  const [members, invite] = await Promise.all([store.listMembers(), store.getInviteCode()]);
  const appUrl = location.origin + location.pathname;
  app.innerHTML = `
    <a class="back" href="#/me">${icon('left', 18)} Profile</a>
    ${label('Admin')}
    <h1 class="page-title">Group settings</h1>

    <section class="card">
      ${label('Invite code')}
      <p class="muted small">${invite ? 'New members must enter this code to create an account.' : 'No code set. Anyone with the link can create an account.'}</p>
      <form id="invite-form" class="inline-form">
        <input name="code" value="${esc(invite)}" placeholder="e.g. morning-miles" maxlength="60" autocapitalize="none" autocorrect="off">
        <button class="btn primary" type="submit">Save</button>
      </form>
      ${invite ? '<button class="btn small-btn" id="clear-invite">Remove code</button>' : ''}
    </section>

    <section class="card">
      ${label('Share')}
      <div class="inline-form">
        <input value="${esc(appUrl)}" readonly id="share-url">
        <button class="btn" id="copy-link">${icon('copy', 18)} Copy</button>
      </div>
      <p class="muted small">Send friends this link${invite ? ' and the invite code' : ''}.</p>
    </section>

    <section class="card">
      <div class="row between head">${label(`Members · ${members.length}`)}</div>
      <ul class="members">
        ${members.map((m) => `
          <li>
            ${avatar(m, 'md')}
            <div class="grow">
              <strong>${esc(m.displayName)}</strong>${m.isAdmin ? ' <span class="tag">Admin</span>' : ''}
              <div class="muted small">@${esc(m.username)} · ${fmt(m.stats.xp)} XP · ${m.stats.workouts} workouts${m.joined ? ` · joined ${m.joined.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</div>
            </div>
            ${m.id === state.user.id ? '<span class="muted small">You</span>' : `
              <div class="member-actions">
                <button class="btn small-btn" data-role="${m.isAdmin ? 'member' : 'admin'}" data-id="${esc(m.id)}">${m.isAdmin ? 'Remove admin' : 'Make admin'}</button>
                <button class="icon-btn danger" data-remove="${esc(m.id)}" data-name="${esc(m.displayName)}" aria-label="Remove ${esc(m.displayName)}">${icon('trash', 18)}</button>
              </div>`}
          </li>`).join('')}
      </ul>
      <p class="muted small">Removing someone locks their account and deletes their workouts and food log. Members can't reset a forgotten password themselves. Remove the account and have them sign up again.</p>
    </section>`;

  $('#invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await store.setInviteCode(e.target.code.value);
      toast(e.target.code.value.trim() ? 'Invite code saved' : 'Invite code removed');
      viewAdmin();
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#clear-invite')?.addEventListener('click', async () => {
    await store.setInviteCode('');
    toast('Invite code removed');
    viewAdmin();
  });
  $('#copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
    } catch {
      $('#share-url').select();
      document.execCommand('copy');
    }
    toast('Link copied');
  });
  $$('[data-role]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await store.setRole(b.dataset.id, b.dataset.role);
      toast(b.dataset.role === 'admin' ? 'Now an admin' : 'Admin removed');
      viewAdmin();
    } catch (err) { toast(err.message, 'bad'); }
  }));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Remove ${b.dataset.name}? Their account is locked and all their data is deleted.`)) return;
    try {
      await store.removeMember(b.dataset.remove);
      toast(`${b.dataset.name} removed`);
      viewAdmin();
    } catch (err) { toast(err.message, 'bad'); }
  }));
}

// ---------- boot ----------

buildNav();
if (store.isReady) {
  // Fires once on load with the saved sign-in (or null), then on every sign-in/out.
  store.onUser((user) => {
    if (state.authBusy) return; // the sign-in form handles its own result
    state.user = user;
    render();
  });
} else {
  render();
}
