// GPS helpers: distances, route compression, splits and GPX files. A point is [lat, lng, timeMs?, elevationM?].

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function meters(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MI = 1609.344;
export const splitMeters = (units) => (units === 'metric' ? 1000 : MI);

// Google's encoded polyline format (5 decimals, about 1 m): compact enough to store a whole run in one document.
export function encode(points) {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lng * 1e5);
    out += enc(a - pLat) + enc(b - pLng);
    pLat = a;
    pLng = b;
  }
  return out;
}

export function decode(str) {
  const pts = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = str.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < (str || '').length) {
    lat += next();
    lng += next();
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

// Ramer-Douglas-Peucker: drops points that sit within tol meters of the line through their neighbors.
export function simplify(points, tol = 3) {
  if (points.length < 3) return points.slice();
  const lat0 = rad(points[0][0]);
  const xy = points.map(([lat, lng]) => [lng * 111320 * Math.cos(lat0), lat * 110540]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = xy[s];
    const [bx, by] = xy[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = xy[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worst) { worst = d; idx = i; }
    }
    if (worst > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Squeezes a route under maxPoints by raising the tolerance until it fits.
export function compress(points, maxPoints = 1500) {
  let tol = 2;
  let out = simplify(points, tol);
  while (out.length > maxPoints && tol < 200) { tol *= 1.6; out = simplify(points, tol); }
  return encode(out);
}

// Total climb, ignoring wobble under 3 m so GPS noise doesn't add up.
export function elevationGain(points) {
  let gain = 0;
  let base = null;
  for (const p of points) {
    const e = p[3];
    if (e == null || !Number.isFinite(e)) continue;
    if (base == null) { base = e; continue; }
    if (e - base >= 3) { gain += e - base; base = e; } else if (base - e >= 3) base = e;
  }
  return Math.round(gain);
}

// Distance and split times for timestamped points (GPX imports). Splits are seconds per mile or km.
export function analyze(points, units) {
  const unit = splitMeters(units);
  let dist = 0;
  const splits = [];
  let lastSplitT = 0;
  let mark = unit;
  const t0 = points[0]?.[2];
  for (let i = 1; i < points.length; i++) {
    const d = meters(points[i - 1], points[i]);
    if (t0 != null && points[i][2] != null) {
      const ta = points[i - 1][2] - t0;
      const tb = points[i][2] - t0;
      while (dist + d >= mark && d > 0) {
        const at = ta + ((mark - dist) / d) * (tb - ta);
        splits.push(Math.round((at - lastSplitT) / 1000));
        lastSplitT = at;
        mark += unit;
      }
    }
    dist += d;
  }
  const last = points[points.length - 1];
  return {
    distanceM: dist,
    durationSec: t0 != null && last?.[2] != null ? Math.round((last[2] - t0) / 1000) : null,
    splits,
    elevGainM: elevationGain(points),
  };
}

// Reads track points out of a GPX file (Strava, Garmin, Apple Watch exports and most running apps).
export function parseGpx(text) {
  const docx = new DOMParser().parseFromString(text, 'application/xml');
  if (docx.querySelector('parsererror')) throw new Error("That file isn't a readable GPX file.");
  let nodes = [...docx.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...docx.getElementsByTagName('rtept')];
  const points = nodes.map((n) => {
    const t = n.getElementsByTagName('time')[0]?.textContent;
    const ele = n.getElementsByTagName('ele')[0]?.textContent;
    return [Number(n.getAttribute('lat')), Number(n.getAttribute('lon')), t ? Date.parse(t) : null, ele != null ? Number(ele) : null];
  }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length < 2) throw new Error('No GPS track found in that file.');
  const name = docx.getElementsByTagName('name')[0]?.textContent?.trim() || '';
  const type = docx.getElementsByTagName('type')[0]?.textContent?.trim().toLowerCase() || '';
  return { points, name, type };
}

// SVG path of a route fitted into a w×h box, north up.
export function outlinePath(points, w = 100, h = 100, pad = 6) {
  if (points.length < 2) return '';
  const lat0 = rad(points[0][0]);
  const xy = points.map(([lat, lng]) => [lng * Math.cos(lat0), -lat]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1e-9), (h - 2 * pad) / (maxY - minY || 1e-9));
  const ox = (w - (maxX - minX) * scale) / 2;
  const oy = (h - (maxY - minY) * scale) / 2;
  return xy.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * scale).toFixed(1)} ${(oy + (y - minY) * scale).toFixed(1)}`).join('');
}

export function routeSvg(encoded, cls = 'route-thumb', size = 44) {
  const pts = decode(encoded);
  return `<svg class="${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><path d="${outlinePath(pts)}"/></svg>`;
}

// m:ss or h:mm:ss per mile/km.
export function paceClock(secPerUnit) {
  if (!Number.isFinite(secPerUnit) || secPerUnit <= 0 || secPerUnit > 5940) return '–';
  const s = Math.round(secPerUnit);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
