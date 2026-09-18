import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
const root=new URL('../plant/vendor/firmverse/',import.meta.url);
const code=stripTypeScriptTypes(await readFile(new URL('binaries.ts',root),'utf8'));
const assets=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
for(const name of ['compiler','runtime']){
  const bytes=Buffer.from(assets[name+'Base64'],'base64');
  assert.equal(bytes.length,manifest.assets[name].bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.assets[name].sha256);
  assert.equal(assets[name+'Hash'],manifest.assets[name].sha256);
}
console.log('Pinned Firmverse compiler/runtime asset hashes verified.');
