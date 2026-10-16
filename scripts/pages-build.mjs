import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

const source = 'dist/plant/site';
const output = 'dist/pages';
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/site`, { recursive: true });
await mkdir(`${output}/plant`, { recursive: true });
// Reuse the exact server bundle; only the public entry surface differs.
const html = (await readFile(`${source}/index.html`, 'utf8')).replace('name="saturn-shell-mode" content="ide"', 'name="saturn-shell-mode" content="demo"');
await writeFile(`${output}/index.html`, html);
await cp(`${source}/assets`, `${output}/site/assets`, { recursive: true });
await cp(`${source}/saturn-sw.js`, `${output}/saturn-sw.js`);
// Publish the same browser runtime built by plant:build so the landing embeds a live product, not screenshots.
await cp('dist/plant/demo', `${output}/plant/demo`, { recursive: true });
await cp('dist/plant/assets', `${output}/plant/assets`, { recursive: true });
await cp('dist/plant/manifest.webmanifest', `${output}/plant/manifest.webmanifest`);
await cp('dist/plant/sw.js', `${output}/plant/sw.js`);
await writeFile(`${output}/.nojekyll`, '');
console.log('Saturn Pages artifact → dist/pages');
