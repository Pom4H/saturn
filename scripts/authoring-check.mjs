import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.authoring', { recursive: true });
const source = `
import assert from 'node:assert/strict';
import { compileProject } from '../plant/compiler';
import { demoFiles } from '../plant/demo/files';

const project = compileProject(demoFiles);
const transient = project.reports.find(report => report.id === 'transient');
assert.ok(transient);
assert.deepEqual(transient.signals, ['core.temperature']);
assert.deepEqual(transient.schema, [
  { key: 'time', type: 'number', unit: 'ms' },
  { key: 'temperature', type: 'number', unit: 'отн.' },
]);
assert.equal(transient.excel?.sheets[0]?.name, 'Температура');
assert.equal(transient.excel?.sheets[0]?.sort?.[0]?.key, 'time');
assert.equal(transient.excel?.sheets[0]?.autoFilter, true);
const bench = project.reports.find(report => report.id === 'bench-state');
assert.deepEqual(bench?.signals, ['SATURN-1.AI1', 'SATURN-1.DO1']);
console.log('Saturn typed authoring smoke passed');
`;
await writeFile('.authoring/check.ts', source);
await build({
  entryPoints: ['.authoring/check.ts'],
  outfile: '.authoring/check.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
});
const { spawnSync } = await import('node:child_process');
const result = spawnSync(process.execPath, ['.authoring/check.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
