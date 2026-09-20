import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
const tests = ['core', 'hmi'];
for (const name of tests) {
  await build({ entryPoints:[`tests/${name}.test.ts`], outfile:`.test/${name}.test.mjs`, bundle:true, platform:'node', format:'esm', packages:'external', target:'es2022' });
}
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => `.test/${name}.test.mjs`)], {stdio:'inherit'});
process.exit(result.status ?? 1);
