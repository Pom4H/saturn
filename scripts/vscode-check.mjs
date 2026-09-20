import { spawnSync } from 'node:child_process';
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
