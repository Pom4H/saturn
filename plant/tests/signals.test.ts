import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, bind, derived, protocols, quality, signal, SignalCatalog } from '../signals';
import { generateProjectDocumentation } from '../autodoc';
import type { Project } from '../types';

test('universal signals preserve domain identity while transport is replaceable',()=>{
  const pressure=signal.number('P-101.pressure',{unit:'bar',dimension:'pressure',range:[0,16],origin:{kind:'hardware',device:'PT-101'}});
  const modbus=bind(pressure,protocols.modbus('PLC-1',40124,{codec:'float32be'}));
  const opc=bind(pressure,protocols.opcua('opc.tcp://plant','ns=4;s=P101.Pressure'));
  assert.equal(modbus.definition.id,opc.definition.id);
  assert.equal(modbus.definition.binding?.protocol,'modbus');
  assert.equal(opc.definition.binding?.protocol,'opcua');
});

test('quality is compositional and explicit',()=>{
  assert.deepEqual(quality.stale(),{validity:'uncertain',connection:'online',freshness:'stale'});
  assert.equal(quality.offline().connection,'offline');
});

test('derived and aggregate signals expose dependencies for tooling and docs',()=>{
  const flow=signal.number('flow',{unit:'m3/h',dimension:'flow'});
  const power=signal.number('power',{unit:'kW',dimension:'power'});
  const efficiency=derived(signal.number('efficiency',{unit:'m3/kWh'}),[flow,power],{op:'div',args:[flow.ref!,power.ref!]});
  const hourly=aggregate(signal.number('hourly',{unit:'m3'}),flow,'integral',3600000);
  const catalog=new SignalCatalog().add(flow,power,efficiency,hourly);
  assert.equal((catalog.get('efficiency')!.definition.origin as {kind:string;dependencies:readonly string[]}).dependencies.join(','),'flow,power');
  assert.equal(catalog.list().length,4);
});

test('project documentation is generated from the executable object model',()=>{
  const project:Project={version:1,id:'plant',title:'Pump station',description:'Demo',systems:[{id:'water',title:'Water'}],simulations:[],signals:[{id:'flow.total',expression:{ref:'flow'},unit:'m3/h'}],devices:[],alarms:[],reports:[],stepMs:100,history:{deadband:0,maxInterval:1000,retention:60000},seed:1};
  const catalog=new SignalCatalog().add(signal.number('flow',{unit:'m3/h',dimension:'flow'}),signal.number('flow.total',{unit:'m3/h',origin:{kind:'derived',dependencies:['flow']}}));
  const md=generateProjectDocumentation(project,{locale:'en',signals:catalog});
  assert.match(md,/Pump station/);
  assert.match(md,/flow\.total/);
  assert.match(md,/derived ← flow/);
  assert.match(md,/source → decode → typed signal/);
});
