import './plant-toolchain-check.mjs';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const raw={name:'showcase-raw',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
await build({entryPoints:['plant/server.ts'],outfile:'.plant/showcase-server.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[raw]});
await build({entryPoints:['plant/showcase/files.ts'],outfile:'.plant/showcase-files.mjs',bundle:true,platform:'node',format:'esm',plugins:[raw]});
const [{startPlantServer},{showcaseFiles}]=await Promise.all([
  import(pathToFileURL(resolve('.plant/showcase-server.mjs'))),
  import(pathToFileURL(resolve('.plant/showcase-files.mjs'))),
]);
const password=process.env.SCADA_PASSWORD??'showcase';
const server=await startPlantServer({port:Number(process.env.PORT??4177),seed:showcaseFiles,user:'engineer',password});
console.log('Saturn HMI showcase:',server.origin+'/plant/');
console.log('Login: engineer / '+password);
const stop=async()=>{await server.close();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
await new Promise(()=>{});
