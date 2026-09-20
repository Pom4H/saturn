import './plant-toolchain-check.mjs';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const raw={name:'showcase-raw',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}};
await build({entryPoints:['plant/server.ts'],outfile:'.plant/showcase-video-server.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[raw]});
await build({entryPoints:['plant/showcase/files.ts'],outfile:'.plant/showcase-video-files.mjs',bundle:true,platform:'node',format:'esm',plugins:[raw]});
const [{startPlantServer},{showcaseFiles}]=await Promise.all([
  import(pathToFileURL(resolve('.plant/showcase-video-server.mjs'))),
  import(pathToFileURL(resolve('.plant/showcase-video-files.mjs'))),
]);
const directory=await mkdtemp(join(tmpdir(),'saturn-hmi-showcase-'));
const password='showcase-demo-2026';
let server;
try{
  server=await startPlantServer({port:0,data:join(directory,'db.sqlite'),repository:join(directory,'project.git'),seed:showcaseFiles,user:'engineer',password});
  const code=await new Promise((resolveCode,reject)=>{
    const child=spawn(process.execPath,['scripts/plant-showcase-video-browser.mjs'],{stdio:'inherit',env:{...process.env,PWA_URL:server.origin+'/plant/',SCADA_PASSWORD:password}});
    child.once('error',reject);child.once('exit',code=>resolveCode(code??1));
  });
  if(code!==0)throw new Error('Showcase browser recording failed');
  const out='showcase-tour',silent=out+'/saturn-hmi-showcase-silent.mp4',narration='plant/showcase/narration.txt';
  let audio=out+'/narration.mp3';
  let tts=spawnSync('python3',['-m','edge_tts','--voice','ru-RU-DmitryNeural','--rate','+6%','--file',narration,'--write-media',audio],{stdio:'inherit'});
  if(tts.status!==0){
    console.warn('edge-tts unavailable, falling back to espeak-ng');
    audio=out+'/narration.wav';
    tts=spawnSync('espeak-ng',['-v','ru','-s','150','-f',narration,'-w',audio],{stdio:'inherit'});
    if(tts.status!==0)throw new Error('No TTS backend available');
  }
  const final=out+'/saturn-hmi-showcase-tts.mp4';
  const mux=spawnSync('ffmpeg',['-y','-i',silent,'-i',audio,'-filter_complex','[1:a]apad[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',final],{stdio:'inherit'});
  if(mux.status!==0)throw new Error('TTS mux failed');
  console.log(final);
}finally{
  await server?.close();await rm(directory,{recursive:true,force:true});
}
