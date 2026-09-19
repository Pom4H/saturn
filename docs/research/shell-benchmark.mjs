/** Run from the Saturn checkout: node docs/research/shell-benchmark.mjs /path/to/isolated/dependencies */
import { build, version } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Provide the directory containing the isolated research node_modules');
const dependencyDirectory = resolve(process.argv[2]);
const cases = {
  dockview: `export { createDockview } from 'dockview'; import 'dockview/dist/styles/dockview.css';`,
  luminoDock: `export { DockPanel, Widget } from '@lumino/widgets'; import '@lumino/widgets/style/index.css'; import '@lumino/default-theme/style/index.css';`,
  luminoShell: `export { DockPanel, Widget, SplitPanel, CommandPalette, Menu, MenuBar } from '@lumino/widgets'; export { CommandRegistry } from '@lumino/commands'; import '@lumino/widgets/style/index.css'; import '@lumino/default-theme/style/index.css';`,
  goldenLayout: `export { GoldenLayout } from 'golden-layout'; import 'golden-layout/dist/css/goldenlayout-base.css'; import 'golden-layout/dist/css/themes/goldenlayout-light-theme.css';`,
};
const lock = JSON.parse(await readFile(resolve(dependencyDirectory, 'package-lock.json'), 'utf8'));
const packages = Object.fromEntries(Object.entries(lock.packages).filter(([key]) => key.startsWith('node_modules/')).map(([key, value]) => [key.slice('node_modules/'.length), value.version]));
const measurements = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  esbuild: version,
  method: 'browser ESM ES2022; minify; named exports retained; gzip level 9; library CSS/themes; PNG data URLs; legal comments excluded; no application, editor, renderer or HTML',
  packages,
  cases: {},
};
for (const [name, contents] of Object.entries(cases)) {
  const result = await build({
    stdin: { contents, loader: 'ts', sourcefile: `${name}.ts`, resolveDir: dependencyDirectory },
    absWorkingDir: dependencyDirectory,
    bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
    outdir: `out/${name}`, write: false, metafile: true, legalComments: 'none', loader: { '.png': 'dataurl' },
  });
  measurements.cases[name] = {
    sizes: result.outputFiles.map(file => ({ type: file.path.split('.').at(-1), bytes: file.contents.length, gzipBytes: gzipSync(file.contents, { level: 9 }).length })),
    modules: Object.keys(result.metafile.inputs).length,
  };
}
const output = JSON.stringify(measurements, null, 2) + '\n';
if (process.argv[3]) await writeFile(resolve(process.argv[3]), output);
process.stdout.write(output);
