import test from 'node:test';
import assert from 'node:assert/strict';
import { panel, label, readout, view, pin, block, functionBlock, dataTable, commandButton } from '../dsl';
import { bindPresentation, renderPresentation, validatePresentation } from '../presentation';
import { projectPresentation, presentationTargets } from '../presentation-target';
import { ControllerVM, compileController } from '../controller';
import { Kernel } from '../kernel';
import { compileProject, validateProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { executeReport } from '../workflows';
import { NodeSql } from '../adapters/node-sql';
import type { ReportTask } from '../types';
import { diagnostic } from './diagnostic';
const project=()=>compileProject(demoFiles);
test('one DSL tree is shared by live HMI, report and the compiled controller screen',()=>{
 const p=project(),v=p.views![0];assert.deepEqual(v.body,p.reports.find(r=>r.id==='bench-state')!.view!.body);
 assert.deepEqual(v.body,p.controllers![0].hmi.view!.body);
 const vm=new ControllerVM(p.controllers![0]),result=vm.scan({AI1:700},100);assert.equal(result.outputs.DO1,1);assert.ok(result.hmi.some(c=>c.type==='text'&&c.text==='700'));
});
test('one canonical Presentation IR projects to web and the physical Saturn target',()=>{
 const p=project(),v=p.views![0];
 const values=bindPresentation(v,{},0);
 const web=projectPresentation(v,{target:'web',context:{values,interactive:true}});
 assert.equal(web.target,'web');assert.ok('html' in web);assert.match(web.html,/presentation/);
 const bindings=Object.fromEntries(Object.keys(v.bindings).map((name,index)=>[name,'projection_'+index]));
 const physical=projectPresentation(v,{target:'saturn-plc-320',bindings});
 assert.equal(physical.target,'saturn-plc-320');assert.ok('screen' in physical);assert.equal(physical.screen.id,v.id);
 assert.deepEqual(presentationTargets['saturn-plc-320'],{width:320,height:240,interactive:true});
});
test('presentation escapes content, preserves bad quality and disables commands in report mode',()=>{
 const v=view('escape',{title:'Example',bindings:{a:pin('value')},body:panel([label('<script>x</script>'),readout('X','a'),commandButton('Start','control',1)])});
 const html=renderPresentation(v,{values:bindPresentation(v,{value:{value:7,quality:'bad',time:0}},0)});
 assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/—/);assert.match(html,/ disabled/);
});
test('report presentation binds only the frozen data capsule, excluding samples beyond the cutoff',()=>{
 const p=project(),report=p.reports.find(r=>r.id==='bench-state')!;
 const task:ReportTask={id:'view-report',createdAt:1000,report,revision:'v',runId:'r',from:0,to:1000,actor:'test',trigger:'manual',inputs:{},data:{segments:[],samples:[
  {signal:'SATURN-1.AI1',time:500,value:321,quality:'good'},
  {signal:'SATURN-1.AI1',time:1500,value:999,quality:'good'},
  {signal:'SATURN-1.DO1',time:500,value:0,quality:'good'},
 ]}};
 const result=executeReport(task,new NodeSql());assert.match(result.html,/>321</);assert.ok(!result.html.includes('>999<'));
});
test('modern report renders summary metrics, bar chart and printable Saturn typography',()=>{
 const report=project().reports.find(r=>r.id==='pump-a-hourly-flow')!;
 const task:ReportTask={id:'hourly-flow',createdAt:7200000,report,revision:'abc123',runId:'run-1',from:0,to:7200000,actor:'engineer',trigger:'manual',inputs:{},data:{samples:[],segments:[
  {signal:'PUMP-A.flow',start:0,end:3600000,value:40,quality:'good'},
  {signal:'PUMP-A.flow',start:3600000,end:7200000,value:50,quality:'good'},
 ]}};
 const result=executeReport(task,new NodeSql());
 assert.equal(result.rows.length,2);
 assert.match(result.html,/class="report-sheet"/);
 assert.match(result.html,/data-report-metric="volume"/);
 assert.match(result.html,/90,0/);
 assert.match(result.html,/data-chart-type="bar"/);
 assert.match(result.html,/Engineering report/);
 assert.match(result.html,/@page\{size:A4/);
});

test('target-specific unsupported widgets and display overflow fail explicitly',()=>{
 const v=view('small',{title:'Small',bindings:{},body:dataTable([{key:'x',title:'X'}])});assert.throws(()=>projectPresentation(v,{target:'saturn-plc-320',bindings:{}}),diagnostic('SATURN_PRESENTATION_INVALID',{target:'plc',nodeKind:'table'}));
 v.body=panel(Array.from({length:12},()=>label('A')));assert.throws(()=>projectPresentation(v,{target:'saturn-plc-320',bindings:{}}),diagnostic('SATURN_LIMIT'));
});
test('view reference errors and unauthorized command ranges are compile-time errors',()=>{
 const p=project();p.views![0].bindings.input=pin('missing.signal');assert.throws(()=>validateProject(p),diagnostic('SATURN_DSL_UNKNOWN',{signal:'missing.signal'}));
 const q=project();q.views![0].body=commandButton('Go','BENCH-LEVEL',100);assert.throws(()=>validateProject(q),diagnostic('SATURN_PRESENTATION_INVALID',{field:'action.target'}));
 const r=project();r.reports.find(r=>r.id==='bench-state')!.view!.bindings.input=pin('CORE.power');assert.throws(()=>validateProject(r),diagnostic('SATURN_REPORT_INVALID',{signal:'CORE.power'}));
});
test('presentation tree rejects excessive recursion and unknown binding slots',()=>{
 const v=view('bounded',{title:'Bounded',bindings:{},body:readout('Unknown','x')});assert.throws(()=>validatePresentation(v));
 v.body=label('x');for(let i=0;i<12;i++)v.body=panel([v.body]);assert.throws(()=>validatePresentation(v),diagnostic('SATURN_LIMIT'));
});
test('named timer is compiled once and checkpoint restoration survives repeated frame reads',()=>{
 const p=project(),c=p.controllers![0];c.blocks={start:functionBlock('TON',[{op:'gt',args:[pin('AI1'),500]},500])};
 c.outputs={DO1:block('start'),DO2:block('start')};c.hmi.view=undefined;c.hmi.rows=[{label:'State',pin:'DO1'}];
 const artifact=compileController(c);assert.equal(artifact.listing.filter(r=>r.type==='TON').length,1);
 const a=new Kernel(p,'v','r',0);for(let i=0;i<10;i++)a.step();a.operate('BENCH-LEVEL',7);
 while(a.state.plc!['SATURN-1'].inputs.AI1<=500)a.step();a.step();
 const b=new Kernel(p,'v','r',0,a.state),saved=structuredClone(a.state);
 for(let i=0;i<20;i++){a.frame();assert.deepEqual(a.state,saved);}
 for(let i=0;i<12;i++){a.step();b.step();assert.deepEqual(a.frame(),b.frame());}
 assert.equal(a.frame().samples['SATURN-1.DO1'].value,1);assert.equal(a.frame().samples['SATURN-1.DO2'].value,1);
});
test('PLC block identity rejects cycles and a checkpoint with mismatched program',()=>{
 const p=project(),c=p.controllers![0];c.blocks={loop:functionBlock('TON',[block('loop'),500])};c.outputs.DO1=block('loop');assert.throws(()=>compileController(c),/cycle/);
 const q=project(),a=new Kernel(q,'v','r',0);for(let i=0;i<10;i++)a.step();q.controllers![0].outputs.DO1=1;
 assert.throws(()=>new Kernel(q,'v','r',0,a.state),/Incompatible/);
});
