import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base=(process.env.SATURN_SMOKE_URL??'http://127.0.0.1:4176/plant/').replace(/\/?$/,'/');
const user=process.env.SATURN_SMOKE_USER??'engineer',password=process.env.SATURN_SMOKE_PASSWORD;
if(!password)throw new Error('SATURN_SMOKE_PASSWORD required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function raw(path,{method='GET',cookie,csrf,body}={}){
 const headers={};if(cookie)headers.cookie=cookie;if(csrf)headers['x-csrf-token']=csrf;if(body!==undefined)headers['content-type']='application/json';
 if(method==='POST')headers.origin=new URL(base).origin;
 const r=await fetch(new URL(path,base),{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const text=await r.text();let v;try{v=JSON.parse(text)}catch{v=text}
 if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${text}`);return {r,v};
}
const login=await raw('api/login',{method:'POST',body:{user,password}}),cookie=login.r.headers.get('set-cookie').split(';')[0],csrf=login.v.csrf;
const before=(await raw('api/session',{cookie})).v;
const files={'plant.ts':`
import {project,system,external,derived,signal,alarm,report} from '@scada/plant';
const process=system('process','Live Modbus process');
const temperature=external('TEMP',{connection:'plc-main',address:'holding:0:u16',unit:'C',pollMs:100,history:{deadband:1,maxInterval:1000,retention:60000}});
const scaled=derived('TEMP.scaled',signal('TEMP'),'C');
const hot=alarm('hot',{title:'High temperature',signal:signal('TEMP'),above:900,clearBelow:850,delay:0,notify:false});
const snapshot=report('live-snapshot',{title:'Live snapshot',on:{workflow_dispatch:{}},signals:['TEMP'],window:5000,sql:'SELECT signal,time,value,quality FROM samples ORDER BY time',columns:[{key:'signal',title:'Signal'},{key:'time',title:'Time'},{key:'value',title:'Value'},{key:'quality',title:'Quality'}],notify:false});
export default project('live-smoke',{title:'Live Modbus smoke',description:'Self-hosted deployment verification',systems:[process],sources:[temperature],signals:[scaled],devices:[],alarms:[hot],reports:[snapshot],history:{deadband:1,maxInterval:1000,retention:60000}});
`};
const saved=(await raw('api/save',{method:'POST',cookie,csrf,body:{files,expected:before.head,message:'Self-hosted live Modbus smoke'}})).v;
await raw('api/publish',{method:'POST',cookie,csrf,body:{revision:saved.id,expected:before.desired}});
let first=null,second=null;
for(let i=0;i<50;i++){
 await sleep(120);
 const status=(await raw('api/session',{cookie})).v,s=status.frame.samples.TEMP;
 if(status.mode==='live'&&s?.quality==='good'){if(!first)first={status,s};else if(s.value!==first.s.value){second={status,s};break;}}
}
assert.ok(first,'live Modbus signal never became good');assert.ok(second,'live Modbus signal did not change');
assert.ok(second.status.frame.samples['TEMP.scaled']);assert.equal(second.status.mode,'live');
const evidence={revision:saved.id,first:first.s,second:second.s,derived:second.status.frame.samples['TEMP.scaled'],mode:second.status.mode,seq:second.status.frame.seq};
if(process.env.SATURN_SMOKE_OUTPUT)await writeFile(process.env.SATURN_SMOKE_OUTPUT,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
