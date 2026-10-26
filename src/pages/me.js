import * as store from '../store.js';
import { state } from '../state.js';
import { ACTIVITY, paceLabel, calorieTarget, macroTargets, goalsFor, ageFrom } from '../nutrition.js';
import { $, $$, esc, fmt, icon, label, avatar, toast, haptic, localDate } from '../ui.js';
import { imperial, weightUnit, toDisplayWeight, fmtWeight, fmtHeight } from '../units.js';
import { pushStatus, enablePush, disablePush, testPush } from '../notify.js';

const NOTIFY_OPTIONS = [
  ['workout', 'Workout reminder', 'Evening nudge if you haven\'t trained, with your streak'],
  ['meals', 'Meal reminders', 'Early afternoon if nothing is logged, and at dinner time'],
  ['water', 'Water check', 'Mid-afternoon if you\'re under half your glasses'],
  ['arena', 'Arena alerts', 'When someone passes you or you take first place'],
  ['weekly', 'Weekly results', 'Monday morning: how last week finished'],
  ['friends', 'Friend activity', 'When a friend logs a workout'],
];

export async function viewMe(app, stale, install) {
  const { board, meId } = await store.leaderboard({ from: null, today: localDate() });
  if (stale()) return;
  const me = board.find((p) => p.id === meId);
  const u = state.user;
  const goals = goalsFor(u);
  const plan = calorieTarget(u);
  const suggested = plan ? { calories: plan.target, ...macroTargets(plan.target, u.weightKg) } : null;
  const differs = suggested && (suggested.calories !== goals.calories || suggested.protein !== goals.protein);

  app.innerHTML = `
    ${label('Profile')}
    <section class="me-head">
      ${avatar(u, 'xl')}
      <div>
        <h1>${esc(u.displayName)}</h1>
        <span class="muted">@${esc(u.username)}${u.isAdmin ? ' · <span class="tag">Admin</span>' : ''}</span>
      </div>
    </section>

    <nav class="link-list card">
      <a href="#/body">${icon('scale', 20)}<span>Body weight<small class="muted">${u.weightKg ? fmtWeight(u.weightKg, u.units) : 'Log a weigh-in'}${u.goalWeightKg != null ? ` · goal ${fmtWeight(u.goalWeightKg, u.units)}` : ''}</small></span>${icon('right', 18)}</a>
      <a href="#/setup">${icon('calc', 20)}<span>Goal setup<small class="muted">${u.onboarded && u.sex ? `${ACTIVITY[u.activity]?.label} · ${paceLabel(u.goalPace, !imperial(u.units))}` : 'Get targets made for you'}</small></span>${icon('right', 18)}</a>
      ${u.isAdmin ? `<a href="#/admin">${icon('shield', 20)}<span>Admin panel<small class="muted">Members, roles, resets and invite code</small></span>${icon('right', 18)}</a>` : ''}
      ${install.standalone ? '' : `<a href="#/install">${icon('download', 20)}<span>Install the app<small class="muted">Add FitFriends to your home screen</small></span>${icon('right', 18)}</a>`}
    </nav>

    <section class="card">
      ${label('Units')}
      <div class="seg">
        <button type="button" data-units="imperial" class="${imperial(u.units) ? 'on' : ''}">lb · mi</button>
        <button type="button" data-units="metric" class="${imperial(u.units) ? '' : 'on'}">kg · km</button>
      </div>
    </section>

    <section class="card" id="notify-card">${label('Notifications')}<div class="loading small"><span></span></div></section>

    <section class="card">
      <div class="row between head">${label('Daily targets')}${differs ? '<button class="link" id="use-suggested">Recalculate</button>' : ''}</div>
      ${differs ? `<p class="muted small" style="margin-bottom:12px">${icon('info', 14)} Based on your stats we'd suggest ${fmt(suggested.calories)} kcal and ${suggested.protein}g protein.</p>` : ''}
      <form id="t-form" class="stack">
        <div class="fields">
          <label>Calories<input name="calorieGoal" type="number" inputmode="numeric" min="800" max="6000" value="${goals.calories}"></label>
          <label>Water (glasses)<input name="waterGoal" type="number" inputmode="numeric" min="0" max="30" value="${goals.water}"></label>
        </div>
        <div class="fields three">
          <label>Protein g<input name="proteinGoal" type="number" inputmode="numeric" min="0" max="600" value="${goals.protein}"></label>
          <label>Carbs g<input name="carbsGoal" type="number" inputmode="numeric" min="0" max="1200" value="${goals.carbs}"></label>
          <label>Fat g<input name="fatGoal" type="number" inputmode="numeric" min="0" max="400" value="${goals.fat}"></label>
        </div>
        <p class="muted small" id="macro-kcal"></p>
        <button class="btn primary" type="submit">Save targets</button>
      </form>
    </section>

    ${u.sex ? `
    <section class="card">
      <div class="row between head">${label('About you')}<a href="#/setup" class="link">Edit ${icon('right', 16)}</a></div>
      <div class="detail-grid">
        <div><span>Sex</span><b>${u.sex === 'male' ? 'Male' : 'Female'}</b></div>
        <div><span>Age</span><b class="num">${ageFrom(u.birthYear) ?? '–'}</b></div>
        <div><span>Height</span><b class="num">${fmtHeight(u.heightCm, u.units)}</b></div>
        <div><span>Weight</span><b class="num">${fmtWeight(u.weightKg, u.units)}</b></div>
        ${plan ? `<div><span>Burn at rest</span><b class="num">${fmt(plan.bmr)} kcal</b></div><div><span>Normal day</span><b class="num">${fmt(plan.tdee)} kcal</b></div>` : ''}
      </div>
    </section>` : ''}

    <section class="card">
      ${label('Your look')}
      <form id="p-form" class="stack">
        <label>Display name<input name="displayName" value="${esc(u.displayName)}" maxlength="40"></label>
        <div><span class="field-label">Color</span><div class="swatches">${store.COLORS.map((c) => `<button type="button" class="swatch ${c === u.color ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>
        <button class="btn primary" type="submit">Save</button>
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

  const save = async (changes, msg) => {
    try {
      state.user = await store.updateProfile(changes);
      haptic(10);
      toast(msg);
      state.rerender();
    } catch (err) { toast(err.message, 'bad'); }
  };

  $$('[data-units]').forEach((b) => b.addEventListener('click', () => save({ units: b.dataset.units }, b.dataset.units === 'metric' ? 'Switched to kg and km' : 'Switched to lb and miles')));

  const t = $('#t-form');
  const kcalLine = () => {
    const kcal = Number(t.proteinGoal.value) * 4 + Number(t.carbsGoal.value) * 4 + Number(t.fatGoal.value) * 9;
    const diff = kcal - Number(t.calorieGoal.value);
    $('#macro-kcal').textContent = `Macros add up to ${fmt(kcal)} kcal${Math.abs(diff) > 50 ? ` (${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} vs your calorie goal)` : ''}.`;
  };
  t.addEventListener('input', kcalLine);
  kcalLine();
  t.addEventListener('submit', (e) => {
    e.preventDefault();
    save(Object.fromEntries(new FormData(t)), 'Targets saved');
  });
  $('#use-suggested')?.addEventListener('click', () => save({
    calorieGoal: suggested.calories, proteinGoal: suggested.protein, carbsGoal: suggested.carbs, fatGoal: suggested.fat,
  }, `Targets set to ${fmt(suggested.calories)} kcal`));

  let color = u.color;
  $$('[data-color]').forEach((b) => b.addEventListener('click', () => {
    color = b.dataset.color;
    $$('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    $('.me-head .ava').style.setProperty('--c', color);
  }));
  $('#p-form').addEventListener('submit', (e) => {
    e.preventDefault();
    save({ displayName: e.target.displayName.value, color }, 'Saved');
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
  drawNotify(u);

  $('#logout').addEventListener('click', async () => {
    await store.signOut();
    state.user = null;
    location.hash = '#/login';
  });
}

async function drawNotify(u) {
  const card = $('#notify-card');
  if (!card) return;
  const status = await pushStatus();
  const intro = {
    'ios-install': `On iPhone, notifications work once FitFriends is on your Home Screen. <a class="link" href="#/install">Install it</a>, open it from the Home Screen, then come back here.`,
    unsupported: 'This browser can\'t show notifications. Try Chrome on Android, or install the app on iPhone.',
    denied: 'Notifications are blocked. iPhone: Settings → Notifications → FitFriends. Android: tap the lock icon or site settings and allow notifications. Then come back.',
    off: 'Get reminders and Arena alerts on this phone. You can pick which ones below.',
    on: 'On for this phone. Alerts can take up to about 20 minutes to arrive.',
  }[status];
  card.innerHTML = `
    <div class="row between head">${label('Notifications')}${status === 'on' ? '<span class="tag">On</span>' : ''}</div>
    <p class="muted small notify-intro">${intro}</p>
    ${status === 'off' ? `<button class="btn primary full" id="push-on">${icon('zap', 18)} Turn on notifications</button>` : ''}
    ${status === 'on' ? `<div class="row gap"><button class="btn small-btn" id="push-test">Send a test</button><button class="btn small-btn ghost" id="push-off">Turn off on this phone</button></div>` : ''}
    <div class="toggles ${status === 'on' || status === 'off' ? '' : 'disabled'}">
      ${NOTIFY_OPTIONS.map(([k, t, d]) => `
        <label class="toggle"><span><b>${t}</b><small class="muted">${d}</small></span>
          <input type="checkbox" data-notify="${k}" ${u.notify[k] ? 'checked' : ''}><i aria-hidden="true"></i></label>`).join('')}
    </div>
    <p class="muted small">Quiet from 10pm to 8am your time.</p>`;
  $('#push-on')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await enablePush(state.user);
      state.user = await store.getProfile();
      haptic(20);
      toast('Notifications on');
    } catch (err) { toast(err.message, 'bad'); }
    drawNotify(state.user);
  });
  $('#push-test')?.addEventListener('click', () => testPush().catch((err) => toast(err.message, 'bad')));
  $('#push-off')?.addEventListener('click', async () => {
    await disablePush();
    toast('Notifications off for this phone');
    drawNotify(state.user);
  });
  $$('[data-notify]', card).forEach((box) => box.addEventListener('change', async () => {
    const notify = { ...state.user.notify, [box.dataset.notify]: box.checked };
    try {
      state.user = await store.updateProfile({ notify });
      haptic(6);
    } catch (err) { toast(err.message, 'bad'); box.checked = !box.checked; }
  }));
}
