import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join, delimiter, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

const root=process.cwd(),temp=process.env.RUNNER_TEMP??tmpdir();
const evidence=process.env.EVIDENCE??join(temp,'saturn-target-evidence');
await rm(evidence,{recursive:true,force:true});await mkdir(evidence,{recursive:true});
const password=randomBytes(18).toString('base64url'),reportToken=randomBytes(24).toString('base64url');
const npm='npm';
const command=(cmd,args=[])=>process.platform==='win32'&&cmd==='npm'?{cmd:'cmd.exe',args:['/d','/s','/c','npm',...args]}:{cmd,args};

function findGit(){
  const probe=spawnSync(process.platform==='win32'?'where.exe':'which',['git'],{encoding:'utf8'});
  if(probe.status===0)return dirname(probe.stdout.trim().split(/\r?\n/)[0]);
  if(process.platform==='win32'){
    const candidates=[
      'C:\\Program Files\\Git\\cmd','C:\\Program Files\\Git\\bin','C:\\Program Files (x86)\\Git\\cmd',
      'C:\\tools\\Git\\cmd','C:\\tools\\git\\cmd',
      join(process.env.LOCALAPPDATA??'','Programs','Git','cmd'),
      join(process.env.USERPROFILE??'','scoop','apps','git','current','cmd'),
    ];
    for(const hive of ['HKLM\\SOFTWARE\\GitForWindows','HKCU\\SOFTWARE\\GitForWindows']){
      const reg=spawnSync('reg.exe',['query',hive,'/v','InstallPath'],{encoding:'utf8'});
      const path=/InstallPath\s+REG_SZ\s+(.+)$/mi.exec(reg.stdout??'')?.[1]?.trim();if(path)candidates.push(join(path,'cmd'),join(path,'bin'));
    }
    const desktop=join(process.env.LOCALAPPDATA??'','GitHubDesktop');
    if(existsSync(desktop)){
      const scan=spawnSync('cmd.exe',['/d','/s','/c',`dir /b /ad "${desktop}\\app-*"`],{encoding:'utf8'});
      for(const name of (scan.stdout??'').split(/\r?\n/).filter(Boolean))candidates.push(join(desktop,name,'resources','app','git','cmd'));
    }
    for(const dir of candidates)if(existsSync(join(dir,'git.exe')))return dir;
  }
  return null;
}
async function portableGit(){
  if(process.platform!=='win32'||process.arch!=='x64')return null;
  const dir=join(temp,'saturn-mingit-2.55.0.5'),exe=join(dir,'cmd','git.exe');
  if(existsSync(exe))return join(dir,'cmd');
  const zip=join(temp,'saturn-mingit-2.55.0.5.zip');
  const url='https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip';
  const expected='56d7b226b7693196cfc71fef26568f536c4a021ab6c37ff2db4287bed908e96e';
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`MinGit download failed: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer()),actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==expected)throw new Error(`MinGit digest mismatch: ${actual}`);
  await writeFile(zip,bytes);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
  const expand=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`Expand-Archive -LiteralPath '${zip.replaceAll("'","''")}' -DestinationPath '${dir.replaceAll("'","''")}' -Force`],{encoding:'utf8'});
  if(expand.status!==0||!existsSync(exe))throw new Error(`MinGit extraction failed: ${expand.stderr||expand.stdout}`);
  return join(dir,'cmd');
}
let gitDir=findGit(),gitSource='system';
if(!gitDir){gitDir=await portableGit();gitSource=gitDir?'portable-ci':'missing';}
if(gitDir)process.env.PATH=gitDir+delimiter+process.env.PATH;

function version(cmd,args=[]){
  const spec=command(cmd,args),r=spawnSync(spec.cmd,spec.args,{encoding:'utf8',shell:false});
  return r.error?`unavailable: ${r.error.message}`:(r.stdout||r.stderr||'').trim()||`exit ${r.status}`;
}
await writeFile(join(evidence,'environment.txt'),[
  `runner_name=${process.env.RUNNER_NAME??'local'}`,
  `runner_os=${process.env.RUNNER_OS??process.platform}`,
  `runner_arch=${process.env.RUNNER_ARCH??process.arch}`,
  `platform=${process.platform} ${process.arch}`,
  `node=${process.version}`,
  `npm=${version(npm,['--version'])}`,
  `bun=${version('bun',['--version'])}`,
  `git=${version('git',['--version'])}`,
  `git_source=${gitSource}`,
  `docker=${version('docker',['--version'])}`,
  `docker_compose=${version('docker',['compose','version'])}`,
].join('\n')+'\n');
process.stdout.write(await readFile(join(evidence,'environment.txt'),'utf8'));
if(!gitDir)throw new Error('Git executable is required by the production project repository but was not found on the runner');

async function run(cmd,args,options={}){
  const log=options.log?createWriteStream(options.log):null,spec=command(cmd,args);
  const child=spawn(spec.cmd,spec.args,{cwd:root,env:{...process.env,...options.env},stdio:log?['ignore','pipe','pipe']:'inherit',shell:false});
  if(log){child.stdout.pipe(log);child.stderr.pipe(log);}
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?128:1)));});
  log?.end();
  if(code!==0)throw new Error(`${cmd} ${args.join(' ')} exited ${code}`);
}
function background(cmd,args,{env={},log}={}){
  const stream=createWriteStream(log);
  const child=spawn(cmd,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],shell:false});
  child.stdout.pipe(stream);child.stderr.pipe(stream);child.once('exit',()=>stream.end());
  return child;
}
async function stop(children){for(const child of children.filter(Boolean)){if(child.exitCode===null)child.kill();}await Promise.all(children.filter(Boolean).map(child=>new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,1500).unref();})));}
async function waitHealth(url,timeout=30000){
  const end=Date.now()+timeout;let last='';
  while(Date.now()<end){
    try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});last=await r.text();if(r.ok)return last;}catch(e){last=String(e);}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error(`Health timeout ${url}: ${last}`);
}
async function smoke(script,url,out,extra={}){
  await run(process.execPath,[script],{env:{SATURN_SMOKE_URL:url,SATURN_SMOKE_PASSWORD:password,SATURN_SMOKE_OUTPUT:out,...extra}});
}

await run(npm,['ci'],{log:join(evidence,'npm-ci.log')});
await run(npm,['run','plant:check'],{log:join(evidence,'plant-check.log')});
await run(process.execPath,['scripts/plant-build.mjs'],{log:join(evidence,'build.log')});

async function nodeTarget(){
  const dir=join(temp,'saturn-node-target');await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
  const connections=join(dir,'connections.json');await writeFile(connections,JSON.stringify({connections:[{id:'plc-main',driver:'modbus-tcp',readOnly:false,options:{host:'127.0.0.1',port:15020,unitId:1,timeoutMs:1000}}]}));
  const children=[];
  try{
    const modbus=background(process.execPath,['scripts/self-hosted-modbus-server.mjs'],{env:{MODBUS_PORT:'15020',MODBUS_STATS:join(evidence,'node-modbus-stats.json')},log:join(evidence,'node-modbus.log')});children.push(modbus);
    const server=background(process.execPath,['--experimental-sqlite','.plant/server.mjs'],{env:{HOST:'127.0.0.1',PORT:'4176',SATURN_DATABASE:join(dir,'saturn.sqlite3'),SATURN_PROJECT_REPO:join(dir,'project.git'),SATURN_PASSWORD:password,SATURN_CONNECTIONS_FILE:connections,SATURN_WORKERS:'external',SATURN_WORKER_TOKENS:JSON.stringify({[reportToken]:['report']})},log:join(evidence,'node-server.log')});children.push(server);
    await writeFile(join(evidence,'node-health.json'),await waitHealth('http://127.0.0.1:4176/plant/api/health')+'\n');
    const worker=background(process.execPath,['.plant/worker.mjs'],{env:{SATURN_SERVER_URL:'http://127.0.0.1:4176/plant/worker/',SATURN_WORKER_TOKEN:reportToken,SATURN_WORKER_CAPABILITIES:'report',SATURN_WORKER_ID:'self-hosted-report-1'},log:join(evidence,'report-worker.log')});children.push(worker);
    await smoke('scripts/self-hosted-server-smoke.mjs','http://127.0.0.1:4176/plant/',join(evidence,'node-demo-signals.json'));
    await smoke('scripts/self-hosted-live-smoke.mjs','http://127.0.0.1:4176/plant/',join(evidence,'node-live-modbus.json'));
  }finally{await stop(children);}
}
async function bunTarget(){
  if(version('bun',['--version']).startsWith('unavailable')){await writeFile(join(evidence,'bun-skipped.txt'),'Bun unavailable\n');return;}
  const dir=join(temp,'saturn-bun-target');await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
  const connections=join(dir,'connections.json');await writeFile(connections,JSON.stringify({connections:[{id:'plc-main',driver:'modbus-tcp',readOnly:false,options:{host:'127.0.0.1',port:15021,unitId:1,timeoutMs:1000}}]}));
  const children=[];
  try{
    children.push(background(process.execPath,['scripts/self-hosted-modbus-server.mjs'],{env:{MODBUS_PORT:'15021',MODBUS_STATS:join(evidence,'bun-modbus-stats.json')},log:join(evidence,'bun-modbus.log')}));
    children.push(background('bun',['.plant/server.mjs'],{env:{HOST:'127.0.0.1',PORT:'4177',SATURN_DATABASE:join(dir,'saturn.sqlite3'),SATURN_PROJECT_REPO:join(dir,'project.git'),SATURN_PASSWORD:password,SATURN_CONNECTIONS_FILE:connections},log:join(evidence,'bun-server.log')}));
    await writeFile(join(evidence,'bun-health.json'),await waitHealth('http://127.0.0.1:4177/plant/api/health')+'\n');
    await smoke('scripts/self-hosted-server-smoke.mjs','http://127.0.0.1:4177/plant/',join(evidence,'bun-demo-signals.json'));
    await smoke('scripts/self-hosted-live-smoke.mjs','http://127.0.0.1:4177/plant/',join(evidence,'bun-live-modbus.json'));
  }finally{await stop(children);}
}
async function dockerTarget(){
  const docker=spawnSync('docker',['compose','version'],{encoding:'utf8'});
  if(docker.error||docker.status!==0){await writeFile(join(evidence,'docker-skipped.txt'),'Docker Compose unavailable on runner\n');return;}
  const project=`saturn-target-${process.env.GITHUB_RUN_ID??'local'}`,env={...process.env,SATURN_PORT:'4178',SATURN_PASSWORD:password};
  try{
    await run('docker',['compose','-f','compose.yaml','-f','compose.workers.yaml','config'],{env,log:join(evidence,'compose-workers-rendered.txt')});
    await run('docker',['compose','-p',project,'build','saturn'],{env,log:join(evidence,'docker-build.log')});
    await run('docker',['compose','-p',project,'up','-d','saturn'],{env,log:join(evidence,'docker-up.log')});
    await writeFile(join(evidence,'docker-health.json'),await waitHealth('http://127.0.0.1:4178/plant/api/health',60000)+'\n');
    await smoke('scripts/self-hosted-server-smoke.mjs','http://127.0.0.1:4178/plant/',join(evidence,'docker-demo-signals.json'));
    await run('docker',['compose','-p',project,'ps'],{env,log:join(evidence,'docker-ps.txt')});
  }finally{
    spawnSync('docker',['compose','-p',project,'down','-v','--remove-orphans'],{env,encoding:'utf8'});
  }
}

await nodeTarget();
await bunTarget();
await dockerTarget();
console.log(`Saturn target verification complete: ${evidence}`);
