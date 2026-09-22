import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject, validateProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { terminals, resolvePort, validateConnections, footprint } from '../ports';
import { routeConnections } from '../routing';
import { compileController, ControllerVM } from '../controller';
import { Kernel } from '../kernel';
import { SATURN_TERMINAL_ANCHORS, SATURN_SERVICE_ANCHORS } from '../vendor/saturn/src/view';
import { fbdCrc32 } from '../vendor/saturn/src/format';
import { appendConnection, addExpansionSource, removeConnection } from '../connection-edit';
import { createPlantModel } from '../visual3d';
import * as THREE from 'three';
import { diagnostic } from './diagnostic';
const project=()=>compileProject(demoFiles);
test('physical connections use exact installed anchors and all demo routes avoid equipment',()=>{
 const p=project(),routes=routeConnections(p);assert.equal(routes.length,p.connections!.length);console.log('routes',routes.length,routes.filter(r=>!r.valid));
 for(const r of routes){assert.equal(r.valid,true,r.id+':'+r.error);for(const [end,point] of [[r.from,r.points[0]],[r.to,r.points.at(-1)!]] as const){const{device,terminal}=resolvePort(p,end);assert.deepEqual(point,{x:device.layout.x+terminal.x,y:device.layout.y+terminal.y,z:terminal.z});}}
});
test('compiler rejects wrong medium, opposite polarity, unknown terminals and occupied input',()=>{
 const p=project(),wire=p.connections!.find(w=>w.id==='level-input')!;
 for(const change of [()=>wire.medium='power',()=>wire.to.port='missing',()=>p.connections!.push({...wire,id:'duplicate-input'}),()=>wire.to={device:'PSU-24',port:'plus'}]){const q=project();Object.assign(p,q);const current=p.connections!.find(w=>w.id==='level-input')!;Object.assign(wire,current);p.connections![p.connections!.findIndex(w=>w.id==='level-input')]=wire;change();assert.throws(()=>validateProject(p));}
 const q=project();q.connections!.find(w=>w.id==='dc-positive')!.to.port='DC-';assert.throws(()=>validateProject(q),/Incompatible/);
});
test('reference Saturn terminal centers are shared with the vendor SVG, including DC and bus contacts',()=>{
 const saturnType:string='saturn',ports=terminals(saturnType);for(const p of [...SATURN_TERMINAL_ANCHORS,...SATURN_SERVICE_ANCHORS]){assert.equal(ports[p.id].x,p.x*.5);assert.equal(ports[p.id].y,p.y*.5);}
 assert.equal(ports['DC+'].family,'dc24');assert.equal(ports['DC-'].family,'dc0');
});
test('all installed visual terminal anchors match the 3D connection points',()=>{
 const p=project(),mats={steel:new THREE.MeshStandardMaterial(),dark:new THREE.MeshStandardMaterial(),teal:new THREE.MeshStandardMaterial(),fluid:new THREE.MeshStandardMaterial()};
 for(const d of p.devices){const model=createPlantModel({THREE,equipment:{id:d.id,kind:'plant_'+d.type,variable:d.id,props:{...d.layout}},materials:mats,signal:()=>undefined,number:()=>null,quality:()=> 'good',alarm:()=> 'none',mode:()=> 'simulation',phase:()=>0},d.type,'value');
 const size=footprint(d.type);for(const[name,t]of Object.entries(terminals(d.type))){assert.deepEqual(model.ports.get(name)!.toArray(),[(t.x-size.width/2)/100,-(t.y-size.height/2)/100,t.z]);assert.ok(model.root.getObjectsByProperty('type','Mesh').some(m=>m.userData.terminal===name));}model.dispose!();}
 for(const m of Object.values(mats))m.dispose();
});
test('legacy FBD logic backend is byte-reproducible, CRC-valid and drives actual WASM without owning physical HMI',()=>{
 const c=project().controllers![0],a=compileController(c),b=compileController(structuredClone(c));assert.deepEqual(a.fbdbin,b.fbdbin);assert.equal(fbdCrc32(a.fbdbin),0);
 const vm=new ControllerVM(c);assert.equal(vm.scan({AI1:400},100).outputs.DO1,0);const result=vm.scan({AI1:700},100);assert.equal(result.outputs.DO1,1);assert.deepEqual(result.hmi,[]);
});
test('unsafe/arbitrary/stateful PLC expressions and unmapped expansion addresses are rejected',()=>{
 const c=project().controllers![0];for(const expression of [{ref:'EXP-AI4.AI1'},{op:'div',args:[1,0]},{op:'timer',args:[10]},2147483648,.5]){c.outputs.DO1=expression as never;assert.throws(()=>compileController(c));}
});
test('wire input scaling reaches the runtime; bounded controls drive relay and lamp through the same graph',()=>{
 const k=new Kernel(project(),'v','r',0);for(let i=0;i<20;i++)k.step();assert.equal(k.state.plc!['SATURN-1'].inputs.AI1,300);assert.equal(k.state.plc!['SATURN-1'].outputs.DO1,0);
 k.operate('BENCH-LEVEL',8);for(let i=0;i<80;i++)k.step();assert.equal(k.state.plc!['SATURN-1'].inputs.AI1,800);assert.equal(k.frame().samples['SATURN-1.DO1'].value,1);assert.equal(k.frame().samples['LAMP-1.brightness'].value,1);
});
test('missing supply/common or signal makes PLC unhealthy and relay deenergizes',()=>{
 for(const removed of ['dc-positive','dc-return','input-common','level-input']){const p=project();p.connections=p.connections!.filter(w=>w.id!==removed);validateProject(p);const k=new Kernel(p,'v','r',0);k.operate('BENCH-LEVEL',9);for(let i=0;i<100;i++)k.step();assert.equal(k.state.plc!['SATURN-1'].healthy,false,removed);assert.equal(k.frame().samples['LAMP-1.brightness'].value,0,removed);}
});
test('powered-down PLC has no HMI image and its demand does not secretly survive a reboot',()=>{
 const k=new Kernel(project(),'v','r',0);k.operate('BENCH-LEVEL',9);for(let i=0;i<90;i++)k.step();k.state.overrides['PSU-24.voltage']=0;for(let i=0;i<20;i++)k.step();assert.equal(k.state.plc!['SATURN-1'].powered,false);assert.deepEqual(k.frame().displays!['SATURN-1'],[]);assert.equal(k.frame().samples['LAMP-1.brightness'].value,0);
});
test('checkpoint restore and device order preserve integer PLC/HMI trajectory',()=>{
 const p=project(),a=new Kernel(p,'v','r',0);a.operate('BENCH-LEVEL',9);for(let i=0;i<45;i++)a.step();const q=structuredClone(p);q.simulations.reverse();const b=new Kernel(q,'v','r',0,a.state);for(let i=0;i<30;i++){a.step();b.step();assert.deepEqual(a.frame(),b.frame());}
});
test('visual connection edit only patches the wiring array, stays a draft and rejects ignored arrays',()=>{
 const wire={id:'module-signal',from:{device:'LEVEL-TX',port:'value'},to:{device:'EXP-AI4',port:'AI1'},medium:'control' as const};
 // The existing sensor output uses a single conductor; a second is not silently fanned out.
 assert.throws(()=>appendConnection(demoFiles,wire),diagnostic('SATURN_PORT_OCCUPIED'));
 const p={...demoFiles,'wiring.ts':demoFiles['wiring.ts'].replace('export const userWires=[]','export const userWires=[] // preserved')};
 const next=appendConnection(p,{id:'power-com2',from:{device:'PSU-24',port:'minus'},to:{device:'SATURN-1',port:'COM2'},medium:'power'});
 assert.equal(next['plant.ts'],demoFiles['plant.ts']);assert.ok(next['wiring.ts'].includes('// preserved'));assert.ok(compileProject(next).connections!.some(w=>w.id==='power-com2'));
 assert.throws(()=>appendConnection({...demoFiles,'plant.ts':demoFiles['plant.ts'].replace(', ...userWires','')},{id:'ignored',from:{device:'PSU-24',port:'minus'},to:{device:'SATURN-1',port:'COM2'},medium:'power'}),diagnostic('SATURN_PROJECT_INVALID'));
});
test('expansion adds a typed slot and real module declaration without overwriting other files',()=>{
 const next=addExpansionSource(demoFiles,'SATURN-1','EXP-SECOND','expansion-2.ts',"import {simulation} from '@saturn/core'; export const module=simulation('EXP-SECOND','io-module',{system:'commissioning',at:{x:1700,y:3850}});",2),p=compileProject(next);
 assert.ok(p.devices.some(d=>d.id==='EXP-SECOND'));assert.equal(p.attachments!.length,2);assert.equal(next['core.ts'],demoFiles['core.ts']);
 p.attachments![1].slot=1;assert.throws(()=>validateConnections(p),/slot/);
});
test('wire z transitions remain rectilinear and leave a terminal along its surface normal',()=>{
 for(const route of routeConnections(project()))for(let i=1;i<route.points.length;i++) {const a=route.points[i-1],b=route.points[i];assert.ok(['x','y','z'].filter(k=>a[k as keyof typeof a]!==b[k as keyof typeof b]).length<=1,route.id);}
});
test('virtual module requires matching two-wire bus, supply and an owner; open AI channels are unknown',()=>{
 const intact=project();intact.connections!.find(w=>w.id==='level-input')!.to={device:'EXP-AI4',port:'AI1'}; // test module input independently, never guessing expansion FBD addresses.
 for(const removed of ['', 'module-a','module-b','module-positive','module-return']) {const p=structuredClone(intact);if(removed)p.connections=p.connections!.filter(w=>w.id!==removed);validateProject(p);const k=new Kernel(p,'v','r',0);for(let i=0;i<30;i++)k.step();assert.equal(k.frame().samples['EXP-AI4.channel1'].quality,removed?'bad':'good',removed);assert.equal(k.frame().samples['EXP-AI4.channel2'].quality,'bad');}
});
test('a module cannot be assigned twice even with different slot numbers',()=>{const p=project();p.attachments!.push({...p.attachments![0],slot:2});assert.throws(()=>validateConnections(p),/slot/);});
test('disconnecting the transmitter common makes its value unknown and prevents PLC actuation',()=>{
 const p=project();p.connections=p.connections!.filter(w=>w.id!=='sensor-common');const k=new Kernel(p,'v','r',0);k.operate('BENCH-LEVEL',9);for(let i=0;i<100;i++)k.step();assert.equal(k.frame().samples['LEVEL-TX.value'].quality,'bad');assert.equal(k.state.plc!['SATURN-1'].healthy,false);assert.equal(k.frame().samples['LAMP-1.brightness'].value,0);
});

test('disconnect patches the explicit source, preserving unrelated declarations and comments',()=>{
 const removed=removeConnection(demoFiles,'level-input');assert.equal(removed['plant.ts'],demoFiles['plant.ts']);assert.equal(compileProject(removed).connections!.length,22);assert.ok(removed['commissioning.ts'].includes('// Generic isolated'));assert.throws(()=>removeConnection(removed,'level-input'),/literal/);
});

test('controller checkpoint rejects a changed runtime ABI rather than claiming deterministic restoration',()=>{const p=project(),k=new Kernel(p,'v','r',0);k.state.controllerAbi='unknown-runtime';assert.throws(()=>new Kernel(p,'v','r',0,k.state),diagnostic('SATURN_RUNTIME_INVALID',{field:'controllerAbi'}));});

test('prototype members cannot masquerade as physical connectors',()=>{for(const port of ['__proto__','constructor','toString']){const p=project();p.connections![0].to.port=port;assert.throws(()=>validateProject(p),/Unknown terminal/);}assert.throws(()=>terminals('__proto__'),/No physical/);});

test('a second virtual expansion is reachable by a two-conductor daisy chain, and a broken branch becomes unknown',()=>{
 const next=addExpansionSource(demoFiles,'SATURN-1','EXP-SECOND','expansion-2.ts',"import {simulation} from '@saturn/core'; export const module=simulation('EXP-SECOND','io-module',{system:'commissioning',at:{x:1600,y:3480}});",2),p=compileProject(next);
 for(const [id,a,b,medium] of [['chain-a','busA','busA','bus'],['chain-b','busB','busB','bus'],['second-plus','plus','plus','power'],['second-minus','minus','minus','power']] as const)p.connections!.push({id,from:{device:medium==='bus'?'EXP-AI4':'PSU-24',port:a},to:{device:'EXP-SECOND',port:b},medium});
 p.connections!.find(w=>w.id==='level-input')!.to={device:'EXP-SECOND',port:'AI1'};validateProject(p);const a=new Kernel(p,'v','r',0);for(let i=0;i<30;i++)a.step();assert.equal(a.frame().samples['EXP-SECOND.channel1'].value,300);
 p.connections=p.connections!.filter(w=>w.id!=='module-b');validateProject(p);const b=new Kernel(p,'v','r',0);for(let i=0;i<30;i++)b.step();assert.equal(b.frame().samples['EXP-SECOND.channel1'].quality,'bad');
});


test('HMI observation is pure: repeated frames and a paused step do not scan PLCs',()=>{
 const p=project(),k=new Kernel(p,'v','r',0);for(let i=0;i<15;i++)k.step();
 const before=structuredClone(k.state),frame=k.frame();
 for(let i=0;i<30;i++)assert.deepEqual(k.frame(),frame);
 assert.deepEqual(k.state,before);
 k.state.paused=true;const paused=structuredClone(k.state);k.step();assert.deepEqual(k.state,paused);
 const restored=new Kernel(p,'v','r',0,k.state);assert.deepEqual(restored.frame(),k.frame());
 // A view consumer cannot mutate the retained command buffer.
 k.frame().displays!['SATURN-1'].splice(0);assert.deepEqual(k.state,paused);
});
