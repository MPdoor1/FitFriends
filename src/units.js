// Everything is stored metric (kg, km, cm). These convert for display and input.
export const LB_PER_KG = 2.20462;
export const KM_PER_MI = 1.609344;
const CM_PER_IN = 2.54;

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
export const imperial = (units) => units !== 'metric';

export const weightUnit = (units) => (imperial(units) ? 'lb' : 'kg');
export const toDisplayWeight = (kg, units) => (kg == null ? null : round(imperial(units) ? kg * LB_PER_KG : kg));
export const fromDisplayWeight = (v, units) => (v === '' || v == null ? null : Number(v) / (imperial(units) ? LB_PER_KG : 1));
export const fmtWeight = (kg, units, d = 1) => (kg == null ? '–' : `${round(imperial(units) ? kg * LB_PER_KG : kg, d).toLocaleString()} ${weightUnit(units)}`);

export const distUnit = (units) => (imperial(units) ? 'mi' : 'km');
export const toDisplayDist = (km, units) => (km == null ? null : round(imperial(units) ? km / KM_PER_MI : km, 2));
export const fromDisplayDist = (v, units) => (v === '' || v == null ? null : Number(v) * (imperial(units) ? KM_PER_MI : 1));
export const fmtDist = (km, units) => (km == null ? '' : `${toDisplayDist(km, units)} ${distUnit(units)}`);

// Pace for foot sports (min per mile/km) or speed for wheels and water.
export function paceText(type, minutes, km, units) {
  if (!km || !minutes) return '';
  const d = imperial(units) ? km / KM_PER_MI : km;
  if (['Cycling', 'Rowing'].includes(type)) return `${round(d / (minutes / 60), 1)} ${imperial(units) ? 'mph' : 'km/h'}`;
  const pace = minutes / d;
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')} /${distUnit(units)}`;
}

export function heightParts(cm, units) {
  if (cm == null) return imperial(units) ? { ft: '', in: '' } : { cm: '' };
  if (!imperial(units)) return { cm: Math.round(cm) };
  const totalIn = cm / CM_PER_IN;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return { ft, in: inch };
}
export const heightFromParts = (p, units) => (imperial(units)
  ? (Number(p.ft) * 12 + Number(p.in || 0)) * CM_PER_IN
  : Number(p.cm));
export function fmtHeight(cm, units) {
  if (cm == null) return '–';
  const p = heightParts(cm, units);
  return imperial(units) ? `${p.ft}′${p.in}″` : `${p.cm} cm`;
}
