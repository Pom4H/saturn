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
import { SaturnDiagnosticError, formatDiagnostic } from '../plant/diagnostics';
import { localizedDslEntity } from '../plant/dsl-i18n';

const invalidDimension = {
  'plant.ts': [
    "import { project, system, simulation } from '@saturn/core';",
    "const root = system('root','Root');",
    "const tank = simulation('TANK','reservoir',{system:'root',at:{x:0,y:0}});",
    "const pump = simulation('PUMP','pump',{system:'root',at:{x:100,y:0},inputs:{voltage:tank.flow}});",
    "export default project('bad',{title:'Bad',description:'',systems:[root],simulations:[tank,pump],signals:[],alarms:[],reports:[]});",
  ].join('\\n'),
};
let mismatch;
try { compileProject(invalidDimension); } catch (error) { mismatch = error; }
assert.ok(mismatch instanceof SaturnDiagnosticError);
assert.equal(mismatch.diagnostic.code, 'SATURN_TYPE_DIMENSION');
assert.match(formatDiagnostic(mismatch.diagnostic, 'ru'), /ожидает размерность voltage/);
assert.match(formatDiagnostic(mismatch.diagnostic, 'en'), /expects dimension voltage/);
assert.equal(mismatch.diagnostic.data?.expectedDimension, 'voltage');
assert.equal(mismatch.diagnostic.data?.actualDimension, 'flow');
assert.equal(mismatch.diagnostic.data?.source?.path, 'plant.ts');

const ruSimulation = localizedDslEntity('simulation', 'ru');
const enSimulation = localizedDslEntity('simulation', 'en');
assert.ok(ruSimulation && enSimulation);
assert.notEqual(ruSimulation.summary, enSimulation.summary);
assert.match(enSimulation.summary, /physical dimension/i);

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
  plugins: [{
    name: 'raw',
    setup(build) {
      build.onResolve({ filter: /\\?raw$/ }, args => ({
        path: new URL(args.path.slice(0, -4), 'file://' + args.resolveDir.replace(/\\\\/g, '/') + '/').pathname,
        namespace: 'raw',
      }));
      build.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({
        contents: await (await import('node:fs/promises')).readFile(args.path, 'utf8'),
        loader: 'text',
      }));
    },
  }],
});
const { spawnSync } = await import('node:child_process');
const result = spawnSync(process.execPath, ['.authoring/check.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
