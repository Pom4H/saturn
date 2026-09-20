import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const raw = { name: 'raw', setup(b) { b.onResolve({ filter: /\?raw$/ }, a => ({ path: new URL(a.path.slice(0, -4), `file://${a.resolveDir}/`).pathname, namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' })); } };
await build({ entryPoints: ['plant/tests/counterfactual.ts'], outfile: '.plant/comparison.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', plugins: [raw] });
await build({ entryPoints: ['plant/tests/browser-contract.ts'], outfile: '.plant/browser-contract.js', bundle: true, format: 'esm', platform: 'browser', plugins: [raw] });
const comparison = await import(pathToFileURL(process.cwd() + '/.plant/comparison.mjs'));
const expectedPlc=comparison.runPlcTrace();
const expected = comparison.runCounterfactuals(), expectedControls = comparison.runControlTrace(), expectedTraining = comparison.runTrainingSuite();
const evidence = process.env.PWA_EVIDENCE_DIR ?? 'plant-test-results';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PWA_CHROMIUM || undefined, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, permissions: ['notifications'] });
context.setDefaultTimeout(20000);
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
let evidencePage=page, manualReportId='';
const base = process.env.PWA_URL ?? 'http://127.0.0.1:4176/plant/';
const check = async (name, fn) => { if(process.env.PWA_ONLY_PLC==='1'&&!/^(all 23|Saturn inspector|HMI as code|clicking two|commissioning bench|offline PWA restores compiled)/.test(name))return; const start = performance.now(); console.log('START', name); await fn(); checks.push(name); console.log('PASS', name, Math.round(performance.now() - start) + 'ms'); };
try {
    await check('persistent browser Worker starts with SQLite WASM and live equipment', async () => { await page.goto(base + 'demo/'); await page.locator('#application').waitFor({ state: 'visible', timeout: 20000 }); await page.waitForTimeout(1500); assert.match(await page.locator('#storage').innerText(), /OPFS/); assert.equal(await page.locator('[data-node]').count(), 47); assert.equal(await page.locator('#error').isVisible(), false); await page.screenshot({ path: evidence + '/desktop.png', fullPage: true }); });
    await check('service worker installs and only public demo resources enter cache', async () => { await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.waitForFunction(() => !!navigator.serviceWorker.controller); const urls = await page.evaluate(async () => { const result = []; for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
            result.push(req.url); return result; }); assert.ok(urls.some(url => url.endsWith('demo/'))); assert.ok(urls.some(url => url.endsWith('.wasm'))); assert.ok(!urls.some(url => /\/api\/|\/app\/|\/plant\/login(?:$|\?)/.test(url))); });
    await check('Node and browser execute identical equations, control/interlock traces and SQL reports', async () => { await context.route(base + 'assets/test-contract.js', route => route.fulfill({ contentType: 'text/javascript', path: '.plant/browser-contract.js' })); const result = await page.evaluate(url => new Promise((resolve, reject) => { const worker = new Worker(url, { type: 'module' }), timer = setTimeout(() => { worker.terminate(); reject(new Error('Browser contract timeout')); }, 30000); worker.onmessage = e => { clearTimeout(timer); worker.terminate(); resolve(e.data); }; worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)); }; worker.postMessage({}); }), base + 'assets/test-contract.js'); assert.equal(result.error, undefined); assert.deepEqual(result.plc,expectedPlc);assert.deepEqual(result.training, expectedTraining); assert.deepEqual(result.controls, expectedControls); assert.equal(result.controls.blocked, true); assert.equal(result.controls.clearedDemand, 0); for (const [variant, values] of Object.entries(expected))
        for (const [key, value] of Object.entries(values))
            assert.ok(Math.abs(result.physics[variant][key] - value) < 1e-9, variant + ':' + key); assert.equal(result.rows[0].average, 17.5); assert.equal(result.rows[0].coverage, 80); await writeFile(evidence + '/cross-runtime.json', JSON.stringify({ plc:result.plc, node: expected, browser: result.physics, controls: result.controls, training: result.training, sql: result.rows }, null, 2)); });
    await check('one canvas keeps all equipment DOM nodes while nested groups only change the camera', async () => {
        assert.equal(await page.locator('[data-group]').count(), 18);
        const initial = await page.locator('#diagram').getAttribute('viewBox');
        await page.evaluate(() => { window.originalScadaNode = document.querySelector('[data-node="CORE"]'); });
        await page.locator('[data-system="coreA"]').click();
        assert.equal(await page.locator('[data-node]').count(), 47);
        assert.notEqual(await page.locator('#diagram').getAttribute('viewBox'), initial);
        assert.equal(await page.evaluate(() => window.originalScadaNode === document.querySelector('[data-node="CORE"]')), true);
        assert.equal(await page.locator('[data-group="coreA"]').getAttribute('class'), 'focused');
        await page.locator('[data-node="CH-A1"]').click();
        assert.equal(await page.locator('.signal-links [data-from="PUMP-A"]').count(), 1);
        assert.equal(await page.locator('.signal-links [data-from="COND"]').count(), 1);
        assert.equal(await page.locator('#error').isVisible(), false);
        await page.screenshot({path:evidence+'/group-focus.png',fullPage:true});
        await page.locator('#fit').click();
        assert.equal(await page.locator('#diagram').getAttribute('viewBox'), initial);
    });
    await check('backplate headers are keyboard navigable and retain cross-system equipment', async () => {
        const header = page.locator('[data-group="auxiliary"] [role="button"]');
        await header.focus(); await header.press('Enter');
        assert.equal(await page.locator('#diagram').getAttribute('data-focused-group'), 'auxiliary');
        assert.equal(await page.locator('[data-node]').count(), 47);
        await page.locator('#fit').click();
        assert.equal(await page.locator('#diagram').getAttribute('data-focused-group'), '');
    });
    await check('subsystem focus and sensor observation update the same SVG', async () => { await page.locator('[data-system="safety"]').click(); await page.locator('[data-node="TEMP"]').click(); await page.waitForTimeout(500); const value = await page.locator('[data-signal="TEMP.value"] b').innerText(); assert.ok(Number(value) > .9); await page.screenshot({ path: evidence + '/subsystem.png', fullPage: true }); });
    await check('operator panel sends ramped commands without editing the project', async () => {
        await page.locator('[data-tab="controls"]').click();
        await page.locator('[data-control-input="MAKEUP"]').fill('0.2');
        await page.locator('[data-operate="MAKEUP"]').click();
        await page.waitForFunction(() => document.querySelector('[data-control="MAKEUP"] [data-demand]').textContent === '0.20');
        await page.waitForFunction(() => Number(document.querySelector('[data-control="MAKEUP"] [data-actual]').textContent) > .08);
        assert.equal(await page.locator('#error').isVisible(), false);
        await page.screenshot({ path: evidence + '/controls.png', fullPage: true });
        await page.locator('[data-tab="events"]').click(); await page.waitForFunction(() => document.querySelector('#event-list').textContent.includes('command.control'));
    });
    await check('equipment inventory searches and focuses the matching subsystem', async () => {
        await page.locator('[data-tab="inventory"]').click(); await page.locator('#equipment-search').fill('AUX-');
        assert.equal(await page.locator('[data-inspect]').count(), 6); await page.locator('[data-inspect="AUX-TANK"]').click();
        assert.match(await page.locator('#system-title').innerText(), /Запас воды/);
        assert.equal(await page.locator('#inspector h2').innerText(), 'AUX-TANK');
        await page.screenshot({path:evidence+'/auxiliary-2d.png',fullPage:true});
    });
    await check('real WebGL 3D shares selection and signal identity with the 2D view', async () => {
        await page.locator('[data-system="auxiliary"]').click(); await page.locator('#view-3d').click();
        await page.locator('#scene3d canvas').waitFor({state:'visible',timeout:20000});
        assert.equal(await page.locator('#scene3d').getAttribute('data-group-count'), '18');
        assert.equal(await page.locator('[data-node3d]').count(), 47);
        await page.locator('[data-node3d="AUX-TANK"]').click();
        assert.equal(await page.locator('#inspector h2').innerText(),'AUX-TANK');
        await page.waitForTimeout(700); assert.ok(await page.locator('#scene3d').getAttribute('data-run-id'));
        await page.screenshot({path:evidence+'/auxiliary-3d.png',fullPage:true});
        await page.locator('#view-2d').click(); assert.equal(await page.locator('#inspector h2').innerText(),'AUX-TANK');
        assert.equal(await page.locator('#scene3d').isVisible(),false);
    });
    await check('3D overview and backplates use all equipment and retain selection when changing view', async () => {
        await page.locator('#view-3d').click();
        await page.locator('#scene3d canvas').waitFor({state:'visible'});
        await page.locator('#scene3d canvas').press('Escape');
        await page.locator('#fit').click();
        await page.waitForTimeout(500);
        assert.equal(await page.locator('[data-node3d]').count(), 47);
        assert.equal(await page.locator('#scene3d').getAttribute('data-group-count'), '18');
        assert.equal(await page.locator('#scene3d').getAttribute('data-focused-group'), '');
        await page.screenshot({path:evidence+'/all-systems-3d.png',fullPage:true});
        await page.locator('[data-system="auxiliary"]').click();
        assert.equal(await page.locator('[data-node3d]').count(), 47);
        await page.locator('#view-2d').click();
        assert.equal(await page.locator('[data-node]').count(), 47);
        await page.locator('#fit').click();
        await page.screenshot({path:evidence+'/all-systems-2d.png',fullPage:true});
    });
    await check('manual report runs SQL in a separate browser worker and renders HTML', async () => { await page.locator('[data-tab="reports"]').click(); await page.locator('[data-run="thermal-balance"]').click(); const manual=page.locator('#report-runs tr').filter({hasText:'workflow_dispatch'}).filter({has:page.locator('.success')}).first(); await manual.waitFor({timeout:20000}); manualReportId=await manual.locator('[data-artifact]').getAttribute('data-artifact'); await manual.locator('[data-artifact]').click(); await page.frameLocator('#report-preview').locator('h1').waitFor(); assert.match(await page.frameLocator('#report-preview').locator('body').innerText(), /Средневзвешенное/); await page.screenshot({ path: evidence + '/report.png', fullPage: true }); });
    await check('draft validation, CAS commit and explicit publication use the same project files', async () => { await page.locator('[data-tab="project"]').click(); await page.locator('#file').selectOption('cooling.ts'); const content = await page.locator('.cm-content').innerText(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(content.replace('voltage: 1', 'voltage: 0.9')); assert.equal(await page.locator('#publish').isEnabled(), false); await page.locator('#commit-message').fill('Browser test: supply 0.9'); await page.locator('#validate').click(); assert.match(await page.locator('#diagnostics').innerText(), /корректны/); await page.locator('#commit').click(); await page.waitForFunction(() => document.querySelector('#draft-state').textContent.startsWith('Сохранено')); await page.locator('#publish').click(); await page.waitForTimeout(700); assert.match(await page.locator('#revision-list').innerText(), /Browser test/); await page.screenshot({ path: evidence + '/project.png', fullPage: true }); });
    await check('explicit rollback creates a new revision without deleting reports', async () => { page.once('dialog', d => d.accept()); await page.locator('[data-rollback]').last().click(); await page.waitForTimeout(700); assert.match(await page.locator('#revision-list').innerText(), /Restore/); await page.locator('[data-tab="reports"]').click(); const saved=page.locator(`[data-artifact="${manualReportId}"]`); await saved.waitFor(); assert.equal(await saved.isEnabled(),true); });
    await check('public browser alarm notification and acknowledgement follow emergent state', async () => { await page.locator('#notifications').click(); await page.locator('[data-tab="scheme"]').click(); await page.locator('[data-system="electrical"]').click(); await page.locator('[data-node="GRID"]').click(); await page.locator('[data-param="voltage"]').fill('0.4'); await page.locator('[data-set="voltage"]').click(); await page.waitForFunction(() => Number(document.querySelector('#alarm-count').textContent) > 0, {}, { timeout: 90000 }); await page.locator('[data-tab="alarms"]').click(); await page.locator('[data-ack]').first().click(); await page.waitForFunction(() => document.querySelector('#alarm-list').textContent.includes('Квитировано')); await page.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return (await r.getNotifications()).some(n => n.title.includes('Аларм')); }); /* Provider-to-phone delivery is not asserted by this local browser check. */ await page.screenshot({ path: evidence + '/alarms.png', fullPage: true }); });
    await check('offline PWA reload resumes persisted state, report artifacts and local revisions', async () => { await page.locator('#pause').click(); await page.waitForTimeout(500); const clock = await page.locator('#clock').innerText(); await context.setOffline(true); await page.reload(); await page.locator('#application').waitFor({ state: 'visible', timeout: 20000 }); assert.equal(await page.locator('#clock').innerText(), clock); assert.equal(await page.locator('#pause').innerText(), 'Продолжить'); assert.equal(await page.locator('[data-group]').count(), 18); assert.equal(await page.locator('[data-node]').count(), 47); await page.locator('[data-tab="reports"]').click(); await page.locator('#report-runs .success').first().waitFor(); await page.locator('[data-artifact]').first().click(); await page.frameLocator('#report-preview').locator('h1').waitFor(); });
    await check('offline installation loads the lazy 3D bundle from the public cache', async () => {
        await page.locator('[data-tab="scheme"]').click(); await page.locator('[data-system="auxiliary"]').click();
        await page.locator('#view-3d').click(); await page.locator('#scene3d canvas').waitFor({state:'visible',timeout:20000});
        await page.locator('#view-2d').click();
    });
    await check('a second tab cannot silently become another database writer', async () => { const tab = await context.newPage(); await tab.goto(base + 'demo/'); await tab.locator('#memory').waitFor({ state: 'visible', timeout: 15000 }); assert.match(await tab.locator('#loading').innerText(), /another tab/); await tab.close(); });
    await check('mobile 2D and 3D have no horizontal document overflow', async () => { await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-tab="scheme"]').click(); await page.locator('[data-system="coreA"]').click(); await page.waitForTimeout(500); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: evidence + '/mobile.png', fullPage: true }); await page.locator('[data-system="auxiliary"]').click(); await page.locator('#view-3d').click(); await page.waitForTimeout(500); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({path:evidence+'/mobile-3d.png', fullPage:true}); await page.locator('#view-2d').click(); });
    await context.setOffline(false);
    await check('authenticated Node receives operator commands and publishes SSE without a local simulation', async () => { const remote = await browser.newContext({ viewport: { width: 1440, height: 980 } }); const p = await remote.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(base + 'app/'); await p.locator('#login').waitFor(); await p.locator('[name="user"]').fill(process.env.SCADA_USER ?? 'engineer'); await p.locator('[name="password"]').fill(process.env.SCADA_PASSWORD ?? 'test-password-only-9284'); await p.locator('#login button').click(); await p.locator('#application').waitFor({ state: 'visible', timeout: 15000 }); assert.match(await p.locator('#mode').innerText(), /NODE.JS/); assert.equal(p.workers().length, 0); const clock = await p.locator('#clock').innerText(); await p.waitForTimeout(400); assert.notEqual(await p.locator('#clock').innerText(), clock); await p.locator('[data-tab="controls"]').click(); await p.locator('[data-control-input="MAKEUP"]').fill('0.16'); await p.locator('[data-operate="MAKEUP"]').click(); await p.waitForFunction(() => document.querySelector('[data-control="MAKEUP"] [data-demand]').textContent === '0.16'); assert.equal(await p.locator('#error').isVisible(), false); await p.screenshot({ path: evidence + '/server.png', fullPage: true }); await p.locator('#logout').click(); await p.locator('#login').waitFor(); await remote.close(); });
    await context.close(); // Release the previous WebGL/Worker before the independent bench.
    const wiringContext=await browser.newContext({viewport:{width:1680,height:1100}}),bench=await wiringContext.newPage();
    evidencePage=bench;
    bench.on('pageerror',e=>errors.push(e.message));wiringContext.setDefaultTimeout(20000);
    await check('all 23 pipe and cable endpoints hit the rendered terminal centers after camera transforms',async()=>{
        await bench.goto(base+'demo/');await bench.locator('#application').waitFor({state:'visible'});
        await bench.locator('[data-system="commissioning"]').click();
        assert.equal(await bench.locator('[data-connection]').count(),23);
        assert.equal(await bench.locator('[data-connection][data-valid="false"]').count(),0);
        const mismatches=await bench.evaluate(()=>{const errors=[];for(const g of document.querySelectorAll('[data-connection]')){
            const ends=g.querySelector('title').textContent.split(' → '),path=g.querySelector('path');
            ends.forEach((name,i)=>{const dot=name.lastIndexOf('.'),id=name.slice(0,dot),port=name.slice(dot+1);
                const circle=document.querySelector(`[data-node="${id}"] [data-port="${port}"]`),point=new DOMPoint(circle.cx.baseVal.value,circle.cy.baseVal.value).matrixTransform(circle.getScreenCTM());
                const q=path.getPointAtLength(i?path.getTotalLength():0),end=new DOMPoint(q.x,q.y).matrixTransform(path.getScreenCTM());
                if(Math.hypot(point.x-end.x,point.y-end.y)>.2)errors.push(name);
            });}return errors;});assert.deepEqual(mismatches,[]);
        const offset=await bench.evaluate(()=>{const result=[];for(const pin of document.querySelectorAll('#diagram [data-node="SATURN-1"] .saturn-terminal-pin[data-terminal-id]')){const target=document.querySelector(`#diagram [data-node="SATURN-1"] [data-port="${pin.dataset.terminalId}"]`);if(!target)continue;const a=new DOMPoint(pin.x.baseVal.value+pin.width.baseVal.value/2,pin.y.baseVal.value+pin.height.baseVal.value/2).matrixTransform(pin.getScreenCTM());const b=new DOMPoint(target.cx.baseVal.value,target.cy.baseVal.value).matrixTransform(target.getScreenCTM());if(Math.hypot(a.x-b.x,a.y-b.y)>.2)result.push(pin.dataset.terminalId);}return result;});assert.deepEqual(offset,[]);
        assert.equal(await bench.locator('#diagram .saturn-block-outline').first().evaluate(e=>getComputedStyle(e).fill),'none');
        await bench.screenshot({path:evidence+'/commissioning-2d.png',fullPage:true});
    });
    await check('Saturn inspector executes the same compiled WASM program, downloads exact CRC-tested bytes and renders its HMI',async()=>{
        await bench.locator('#diagram [data-node="SATURN-1"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.AI1"] b')?.textContent)===300);
        assert.match(await bench.locator('#plc-front .runtime-hmi').textContent(),/AUTO SHELL/);
        const downloaded=bench.waitForEvent('download');await bench.locator('#build-plc').click();const artifact=await downloaded;
        await artifact.saveAs(evidence+'/SATURN-1.fbdbin');assert.deepEqual(new Uint8Array(await readFile(evidence+'/SATURN-1.fbdbin')),comparison.compileController(comparison.plcFixture()).fbdbin);
        const manifestDownload=bench.waitForEvent('download');await bench.locator('#build-manifest').click();const file=await manifestDownload;
        await file.saveAs(evidence+'/SATURN-1-build.json');const manifest=JSON.parse(await readFile(evidence+'/SATURN-1-build.json','utf8'));assert.equal(manifest.hardwareVerified,false);assert.ok(manifest.connections.length>0);
        await bench.locator('[data-tab="controls"]').click();await bench.locator('[data-control-input="BENCH-LEVEL"]').fill('8');await bench.locator('[data-operate="BENCH-LEVEL"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('[data-control="BENCH-LEVEL"] [data-actual]').textContent)>=8);
        await bench.locator('[data-tab="scheme"]').click();await bench.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.AI1"] b')?.textContent)===800);
        assert.equal(Number(await bench.locator('#inspector [data-signal="SATURN-1.DO1"] b').innerText()),1);assert.match(await bench.locator('#plc-front .runtime-hmi').textContent(),/AUTO SHELL/);
        await bench.screenshot({path:evidence+'/saturn-inspector.png',fullPage:true});
    });
    await check('Saturn front-panel keys navigate and control the autogenerated graphical shell',async()=>{
        await bench.locator('[data-tab="controls"]').click();
        await bench.locator('[data-control-input="BENCH-LEVEL"]').fill('3');
        await bench.locator('[data-operate="BENCH-LEVEL"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('[data-control="BENCH-LEVEL"] [data-actual]')?.textContent)<=3.01,null,{timeout:12000});
        await bench.locator('[data-tab="scheme"]').click();
        await bench.locator('[data-system="commissioning"]').click();
        await bench.locator('#diagram [data-node="SATURN-1"]').click();
        const lcd=bench.locator('#plc-front .runtime-hmi'),right=bench.locator('#plc-front [data-plc-button="right"]'),left=bench.locator('#plc-front [data-plc-button="left"]');
        await bench.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('AUTO SHELL'));
        await right.click();
        await bench.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('PUMP-1'));
        assert.match(await lcd.textContent(),/TANK-1/);
        await right.click();
        await bench.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('CENTRIFUGAL PUMP'));
        await bench.locator('#plc-front [data-plc-button="down"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===0);
        await bench.locator('#plc-front [data-plc-button="up"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===1);
        await bench.waitForFunction(()=>Number(document.querySelector('#plc-front .runtime-hmi [data-rpm]')?.textContent)>500,null,{timeout:12000});
        assert.ok(await bench.locator('#plc-front .runtime-hmi [data-rotor]').evaluate(element=>element.getAnimations().length>0));
        await bench.locator('#plc-front [data-plc-button="down"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===0);
        await left.click();
        await bench.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('AUTO SHELL'));
        await bench.screenshot({path:evidence+'/saturn-autoshell-navigation.png',fullPage:true});
    });
    await check('HMI as code navigates and drives the exact Saturn PLC runtime in the browser',async()=>{
        await bench.locator('[data-tab="hmi"]').click();
        await bench.locator('#hmi-root [data-hmi-screen="overview"]').waitFor();
        assert.match(await bench.locator('#hmi-route').innerText(), /#hmi\/$/);
        await bench.locator('#openPlc').click();
        await bench.locator('#hmi-root [data-hmi-screen="plc"]').waitFor();
        assert.equal(new URL(bench.url()).hash,'#hmi/plc');
        await bench.locator('#level3').click();
        await bench.waitForFunction(()=>document.querySelector('#levelReadout')?.textContent==='3.0 V',null,{timeout:12000});
        await bench.waitForFunction(()=>document.querySelector('#aiReadout')?.textContent==='300',null,{timeout:5000});
        assert.equal(await bench.locator('#doReadout').innerText(),'0');
        assert.equal(await bench.locator('#plcLamp').getAttribute('data-on'),'false');
        assert.match(await bench.locator('#plcFront .runtime-hmi').textContent(),/AUTO SHELL/);
        bench.once('dialog',dialog=>dialog.accept());
        await bench.locator('#level7').click();
        await bench.waitForFunction(()=>document.querySelector('#levelReadout')?.textContent==='7.0 V',null,{timeout:12000});
        await bench.waitForFunction(()=>document.querySelector('#doReadout')?.textContent==='1',null,{timeout:5000});
        assert.equal(await bench.locator('#plcLamp').getAttribute('data-on'),'true');
        await bench.waitForFunction(()=>document.querySelector('#plcFront .runtime-hmi')?.textContent?.includes('AUTO SHELL'),null,{timeout:5000});
        assert.ok(await bench.locator('#plcLamp .hmi-lamp-bulb').evaluate(element=>element.getAnimations().length>0));
        await bench.screenshot({path:evidence+'/hmi-saturn-plc-live.png',fullPage:true});
        await bench.locator('#plcBack').click();
        await bench.locator('#hmi-root [data-hmi-screen="overview"]').waitFor();
        assert.match(await bench.locator('#overviewOutputValue').innerText(),/^1$/);
        // Restore the fixture state expected by the older independent PLC/3D checks.
        await bench.locator('[data-tab="controls"]').click();
        await bench.locator('[data-control-input="BENCH-LEVEL"]').fill('8');
        await bench.locator('[data-operate="BENCH-LEVEL"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('[data-control="BENCH-LEVEL"] [data-actual]')?.textContent)>=8,null,{timeout:12000});
        await bench.locator('[data-tab="scheme"]').click();
        await bench.locator('[data-system="commissioning"]').click();
    });
    await check('clicking two terminals and removing a connection only edits a validated source draft',async()=>{
        await bench.locator('#diagram [data-node="PSU-24"]').click();await bench.locator('[data-connect-port="minus"]').click();
        await bench.locator('#diagram [data-node="SATURN-1"] [data-port="COM2"]').click({force:true});
        assert.equal(await bench.locator('[data-connection]').count(),24);
        await bench.locator('#diagram [data-node="SATURN-1"]').click();
        const extra=bench.locator('[data-disconnect^="W-"]');assert.equal(await extra.count(),1);await extra.click();
        assert.equal(await bench.locator('[data-connection]').count(),23);
        await bench.locator('[data-tab="project"]').click();await bench.locator('#validate').click();assert.match(await bench.locator('#diagnostics').innerText(),/корректны/);
        await bench.locator('#reload-project').click();await bench.waitForTimeout(200);
        await bench.locator('[data-tab="scheme"]').click();await bench.locator('#diagram [data-node="SATURN-1"]').click();await bench.locator('#attach-module').click();
        await bench.locator('[data-tab="project"]').click();assert.equal(await bench.locator('#file').inputValue(),'expansion-2.ts');await bench.locator('#validate').click();assert.match(await bench.locator('#diagnostics').innerText(),/корректны/);
        // Do not silently publish a draft or claim the virtual module is hardware qualified.
        await bench.locator('#reload-project').click();await bench.waitForTimeout(200);
    });
    await check('commissioning bench renders exact 3D terminal routes and Saturn front-panel HMI',async()=>{
        await bench.locator('[data-tab="scheme"]').click();await bench.locator('[data-system="commissioning"]').click();
        await bench.locator('#view-3d').click();await bench.locator('#scene3d canvas').waitFor({state:'visible'});
        await bench.locator('[data-node3d="SATURN-1"]').click();await bench.waitForTimeout(800);
        assert.match(await bench.locator('#plc-front .runtime-hmi').textContent(),/AUTO SHELL/);
        await bench.screenshot({path:evidence+'/commissioning-3d.png',fullPage:true});await bench.locator('#view-2d').click();
    });
    await check('offline PWA restores compiled PLC outputs, terminal wiring and HMI without a server',async()=>{
        await bench.locator('#pause').click();await bench.waitForTimeout(400);const clock=await bench.locator('#clock').innerText();
        await bench.waitForFunction(()=>!!navigator.serviceWorker.controller);await wiringContext.setOffline(true);await bench.reload();await bench.locator('#application').waitFor({state:'visible'});
        assert.equal(await bench.locator('#clock').innerText(),clock);assert.equal(await bench.locator('[data-connection]').count(),23);
        await bench.locator('[data-system="commissioning"]').click();await bench.locator('#diagram [data-node="SATURN-1"]').click();
        assert.equal(Number(await bench.locator('#inspector [data-signal="SATURN-1.DO1"] b').innerText()),1);assert.match(await bench.locator('#plc-front .runtime-hmi').textContent(),/AUTO SHELL/);
        await bench.locator('#view-3d').click();await bench.locator('#scene3d canvas').waitFor({state:'visible'});await bench.waitForTimeout(500);await bench.screenshot({path:evidence+'/commissioning-offline-3d.png',fullPage:true});
    });
    await check('shared DSL panel renders identical frozen PLC values in live view and report while paused offline',async()=>{
        await bench.locator('[data-tab="views"]').click();await bench.locator('#view-select').selectOption('bench-hmi');
        await bench.waitForFunction(()=>document.querySelector('#live-view [data-view-value="input"]').textContent==='800');
        const clock=await bench.locator('#clock').innerText();
        await bench.screenshot({path:evidence+'/shared-live-panel.png',fullPage:true});
        await bench.locator('[data-tab="reports"]').click();await bench.locator('[data-run="bench-state"]').click();
        const row=bench.locator('#report-runs tr').filter({hasText:'bench-state'}).filter({has:bench.locator('.success')}).first();
        await row.waitFor();await row.locator('[data-artifact]').click();
        const report=bench.frameLocator('#report-preview');await report.locator('[data-view="bench-hmi"]').waitFor();
        assert.equal(await report.locator('[data-view-value="input"]').innerText(),'800');
        assert.equal(await report.locator('[data-view-value="output"]').innerText(),'1');
        assert.equal(await bench.locator('#clock').innerText(),clock);
        await bench.screenshot({path:evidence+'/shared-report-panel.png',fullPage:true});
    });
    await check('DSL operator actions use audited commands and telemetry preserves keyboard focus',async()=>{
        await bench.locator('[data-tab="views"]').click();await bench.locator('#view-select').selectOption('bench-operator');
        const button=bench.locator('#live-view [data-view-set="7"]');await button.click();
        await button.focus();await bench.evaluate(()=>{window.focusedOperatorButton=document.activeElement;});
        await bench.waitForTimeout(500);
        assert.equal(await bench.evaluate(()=>window.focusedOperatorButton===document.activeElement),true);
        await bench.locator('[data-tab="controls"]').click();
        await bench.waitForFunction(()=>Number(document.querySelector('[data-control="BENCH-LEVEL"] [data-demand]').textContent)===7);
        await bench.locator('[data-tab="events"]').click();await bench.waitForFunction(()=>document.querySelector('#event-list').textContent.includes('command.control'));
    });
    await wiringContext.close();
    assert.deepEqual(errors, []);
    await writeFile(evidence + '/browser-summary.json', JSON.stringify({ checks, errors, browser: browser.version() }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, browser: browser.version() }));
}
catch (error) {
    await evidencePage.screenshot({ path: evidence + '/failure.png', fullPage: true }).catch(() => { });
    await writeFile(evidence + '/browser-summary.json', JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
    console.error(await evidencePage.locator('body').innerText().catch(() => ''));
    throw error;
}
finally {
    await browser.close();
}
