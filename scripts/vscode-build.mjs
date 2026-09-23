import { build } from 'esbuild';
import { rawText } from './esbuild-raw-text.mjs';
import { mkdir } from 'node:fs/promises';

await mkdir('vscode/dist', { recursive: true });
await build({
  entryPoints: ['vscode/diagram-webview.ts'],
  outfile: 'vscode/dist/diagram-webview.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  plugins: [rawText],
});
console.log('Built Saturn VS Code mnemonic renderer → vscode/dist/diagram-webview.js');
