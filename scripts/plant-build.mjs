import './plant-toolchain-check.mjs';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildSite } from './site-build.mjs';
const raw = { name: 'project-source', setup(b) { b.onResolve({ filter: /\?raw$/ }, a => ({ path: resolve(a.resolveDir, a.path.slice(0, -4)), namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' })); } };
export const options = { bundle: true, format: 'esm', target: 'es2022', sourcemap: true, plugins: [raw] };
await mkdir('.plant', { recursive: true });
await build({ ...options, entryPoints: ['plant/cli.ts'], outfile: '.plant/server.mjs', platform: 'node', packages: 'external' });
await build({ ...options, entryPoints: ['plant/adapters/node-report-worker.ts'], outfile: '.plant/report-worker.mjs', platform: 'node', packages: 'external' });
if (process.argv.includes('--server'))
    process.exit(0);
await rm('dist/plant/assets', { recursive: true, force: true });
await mkdir('dist/plant/assets', { recursive: true });
await build({ ...options, entryPoints: { app: 'plant/web/main.ts', worker: 'plant/adapters/browser-worker.ts', 'browser-report-worker': 'plant/adapters/browser-report-worker.ts', login: 'plant/web/login.ts' }, outdir: 'dist/plant/assets', platform: 'browser', minify: true, sourcemap: false, legalComments: 'linked', splitting: true, chunkNames: 'chunks/[name]-[hash]', loader: { '.wasm': 'file' } });
await cp('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', 'dist/plant/assets/sqlite3.wasm');
await cp('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', 'dist/plant/assets/chunks/sqlite3.wasm');
await writeFile('dist/plant/assets/THIRD-PARTY.txt', 'Saturn profile adapted from Pom4H/open-device 007ada38d2cce27b37413f38952ca11b919842c1\n\n'+await readFile('plant/vendor/saturn/LICENSE','utf8')+'\n\nFBD WASM runtime\n'+await readFile('plant/vendor/saturn/RUNTIME-LICENSE','utf8')+'\n\nFirmverse portable Saturn package\n'+await readFile('plant/vendor/firmverse/LICENSE','utf8')+'\n\n'+await readFile('plant/vendor/firmverse/RUNTIME_LICENSE','utf8'));
await cp('plant/web/app.css', 'dist/plant/assets/app.css');
await cp('plant/web/manifest.webmanifest', 'dist/plant/manifest.webmanifest');
await cp('plant/web/icon.svg', 'dist/plant/assets/icon.svg');
await mkdir('dist/plant/demo', { recursive: true });
const html = await readFile('plant/web/index.html', 'utf8');
await writeFile('dist/plant/index.html', html);
await writeFile('dist/plant/demo/index.html', html);
for (const size of [192, 512])
    await cp(`plant/web/icon-${size}.png`, `dist/plant/assets/icon-${size}.png`);
const manifest = JSON.parse(await readFile('plant/web/manifest.webmanifest', 'utf8'));
manifest.id = '../demo/';
manifest.start_url = './';
manifest.scope = '../';
for (const icon of manifest.icons)
    icon.src = '.' + icon.src;
await writeFile('dist/plant/demo/manifest.webmanifest', JSON.stringify(manifest));
const assets = ['demo/', 'demo/manifest.webmanifest', ...(await readdir('dist/plant/assets', { recursive: true })).filter(p => /\.(js|css|wasm|svg|png|txt)$/.test(p)).map(p => 'assets/' + p.replaceAll('\\', '/'))];
const hash = createHash('sha256');
for (const asset of assets)
    hash.update(await readFile('dist/plant/' + (asset === 'demo/' ? 'demo/index.html' : asset)));
const sw = (await readFile('plant/web/sw.js', 'utf8')).replace('__VERSION__', hash.digest('hex').slice(0, 16)).replace('__ASSETS__', JSON.stringify(assets));
await writeFile('dist/plant/sw.js', sw);
console.log('Built Bun server and installable /plant/demo/');
await buildSite('dist/plant/site');

await cp('LICENSE', 'dist/plant/LICENSE');
await cp('catalog/licenses/drawio-Apache-2.0.txt', 'dist/plant/Apache-2.0.txt');
await writeFile('dist/plant/THIRD-PARTY-NOTICES.txt', 'SCADA Plant: MIT, Roman Popov.\n@typescript/typescript6 and @sqlite.org/sqlite-wasm npm distribution: Apache-2.0.\nSQLite core: public domain; WASM glue notices are retained in assets/*.LEGAL.txt and assets/chunks/*.LEGAL.txt.\nCodeMirror, Lezer and Three.js: MIT; bundled copyright notices are retained alongside JavaScript files.\nSee the lockfile in the source release for exact dependency versions.\n');
