// Food search: the built-in list (data/*.txt, about 1,400 foods and restaurant items) plus
// Open Food Facts for brand-name groceries and barcodes.
import { FOODS } from './data.js';

let db = null;
let loading = null;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Match "mcdonalds", "mc donalds" and "chick fil a" alike.
const hay = (s) => { const n = norm(s); return `${n.replace(/['’.\-&]/g, '')} ${n.replace(/[^a-z0-9]+/g, ' ')}`; };

const toFood = ([name, serving, calories, proteinG, carbsG, fatG, category, brand]) => ({
  name, serving, calories, proteinG, carbsG, fatG, category, brand: brand || '',
});

// Loads the full list once; until then the small built-in list still works.
export function loadFoodDb() {
  if (db) return Promise.resolve(db);
  loading ||= fetch('foods.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((rows) => {
      const big = rows.map(toFood);
      db = big.length ? big : FOODS.map((f) => ({ ...f, brand: '' }));
      for (const f of db) f.hay = hay(`${f.brand} ${f.name} ${f.category}`);
      return db;
    });
  return loading;
}

export const foodDbReady = () => Boolean(db);
export const allFoods = () => db || FOODS.map((f) => ({ ...f, brand: '', hay: hay(`${f.name} ${f.category}`) }));
export const chains = () => [...new Set(allFoods().filter((f) => f.brand).map((f) => f.brand))].sort((a, b) => a.localeCompare(b));
export const categories = () => [...new Set(allFoods().filter((f) => !f.brand).map((f) => f.category))];

// Every word has to appear (plurals forgiven); names that start with the words rank first.
export function searchFoods(q, { category = null, brand = null, limit = 80 } = {}) {
  const words = norm(q).split(/[^a-z0-9]+/).filter(Boolean);
  const pool = allFoods().filter((f) => (!category || f.category === category) && (!brand || f.brand === brand));
  if (!words.length) return pool.slice(0, limit);
  const has = (h, w) => h.includes(w) || (w.length > 3 && w.endsWith('s') && h.includes(w.slice(0, -1)));
  const out = [];
  for (const f of pool) {
    if (!words.every((w) => has(f.hay, w))) continue;
    const name = norm(f.name);
    let score = 0;
    const w0 = words[0];
    if (name.startsWith(w0) || (w0.length > 3 && w0.endsWith('s') && name.startsWith(w0.slice(0, -1)))) score += 30;
    if (name === words.join(' ')) score += 50;
    for (const w of words) {
      if (new RegExp(`(^|[^a-z0-9])${w}`).test(name)) score += 10;
      if (norm(f.brand).replace(/[^a-z0-9]/g, '').includes(w)) score += 8;
    }
    score -= name.length / 20;
    if (f.brand) score -= 3; // plain foods first unless the chain was named
    out.push([score, f]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, f]) => f);
}

// ---------- Open Food Facts (free, crowd-sourced grocery products) ----------

const OFF_FIELDS = 'code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments';
const r1 = (n) => Math.round(n * 10) / 10;

// Turns an Open Food Facts product into our per-serving shape, keeping per-100 g values for weighing.
export function fromOff(p) {
  const n = p?.nutriments || {};
  const kcal100 = n['energy-kcal_100g'] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null);
  const name = (p?.product_name_en || p?.product_name || '').trim();
  if (!name || kcal100 == null) return null;
  const per100 = { calories: Math.round(kcal100), proteinG: r1(n.proteins_100g || 0), carbsG: r1(n.carbohydrates_100g || 0), fatG: r1(n.fat_100g || 0) };
  const grams = Number(p.serving_quantity) > 0 && Number(p.serving_quantity) < 2000 ? Number(p.serving_quantity) : null;
  const brand = String(p.brands || '').split(',')[0].trim();
  const base = { name: brand && !norm(name).includes(norm(brand)) ? `${brand} ${name}` : name, brand, code: p.code, per100, source: 'off', category: 'Groceries' };
  if (grams) {
    const k = grams / 100;
    return { ...base, serving: p.serving_size ? `${p.serving_size}` : `${grams} g`, servingGrams: grams, calories: Math.round(per100.calories * k), proteinG: r1(per100.proteinG * k), carbsG: r1(per100.carbsG * k), fatG: r1(per100.fatG * k) };
  }
  return { ...base, serving: '100 g', servingGrams: 100, ...per100 };
}

async function getJson(url, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// Brand-name grocery search (US products first, then worldwide).
export async function searchGroceries(q) {
  const params = `search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
  let products = [];
  try {
    products = (await getJson(`https://us.openfoodfacts.org/cgi/search.pl?${params}`)).products || [];
  } catch { /* try worldwide */ }
  if (products.length < 5) {
    try { products = [...products, ...((await getJson(`https://world.openfoodfacts.org/cgi/search.pl?${params}`)).products || [])]; } catch { /* offline */ }
  }
  const seen = new Set();
  return products.map(fromOff).filter((f) => f && !seen.has(f.code) && seen.add(f.code)).slice(0, 25);
}

export async function lookupBarcode(code) {
  const clean = String(code).replace(/\D/g, '');
  if (clean.length < 6) throw new Error('That barcode looks too short.');
  const j = await getJson(`https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${OFF_FIELDS}`);
  const f = j.status === 1 || j.status === 'success' || j.product ? fromOff({ ...j.product, code: clean }) : null;
  if (!f) throw new Error("That product isn't in the Open Food Facts database yet. Enter it as your own food.");
  return f;
}
