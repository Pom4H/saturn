import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base=(process.env.SATURN_SMOKE_URL??'http://127.0.0.1:4176/plant/').replace(/\/?$/,'/');
const user=process.env.SATURN_SMOKE_USER??'engineer';
const password=process.env.SATURN_SMOKE_PASSWORD;
if(!password)throw new Error('SATURN_SMOKE_PASSWORD is required');
const out=process.env.SATURN_SMOKE_OUTPUT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function request(path,{method='GET',cookie,csrf,body}={}){
  const headers={};
  if(cookie)headers.cookie=cookie;
  if(csrf)headers['x-csrf-token']=csrf;
  if(body!==undefined)headers['content-type']='application/json';
  const response=await fetch(new URL(path,base),{
    method,headers,body:body===undefined?undefined:JSON.stringify(body),
    ...(method==='POST'?{headers:{...headers,origin:new URL(base).origin}}:{}),
    signal:AbortSignal.timeout(15000),
  });
  const text=await response.text();
  let value;try{value=text?JSON.parse(text):null;}catch{value=text;}
  if(!response.ok)throw new Error(`${method} ${path}: HTTP ${response.status}: ${typeof value==='string'?value:JSON.stringify(value)}`);
  return {response,value};
}
const login=await request('api/login',{method:'POST',body:{user,password}});
const cookie=login.response.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie,'login did not set session cookie');
const csrf=login.value.csrf;
const first=(await request('api/session',{cookie})).value;
assert.ok(first.frame?.seq>=0);
assert.ok(Object.keys(first.frame.samples??{}).length>=10,'expected runtime signals');
await sleep(450);
const second=(await request('api/session',{cookie})).value;
assert.ok(second.frame.seq>first.frame.seq,'server model clock did not advance');
for(const name of ['GRID.voltage','core.temperature','SATURN-1.powered']){
  const sample=second.frame.samples[name];assert.ok(sample,`missing ${name}`);assert.ok(['good','bad'].includes(sample.quality));
}
const stream=await fetch(new URL('api/stream',base),{headers:{cookie},signal:AbortSignal.timeout(5000)});
assert.equal(stream.status,200);const reader=stream.body.getReader();const chunk=new TextDecoder().decode((await reader.read()).value);await reader.cancel();
assert.match(chunk,/event: frame/);

let report=null;
if(process.env.SATURN_SMOKE_REPORT!=='0'){
  const reportId=second.project.reports.find(r=>r.on?.workflow_dispatch)?.id;
  assert.ok(reportId,'no manual report in demo project');
  const queued=(await request('api/report',{method:'POST',cookie,csrf,body:{reportId,inputs:{}}})).value;
  for(let i=0;i<60;i++){
    await sleep(250);
    const runs=(await request('api/reports',{cookie})).value;
    report=runs.find(r=>r.id===queued.id);
    if(report?.status==='success')break;
    if(report?.status==='failure')throw new Error(`report worker failed: ${report.error}`);
  }
  assert.equal(report?.status,'success','report did not finish');
}
const evidence={
  base,
  runtime:first.mode,
  actor:first.actor,
  capabilities:first.capabilities,
  first:{seq:first.frame.seq,time:first.frame.time,signals:Object.keys(first.frame.samples).length},
  second:{seq:second.frame.seq,time:second.frame.time,samples:Object.fromEntries(['GRID.voltage','core.temperature','SATURN-1.powered'].map(k=>[k,second.frame.samples[k]]))},
  sse:chunk.slice(0,300),
  report,
};
if(out)await writeFile(out,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
