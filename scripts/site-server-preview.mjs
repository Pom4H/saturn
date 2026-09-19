import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildSite } from './site-build.mjs';

// Separate local installation: never uses the user's runtime database or Git repository.
const directory = resolve('.plant/navigator-preview');
await mkdir(directory, { recursive: true });
const raw = { name: 'raw', setup(b) {
  b.onResolve({ filter: /\?raw$/ }, a => ({ path: resolve(a.resolveDir, a.path.slice(0, -4)), namespace: 'raw' }));
  b.onLoad({ filter: /.*/, namespace: 'raw' }, async a => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }));
} };
await build({ stdin: { contents: `export { startPlantServer } from './plant/server'; export { demoFiles } from './plant/demo/files'; export { GitRepository } from './plant/adapters/git'; export { compileProject } from './plant/compiler';`, resolveDir: process.cwd(), loader: 'ts' }, outfile: directory + '/server.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [raw] });
await buildSite('dist/plant/site');
const { startPlantServer, demoFiles, GitRepository, compileProject } = await import(pathToFileURL(directory + '/server.mjs'));
const repository = await new GitRepository(directory + '/project.git').initialize();
if (!await repository.head()) {
  const destination = path => path === 'plant.ts' ? path : path === 'views.ts' ? 'views/operator.ts' : path === 'reports.ts' ? 'reports/definitions.ts' : ['commissioning.ts', 'wiring.ts'].includes(path) ? 'controllers/' + path : 'systems/' + path;
  const files = {};
  for (const [path, source] of Object.entries(demoFiles)) {
    const target = destination(path);
    files[target] = source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, before, imported, after) => {
      const resolved = posix.normalize(posix.join(posix.dirname(path), imported)) + (imported.endsWith('.ts') ? '' : '.ts');
      let relative = posix.relative(posix.dirname(target), destination(resolved)).replace(/\.ts$/, '');
      if (!relative.startsWith('.')) relative = './' + relative;
      return before + relative + after;
    });
  }
  files['README.md'] = '# Серверная установка\n\nИсходники получены из Git-ревизии локального Node-сервера.\n\nКаталоги: systems — технологические системы; controllers — контроллеры и связи; views — операторские экраны; reports — отчёты.\n';
  files['docs/operations/README.md'] = '# Работа с проектом\n\nИзменения в Shell пока хранятся в памяти. Скопируйте проект или скачайте JSON перед закрытием.\n';
  files['config/site.json'] = '{\n  "name": "Энергоблок A",\n  "environment": "local-verification"\n}\n';
  compileProject(files);
  const initial = await repository.commit(files, null, 'Server project organized by systems, controllers, views and reports', 'engineer');
  await repository.publish(initial.id, null);
}
let password;
try { password = (await readFile(directory + '/password', 'utf8')).trim(); }
catch { password = randomBytes(24).toString('base64url'); await writeFile(directory + '/password', password, { mode: 0o600 }); }
const port = Number(process.env.SATURN_NAVIGATOR_PORT ?? 4196);
const app = await startPlantServer({ port, publicUrl: `http://localhost:${port}`, data: directory + '/db.sqlite', repository: directory + '/project.git', password, autoTick: true });
console.log(`Navigator server: ${app.origin}/?project=server#workspace (${app.service.project.devices.length} devices). Login: engineer; password file: .plant/navigator-preview/password`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
