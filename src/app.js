import * as store from './store.js';
import { state } from './state.js';
import {
  $, $$, esc, fmt, icon, label, avatar, localDate, shiftDate, weekStart, monthStart, dayLetter, toast,
  openSheet, closeSheet, haptic,
} from './ui.js';
import { NUDGES } from './notify-catalog.js';
import { viewToday } from './pages/today.js';
import { viewTrain } from './pages/train.js';
import { viewFuel } from './pages/fuel.js';
import { viewBody } from './pages/body.js';
import { viewMe } from './pages/me.js';
import { viewSetup } from './pages/setup.js';
import { refreshPush } from './notify.js';
import { viewAlerts } from './pages/alerts.js';
import { viewRoutines, viewRoutineEdit } from './pages/routines-page.js';
import { viewPlayer, viewTimers } from './pages/player.js';
import { viewTrack } from './pages/track.js';

const app = $('#app');

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

// ---------- router & nav ----------

const routes = {
  login: viewLogin,
  install: viewInstall,
  setup: () => viewSetup(app),
  home: () => viewToday(app, () => stale('home')),
  train: () => viewTrain(app, () => stale('train')),
  fuel: () => viewFuel(app, () => stale('fuel')),
  body: () => viewBody(app, () => stale('body')),
  arena: viewArena,
  me: () => viewMe(app, () => stale('me'), install),
  notifications: () => viewAlerts(app, () => stale('notifications')),
  routines: () => viewRoutines(app, () => stale('routines')),
  routine: () => viewRoutineEdit(app, () => stale('routine')),
  play: () => viewPlayer(app),
  timers: () => viewTimers(app),
  track: () => viewTrack(app),
  admin: viewAdmin,
};
const PUBLIC_ROUTES = ['login', 'install'];
const currentRoute = () => location.hash.replace(/^#\//, '').split('?')[0] || 'home';
// True when the user has moved on while a page was loading, so the late result must not be drawn.
const stale = (route) => currentRoute() !== route;

function buildNav() {
  const items = [['home', 'home', 'Today'], ['train', 'train', 'Train'], ['fuel', 'fuel', 'Fuel'], ['arena', 'arena', 'Arena'], ['me', 'user', 'Me']];
  if (!install.standalone) items.push(['install', 'download', 'Install']);
  $('#nav').innerHTML = items.map(([route, ico, text]) => `<a href="#/${route}" data-route="${route}">${icon(ico, 22)}<span>${text}</span></a>`).join('');
  $('#nav').style.setProperty('--n', items.length);
  highlightNav();
}
const NAV_PARENT = { admin: 'me', body: 'me', setup: 'me', notifications: 'me', routines: 'train', routine: 'train', play: 'train', timers: 'train', track: 'train' };
function highlightNav() {
  const name = currentRoute();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (NAV_PARENT[name] || name)));
}

// soft: redraw the current page in place (after a save) without the spinner or jumping to the top.
async function render({ soft = false } = {}) {
  if (!store.isReady) { app.innerHTML = '<div class="card">Firebase is not configured.</div>'; return; }
  let name = currentRoute();
  if (!routes[name]) name = 'home';
  if (!state.user && !PUBLIC_ROUTES.includes(name)) { location.hash = '#/login'; return; }
  if (state.user && name === 'login') { location.hash = '#/home'; return; }
  if (name === 'admin' && !state.user?.isAdmin) { location.hash = '#/me'; return; }
  document.body.classList.toggle('signed-in', Boolean(state.user));
  // Setup and the live workout screen take over the whole screen.
  const fullScreen = name === 'setup' || name === 'play' || name === 'track';
  $('#topbar').hidden = !state.user || fullScreen;
  document.body.classList.toggle('no-nav', fullScreen);
  highlightNav();
  const y = window.scrollY;
  if (!soft) app.innerHTML = '<div class="loading"><span></span></div>';
  try {
    await routes[name]();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, soft ? y : 0);
}
window.addEventListener('hashchange', () => render());
state.rerender = () => render({ soft: true });

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
          ${mode === 'reset' ? `
          <button type="button" class="back" data-mode="login">${icon('left', 18)} Back to sign in</button>
          <h2 class="card-title">Reset your password</h2>
          <p class="muted small">Ask the group admin for a reset code, then choose a new password.</p>` : `
          <div class="seg">
            <button type="button" data-mode="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button>
            <button type="button" data-mode="register" class="${mode === 'register' ? 'on' : ''}">Create account</button>
          </div>`}
          <form id="auth-form" class="stack">
            <label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
            ${mode === 'register' ? '<label>Display name<input name="displayName" maxlength="40" placeholder="What friends see" autocomplete="nickname"></label>' : ''}
            ${mode === 'reset' ? '<label>Reset code<input name="code" required placeholder="XXXX-XXXX" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="one-time-code"></label>' : ''}
            <label>${mode === 'reset' ? 'New password' : 'Password'}<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="6"></label>
            ${mode === 'register' ? '<label>Invite code<input name="inviteCode" placeholder="Ask the group admin" autocapitalize="none" autocorrect="off"></label>' : ''}
            <p class="form-error" id="auth-error" role="alert"></p>
            <button class="btn primary big" type="submit">${{ login: 'Sign in', register: 'Create account', reset: 'Set new password' }[mode]}</button>
            ${mode === 'login' ? '<button type="button" class="text-btn" data-mode="reset">Forgot password?</button>' : ''}
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
        state.user = await { login: store.signIn, register: store.signUp, reset: store.completeReset }[mode](body);
        if (mode === 'reset') toast('Password changed. You are signed in.');
        location.hash = mode === 'register' ? '#/setup' : '#/home';
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

// ---------- arena ----------

let arenaPeriod = 'week';

async function viewArena() {
  const today = localDate();
  const from = arenaPeriod === 'week' ? weekStart(today) : arenaPeriod === 'month' ? monthStart(today) : null;
  const { board, meId } = await store.leaderboard({ from, today });
  if (stale('arena')) return;
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
            ${p.id !== meId ? `<button type="button" class="btn small-btn nudge-btn" data-nudge="${esc(p.id)}" data-name="${esc(p.displayName)}">${icon('zap', 16)} Nudge ${esc(p.displayName.split(' ')[0])}</button>` : ''}
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
  $$('[data-nudge]').forEach((b) => b.addEventListener('click', () => openNudgeSheet(b.dataset.nudge, b.dataset.name)));
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.race, .cmp').forEach((el) => el.classList.add('go'))));
}

// Send a friend a quick nudge or cheer; it arrives as a phone notification.
function openNudgeSheet(toId, name) {
  const first = name.split(' ')[0];
  openSheet({
    title: `Nudge ${first}`,
    html: `
      <p class="muted" style="margin-bottom:14px">${esc(first)} gets this as a notification if they have them on. One nudge per friend per day.</p>
      <div class="options">
        ${Object.entries(NUDGES).map(([k, n]) => `<button type="button" class="option" data-msg="${k}"><strong>${esc(n.label)}</strong><span class="muted">${esc(n.body)}</span>${icon('right', 20)}</button>`).join('')}
      </div>`,
    onMount(sheet) {
      $$('[data-msg]', sheet).forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await store.sendNudge(toId, b.dataset.msg, localDate());
          closeSheet();
          haptic(20);
          toast(`Sent to ${first}`);
        } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
      }));
    },
  });
}

// ---------- admin ----------

async function viewAdmin() {
  const [members, invite] = await Promise.all([store.listMembers(), store.getInviteCode()]);
  if (stale('admin')) return;
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
                <button class="icon-btn" data-reset="${esc(m.id)}" aria-label="Reset password for ${esc(m.displayName)}" title="Reset password">${icon('key', 18)}</button>
                <button class="icon-btn danger" data-remove="${esc(m.id)}" data-name="${esc(m.displayName)}" aria-label="Remove ${esc(m.displayName)}">${icon('trash', 18)}</button>
              </div>`}
          </li>`).join('')}
      </ul>
      <div id="reset-panel"></div>
      <p class="muted small">The key button makes a one-time reset code for someone who forgot their password. Removing someone locks their account and deletes their workouts and food log.</p>
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
  $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const m = members.find((x) => x.id === b.dataset.reset);
    if (!confirm(`Make a password reset code for ${m.displayName}?`)) return;
    try {
      const code = await store.issueReset(m);
      $('#reset-panel').innerHTML = `
        <div class="reset-code">
          ${label(`Reset code for ${esc(m.displayName)}`)}
          <div class="row between gap">
            <strong class="num code">${code}</strong>
            <button class="btn small-btn" id="copy-code">${icon('copy', 16)} Copy</button>
          </div>
          <p class="muted small">Send this to ${esc(m.displayName.split(' ')[0])}. On the sign-in screen they tap <b>Forgot password?</b>, enter <b>${esc(m.username)}</b>, this code and a new password. It works once and expires in ${store.RESET_HOURS} hours. Making a new code replaces this one.</p>
        </div>`;
      $('#reset-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#copy-code').addEventListener('click', async () => {
        await navigator.clipboard.writeText(code).catch(() => {});
        toast('Code copied');
      });
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
    if (user) refreshPush(user);
  });
} else {
  render();
}
