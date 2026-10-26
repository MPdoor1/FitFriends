// Bundles src/ (including the Firebase SDK) and copies public/ into dist/ for GitHub Pages.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
writeFileSync('dist/.nojekyll', '');
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: 'es2020',
  outfile: 'dist/app.js',
});
// Give the service worker a new cache name on every build so updates roll out.
const sw = readFileSync('dist/sw.js', 'utf8').replace('__BUILD__', Date.now().toString(36));
writeFileSync('dist/sw.js', sw);
console.log('Built dist/');
