import { build } from 'esbuild';
import { rawText } from './esbuild-raw-text.mjs';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['plant/tests/core.test.ts'], outfile: '.plant/core.test.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', sourcemap: true, plugins: [rawText] });
const result = spawnSync(process.execPath, ['--experimental-sqlite', '--test', '.plant/core.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
