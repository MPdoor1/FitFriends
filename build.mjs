// Bundles src/ (including the Firebase SDK) and copies public/ into dist/ for GitHub Pages.
import { build } from 'esbuild';
import { cpSync, rmSync, writeFileSync } from 'node:fs';

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
console.log('Built dist/');
