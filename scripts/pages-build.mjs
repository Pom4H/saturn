import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const source = 'dist/plant/site';
const output = 'dist/pages';
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/site`, { recursive: true });
await cp(`${source}/index.html`, `${output}/index.html`);
await cp(`${source}/assets`, `${output}/site/assets`, { recursive: true });
await cp(`${source}/saturn-sw.js`, `${output}/saturn-sw.js`);
await writeFile(`${output}/.nojekyll`, '');
console.log('Saturn Pages artifact → dist/pages');
