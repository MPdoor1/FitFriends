// Shared UI helpers: DOM shortcuts, dates, toasts, bottom sheets, steppers and charts.
import { icon } from './icons.js';

export { icon };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => Math.round(n || 0).toLocaleString();
export const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString();

// ---------- dates (local, as YYYY-MM-DD) ----------

export function localDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
export function weekStart(dateStr = localDate()) {
  const d = new Date(`${dateStr}T12:00:00`);
  return shiftDate(dateStr, -((d.getDay() + 6) % 7)); // Monday
}
export const monthStart = (dateStr = localDate()) => `${dateStr.slice(0, 8)}01`;
export const dateObj = (dateStr) => new Date(`${dateStr}T12:00:00`);
export function prettyDate(dateStr) {
  const today = localDate();
  if (dateStr === today) return 'Today';
  if (dateStr === shiftDate(today, -1)) return 'Yesterday';
  return dateObj(dateStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export const shortDate = (dateStr) => dateObj(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const dayLetter = (dateStr) => dateObj(dateStr).toLocaleDateString(undefined, { weekday: 'narrow' });
export const datesBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
};

// ---------- small bits ----------

export const label = (text) => `<span class="eyebrow">${text}</span>`;
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const avatar = (p, cls = '') => `<span class="ava ${cls}" style="--c:${esc(p.color)}">${esc(initials(p.displayName))}</span>`;
export const haptic = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

let toastTimer;
// toast('Saved') or toast('Deleted', { action: 'Undo', onAction }) or toast(msg, 'bad').
export function toast(msg, opts = {}) {
  if (typeof opts === 'string') opts = { kind: opts };
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}`;
  el.className = `toast show ${opts.kind || 'ok'} ${opts.action ? 'has-action' : ''}`;
  if (opts.action) {
    el.querySelector('button').onclick = () => { el.className = 'toast'; opts.onAction(); };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, opts.action ? 5000 : 2600);
}

export function pointsPop(points) {
  if (!points) return;
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = `+${points}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// ---------- bottom sheet ----------

let openSheetEl = null;
export function closeSheet() {
  if (!openSheetEl) return;
  const el = openSheetEl;
  openSheetEl = null;
  el.classList.remove('open');
  document.documentElement.classList.remove('sheet-open');
  setTimeout(() => el.remove(), 260);
}

// Slides a panel up from the bottom (centered dialog on wide screens). onMount(body) wires it up.
export function openSheet({ title, html, onMount, footer = '' }) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn sheet-close" aria-label="Close">${icon('x', 20)}</button></header>
      <div class="sheet-body">${html}</div>
      ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ''}
    </section>`;
  document.body.appendChild(wrap);
  document.documentElement.classList.add('sheet-open');
  openSheetEl = wrap;
  wrap.querySelector('.sheet-backdrop').addEventListener('click', closeSheet);
  wrap.querySelector('.sheet-close').addEventListener('click', closeSheet);
  requestAnimationFrame(() => wrap.classList.add('open'));
  onMount?.(wrap.querySelector('.sheet'));
  return wrap.querySelector('.sheet');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', closeSheet);

// ---------- stepper ----------

// A number input with − / + buttons. bindSteppers() wires every stepper inside root.
export function stepper(name, value, { step = 1, min = 0, max = 9999, unit = '', decimals = 0, id = '' } = {}) {
  return `
    <div class="stepper" data-step="${step}" data-min="${min}" data-max="${max}" data-decimals="${decimals}">
      <button type="button" class="step-btn" data-dir="-1" aria-label="Less">${icon('minus', 18)}</button>
      <div class="step-val"><input name="${name}" ${id ? `id="${id}"` : ''} type="number" inputmode="decimal" step="any" value="${value ?? ''}" min="${min}" max="${max}">${unit ? `<span>${unit}</span>` : ''}</div>
      <button type="button" class="step-btn" data-dir="1" aria-label="More">${icon('plus', 18)}</button>
    </div>`;
}
export function bindSteppers(root) {
  $$('.stepper', root).forEach((s) => {
    const input = $('input', s);
    const { step, min, max, decimals } = Object.fromEntries(Object.entries(s.dataset).map(([k, v]) => [k, Number(v)]));
    $$('.step-btn', s).forEach((b) => b.addEventListener('click', () => {
      const cur = Number(input.value) || 0;
      const next = Math.min(max, Math.max(min, Math.round((cur + step * Number(b.dataset.dir)) / step) * step));
      input.value = decimals ? next.toFixed(decimals).replace(/\.0+$/, '') : next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      haptic(6);
    }));
  });
}

// ---------- charts ----------

// Vertical bars. bars: [{ label, value, tip, color, dim }]. Tap or hover a bar to read it.
export function barChart(bars, { goal = null, height = 150, color = 'var(--accent)', unit = '' } = {}) {
  const max = Math.max(goal || 0, ...bars.map((b) => b.value), 1) * 1.1;
  return `
    <div class="chart bars" style="--h:${height}px">
      <div class="chart-tip" aria-live="polite"></div>
      <div class="bar-area">
        ${goal ? `<div class="goal-line" style="bottom:${(goal / max) * 100}%"><span>${fmt(goal)}${unit}</span></div>` : ''}
        ${bars.map((b, i) => `
          <button type="button" class="bar-col ${b.dim ? 'dim' : ''}" data-tip="${esc(b.tip ?? `${b.label}: ${fmt(b.value)}${unit}`)}" data-i="${i}">
            <span class="bar-fill" style="height:${(b.value / max) * 100}%; background:${b.color || color}"></span>
          </button>`).join('')}
      </div>
      <div class="bar-labels">${bars.map((b) => `<span>${esc(b.label)}</span>`).join('')}</div>
    </div>`;
}

// Line chart for values over time. points: [{ date, value }].
export function lineChart(points, { goal = null, height = 180, unit = '', decimals = 1 } = {}) {
  if (points.length === 0) return '<div class="chart empty-chart">No entries yet</div>';
  const W = 320;
  const H = 100;
  const vals = points.map((p) => p.value).concat(goal != null ? [goal] : []);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 1);
  lo -= pad; hi += pad;
  const t0 = dateObj(points[0].date).getTime();
  const t1 = dateObj(points[points.length - 1].date).getTime();
  const x = (p) => (t1 === t0 ? W / 2 : ((dateObj(p.date).getTime() - t0) / (t1 - t0)) * W);
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points[points.length - 1]).toFixed(1)},${H} L${x(points[0]).toFixed(1)},${H} Z`;
  const data = points.map((p) => ({ x: x(p) / W, y: y(p.value) / H, tip: `${shortDate(p.date)} · ${p.value.toFixed(decimals)} ${unit}` }));
  return `
    <div class="chart line" style="--h:${height}px" data-points="${esc(JSON.stringify(data))}">
      <div class="chart-tip" aria-live="polite"></div>
      <div class="line-area">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
          ${goal != null ? `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal" vector-effect="non-scaling-stroke"/>` : ''}
          <path d="${area}" fill="url(#lg)"/>
          <path d="${path}" class="stroke" vector-effect="non-scaling-stroke"/>
        </svg>
        ${data.map((d) => `<span class="dot" style="left:${d.x * 100}%; top:${d.y * 100}%"></span>`).join('')}
        <span class="cursor" hidden></span>
        ${goal != null ? `<span class="goal-tag" style="top:${(y(goal) / H) * 100}%">Goal</span>` : ''}
      </div>
      <div class="line-axis"><span>${shortDate(points[0].date)}</span><span>${shortDate(points[points.length - 1].date)}</span></div>
    </div>`;
}

// Makes every chart inside root respond to taps and pointer movement.
export function bindCharts(root) {
  $$('.chart.bars', root).forEach((c) => {
    const tip = $('.chart-tip', c);
    const cols = $$('.bar-col', c);
    const pick = (col) => {
      cols.forEach((x) => x.classList.toggle('sel', x === col));
      tip.textContent = col.dataset.tip;
      tip.classList.add('show');
    };
    cols.forEach((col) => {
      col.addEventListener('click', () => { pick(col); haptic(5); });
      col.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') pick(col); });
    });
    const last = cols.filter((x) => !x.classList.contains('dim')).pop() || cols[cols.length - 1];
    if (last) pick(last);
  });
  $$('.chart.line', root).forEach((c) => {
    const data = JSON.parse(c.dataset.points);
    const area = $('.line-area', c);
    const tip = $('.chart-tip', c);
    const cursor = $('.cursor', c);
    const show = (i) => {
      const d = data[i];
      cursor.hidden = false;
      cursor.style.left = `${d.x * 100}%`;
      cursor.style.top = `${d.y * 100}%`;
      tip.textContent = d.tip;
      tip.classList.add('show');
    };
    const nearest = (clientX) => {
      const r = area.getBoundingClientRect();
      const fx = (clientX - r.left) / r.width;
      let best = 0;
      data.forEach((d, i) => { if (Math.abs(d.x - fx) < Math.abs(data[best].x - fx)) best = i; });
      return best;
    };
    area.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    area.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    show(data.length - 1);
  });
}

// Horizontal progress bar with label: used for macros and goals.
export function meter(labelText, value, goal, { unit = 'g', color = 'var(--accent)' } = {}) {
  const pct = goal ? Math.min((value / goal) * 100, 100) : 0;
  const over = goal && value > goal * 1.05;
  return `
    <div class="macro">
      <div class="macro-head"><span>${labelText}</span><span class="num"><b>${fmt(value)}</b> / ${fmt(goal)}${unit}</span></div>
      <div class="macro-bar"><div style="width:${pct}%; background:${over ? 'var(--hot)' : color}"></div></div>
    </div>`;
}
