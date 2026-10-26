// GPS run tracking: a live map and stats while you move, saved as a workout with its route.
// The browser only hands out positions while FitFriends is open, so the screen is kept awake during a run.
import L from 'leaflet';
import * as store from '../store.js';
import { state } from '../state.js';
import { INTENSITY } from '../scoring.js';
import {
  $, $$, esc, fmt, icon, label, localDate, prettyDate, toast, pointsPop, haptic, openSheet, closeSheet, stepper, bindSteppers,
} from '../ui.js';
import { toDisplayDist, distUnit, fmtDist } from '../units.js';
import { clock } from '../routines.js';
import { meters, splitMeters, compress, decode, elevationGain, analyze, parseGpx, paceClock, routeSvg } from '../geo.js';

export const GPS_TYPES = ['Running', 'Walking', 'Cycling', 'Hiking'];
const MAX_SPEED = { Running: 9, Walking: 4, Hiking: 4, Cycling: 25 }; // m/s; faster jumps are GPS glitches
const MAX_ACCURACY = 40; // meters
const KEY = 'ff-track';
const PREFS_KEY = 'ff-track-prefs';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

let run = read(KEY);
let prefs = { voice: true, type: 'Running', ...(read(PREFS_KEY) || {}) };
let watchId = null;
let fix = null; // latest raw reading, accepted or not: { acc, at }
let wakeLock = null;
let follow = true;
let live = null; // map pieces while the tracker page is open

const save = () => write(KEY, run);
const savePrefs = () => write(PREFS_KEY, prefs);
export const activeRun = () => run;

const movingMs = (at = Date.now()) => {
  if (!run) return 0;
  const end = run.finished ? run.endedAt : at;
  return end - run.startedAt - run.pausedMs - (run.paused ? end - run.pauseStart : 0);
};
const unitName = () => (run?.unit === 1000 ? 'km' : 'mi');

// Speed over the last half minute, as seconds per mile/km.
function currentPace() {
  if (!run || run.pts.length < 2) return null;
  const last = run.pts[run.pts.length - 1];
  if (Date.now() - last[2] > 20000) return null;
  let d = 0;
  let i = run.pts.length - 1;
  while (i > 0 && last[2] - run.pts[i - 1][2] <= 30000) { d += meters(run.pts[i - 1], run.pts[i]); i--; }
  const sec = (last[2] - run.pts[i][2]) / 1000;
  return d >= 15 && sec > 0 ? (sec / d) * run.unit : null;
}

// ---------- sound & voice ----------

function say(text) {
  if (!prefs.voice || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no voice */ }
}
const spokenPace = (sec) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)} minutes ${s % 60} seconds`;
};

async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); wakeLock?.addEventListener('release', () => { wakeLock = null; }); } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && run && !run.finished) keepAwake();
});

// ---------- GPS ----------

function startWatch() {
  if (watchId != null || !('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onGpsError(err) {
  fix = { error: err.code === 1 ? 'denied' : 'unavailable', at: Date.now() };
  drawGps();
}

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc, altitude } = pos.coords;
  const t = pos.timestamp || Date.now();
  fix = { acc, at: t, lat, lng };
  drawGps();
  if (live && !run) live.locate([lat, lng]);
  if (!run || run.paused || run.finished || acc > MAX_ACCURACY) return;
  const p = [lat, lng, t, altitude ?? null];
  const last = run.pts[run.pts.length - 1];
  if (!last || run.gap) {
    run.pts.push(p);
    run.gap = false;
    save();
    drawLive();
    return;
  }
  const d = meters(last, p);
  if (d < 4) return;
  const dt = (t - last[2]) / 1000;
  if (dt > 0 && dt < 30 && d / dt > MAX_SPEED[run.type]) return;
  // Mile/km splits, interpolated to the moment the line was crossed.
  const ta = last[2] - run.startedAt - run.pausedMs;
  const tb = t - run.startedAt - run.pausedMs;
  while (run.dist + d >= run.nextMark) {
    const at = ta + ((run.nextMark - run.dist) / d) * (tb - ta);
    const split = Math.round((at - run.lastSplitT) / 1000);
    run.splits.push(split);
    run.lastSplitT = at;
    haptic([60, 80, 60]);
    say(`${unitName() === 'km' ? 'Kilometer' : 'Mile'} ${run.splits.length}. ${spokenPace(split)}.`);
    run.nextMark += run.unit;
  }
  run.dist += d;
  run.pts.push(p);
  save();
  drawLive();
}

// A run in progress keeps tracking even after the app is closed and reopened.
if (run && !run.finished && !run.paused) startWatch();
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/track') && !(run && !run.finished)) stopWatch();
  if (!location.hash.startsWith('#/track')) { live?.map.remove(); live = null; }
});

// ---------- actions ----------

function start() {
  run = {
    type: prefs.type, startedAt: Date.now(), paused: false, pauseStart: null, pausedMs: 0,
    pts: [], dist: 0, splits: [], unit: splitMeters(state.user.units), nextMark: splitMeters(state.user.units), lastSplitT: 0,
    finished: false, endedAt: null, gap: false,
  };
  if (fix?.lat != null && Date.now() - fix.at < 10000 && fix.acc <= MAX_ACCURACY) run.pts.push([fix.lat, fix.lng, Date.now(), null]);
  save();
  startWatch();
  keepAwake();
  haptic(30);
  say(`${run.type} started.`);
}

function togglePause() {
  if (run.paused) {
    run.pausedMs += Date.now() - run.pauseStart;
    run.paused = false;
    run.pauseStart = null;
    run.gap = true; // don't count whatever was covered while paused
    say('Resumed.');
  } else {
    run.paused = true;
    run.pauseStart = Date.now();
    say('Paused.');
  }
  haptic(20);
  save();
}

function finish() {
  if (run.paused) { run.pausedMs += Date.now() - run.pauseStart; run.paused = false; }
  run.finished = true;
  run.endedAt = Date.now();
  save();
  stopWatch();
  wakeLock?.release().catch(() => {});
  say(`Done. ${(run.dist / run.unit).toFixed(2)} ${unitName() === 'km' ? 'kilometers' : 'miles'}.`);
}

function discard() {
  run = null;
  write(KEY, null);
  stopWatch();
  wakeLock?.release().catch(() => {});
}

// ---------- maps ----------

const TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function baseMap(el, { interactive = true } = {}) {
  const map = L.map(el, {
    zoomControl: interactive, attributionControl: true, dragging: interactive, touchZoom: interactive,
    scrollWheelZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: false, tap: false,
  });
  L.tileLayer(TILES, { attribution: ATTRIB, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
  map.attributionControl.setPrefix(false);
  return map;
}

const lineStyle = { color: '#c8ff2e', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' };

// Draws a saved route (encoded polyline) into an element, with start and finish dots.
export function routeMap(el, encoded, opts = {}) {
  const pts = decode(encoded);
  if (pts.length < 2) return null;
  const map = baseMap(el, opts);
  const line = L.polyline(pts, lineStyle).addTo(map);
  L.circleMarker(pts[0], { radius: 6, color: '#0c0d0f', weight: 2, fillColor: '#3dffa8', fillOpacity: 1 }).addTo(map).bindTooltip('Start');
  L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#0c0d0f', weight: 2, fillColor: '#ff4d5e', fillOpacity: 1 }).addTo(map).bindTooltip('Finish');
  map.fitBounds(line.getBounds(), { padding: [18, 18] });
  return map;
}

// Pace, splits and a full map for one workout.
export function openRouteSheet(w) {
  const u = state.user.units;
  const unit = w.splitUnit || 'mi';
  const dist = w.distanceKm ? `${toDisplayDist(w.distanceKm, u)} ${distUnit(u)}` : '';
  const best = w.splits?.length ? Math.min(...w.splits) : null;
  openSheet({
    title: `${w.type} · ${prettyDate(w.date)}`,
    html: `
      <div class="route-full" id="route-full"></div>
      <div class="detail-grid route-stats">
        ${dist ? `<div><span>Distance</span><b class="num">${dist}</b></div>` : ''}
        <div><span>Time</span><b class="num">${w.durationMin} min</b></div>
        ${w.distanceKm ? `<div><span>Avg pace</span><b class="num">${paceClock((w.durationMin * 60) / (w.distanceKm * 1000 / (unit === 'km' ? 1000 : 1609.344)))} /${unit}</b></div>` : ''}
        ${w.elevGainM != null ? `<div><span>Climb</span><b class="num">${u === 'metric' ? `${w.elevGainM} m` : `${fmt(w.elevGainM * 3.28084)} ft`}</b></div>` : ''}
      </div>
      ${w.splits?.length ? `
        <h3 class="sub">Splits</h3>
        <ol class="splits">${w.splits.map((s, i) => `
          <li class="${s === best ? 'best' : ''}"><span>${unit === 'km' ? 'Km' : 'Mile'} ${i + 1}</span>
            <span class="split-bar"><i style="width:${Math.min(100, (best / s) * 100)}%"></i></span>
            <b class="num">${paceClock(s)}</b></li>`).join('')}</ol>` : ''}`,
    onMount(sheet) {
      requestAnimationFrame(() => routeMap($('#route-full', sheet), w.route));
    },
  });
}

// ---------- the page ----------

function stat(id, value, name, big = false) {
  return `<div class="trk-stat ${big ? 'big' : ''}"><b class="num" id="${id}">${value}</b><span>${name}</span></div>`;
}

function gpsBadge() {
  if (!('geolocation' in navigator)) return `<span class="gps bad">${icon('x', 14)} No GPS on this device</span>`;
  if (!fix) return `<span class="gps wait">${icon('route', 14)} Finding GPS…</span>`;
  if (fix.error === 'denied') return `<span class="gps bad">${icon('x', 14)} Location blocked</span>`;
  if (fix.error) return `<span class="gps wait">${icon('route', 14)} Searching for GPS…</span>`;
  const a = Math.round(fix.acc);
  return `<span class="gps ${a <= 15 ? 'good' : a <= MAX_ACCURACY ? 'ok' : 'wait'}">${icon('route', 14)} GPS ${a <= 15 ? 'strong' : a <= MAX_ACCURACY ? 'OK' : 'weak'} · ±${a} m</span>`;
}

function drawGps() {
  const el = $('#trk-gps');
  if (el) el.innerHTML = gpsBadge();
  const help = $('#trk-denied');
  if (help) help.hidden = fix?.error !== 'denied';
}

function drawLive() {
  if (!live || !run) return;
  const latlngs = run.pts.map((p) => [p[0], p[1]]);
  live.line.setLatLngs(latlngs);
  const last = latlngs[latlngs.length - 1];
  if (last) live.locate(last);
  const set = (id, v) => { const el = $(`#${id}`); if (el) el.textContent = v; };
  set('trk-dist', (run.dist / run.unit).toFixed(2));
  const pace = currentPace();
  set('trk-pace', pace ? paceClock(pace) : '–');
  const mv = movingMs() / 1000;
  set('trk-avg', run.dist > 30 ? paceClock(mv / (run.dist / run.unit)) : '–');
  const splits = $('#trk-splits');
  if (splits) splits.innerHTML = splitList();
}

const splitList = () => (run.splits.length ? run.splits.map((s, i) => `<li><span>${unitName() === 'km' ? 'Km' : 'Mi'} ${i + 1}</span><b class="num">${paceClock(s)}</b></li>`).reverse().join('') : '');

export function trackBanner() {
  if (!run) return '';
  return `
    <a class="card resume-banner" href="#/track">
      ${icon(run.finished ? 'check' : 'route', 22)}
      <div><strong>${run.finished ? `${esc(run.type)} finished: save it` : `${esc(run.type)} in progress`}</strong><span class="muted small">${(run.dist / run.unit).toFixed(2)} ${unitName()} · ${clock(movingMs() / 1000)}</span></div>
      ${icon('right', 20)}
    </a>`;
}

export function viewTrack(app) {
  live?.map.remove();
  live = null;
  if (run?.finished) { drawFinish(app); return; }
  startWatch();
  const u = state.user.units;
  const unit = distUnit(u);
  const running = Boolean(run);

  app.innerHTML = `
    <div class="trk ${running ? 'on' : ''}">
      <div class="trk-top">
        ${running ? '<span></span>' : `<a class="back" href="#/train">${icon('left', 18)} Train</a>`}
        <span id="trk-gps">${gpsBadge()}</span>
      </div>
      <div class="trk-map-wrap">
        <div id="trk-map" class="trk-map"></div>
        <button type="button" class="icon-btn trk-center" id="trk-center" aria-label="Center on me" hidden>${icon('target', 18)}</button>
      </div>
      <p class="hint warn" id="trk-denied" hidden>${icon('info', 14)} Location is blocked. Allow it for this site in your browser's site settings (tap the icon left of the address bar), then reload.</p>
      ${running ? `
        <div class="trk-stats">
          ${stat('trk-dist', (run.dist / run.unit).toFixed(2), unitName() === 'km' ? 'Kilometers' : 'Miles', true)}
          ${stat('trk-time', clock(movingMs() / 1000), 'Time')}
          ${stat('trk-pace', '–', `Pace /${unitName()}`)}
          ${stat('trk-avg', '–', `Avg /${unitName()}`)}
        </div>
        ${run.paused ? `<p class="trk-paused">${icon('pause', 16)} Paused</p>` : ''}
        <div class="trk-buttons">
          <button type="button" class="btn big ${run.paused ? 'primary' : ''}" id="trk-pause">${icon(run.paused ? 'play' : 'pause', 20)} ${run.paused ? 'Resume' : 'Pause'}</button>
          <button type="button" class="btn big danger-fill" id="trk-finish">${icon('flag', 20)} Finish</button>
        </div>
        <div class="trk-opts">
          <button type="button" class="chip ${prefs.voice ? 'on' : ''}" id="trk-voice">${icon(prefs.voice ? 'voice' : 'mute', 14)} Voice splits</button>
        </div>
        <ol class="trk-splits" id="trk-splits">${splitList()}</ol>
        <p class="hint">${icon('info', 14)} Keep FitFriends open while you move: the screen stays on, and your phone only shares location with an open web app. If it closes, reopen it and tracking picks back up.</p>`
      : `
        <section class="card stack">
          <div class="chips">${GPS_TYPES.map((t) => `<button type="button" class="chip ${t === prefs.type ? 'on' : ''}" data-gtype="${t}">${icon(t, 14)} ${t}</button>`).join('')}</div>
          <button type="button" class="btn primary big full" id="trk-start">${icon('play', 20)} Start ${esc(prefs.type.toLowerCase())}</button>
          <label class="toggle-row"><span>Voice splits every ${unit === 'km' ? 'kilometer' : 'mile'}</span><input type="checkbox" id="trk-voice-pre" ${prefs.voice ? 'checked' : ''}></label>
        </section>
        <section class="card">
          ${label('Recorded it somewhere else?')}
          <p class="muted small">Import a GPX file from Strava, Garmin, Apple Watch or another app to see its map here.</p>
          <button type="button" class="btn full" id="trk-import">${icon('download', 18)} Import GPX file</button>
        </section>
        <p class="hint">${icon('info', 14)} Tracking works while FitFriends is open on screen. Put your phone in an armband or pocket with the screen on; it won't turn off by itself during a run.</p>`}
    </div>`;

  // Map
  const el = $('#trk-map', app);
  const map = baseMap(el);
  const line = L.polyline([], lineStyle).addTo(map);
  const dot = L.circleMarker([0, 0], { radius: 8, color: '#0c0d0f', weight: 3, fillColor: '#c8ff2e', fillOpacity: 1 });
  let placed = false;
  live = {
    map, line,
    locate(ll) {
      dot.setLatLng(ll);
      if (!placed) { dot.addTo(map); placed = true; map.setView(ll, 16); return; }
      if (follow) map.panTo(ll, { animate: true });
    },
  };
  map.setView([39.5, -98.35], 3);
  map.on('dragstart', () => { follow = false; $('#trk-center').hidden = false; });
  $('#trk-center').addEventListener('click', () => {
    follow = true;
    $('#trk-center').hidden = true;
    const ll = run?.pts.length ? run.pts[run.pts.length - 1] : fix?.lat != null ? [fix.lat, fix.lng] : null;
    if (ll) map.setView([ll[0], ll[1]], Math.max(map.getZoom(), 16));
  });
  if (run?.pts.length) {
    line.setLatLngs(run.pts.map((p) => [p[0], p[1]]));
    if (run.pts.length > 1) map.fitBounds(line.getBounds(), { padding: [30, 30], maxZoom: 17 });
    live.locate(run.pts[run.pts.length - 1].slice(0, 2));
  } else if (fix?.lat != null) live.locate([fix.lat, fix.lng]);
  drawGps();
  drawLive();

  if (!running) {
    $$('[data-gtype]', app).forEach((b) => b.addEventListener('click', () => {
      prefs.type = b.dataset.gtype;
      savePrefs();
      viewTrack(app);
    }));
    $('#trk-voice-pre').addEventListener('change', (e) => { prefs.voice = e.target.checked; savePrefs(); });
    $('#trk-start').addEventListener('click', () => {
      if (fix?.error === 'denied') { toast('Allow location for this site first', 'bad'); return; }
      start();
      viewTrack(app);
    });
    $('#trk-import').addEventListener('click', openGpxImport);
    return;
  }

  $('#trk-pause').addEventListener('click', () => { togglePause(); viewTrack(app); });
  $('#trk-voice').addEventListener('click', () => { prefs.voice = !prefs.voice; savePrefs(); viewTrack(app); });
  $('#trk-finish').addEventListener('click', () => {
    openSheet({
      title: 'Finish?',
      html: `
        <div class="stack">
          <button type="button" class="btn primary big full" id="tf-save">${icon('flag', 20)} Finish and save</button>
          <button type="button" class="btn big full" id="tf-keep">Keep going</button>
          <button type="button" class="btn ghost-danger big" id="tf-discard">${icon('trash', 18)} Discard this ${esc(run.type.toLowerCase())}</button>
        </div>`,
      onMount(sheet) {
        $('#tf-keep', sheet).addEventListener('click', closeSheet);
        $('#tf-save', sheet).addEventListener('click', () => { closeSheet(); finish(); viewTrack(app); });
        $('#tf-discard', sheet).addEventListener('click', () => {
          if (!confirm('Throw away this activity?')) return;
          closeSheet();
          discard();
          location.hash = '#/train';
        });
      },
    });
  });
  const tick = setInterval(() => {
    const t = $('#trk-time');
    if (!t || !run || run.finished) { clearInterval(tick); return; }
    t.textContent = clock(movingMs() / 1000);
    if (!run.paused) { const p = currentPace(); $('#trk-pace').textContent = p ? paceClock(p) : '–'; }
  }, 1000);
}

function drawFinish(app) {
  const u = state.user.units;
  const mv = movingMs() / 1000;
  const miles = run.dist / run.unit;
  let intensity = run.type === 'Walking' ? 'light' : 'moderate';
  app.innerHTML = `
    <div class="trk done">
      ${label('Finished')}
      <h1 class="page-title">${esc(run.type)}</h1>
      <div class="route-full" id="trk-final"></div>
      <div class="trk-stats">
        ${stat('f-dist', miles.toFixed(2), unitName() === 'km' ? 'Kilometers' : 'Miles', true)}
        ${stat('f-time', clock(mv), 'Moving time')}
        ${stat('f-avg', miles > 0.02 ? paceClock(mv / miles) : '–', `Avg /${unitName()}`)}
        ${stat('f-climb', (() => { const g = elevationGain(run.pts); return u === 'metric' ? `${g} m` : `${fmt(g * 3.28084)} ft`; })(), 'Climb')}
      </div>
      ${run.splits.length ? `<ol class="trk-splits">${splitList()}</ol>` : ''}
      <section class="card stack">
        <div>
          <span class="field-label">How hard?</span>
          <div class="seg">${Object.entries(INTENSITY).map(([k, v]) => `<button type="button" data-fi="${k}" class="${k === intensity ? 'on' : ''}">${v.label}</button>`).join('')}</div>
        </div>
        <label>Notes<textarea id="f-notes" rows="2" maxlength="500" placeholder="Route, weather, how it felt"></textarea></label>
        <button type="button" class="btn primary big full" id="f-save">${icon('check', 20)} Save ${esc(run.type.toLowerCase())}</button>
        <button type="button" class="btn ghost-danger" id="f-discard">${icon('trash', 16)} Discard</button>
      </section>
    </div>`;
  if (run.pts.length > 1) routeMap($('#trk-final', app), compress(run.pts.map((p) => [p[0], p[1]])));
  else $('#trk-final', app).innerHTML = '<p class="muted small route-none">Not enough GPS points to draw a map.</p>';
  $$('[data-fi]', app).forEach((b) => b.addEventListener('click', () => {
    intensity = b.dataset.fi;
    $$('[data-fi]', app).forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#f-discard').addEventListener('click', () => {
    if (!confirm('Throw away this activity?')) return;
    discard();
    location.hash = '#/train';
  });
  $('#f-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const w = await store.addWorkout(state.user, {
        type: run.type,
        intensity,
        date: localDate(new Date(run.startedAt)),
        durationMin: Math.max(1, Math.round(mv / 60)),
        distanceKm: run.dist > 0 ? run.dist / 1000 : null,
        route: run.pts.length > 1 ? compress(run.pts.map((p) => [p[0], p[1]])) : null,
        splits: run.splits,
        splitUnit: unitName(),
        elevGainM: elevationGain(run.pts),
        notes: $('#f-notes').value,
      });
      discard();
      haptic(25);
      pointsPop(w.points);
      toast(`${w.type} saved · ${fmtDist(w.distanceKm, u) || `${w.durationMin} min`} · +${w.points} pts`);
      location.hash = '#/train';
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
  });
}

// ---------- GPX import ----------

const guessType = (gpxType, name) => {
  const s = `${gpxType} ${name}`.toLowerCase();
  if (/bik|cycl|ride/.test(s)) return 'Cycling';
  if (/hik/.test(s)) return 'Hiking';
  if (/walk/.test(s)) return 'Walking';
  return 'Running';
};

export function openGpxImport() {
  const u = state.user.units;
  openSheet({
    title: 'Import GPX',
    html: `
      <div class="stack">
        <label class="file-pick">${icon('download', 22)}<span>Choose a .gpx file</span><input type="file" id="gpx-file" accept=".gpx,application/gpx+xml,application/xml,text/xml"></label>
        <p class="hint">${icon('info', 14)}<span>In Strava: open the activity on strava.com, tap the three dots, then <b>Export GPX</b>. Garmin Connect and most watch apps have an Export GPX option too.</span></p>
        <div id="gpx-preview"></div>
      </div>`,
    onMount(sheet) {
      $('#gpx-file', sheet).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 15e6) { toast('That file is too big', 'bad'); return; }
        let g;
        try { g = parseGpx(await file.text()); } catch (err) { toast(err.message, 'bad'); return; }
        const a = analyze(g.points, u);
        const t0 = g.points[0][2];
        const date = t0 ? localDate(new Date(t0)) : localDate();
        let type = guessType(g.type, g.name);
        let intensity = 'moderate';
        const route = compress(g.points.map((p) => [p[0], p[1]]));
        $('#gpx-preview', sheet).innerHTML = `
          <div class="card gpx-card">
            <div class="route-full small" id="gpx-map"></div>
            <div class="detail-grid">
              <div><span>Distance</span><b class="num">${fmtDist(a.distanceM / 1000, u)}</b></div>
              <div><span>Date</span><b class="num">${prettyDate(date)}</b></div>
              ${a.durationSec ? `<div><span>Time</span><b class="num">${clock(a.durationSec)}</b></div>` : ''}
              ${a.splits.length ? `<div><span>Splits</span><b class="num">${a.splits.length}</b></div>` : ''}
            </div>
            ${g.name ? `<p class="muted small">${esc(g.name)}</p>` : ''}
          </div>
          <div class="chips">${GPS_TYPES.map((t) => `<button type="button" class="chip ${t === type ? 'on' : ''}" data-it="${t}">${icon(t, 14)} ${t}</button>`).join('')}</div>
          ${a.durationSec ? '' : `<div><span class="field-label">Duration (the file has no times)</span>${stepper('gpxMin', 30, { step: 5, min: 1, max: 600, unit: 'min' })}</div>`}
          <div class="seg">${Object.entries(INTENSITY).map(([k, v]) => `<button type="button" data-ii="${k}" class="${k === intensity ? 'on' : ''}">${v.label}</button>`).join('')}</div>
          <button type="button" class="btn primary big full" id="gpx-save">${icon('check', 20)} Save workout</button>`;
        bindSteppers(sheet);
        requestAnimationFrame(() => routeMap($('#gpx-map', sheet), route, { interactive: false }));
        $$('[data-it]', sheet).forEach((b) => b.addEventListener('click', () => { type = b.dataset.it; $$('[data-it]', sheet).forEach((x) => x.classList.toggle('on', x === b)); }));
        $$('[data-ii]', sheet).forEach((b) => b.addEventListener('click', () => { intensity = b.dataset.ii; $$('[data-ii]', sheet).forEach((x) => x.classList.toggle('on', x === b)); }));
        $('#gpx-save', sheet).addEventListener('click', async (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            const mins = a.durationSec ? Math.max(1, Math.round(a.durationSec / 60)) : Number($('[name=gpxMin]', sheet).value);
            const w = await store.addWorkout(state.user, {
              type, intensity, date, durationMin: Math.min(600, mins), distanceKm: a.distanceM / 1000,
              route, splits: a.splits, splitUnit: u === 'metric' ? 'km' : 'mi', elevGainM: a.elevGainM, notes: g.name,
            });
            closeSheet();
            pointsPop(w.points);
            toast(`${w.type} imported · +${w.points} pts`);
            if (location.hash.startsWith('#/train')) state.rerender(); else location.hash = '#/train';
          } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
        });
      });
    },
  });
}

export { routeSvg };
