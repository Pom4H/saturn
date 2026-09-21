import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { build } from 'esbuild';

for (const file of ['scripts/saturn.mjs', 'vscode/extension.cjs', 'vscode/lib/model.cjs']) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0)
        process.exit(result.status ?? 1);
}

await build({
    entryPoints: ['standalone/entry.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'warning',
    external: ['bun:*'],
});

const source = await readFile('vscode/diagram-webview.ts', 'utf8');
const host = await readFile('vscode/extension.cjs', 'utf8');
if (!source.includes("import { SceneView } from '../src/view'") || !source.includes("import { installEquipment } from '../plant/equipment'"))
    throw new Error('VS Code mnemonic must reuse Saturn SceneView and installed equipment renderers');
if (host.includes('<iframe') || host.includes('const make=(name,attrs'))
    throw new Error('VS Code mnemonic must not embed Saturn IDE or keep a parallel generic SVG renderer');

const bundle = await stat('vscode/dist/diagram-webview.js');
if (!bundle.isFile() || bundle.size < 10_000)
    throw new Error('VS Code mnemonic bundle is missing or unexpectedly small');
