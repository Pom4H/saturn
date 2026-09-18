import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['plant/tests/core.test.ts'], outfile: '.plant/core.test.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', sourcemap: true, plugins: [{ name: 'raw', setup(b) { b.onResolve({ filter: /\?raw$/ }, a => ({ path: new URL(a.path.slice(0, -4), `file://${a.resolveDir}/`).pathname, namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' })); } }] });
const result = spawnSync(process.execPath, ['--experimental-sqlite', '--test', '.plant/core.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
