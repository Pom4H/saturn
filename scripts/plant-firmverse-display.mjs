import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const raw={name:'raw',setup(b){b.onResolve({filter:/\\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
await build({entryPoints:['plant/server.ts'],outfile:'.plant/firmverse-display-server.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[raw]});
const {startPlantServer}=await import(pathToFileURL(join(process.cwd(),'.plant/firmverse-display-server.mjs')));
const directory=await mkdtemp(join(tmpdir(),'saturn-firmverse-display-'));
const password=randomBytes(24).toString('base64url');
let server;
try{
  server=await startPlantServer({port:0,data:join(directory,'db.sqlite'),repository:join(directory,'project.git'),password});
  const code=await new Promise((resolveCode,reject)=>{
    const child=spawn(process.execPath,['scripts/plant-firmverse-display-browser.mjs'],{stdio:'inherit',env:{...process.env,PWA_URL:server.origin+'/plant/'}});
    child.once('error',reject);child.once('exit',code=>resolveCode(code??1));
  });
  if(code!==0)process.exitCode=code;
}finally{
  await server?.close();await rm(directory,{recursive:true,force:true});
}
