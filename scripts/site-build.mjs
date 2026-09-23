import { writeDslLibrary } from './dsl-library.mjs';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Keep build scripts compatible with Node 22.16 as declared by the project.
export async function loadSiteModule(name) {
  const result = await build({ entryPoints: [({ starter: "examples/pumping/files.ts", "typescript-example": "examples/pump-bank/files.ts", model: "examples/hydraulic-loop/model.ts", "project-context": "examples/pump-bank/context.ts" })[name] ?? `site/${name}.ts`], bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
}

export async function buildSite(outdir = 'dist/site', mode = 'demo') {
  if (!['demo', 'ide'].includes(mode)) throw new Error('Unknown Saturn shell mode');
  const { starter } = await loadSiteModule('starter');
  const { bankCounts, bankExample } = await loadSiteModule('typescript-example');
  const { projectContext } = await loadSiteModule('project-context');
  const extensionId = process.env.SATURN_VSCODE_EXTENSION_ID ?? '';
  if (extensionId && !/^[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+$/.test(extensionId)) throw new Error('SATURN_VSCODE_EXTENSION_ID must be publisher.extension');
  await rm(`${outdir}/assets`, { recursive: true, force: true });
  await mkdir(`${outdir}/assets`, { recursive: true });
  await writeDslLibrary(`${outdir}/assets/dsl-library.json`);
  await build({ entryPoints: ['examples/diagram/standalone.ts'], outfile: `${outdir}/assets/standalone.js`, bundle: true, format: 'iife', platform: 'browser', minify: true, target: 'es2022' });
  const bundle = await build({ entryPoints: { site: 'site/main.ts' }, metafile: true, entryNames: '[name]-[hash]', bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    outdir: `${outdir}/assets`, chunkNames: '[name]-[hash]', legalComments: 'linked', define: { __VSCODE_EXTENSION__: JSON.stringify(extensionId) } });
  const [entry, metadata] = Object.entries(bundle.metafile.outputs).find(([, metadata]) => metadata.entryPoint === 'site/main.ts');
  const revision = process.env.GITHUB_SHA || `local-${Date.now()}`;
  const html = (await readFile('site/index.html', 'utf8')).replace('./site/assets/site.js', './site/assets/' + basename(entry)).replace('./site/assets/site.css', './site/assets/' + basename(metadata.cssBundle)).replace('</head>', `<meta name="saturn-revision" content="${revision}"><meta name="saturn-shell-mode" content="${mode}"></head>`);
  await writeFile(`${outdir}/index.html`, html);
  await cp('site/mark.svg', `${outdir}/assets/mark.svg`);
  await cp('site/saturn-icon.png', `${outdir}/assets/saturn-icon.png`);
  await cp('docs/plant/self-hosting.md', `${outdir}/assets/server-guide.md`);
  await writeFile(`${outdir}/assets/first-pump.json`, JSON.stringify(starter, null, 2));
  await writeFile(`${outdir}/assets/operator-pump.json`, JSON.stringify({ 'plant.ts': await readFile('examples/operator-pump/src/plant.ts', 'utf8') }, null, 2));
  for (const count of bankCounts) {
    await writeFile(`${outdir}/assets/pump-bank-${count}.json`, JSON.stringify(bankExample(count).files, null, 2));
    await writeFile(`${outdir}/assets/saturn-context-${count}.md`, projectContext(count));
  }
  for (const name of ['manifest.json', 'icon-192.png', 'icon-512.png']) await cp(`site/${name}`, `${outdir}/assets/${name}`);
  // A normal build has a text fallback. The existing browser gate supplies verified captures.
  await writeFile(`${outdir}/assets/landing-proof.json`, JSON.stringify({ available: false, revision }));
  await writeSiteCache(outdir);
  console.log(`Saturn landing built → ${outdir}`);
}

export async function writeSiteCache(outdir) {
  const files = (await readdir(`${outdir}/assets`)).sort();
  const hash = createHash('sha256');
  hash.update(await readFile(`${outdir}/index.html`));
  hash.update(await readFile('site/sw.js'));
  for (const name of files) hash.update(await readFile(`${outdir}/assets/${name}`));
  const assets = ['', ...files.filter(name => /\.(js|css|png|svg|json|md)$/.test(name)).map(name => `site/assets/${name}`)];
  const worker = (await readFile('site/sw.js', 'utf8')).replace('__SATURN_CACHE__', 'saturn-landing-' + hash.digest('hex').slice(0, 16)).replace('__SATURN_ASSETS__', JSON.stringify(assets));
  await writeFile(`${outdir}/saturn-sw.js`, worker);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildSite();
