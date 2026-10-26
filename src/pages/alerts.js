import * as store from '../store.js';
import { state } from '../state.js';
import { NOTIFY_GROUPS, NOTIFY_TYPES, PRESETS, notifyPrefs, hourLabel } from '../notify-catalog.js';
import { $, $$, icon, label, toast, haptic } from '../ui.js';
import { pushStatus, enablePush, disablePush } from '../notify.js';

const openGroups = new Set();

const STATUS_TEXT = {
  'ios-install': 'On iPhone, notifications work once FitFriends is on your Home Screen. <a class="link" href="#/install">Install it</a>, open it from the Home Screen, then come back here.',
  unsupported: "This browser can't show notifications. Use Chrome on Android, or install the app on iPhone.",
  denied: 'Notifications are blocked. iPhone: Settings → Notifications → FitFriends. Android: Settings → Apps → Chrome (or FitFriends) → Notifications. Then come back.',
  off: 'Turn them on for this phone, then pick what you want below.',
  on: 'On for this phone. Alerts can take up to about 20 minutes to arrive.',
};

export const countOn = (prefs) => NOTIFY_TYPES.filter((t) => prefs[t.key]).length;

export async function viewAlerts(app, stale) {
  const status = await pushStatus();
  if (stale()) return;
  const prefs = notifyPrefs(state.user);
  const onKeys = NOTIFY_TYPES.filter((t) => prefs[t.key]).map((t) => t.key).sort().join();
  const activePreset = PRESETS.find((p) => [...p.keys].sort().join() === onKeys)?.id;
  const live = status === 'on';

  app.innerHTML = `
    <a class="back" href="#/me">${icon('left', 18)} Profile</a>
    ${label('Notifications')}
    <h1 class="page-title">Alerts</h1>

    <section class="card notify-status ${live ? 'live' : ''}">
      <div class="row between head">
        <strong>${live ? 'Notifications are on' : status === 'off' ? 'Notifications are off' : 'Not available yet'}</strong>
        ${live ? `<span class="tag">On</span>` : ''}
      </div>
      <p class="muted small">${STATUS_TEXT[status]}</p>
      ${status === 'off' ? `<button class="btn primary big full" id="push-on">${icon('zap', 20)} Turn on notifications</button>` : ''}
      ${live ? `<div class="row gap wrap"><button class="btn small-btn" id="push-test">${icon('phone', 16)} Send a test</button><button class="btn small-btn ghost" id="push-off">Turn off on this phone</button></div>` : ''}
    </section>

    <section class="card">
      <div class="row between head">${label('Quick setup')}<span class="muted small">${countOn(prefs)} of ${NOTIFY_TYPES.length} on</span></div>
      <div class="presets">
        ${PRESETS.map((p) => `<button type="button" class="preset ${p.id === activePreset ? 'on' : ''}" data-preset="${p.id}"><b>${p.label}</b><span>${p.keys.length} types</span></button>`).join('')}
      </div>
    </section>

    ${NOTIFY_GROUPS.map((g) => {
      const items = NOTIFY_TYPES.filter((t) => t.group === g.id);
      const n = items.filter((t) => prefs[t.key]).length;
      const open = openGroups.has(g.id);
      return `
        <section class="card notify-group ${open ? 'open' : ''}">
          <div class="group-head">
            <button type="button" class="group-title" data-open="${g.id}" aria-expanded="${open}">
              <span><b>${g.label}</b><small class="muted">${n} of ${items.length} on · ${g.desc}</small></span>
              ${icon('down', 20)}
            </button>
            <label class="toggle bare" aria-label="All ${g.label}"><input type="checkbox" data-group="${g.id}" ${n === items.length ? 'checked' : ''} ${n > 0 && n < items.length ? 'data-mixed="1"' : ''}><i aria-hidden="true"></i></label>
          </div>
          ${open ? `<div class="group-items">
            ${items.map((t) => `
              <div class="notify-item">
                <label class="toggle">
                  <span><b>${t.label}</b><small class="muted">${t.desc} · ${t.when}</small></span>
                  <input type="checkbox" data-key="${t.key}" ${prefs[t.key] ? 'checked' : ''}><i aria-hidden="true"></i>
                </label>
                <button type="button" class="preview-btn" data-preview="${t.key}">${icon('phone', 14)} Preview</button>
              </div>`).join('')}
          </div>` : ''}
        </section>`;
    }).join('')}

    <section class="card">
      ${label('Quiet hours')}
      <p class="muted small">No notifications between these times. Anything waiting (like a nudge) arrives after.</p>
      <div class="quiet">
        <label>From<select id="quiet-start">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === prefs.quietStart ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
        <label>To<select id="quiet-end">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === prefs.quietEnd ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
      </div>
      <p class="muted small">Times use your phone's time zone${state.user.tz ? ` (${state.user.tz.replace('_', ' ')})` : ''}.</p>
    </section>`;

  // Partially-on groups show their switch in a middle state.
  $$('[data-mixed]').forEach((box) => { box.indeterminate = true; });

  const save = async (next, msg) => {
    try {
      state.user = await store.updateProfile({ notify: next });
      haptic(8);
      if (msg) toast(msg);
      state.rerender();
    } catch (err) { toast(err.message, 'bad'); state.rerender(); }
  };

  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS.find((x) => x.id === b.dataset.preset);
    const next = { ...prefs };
    for (const t of NOTIFY_TYPES) next[t.key] = p.keys.includes(t.key);
    save(next, `${p.label}: ${p.keys.length} on`);
  }));
  $$('[data-group]').forEach((box) => box.addEventListener('change', () => {
    const next = { ...prefs };
    const turnOn = box.checked;
    for (const t of NOTIFY_TYPES) if (t.group === box.dataset.group) next[t.key] = turnOn;
    save(next);
  }));
  $$('[data-key]').forEach((box) => box.addEventListener('change', () => save({ ...prefs, [box.dataset.key]: box.checked })));
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.open;
    if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
    state.rerender();
  }));
  $$('[data-preview]').forEach((b) => b.addEventListener('click', async () => {
    const t = NOTIFY_TYPES.find((x) => x.key === b.dataset.preview);
    const [title, body] = t.sample;
    if (live || ('Notification' in window && Notification.permission === 'granted')) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `preview-${t.key}` });
      toast('Preview sent to this phone');
    } else {
      toast(`${title}: ${body}`);
    }
  }));
  $('#quiet-start').addEventListener('change', (e) => save({ ...prefs, quietStart: Number(e.target.value) }, 'Quiet hours saved'));
  $('#quiet-end').addEventListener('change', (e) => save({ ...prefs, quietEnd: Number(e.target.value) }, 'Quiet hours saved'));

  $('#push-on')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await enablePush(state.user);
      state.user = await store.getProfile();
      // First time on: save the defaults explicitly so the scheduler sees them.
      if (!state.user.notify || !Object.keys(state.user.notify).length) state.user = await store.updateProfile({ notify: notifyPrefs(state.user) });
      haptic(20);
      toast('Notifications on');
    } catch (err) { toast(err.message, 'bad'); }
    state.rerender();
  });
  $('#push-test')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('FitFriends', { body: 'Notifications are working.', icon: 'icons/icon-192.png', tag: 'test' });
  });
  $('#push-off')?.addEventListener('click', async () => {
    await disablePush();
    toast('Notifications off for this phone');
    state.rerender();
  });
}
