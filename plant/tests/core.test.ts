import './presentation.test';
import './connections.test';
import './stability.test';
import './group-layout.test';
import './control.test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { compileProject, validateProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { Kernel, evaluate } from '../kernel';
import { updateAlarms, acknowledge } from '../alarms';
import { NodeSql } from '../adapters/node-sql';
import { Store, LocalRepository } from '../store';
import { GitRepository } from '../adapters/git';
import { Service } from '../service';
import { executeReport, cronMatches, validateCron } from '../workflows';
import { Auth } from '../adapters/auth';
import { Push, allowedPushEndpoint } from '../adapters/push';
import { startPlantServer } from '../server';
import { runReport } from '../adapters/node-reports';
import type { Actor, AlarmState, ReportTask, Project, Frame } from '../types';
const engineer: Actor = { id: 'engineer', role: 'engineer' }, viewer: Actor = { id: 'reader', role: 'viewer' };
const project = () => compileProject(demoFiles);
const makeService = async (files = demoFiles) => { const store = new Store(new NodeSql()); let serial = 0; const repo = new LocalRepository(store, () => `local:${++serial}`); const service = new Service(store, repo, { now: () => 1000000, uuid: () => `id-${++serial}`, reportRunner: async (task) => executeReport(task, new NodeSql()) }); await service.start(files); return service; };
test('multi-file DSL compiles hierarchy and typed signal sources', () => { const p = project(); assert.equal(p.simulations.length, 46); assert.equal(p.systems.length, 18); assert.equal(p.reports.length, 5); assert.deepEqual(p.simulations.find(n => n.id === 'PUMP-A')!.inputs.voltage, { ref: 'GRID.voltage' }); });
for (const [name, source] of Object.entries({ execute: 'globalThis.process.exit()', getter: 'const a={get b(){return 1;}};', prototype: 'const a={constructor: 1};', import: 'import { x } from "../../outside";', loop: 'while(true){}', function: 'const x=()=>1;' }))
    test(`DSL rejects ${name}`, () => assert.throws(() => compileProject({ ...demoFiles, 'plant.ts': source })));
test('DSL rejects unknown signals and algebraic cycles', () => { assert.throws(() => compileProject({ ...demoFiles, 'core.ts': demoFiles['core.ts'].replace('"core.void"', '"missing.signal"') }), /Unknown signal/); assert.throws(() => compileProject({ ...demoFiles, 'core.ts': demoFiles['core.ts'].replace(/derived\("core.temperature",[^;]+;/, 'derived("core.temperature", signal("core.temperature"));') }), /cycle/); });
test('DSL rejects imports with module cycles and invalid cron', () => { assert.throws(() => compileProject({ ...demoFiles, 'core.ts': 'import {x} from "./plant";' }), /Circular/); assert.throws(() => validateCron('60 * * * *')); assert.throws(() => validateCron('* * * *')); });
test('simulation is deterministic, independent of equipment declaration order', () => { const p = project(), q = structuredClone(p); q.simulations.reverse(); const a = new Kernel(p, 'rev', 'same', 0), b = new Kernel(q, 'rev', 'same', 0); for (let i = 0; i < 200; i++) {
    a.step();
    b.step();
} assert.deepEqual(a.frame(), b.frame()); });
function experiment(p: Project, mode: string, duration = 300) { const k = new Kernel(p, 'rev', 'run', 0); if (mode !== 'baseline')
    k.setParameter('GRID', 'voltage', .4); if (mode === 'feedback-removed')
    k.setParameter('CORE', 'feedback', 0); if (mode === 'fast-protection')
    k.setParameter('PROTECT', 'actuation', .1); let peak = 0, balance = 0, firstDamage: number | null = null; for (let i = 0; i < duration * 1000 / p.stepMs; i++) {
    const f = k.step();
    peak = Math.max(peak, f.samples['core.temperature'].value!);
    balance = Math.max(balance, Math.abs(f.samples['core.balance'].value!));
    if (firstDamage === null && f.samples['core.damage'].value! > .05)
        firstDamage = f.time;
} return { peak, balance, firstDamage, frame: k.frame() }; }
test('no scripted disaster: baseline stable; cooling loss propagates; counterfactuals prevent damage', () => { const p = project(), baseline = experiment(p, 'baseline'), stress = experiment(p, 'cooling-loss'), feedback = experiment(p, 'feedback-removed'), protection = experiment(p, 'fast-protection'); assert.ok(baseline.peak < 1.1); assert.equal(baseline.frame.samples['core.damage'].value, 0); assert.ok(stress.peak > 3); assert.equal(stress.frame.samples['core.damage'].value, 1); assert.equal(stress.frame.samples['BUILDING.damage'].value, 1); assert.equal(feedback.frame.samples['core.damage'].value, 0); assert.equal(protection.frame.samples['core.damage'].value, 0); assert.ok(stress.balance < 1e-10); console.log('counterfactuals', JSON.stringify({ baseline: baseline.peak, stress: stress.peak, damageAt: stress.firstDamage, feedback: feedback.peak, protection: protection.peak, energyResidual: stress.balance })); });
test('halved time step preserves causal outcome and approximately converges', () => { const p = project(), coarse = experiment(p, 'cooling-loss'); p.stepMs = 50; const fine = experiment(p, 'cooling-loss'); assert.equal(coarse.frame.samples['core.damage'].value, fine.frame.samples['core.damage'].value); assert.ok(Math.abs(coarse.peak - fine.peak) / fine.peak < .05); assert.ok(Math.abs(coarse.firstDamage! - fine.firstDamage!) < 3000); });
test('quality propagates rather than inventing zero', () => { assert.equal(evaluate({ op: 'div', args: [1, 0] }, () => { throw Error(); }, 0).quality, 'bad'); assert.deepEqual(evaluate({ op: 'mul', args: [{ ref: 'x' }, 2] }, () => ({ value: null, quality: 'offline', time: 0 }), 10), { value: null, quality: 'offline', time: 10 }); });
test('alarm debounce, acknowledgement, hysteresis and unknown quality are independent', () => { const p = project(), k = new Kernel(p, 'v', 'r', 0), states: Record<string, AlarmState> = {}; const rule = { id: 'alarm', title: 'Test', signal: { ref: 'x' } as const, above: 10, clearBelow: 8, delay: 1000, priority: 'warning' as const, notify: true }; const f = k.frame(); f.samples.x = { value: 11, quality: 'good', time: 0 }; assert.equal(updateAlarms([rule], states, f).length, 0); f.time = 1100; f.seq = 11; assert.equal(updateAlarms([rule], states, f)[0].type, 'alarm.raised'); acknowledge(states, 'alarm', engineer, 1100); assert.equal(states.alarm.active, true); f.samples.x = { value: null, quality: 'bad', time: 1200 }; f.time = 1200; assert.equal(updateAlarms([rule], states, f).length, 0); assert.equal(states.alarm.active, true); f.samples.x.value = 8; f.samples.x.quality = 'good'; f.time = 1300; assert.equal(updateAlarms([rule], states, f)[0].type, 'alarm.cleared'); assert.equal(states.alarm.acknowledged, true); });
test('SQLite transaction rejects partial writes and async callbacks', () => { const db = new NodeSql(); db.exec('CREATE TABLE t(x)'); assert.throws(() => db.transaction(() => { db.exec('INSERT INTO t VALUES(1)'); throw Error('fail'); })); assert.equal(db.all('SELECT * FROM t').length, 0); assert.throws(() => db.transaction(async () => 1), /synchronous/); db.close(); });
test('command idempotency, permissions and checkpoint restore', async () => { const s = await makeService(); const command = { id: 'cmd-1', revision: s.frame().revision, action: 'set', target: 'GRID', parameter: 'voltage', value: .4 }; assert.throws(() => s.command(command, viewer), /permission/); const receipt = s.command(command, engineer); assert.deepEqual(s.command(command, engineer), receipt); assert.throws(() => s.command({ ...command, value: .5 }, engineer), /reused/); for (let i = 0; i < 10; i++)
    s.tick(); const copy = s.frame(); const resumed = new Service(s.store, s.repository, { reportRunner: async (task) => executeReport(task, new NodeSql()) }); await resumed.start(demoFiles); assert.deepEqual(resumed.frame(), copy); assert.equal(s.store.db.all('SELECT * FROM commands').length, 1); s.store.db.close(); });
test('local repository CAS and release rollback preserve old observations', async () => { const s = await makeService(), old = await s.repository.head(); for (let i = 0; i < 10; i++)
    s.tick(); const before = s.frame(), files = { ...demoFiles, 'cooling.ts': demoFiles['cooling.ts'].replace('voltage: 1', 'voltage: 0.4') }; const revision = await s.save(files, old, 'New supply', engineer); await assert.rejects(s.save(files, old, 'Stale draft', engineer), /changed/); await s.publish(revision.id, old, engineer); assert.notEqual(s.frame().runId, before.runId); await s.rollback(old!, revision.id, engineer); assert.equal(s.project.simulations.find(n => n.id === 'GRID')!.parameters.voltage, 1); assert.ok(s.store.db.all('SELECT * FROM samples WHERE run_id=?', [before.runId]).length > 0); const bad = { ...demoFiles, 'plant.ts': 'throw new Error()' }; await assert.rejects(s.save(bad, await s.repository.head(), 'Invalid', engineer)); s.store.db.close(); });
test('nested installation repository never discovers or modifies its source checkout', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'scada-nested-git-test-'));
    try {
        execFileSync('git', ['init', parent], { stdio: 'ignore' });
        const directory = join(parent, 'data-plant', 'project.git');
        const repository = await new GitRepository(directory).initialize();
        assert.equal(await repository.head(), null);
        const first = await repository.commit(demoFiles, null, 'First installation', engineer.id);
        await repository.publish(first.id, null);
        const reopened = await new GitRepository(directory).initialize();
        assert.equal(await reopened.desired(), first.id);
        assert.deepEqual((await reopened.read(first.id)).files, demoFiles);
        assert.equal(execFileSync('git', ['-C', parent, 'for-each-ref', '--format=%(refname)'], { encoding: 'utf8' }), '');
        await assert.rejects(new GitRepository(parent).initialize());
        assert.equal(execFileSync('git', ['-C', parent, 'rev-parse', '--is-bare-repository'], { encoding: 'utf8' }).trim(), 'false');
    } finally { await rm(parent, { recursive: true, force: true }); }
});
test('Git adapter uses real commits, CAS refs, immutable UTF-8 files and durable release', async () => { const dir = await mkdtemp(join(tmpdir(), 'scada-git-test-')); try {
    const repo = await new GitRepository(dir).initialize();
    const first = await repo.commit(demoFiles, null, 'Начальная версия', engineer.id);
    assert.match(first.id, /^[a-f0-9]{40}$/);
    assert.deepEqual((await repo.read(first.id)).files, demoFiles);
    await repo.publish(first.id, null);
    const second = await repo.commit({ ...demoFiles, 'note.md': 'UTF-8 — 中文 — 🚰' }, first.id, 'Second', engineer.id);
    await assert.rejects(repo.commit(demoFiles, first.id, 'Conflict', engineer.id));
    assert.equal(await repo.desired(), first.id);
    await repo.publish(second.id, first.id);
    assert.equal(await new GitRepository(dir).desired(), second.id);
    assert.equal((await repo.log()).length, 2);
}
finally {
    await rm(dir, { recursive: true, force: true });
} });
test('archive keeps step segments, quality and predecessor at range boundary', () => { const store = new Store(new NodeSql()); for (const [time, value, quality] of [[0, 10, 'good'], [1000, 20, 'good'], [3000, null, 'offline'], [4000, 20, 'good']] as const)
    store.db.exec('INSERT INTO samples VALUES(?,?,?,?,?)', ['r', 'flow', time, value, quality]); const h = store.history('r', ['flow'], 500, 5000); assert.equal(h.segments[0].start, 500); assert.equal(h.segments[0].value, 10); assert.equal(h.segments.find(s => s.quality === 'offline')!.value, null); store.prune('r', 2000); assert.equal(store.history('r', ['flow'], 2000, 5000).segments[0].value, 20); store.db.close(); });
function task(): ReportTask { const report = project().reports[0]; return { id: 'test', report, revision: 'v1', runId: 'r', trigger: 'workflow_dispatch', actor: 'operator', createdAt: 0, from: 0, to: 5000, inputs: { scale: 1 }, data: { samples: [], segments: [{ signal: 'flow', start: 0, end: 1000, value: 10, quality: 'good' }, { signal: 'flow', start: 1000, end: 3000, value: 20, quality: 'good' }, { signal: 'flow', start: 3000, end: 4000, value: null, quality: 'offline' }, { signal: 'flow', start: 4000, end: 5000, value: 20, quality: 'good' }] } }; }
test('SQL report is time-weighted, exposes coverage and escapes HTML', () => { const t = task(); t.report.title = '<script>alert(1)</script>'; const result = executeReport(t, new NodeSql()); assert.equal(result.rows[0].average, 17.5); assert.equal(result.rows[0].coverage, 80); assert.ok(result.html.includes('&lt;script&gt;')); assert.ok(!result.html.includes('<script>')); });
test('report capsule cannot access operational tables or execute SQL writes', () => { for (const sql of ['SELECT * FROM users', 'DELETE FROM samples', 'SELECT 1; SELECT 2', 'SELECT load_extension(1)']) {
    const t = task();
    t.report.sql = sql;
    assert.throws(() => executeReport(t, new NodeSql()));
} });
test('manual and scheduled reports retain revision, deduplicate UTC minute and record completion', async () => { const s = await makeService(); for (let i = 0; i < 20; i++)
    s.tick(); const job = s.dispatch('thermal-balance', { scale: 1 }, engineer); await s.idle(); assert.equal(s.reports()[0].status, 'success'); assert.ok(s.reportArtifact(job.id).html.includes(s.frame().revision)); const at = Date.UTC(2026, 8, 17, 12, 0); s.schedule(at); s.schedule(at + 10000); await s.idle(); assert.equal(s.reports().filter((r: any) => r.trigger === 'schedule').length, 1); assert.ok(s.store.db.all('SELECT * FROM outbox').length >= 2); s.store.db.close(); });
test('cron UTC matching supports ranges, steps and DOM/DOW semantics', () => { assert.equal(cronMatches('*/15 9-17 * * 1-5', Date.UTC(2026, 8, 17, 12, 30)), true); assert.equal(cronMatches('*/15 9-17 * * 1-5', Date.UTC(2026, 8, 17, 12, 31)), false); assert.equal(cronMatches('0 0 1 * 4', Date.UTC(2026, 8, 17, 0, 0)), true); });
test('native report worker runs the same capsule with bounded execution', async () => { const result = await runReport(task()); assert.equal(result.rows[0].coverage, 80); });
test('Web Push allowlist, per-session subscription, expired endpoint handling', async () => { assert.equal(allowedPushEndpoint('https://127.0.0.1/api'), false); assert.equal(allowedPushEndpoint('http://fcm.googleapis.com/x'), false); assert.equal(allowedPushEndpoint('https://fcm.googleapis.com.evil.test/x'), false); const store = new Store(new NodeSql()), auth = new Auth(store); auth.seed('engineer', 'password-for-tests'); const login = auth.login('engineer', 'password-for-tests', 'local'), session = auth.session(`scada_session=${login.token}`); const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; let sent = 0; const push = new Push(store, 'mailto:operator@example.org', (async (_s: unknown, payload: unknown) => { sent++; assert.ok(!payload?.toString().includes('temperature')); throw Object.assign(new Error('Expired'), { statusCode: 410 }); }) as any); push.subscribe(subscription, engineer, session.sessionId); store.notify('notice', Date.now(), 'alarm', 'temperature'); await push.flush(); assert.equal(sent, 1); assert.equal(store.db.all('SELECT * FROM subscriptions').length, 0); assert.equal(store.db.all('SELECT status FROM deliveries')[0].status, 'expired'); auth.logout(session.sessionId); assert.throws(() => auth.session(`scada_session=${login.token}`), /expired/); store.db.close(); });
test('HTTP auth, CSRF, private HTML, SQL reports, SSE and revocation', async () => { const dir = await mkdtemp(join(tmpdir(), 'scada-http-test-')); const app = await startPlantServer({ port: 0, data: join(dir, 'db.sqlite'), repository: join(dir, 'repo.git'), password: 'password-for-http-tests', autoTick: false }); try {
    const base = app.origin + '/plant/';
    const landing = await fetch(app.origin + '/');
    assert.equal(landing.status, 200);
    const landingHTML = await landing.text();
    assert.ok(landingHTML.includes('hero-title'));
    assert.equal((await fetch(app.origin + '/', { method: 'HEAD' })).status, 200);
    const scriptPath = landingHTML.match(/<script[^>]+src="(\/site\/assets\/site-[^"]+\.js)"/)?.[1];
    assert.ok(scriptPath, 'Landing references its built module');
    const landingScript = await fetch(app.origin + scriptPath);
    assert.equal(landingScript.status, 200);
    assert.equal(landingScript.headers.get('content-type'), 'text/javascript');
    const starter = await fetch(app.origin + '/site/assets/first-pump.json');
    assert.equal(starter.status, 200);
    assert.equal(compileProject(await starter.json() as Record<string, string>).id, 'first-pump');
    const unauth = await fetch(base + 'app/', { redirect: 'manual' });
    assert.equal(unauth.status, 302);
    assert.equal((await fetch(base + 'api/session')).status, 401);
    assert.equal((await fetch(base + 'api/login', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    const logged = await fetch(base + 'api/login', { method: 'POST', headers: { 'content-type': 'application/json', Origin: app.origin }, body: JSON.stringify({ user: 'engineer', password: 'password-for-http-tests' }) });
    assert.equal(logged.status, 200);
    const cookie = logged.headers.get('set-cookie')!.split(';')[0], login = await logged.json() as any;
    const page = await fetch(base + 'app/', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok((await page.text()).includes('SCADA'));
    assert.equal((await fetch(base + 'api/restart', { method: 'POST', headers: { Cookie: cookie, Origin: app.origin, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const stream = await fetch(base + 'api/stream', { headers: { Cookie: cookie } });
    const reader = stream.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: frame/);
    await reader.cancel();
    app.service.tick();
    const report = await fetch(base + 'api/report', { method: 'POST', headers: { Cookie: cookie, Origin: app.origin, 'content-type': 'application/json', 'x-csrf-token': login.csrf }, body: JSON.stringify({ reportId: 'thermal-balance' }) });
    assert.equal(report.status, 202);
    await app.service.idle();
    assert.equal(app.service.reports()[0].status, 'success');
    const firmware=await fetch(base+'api/firmware',{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'content-type':'application/json','x-csrf-token':login.csrf},body:JSON.stringify({controllerId:'SATURN-1',revision:app.service.frame().revision})});
    assert.equal(firmware.status,200);const program=await firmware.json() as any;assert.equal(program.hardwareVerified,false);assert.ok(program.fbdbin.length>100);
    assert.equal((await fetch(base+'api/firmware',{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'content-type':'application/json'},body:'{}'})).status,403);
    const logout = await fetch(base + 'api/logout', { method: 'POST', headers: { Cookie: cookie, Origin: app.origin, 'content-type': 'application/json', 'x-csrf-token': login.csrf }, body: '{}' });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(base + 'api/session', { headers: { Cookie: cookie } })).status, 401);
}
finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
} });
test('history accepts contemporary epoch timestamps and returns a predecessor segment', async () => { const s = await makeService(); s.kernel.state.epoch = Date.UTC(2026, 8, 17); s.kernel.state.time = s.kernel.state.epoch; for (let i = 0; i < 4; i++)
    s.tick(); const now = s.frame().time; assert.ok(now > 1e12); const rows = s.history(['GRID.voltage'], now - 200, now); assert.ok(rows.segments.length > 0); assert.equal(rows.segments[0].value, 1); s.store.db.close(); });
test('per-signal archive policies suppress unchanged values without hiding quality changes', () => { const p = project(); p.simulations.find(n => n.id === 'GRID')!.history = { voltage: { deadband: 0, maxInterval: 200, retention: 60000 } }; const k = new Kernel(p, 'revision', 'run', 0), store = new Store(new NodeSql()); store.save(p, k.state, {}, k.frame(), [], p.history, new Set()); for (let i = 0; i < 5; i++) {
    const f = k.step();
    store.save(p, k.state, {}, f, [], p.history, new Set());
} assert.equal(store.db.all("SELECT * FROM samples WHERE signal='GRID.voltage'").length, 3); const frame = k.frame(); frame.samples['GRID.voltage'].value = null; frame.samples['GRID.voltage'].quality = 'offline'; store.save(p, k.state, {}, frame, [], p.history, new Set()); assert.equal(store.db.all("SELECT quality FROM samples WHERE signal='GRID.voltage' ORDER BY time DESC")[0].quality, 'offline'); store.db.close(); });
test('checkpoint restore rejects incompatible installed model versions', () => { const p = project(), k = new Kernel(p, 'r', 'run', 0); k.state.modelVersions.pump = 'incompatible'; assert.throws(() => new Kernel(p, 'r', 'run', 0, k.state), /version mismatch/); });
test('invalid report SQL closes its isolated database', () => { const db = new NodeSql(), t = task(); t.report.sql = 'DELETE FROM samples'; assert.throws(() => executeReport(t, db)); assert.throws(() => db.all('SELECT 1'), /not open|closed/i); });
test('browser-sized DSL rejects excessive banks and unknown visual types', () => { assert.throws(() => compileProject({ ...demoFiles, 'core.ts': demoFiles['core.ts'].replace('count: 6', 'count: 999') })); const p = project(); p.devices[0].type = 'missing-symbol'; assert.throws(() => validateProject(p), /device type/); });
test('push survives cookie expiration, but explicit logout revokes the device subscription', async () => { const store = new Store(new NodeSql()), auth = new Auth(store); auth.seed('engineer', 'password-for-expiry-tests'); const login = auth.login('engineer', 'password-for-expiry-tests', 'local'), session = auth.session(`scada_session=${login.token}`); const key = createECDH('prime256v1'); key.generateKeys(); let sent = 0; const push = new Push(store, 'mailto:operator@example.org', (async () => { sent++; return { statusCode: 201 }; }) as any); push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/expiry', keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, engineer, session.sessionId); store.db.exec('UPDATE sessions SET expires=0'); store.notify('first', Date.now(), 'report', 'report-id'); await push.flush(); assert.equal(sent, 1); auth.logout(session.sessionId); store.notify('second', Date.now(), 'alarm', 'alarm-id'); await push.flush(); assert.equal(sent, 1); store.db.close(); });

test('native SQL runaway is terminated in its isolated process without stopping the runtime', async () => {
    const t = task();
    t.data.samples = Array.from({length: 500}, (_, i) => ({signal:'flow',time:i,value:i,quality:'good'}));
    t.report.sql = 'SELECT count(*) AS total FROM samples a, samples b, samples c, samples d';
    await assert.rejects(runReport(t, 300), /budget/);
    assert.equal((await runReport(task())).rows[0].coverage, 80);
});

test('PLC artifact export checks engineer role, revision and target, and includes a hardware qualification boundary',async()=>{
 const s=await makeService();try{assert.throws(()=>s.firmware('SATURN-1',s.frame().revision,viewer),/permission/);assert.throws(()=>s.firmware('SATURN-1','stale',engineer),/revision/);assert.throws(()=>s.firmware('absent',s.frame().revision,engineer),/Unknown/);const a=s.firmware('SATURN-1',s.frame().revision,engineer);assert.equal(a.hardwareVerified,false);assert.ok(a.fbdbin.length>100);assert.equal(a.expansions[0].profile,'virtual-io4');assert.match(a.runtimeHash,/^[a-f0-9]{64}$/);}finally{s.store.db.close();}
});
test('layout-only edits preserve the run and compiled program',async()=>{
 const s=await makeService();try{for(let i=0;i<20;i++)s.tick();const old=s.frame(),files={...demoFiles,'commissioning.ts':demoFiles['commissioning.ts'].replace('x:760,y:3100','x:765,y:3100')};const head=await s.repository.head(),commit=await s.save(files,head,'Move PLC',engineer);await s.publish(commit.id,await s.repository.desired(),engineer);assert.equal(s.frame().runId,old.runId);assert.deepEqual(s.frame().displays,old.displays);}finally{s.store.db.close();}
});
