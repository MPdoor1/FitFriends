// Bundles src/ (including the Firebase SDK) and copies public/ into dist/ for GitHub Pages.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
writeFileSync('dist/.nojekyll', '');
cpSync('node_modules/leaflet/dist/leaflet.css', 'dist/leaflet.css');
cpSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'dist/zxing_reader.wasm');

// Food database: data/*.txt -> dist/foods.json as [name, serving, kcal, protein, carbs, fat, category, brand].
function readFoods(file, restaurants) {
  const rows = [];
  let section = '';
  for (const [n, raw] of readFileSync(file, 'utf8').split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@')) { section = line.slice(1).trim(); continue; }
    if (line.startsWith('#')) { if (!line.includes('|') && !line.startsWith('# Format')) section = line.slice(1).trim(); continue; }
    const parts = line.split('|').map((x) => x.trim());
    const nums = parts.slice(2, 6).map(Number);
    if (parts.length !== 6 || nums.some((x) => !Number.isFinite(x) || x < 0)) throw new Error(`${file}:${n + 1} bad line: ${line}`);
    const [kcal, p, c, f] = nums;
    const est = 4 * p + 4 * c + 9 * f;
    // Alcohol has its own 7 kcal/g, so drinks won't add up from macros.
    if (section !== 'Alcohol' && !/margarita/i.test(parts[0]) && kcal > 40 && Math.abs(est - kcal) > Math.max(60, kcal * 0.25)) console.warn(`check ${file}:${n + 1} ${parts[0]}: ${kcal} kcal vs ${Math.round(est)} from macros`);
    rows.push([parts[0], parts[1], ...nums, restaurants ? 'Restaurants' : section, restaurants ? section : '']);
  }
  return rows;
}
const foods = [...readFoods('data/foods.txt', false), ...readFoods('data/restaurants.txt', true)];
writeFileSync('dist/foods.json', JSON.stringify(foods));
console.log(`${foods.length} foods, ${new Set(foods.filter((f) => f[7]).map((f) => f[7])).size} restaurants`);
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: 'es2020',
  outfile: 'dist/app.js',
});
await build({
  entryPoints: ['src/barcode-entry.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  outfile: 'dist/barcode.js',
});
// Give the service worker a new cache name on every build so updates roll out.
const sw = readFileSync('dist/sw.js', 'utf8').replace('__BUILD__', Date.now().toString(36));
writeFileSync('dist/sw.js', sw);
console.log('Built dist/');
