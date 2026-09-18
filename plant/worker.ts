import { pathToFileURL } from 'node:url';
import { runReport } from './adapters/node-reports';
import { runWasmSandbox } from './adapters/node-wasm-sandbox';
import { DriverRegistry, driverModulesFromEnv, loadConnections, loadDriverModules, type ConnectionConfig } from './server/drivers';
import { installBuiltInServerDrivers } from './server/builtin-drivers';
import { AppError, type ReportTask, type WorkerJob, type WorkerJobKind } from './types';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const json=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
async function run(){
  const base=new URL(process.env.SATURN_SERVER_URL??'http://127.0.0.1:4176/plant/worker/');
  const token=process.env.SATURN_WORKER_TOKEN;
  if(!token||token.length<24)throw new Error('SATURN_WORKER_TOKEN must be at least 24 characters');
  const workerId=process.env.SATURN_WORKER_ID??`worker-${process.pid}`;
  const kinds=(process.env.SATURN_WORKER_CAPABILITIES??'report').split(',').map(x=>x.trim()).filter((x):x is WorkerJobKind=>['report','database','wasm'].includes(x));
  if(!kinds.length)throw new Error('No SATURN_WORKER_CAPABILITIES');
  const registry=new DriverRegistry();installBuiltInServerDrivers(registry);await loadDriverModules(registry,driverModulesFromEnv());
  const connections=await loadConnections(process.env.SATURN_CONNECTIONS_FILE);
  const request=async(path:string,body:unknown)=>{
    const response=await fetch(new URL(path,base),{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:json(body),signal:AbortSignal.timeout(35000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error??`HTTP ${response.status}`);return result;
  };
  const execute=async(job:WorkerJob)=>{
    if(job.kind==='report')return runReport((job.payload as any).task as ReportTask);
    if(job.kind==='database'){
      const p=job.payload as any,connection=connections.get(String(p.connection));
      if(!connection)throw new AppError(`Worker connection not configured: ${p.connection}`);
      const driver=registry.get(connection.driver,'database');
      return {rows:await driver.query(connection,{language:String(p.language),query:String(p.query),params:p.params,maxRows:Number(p.maxRows),timeoutMs:Number(p.timeoutMs),readOnly:true})};
    }
    if(job.kind==='wasm')return {value:await runWasmSandbox(job.payload as any)};
    throw new AppError('Unsupported worker job');
  };
  console.log(`Saturn worker ${workerId}: ${kinds.join(', ')}`);
  for(;;){
    let job:WorkerJob|null=null;
    try{job=(await request('claim',{workerId,kinds})).job??null;}
    catch(error){console.error('Worker claim failed:',error);await sleep(2000);continue;}
    if(!job){await sleep(500);continue;}
    try{const result=await execute(job);await request('complete',{jobId:job.id,workerId,result});}
    catch(error){const message=error instanceof Error?error.message:String(error);console.error(job.id,message);try{await request('complete',{jobId:job.id,workerId,error:message});}catch(e){console.error('Worker completion failed:',e);}}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
