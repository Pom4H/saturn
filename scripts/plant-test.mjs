import { build } from 'esbuild';
import { rawText } from './esbuild-raw-text.mjs';
import { spawnSync } from 'node:child_process';
await Promise.all([\n  build({ entryPoints: ['plant/tests/core.test.ts'], outfile: '.plant/core.test.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', sourcemap: true, plugins: [rawText] }),\n  build({ entryPoints: ['plant/tests/signals.test.ts'], outfile: '.plant/signals.test.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', sourcemap: true, plugins: [rawText] }),\n]);\nconst result = spawnSync(process.execPath, ['--experimental-sqlite', '--test', '.plant/core.test.mjs', '.plant/signals.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
