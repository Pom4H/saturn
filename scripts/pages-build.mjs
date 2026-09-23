import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

const source = 'dist/plant/site';
const output = 'dist/pages';
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/site`, { recursive: true });
// Reuse the exact server bundle; only the public entry surface differs.
const html = (await readFile(`${source}/index.html`, 'utf8')).replace('name="saturn-shell-mode" content="ide"', 'name="saturn-shell-mode" content="demo"');
await writeFile(`${output}/index.html`, html);
await cp(`${source}/assets`, `${output}/site/assets`, { recursive: true });
await cp(`${source}/saturn-sw.js`, `${output}/saturn-sw.js`);
await writeFile(`${output}/.nojekyll`, '');
console.log('Saturn Pages artifact → dist/pages');
