import test from 'node:test';
import assert from 'node:assert/strict';
import { runExercise, trainingProject } from './stability-trace';
import { Kernel } from '../kernel';
import { validateProject } from '../compiler';
import { model, models } from '../models';
import { svgVisualKinds, installEquipment, sceneFor, visualFrame } from '../equipment';
import { compileProject } from '../compiler';
import { demoFiles } from "../../examples/plant/files";
const exercise = new Map<string, ReturnType<typeof runExercise>>();
const run = (mode: Parameters<typeof runExercise>[0], delay = 20) => {
    const key = `${mode}:${delay}`; if(!exercise.has(key))exercise.set(key,runExercise(mode,delay));return exercise.get(key)!;
};
test('stability exercise is a valid independent project with no historical reactor controls',()=>{
    const p=trainingProject();validateProject(p);
    assert.ok(p.simulations.every(n=>n.id.startsWith('LAB-')));
    assert.deepEqual(p.controls?.map(c=>c.id),['LAB-HEAT','LAB-COOLING']);
    assert.ok(p.simulations.every(n=>!['feedback-source','protection','channel'].includes(n.model)));
});
test('stable baseline and small command errors remain inside the operating band for eight model minutes',()=>{
    for(const mode of ['baseline','small-error'] as const){const r=run(mode);assert.equal(r.warningAt,null);assert.equal(r.damage,0);assert.ok(r.peak<1.4);}
});
test('short transient does not cause instant failure or irreversible damage',()=>{
    const r=run('pulse');assert.equal(r.damage,0);assert.equal(r.warningAt,null);assert.ok(r.finalTemperature<1.2);
});
test('sustained imbalance becomes unstable through equipment equations with advance warning',()=>{
    const r=run('stress');assert.ok(r.warningAt!==null && r.damageAt!==null);assert.ok(r.damageAt-r.warningAt>=45 && r.damageAt-r.warningAt<=85);
    assert.ok(r.peak>3);assert.equal(r.damage,1);assert.ok(r.residual<1e-9);
});
test('timely coordinated commands stabilize, with actuator delay and a persistent recovery interval',()=>{
    for(const delay of [20,30]){const r=run('recover',delay);assert.equal(r.damage,0);assert.ok(r.recoveredAt!>r.responseAt!+20);assert.ok(r.recoveredAt!<240);assert.ok(r.finalTemperature<1.35);}
});
test('neither changing only heat nor only cooling is a magic reset',()=>{
    for(const mode of ['heat-only','cooling-only'] as const){const r=run(mode);assert.equal(r.recoveredAt,null);assert.ok(r.damage>.1);}
});
test('late recovery may remove the cause but never erases accumulated damage',()=>{
    const late=run('recover',40);assert.ok(late.recoveredAt!==null);assert.ok(late.damage>0);assert.ok(late.finalTemperature<1.35);
    assert.equal(run('recover',60).recoveredAt,null);
    for(let i=1;i<late.trace.length;i++)assert.ok(late.trace[i].damage>=late.trace[i-1].damage);
});
test('recovery is robust to timestep and thermal capacity variation, not a single tuned script',()=>{
    const baseline=run('recover');for(const dt of [50,200]){const r=runExercise('recover',20,dt);assert.equal(r.damage,0);assert.ok(Math.abs(r.peak-baseline.peak)<.025);}
    for(const factor of [.9,1.1]){const r=runExercise('recover',20,100,factor);assert.equal(r.damage,0);assert.ok(r.recoveredAt!==null);}
});
test('reordered equipment produces the same result and checkpoint restart keeps the trajectory',()=>{
    const p=trainingProject(), reversed=structuredClone(p);reversed.simulations.reverse();
    const a=new Kernel(p,'v','r',0),b=new Kernel(reversed,'v','r',0);a.operate('LAB-HEAT',1.2);b.operate('LAB-HEAT',1.2);
    for(let i=0;i<100;i++){a.step();b.step();}assert.deepEqual(a.samples(),b.samples());
    const c=new Kernel(p,'v','r',0,a.state);for(let i=0;i<100;i++){a.step();c.step();}assert.deepEqual(a.state,c.state);
});
test('every installed model has a real SVG renderer; no silent sensor fallback',()=>{
    installEquipment();const kinds=new Set(svgVisualKinds());for(const m of models())assert.ok(kinds.has(m.visual),m.kind);
    const p=compileProject(demoFiles), scene=sceneFor(p), frame=visualFrame(p,new Kernel(p,'r','run',0).frame());
    assert.equal(scene.nodes.length,47);assert.equal(Object.keys(frame.equipment).length,47);
    for(const node of scene.nodes)assert.ok(frame.equipment[node.id],node.id);
});
test('one-way valve prevents reverse flow and relief responds to pressure rather than time',()=>{
    const check=model('check-valve'),cq=Object.fromEntries(Object.entries(check.parameters).map(([k,v])=>[k,v.default]));
    assert.equal(check.advance(check.initialize(cq),{upstream:0,downstream:1},cq,.1).flow,0);
    const m=model('relief-valve'),q=Object.fromEntries(Object.entries(m.parameters).map(([k,v])=>[k,v.default]));let s=m.initialize(q);
    for(let i=0;i<100;i++)s=m.advance(s,{pressure:.5,downstream:0},q,.1);assert.equal(s.flow,0);
    for(let i=0;i<100;i++)s=m.advance(s,{pressure:1,downstream:0},q,.1);assert.ok(s.flow>.1);
});
test('expansion-vessel inventory balance remains closed at both capacity limits',()=>{
    const m=model('expansion-vessel'),q=Object.fromEntries(Object.entries(m.parameters).map(([k,v])=>[k,v.default]));let s=m.initialize(q);
    for(let i=0;i<400;i++){s=m.advance(s,{inflow:i<200?0:5,outflow:i<200?4:0},q,.1);assert.ok(s.inventory>=0&&s.inventory<=q.capacity);assert.ok(Math.abs(s.balance)<1e-10);}assert.ok(s.spill>0);
});
