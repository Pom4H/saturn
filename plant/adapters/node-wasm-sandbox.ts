import { fork } from 'node:child_process';
import { AppError } from '../types';

export interface WasmSandboxTask {module:string;export:string;args:number[];timeoutMs:number}
export function runWasmSandbox(task:WasmSandboxTask):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    const child=fork(new URL('./wasm-sandbox-worker.mjs',import.meta.url),[],{
      execArgv:['--max-old-space-size=64'],
      stdio:['ignore','ignore','ignore','ipc'],
      serialization:'advanced',
      env:{NODE_NO_WARNINGS:'1'},
    });
    let settled=false;
    const done=(error?:unknown,result?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');
      error?reject(error):resolve(result);
    };
    const timer=setTimeout(()=>done(new AppError('WASM sandbox timeout',504)),task.timeoutMs);
    child.once('message',(m:any)=>done(m?.error?new AppError(String(m.error)):undefined,m?.result));
    child.once('error',done);
    child.once('exit',code=>{if(!settled)done(new AppError(`WASM sandbox exited (${code})`));});
    child.send({module:task.module,export:task.export,args:task.args},error=>{if(error)done(error);});
  });
}
