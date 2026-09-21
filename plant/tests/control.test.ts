import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compileProject, validateProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { runControlTrace } from './control-trace';
import { Kernel } from '../kernel';
import { Service } from '../service';
import { Store, LocalRepository } from '../store';
import { NodeSql } from '../adapters/node-sql';
import { model, models } from '../models';
import { createPlantModel } from '../visual3d';
import type { Actor, Project } from '../types';
import { diagnostic } from './diagnostic';
const operator: Actor = { id: 'operator', role: 'operator' };
const engineer: Actor = { id: 'engineer', role: 'engineer' };
const source = () => compileProject(demoFiles);
async function service() {
    const store = new Store(new NodeSql()); let n = 0;
    const repository = new LocalRepository(store, () => `local:${++n}`);
    const s = new Service(store, repository, { now: () => 1000, uuid: () => `id-${++n}`, reportRunner: async () => ({ rows: [], html: '' }) });
    await s.start(demoFiles); return s;
}
const payload = (s: Service, target = 'MAKEUP', value = .2) => ({ id: 'input-1', action: 'operate', revision: s.frame().revision, runId: s.frame().runId, target, value });

test('DSL exposes operator controls as ordinary referenced signals', () => {
    const p = source(); assert.equal(p.controls?.length, 7);
    assert.deepEqual(p.simulations.find(n => n.id === 'AUX-VALVE')!.inputs.demand, { ref: 'DRAW.value' });
    assert.equal(new Kernel(p, 'r', 'run', 0).frame().samples['MAKEUP.requested'].value, .08);
});
test('control declarations validate ranges, uniqueness, rates and fail-closed values', () => {
    for (const change of [ { max: -1 }, { rate: 0 }, { initial: 9 }, { id: 'GRID' }, { enableWhen: { ref: 'missing' }, safeValue: 0 }, { enableWhen: true } ]) {
        const p = source(); Object.assign(p.controls![0], change); assert.throws(() => validateProject(p));
    }
});
test('operator commands persist requested values without writing project/model parameters', async () => {
    const s = await service(); try {
        const before = JSON.stringify(s.project), request = payload(s);
        const receipt = s.command(request, operator);
        assert.equal(receipt.status, 'accepted'); assert.equal(s.frame().samples['MAKEUP.value'].value, .08);
        assert.equal(s.frame().samples['MAKEUP.requested'].value, .2);
        s.tick(); assert.ok(Math.abs(s.frame().samples['MAKEUP.value'].value! - .082) < 1e-12);
        assert.equal(JSON.stringify(s.project), before); assert.deepEqual(s.kernel.state.overrides, {});
        assert.equal(s.store.db.all<{actor:string}>("SELECT actor FROM events WHERE type='command.control'")[0].actor, 'operator');
    } finally { s.store.db.close(); }
});
test('control slew limits converge without overshoot and stop on pause', () => {
    const k = new Kernel(source(), 'r', 'run', 0); k.operate('MAKEUP', .2);
    for (let i = 0; i < 20; i++) k.step(); const value = k.samples()['MAKEUP.value'].value!;
    assert.ok(value < .2 && value > .08); k.state.paused = true; for (let i = 0; i < 20; i++) k.step(); assert.equal(k.samples()['MAKEUP.value'].value, value);
    k.state.paused = false; for (let i = 0; i < 200; i++) k.step(); assert.equal(k.samples()['MAKEUP.value'].value, .2);
});
test('interlock closes continuously, clears old demand and never auto-restarts', () => {
    const k = new Kernel(source(), 'r', 'run', 0); k.operate('DRAW', .8);
    k.state.states['AUX-TANK'].inventory = .5; k.step();
    assert.equal(k.samples()['DRAW.blocked'].value, 1); assert.equal(k.samples()['DRAW.requested'].value, 0);
    assert.throws(() => k.operate('DRAW', .8), diagnostic('SATURN_RUNTIME_INVALID',{control:'DRAW',blockedReason:'Низкий запас'}));
    k.state.states['AUX-TANK'].inventory = 5; k.step(); assert.equal(k.samples()['DRAW.blocked'].value, 0);
    assert.equal(k.samples()['DRAW.value'].value, 0);
});
test('unknown interlock input blocks operation rather than treating missing as zero', () => {
    const p = source(); p.controls![0].enableWhen = { op: 'div', args: [1, 0] }; p.controls![0].safeValue = 0; p.controls![0].blockedReason = 'Unknown data'; validateProject(p);
    const k = new Kernel(p, 'r', 'run', 0); assert.throws(() => k.operate('MAKEUP', .2), diagnostic('SATURN_RUNTIME_INVALID',{control:'MAKEUP',blockedReason:'Unknown data'})); k.step(); assert.equal(k.samples()['MAKEUP.value'].value, 0);
});
test('operator commands enforce role, run identity, idempotency and bounds', async () => {
    const s = await service(); try {
        const cmd = payload(s); assert.throws(() => s.command(cmd, {id:'view',role:'viewer'}), /permission/);
        assert.throws(() => s.command({...cmd, runId:'stale'}, operator), diagnostic('SATURN_CONFLICT'));
        const first = s.command(cmd, operator); assert.deepEqual(s.command(cmd, operator), first);
        assert.throws(() => s.command({...cmd, value:.1}, operator), diagnostic('SATURN_CONFLICT',{id:cmd.id}));
        assert.throws(() => s.command({...cmd, id:'range', value:999}, operator));
        assert.equal(s.store.db.all('SELECT * FROM commands').length, 1);
        assert.ok(s.store.db.all("SELECT * FROM events WHERE type='command.rejected'").length >= 2);
    } finally { s.store.db.close(); }
});
test('control failure leaves checkpoint unchanged and accepted values survive restart', async () => {
    const s = await service(); try {
        s.command(payload(s), operator); s.tick(); const before = s.frame();
        assert.throws(() => s.command({...payload(s), id:'bad', target:'absent'}, operator)); assert.deepEqual(s.frame(), before);
        const restored = new Service(s.store, s.repository, {reportRunner:async()=>({rows:[],html:''})}); await restored.start(demoFiles); assert.deepEqual(restored.frame(), before);
        await s.restart(engineer); assert.throws(() => s.command({...payload(s), id:'old-run',runId:before.runId}, operator), diagnostic('SATURN_CONFLICT'));
    } finally { s.store.db.close(); }
});
test('reservoir mass balance closes across empty, filling and overflow states', () => {
    const m = model('reservoir'), p = {capacity:10, initialLevel:.7}; let state = m.initialize(p);
    for (let i = 0; i < 300; i++) { state = m.advance(state, {inflow:i < 100 ? 0 : 4, demand:i < 100 ? 8 : .1}, p, .1); assert.ok(state.inventory >= 0 && state.inventory <= 10); assert.ok(Math.abs(state.balance) < 1e-10); }
    assert.ok(state.spill > 0);
});
test('UPS energy stays bounded and loss of stored energy removes output', () => {
    const m = model('ups'), p = {capacity:2, charging:.1}; let state = m.initialize(p);
    for (let i = 0; i < 100; i++) state = m.advance(state, {grid:0, demand:1}, p, .1);
    assert.equal(state.voltage, 0); assert.equal(state.energy, 0);
    for (let i = 0; i < 300; i++) state = m.advance(state, {grid:1, demand:1}, p, .1);
    assert.equal(state.energy, 2);
});
test('all installed visuals have distinct multipart 3D geometry and dispose safely', () => {
    const materials = {steel:new THREE.MeshStandardMaterial(),dark:new THREE.MeshStandardMaterial(),teal:new THREE.MeshStandardMaterial(),fluid:new THREE.MeshStandardMaterial()};
    try { for (const m of models()) {
        const context = {THREE, materials, equipment:{id:'test',kind:m.visual,props:{},variable:''}, number:()=>1, signal:()=>undefined, quality:()=> 'good' as const, mode:()=> 'simulation', alarm:()=> 'none' as const, phase:()=>.25};
        const view = createPlantModel(context, m.visual, Object.keys(m.outputs)[0]);
        let count = 0; view.root.traverse(o=>{if(o instanceof THREE.Mesh)count++;}); assert.ok(count >= 5, m.visual); assert.equal(view.root.userData.visual,m.visual);
        view.update(.1); const bounds = new THREE.Box3().setFromObject(view.root); assert.ok(!bounds.isEmpty()); assert.ok(bounds.max.z > .5); view.dispose?.(); view.dispose?.();
    }} finally { Object.values(materials).forEach(m=>m.dispose()); }
});
test('3D animated parts consume observations and hide unknown instrumentation', () => {
    const materials = {steel:new THREE.MeshStandardMaterial(),dark:new THREE.MeshStandardMaterial(),teal:new THREE.MeshStandardMaterial(),fluid:new THREE.MeshStandardMaterial()};
    let value:number|null = 25;
    const c = {THREE,materials,equipment:{id:'test',kind:'reservoir',props:{},variable:''},number:()=>value,signal:()=>undefined,quality:()=> 'good' as const,mode:()=> 'simulation',alarm:()=> 'none' as const,phase:()=>.25};
    const view = createPlantModel(c,'reservoir','level'); let fill:THREE.Object3D|undefined;
    view.root.traverse(o=>{if(o.userData.part==='level')fill=o;}); view.update(.1); const low=fill!.scale.z;
    value=75;view.update(.1);assert.ok(fill!.scale.z>low);value=null;view.update(.1);assert.equal(fill!.visible,false);
    view.dispose?.();Object.values(materials).forEach(m=>m.dispose());
});

test('portable water-loop control trace triggers and recovers without resuming old demand', () => {
    const trace = runControlTrace(); assert.equal(trace.blocked, true); assert.equal(trace.clearedDemand, 0);
    assert.ok(trace.trace.at(-1)!.values[4]! > 10);
    for (const row of trace.trace) assert.ok(Math.abs(row.values[5]!) < 1e-10);
});
