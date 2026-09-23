import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = resolve(process.argv[2] ?? '.saturn-c23');
const controllerId = process.argv[3] ?? 'SATURN-1';
const runner = resolve('.saturn-c23-emit.mjs');
const demoFiles = [
  'views.ts','commissioning.ts','wiring.ts','plant.ts','core.ts','cooling.ts',
  'steam.ts','safety.ts','reports.ts','auxiliary.ts','services.ts','training.ts',
];

const entry = `
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildArtifact } from './plant/artifact.ts';
import { saturnPlcC23Source } from './plant/targets/saturn-plc-c23.ts';

const outDir = ${JSON.stringify(outDir)};
const controllerId = ${JSON.stringify(controllerId)};
const names = ${JSON.stringify(demoFiles)};
const files = {};
for (const name of names) files[name] = await readFile(join('plant/demo', name), 'utf8');
const artifact = await buildArtifact(files, { packageName: '@saturn/demo-c23' });
const source = saturnPlcC23Source(artifact, controllerId);
await mkdir(outDir, { recursive: true });
for (const [name, content] of Object.entries(source.files)) await writeFile(join(outDir, name), content);
await writeFile(join(outDir, 'manifest.json'), JSON.stringify({
  schema: source.schema,
  controllerId: source.controllerId,
  presentation: {
    schema: source.presentation.schema,
    abi: source.presentation.abi,
    viewId: source.presentation.viewId,
    signals: source.presentation.signals,
  },
  shell: { schema: source.shell.schema, pages: source.shell.pages },
  files: Object.keys(source.files).sort(),
}, null, 2));
`;

await rm(outDir, { recursive: true, force: true });
await writeFile(runner, entry);
try {
  await build({
    entryPoints: [runner],
    outfile: runner + '.bundle.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    logLevel: 'warning',
  });
  await import(pathToFileURL(runner + '.bundle.mjs').href + '?v=' + Date.now());
} finally {
  await rm(runner, { force: true });
  await rm(runner + '.bundle.mjs', { force: true });
}
console.log('Generated Saturn C23 target source in ' + outDir);
