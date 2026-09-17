import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const raw = { name: 'raw', setup(b) { b.onResolve({ filter: /\?raw$/ }, a => ({ path: new URL(a.path.slice(0, -4), `file://${a.resolveDir}/`).pathname, namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' })); } };
await build({ entryPoints: ['plant/tests/counterfactual.ts'], outfile: '.plant/comparison.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', plugins: [raw] });
await build({ entryPoints: ['plant/tests/browser-contract.ts'], outfile: '.plant/browser-contract.js', bundle: true, format: 'esm', platform: 'browser', plugins: [raw] });
const comparison = await import(pathToFileURL(process.cwd() + '/.plant/comparison.mjs'));
const expected = comparison.runCounterfactuals(), expectedControls = comparison.runControlTrace(), expectedTraining = comparison.runTrainingSuite();
const evidence = process.env.PWA_EVIDENCE_DIR ?? 'plant-test-results';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PWA_CHROMIUM || undefined, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, permissions: ['notifications'] });
context.setDefaultTimeout(20000);
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
const base = process.env.PWA_URL ?? 'http://127.0.0.1:4176/plant/';
const check = async (name, fn) => { const start = performance.now(); console.log('START', name); await fn(); checks.push(name); console.log('PASS', name, Math.round(performance.now() - start) + 'ms'); };
try {
    await check('persistent browser Worker starts with SQLite WASM and live equipment', async () => { await page.goto(base + 'demo/'); await page.locator('#application').waitFor({ state: 'visible', timeout: 20000 }); await page.waitForTimeout(1500); assert.match(await page.locator('#storage').innerText(), /OPFS/); assert.equal(await page.locator('[data-node]').count(), 41); assert.equal(await page.locator('#error').isVisible(), false); await page.screenshot({ path: evidence + '/desktop.png', fullPage: true }); });
    await check('service worker installs and only public demo resources enter cache', async () => { await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.waitForFunction(() => !!navigator.serviceWorker.controller); const urls = await page.evaluate(async () => { const result = []; for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
            result.push(req.url); return result; }); assert.ok(urls.some(url => url.endsWith('demo/'))); assert.ok(urls.some(url => url.endsWith('.wasm'))); assert.ok(!urls.some(url => /\/api\/|\/app\/|\/plant\/login(?:$|\?)/.test(url))); });
    await check('Node and browser execute identical equations, control/interlock traces and SQL reports', async () => { await context.route(base + 'assets/test-contract.js', route => route.fulfill({ contentType: 'text/javascript', path: '.plant/browser-contract.js' })); const result = await page.evaluate(url => new Promise((resolve, reject) => { const worker = new Worker(url, { type: 'module' }), timer = setTimeout(() => { worker.terminate(); reject(new Error('Browser contract timeout')); }, 30000); worker.onmessage = e => { clearTimeout(timer); worker.terminate(); resolve(e.data); }; worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)); }; worker.postMessage({}); }), base + 'assets/test-contract.js'); assert.equal(result.error, undefined); assert.deepEqual(result.training, expectedTraining); assert.deepEqual(result.controls, expectedControls); assert.equal(result.controls.blocked, true); assert.equal(result.controls.clearedDemand, 0); for (const [variant, values] of Object.entries(expected))
        for (const [key, value] of Object.entries(values))
            assert.ok(Math.abs(result.physics[variant][key] - value) < 1e-9, variant + ':' + key); assert.equal(result.rows[0].average, 17.5); assert.equal(result.rows[0].coverage, 80); await writeFile(evidence + '/cross-runtime.json', JSON.stringify({ node: expected, browser: result.physics, controls: result.controls, training: result.training, sql: result.rows }, null, 2)); });
    await check('one canvas keeps all equipment DOM nodes while nested groups only change the camera', async () => {
        assert.equal(await page.locator('[data-group]').count(), 17);
        const initial = await page.locator('#diagram').getAttribute('viewBox');
        await page.evaluate(() => { window.originalScadaNode = document.querySelector('[data-node="CORE"]'); });
        await page.locator('[data-system="coreA"]').click();
        assert.equal(await page.locator('[data-node]').count(), 41);
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
        assert.equal(await page.locator('[data-node]').count(), 41);
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
        assert.equal(await page.locator('#scene3d').getAttribute('data-group-count'), '17');
        assert.equal(await page.locator('[data-node3d]').count(), 41);
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
        assert.equal(await page.locator('[data-node3d]').count(), 41);
        assert.equal(await page.locator('#scene3d').getAttribute('data-group-count'), '17');
        assert.equal(await page.locator('#scene3d').getAttribute('data-focused-group'), '');
        await page.screenshot({path:evidence+'/all-systems-3d.png',fullPage:true});
        await page.locator('[data-system="auxiliary"]').click();
        assert.equal(await page.locator('[data-node3d]').count(), 41);
        await page.locator('#view-2d').click();
        assert.equal(await page.locator('[data-node]').count(), 41);
        await page.locator('#fit').click();
        await page.screenshot({path:evidence+'/all-systems-2d.png',fullPage:true});
    });
    await check('manual report runs SQL in a separate browser worker and renders HTML', async () => { await page.locator('[data-tab="reports"]').click(); await page.locator('[data-run="thermal-balance"]').click(); await page.locator('#report-runs .success').first().waitFor({ timeout: 20000 }); await page.locator('[data-artifact]').first().click(); await page.frameLocator('#report-preview').locator('h1').waitFor(); assert.match(await page.frameLocator('#report-preview').locator('body').innerText(), /Средневзвешенное/); await page.screenshot({ path: evidence + '/report.png', fullPage: true }); });
    await check('draft validation, CAS commit and explicit publication use the same project files', async () => { await page.locator('[data-tab="project"]').click(); await page.locator('#file').selectOption('cooling.ts'); const content = await page.locator('.cm-content').innerText(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(content.replace('voltage: 1', 'voltage: 0.9')); assert.equal(await page.locator('#publish').isEnabled(), false); await page.locator('#commit-message').fill('Browser test: supply 0.9'); await page.locator('#validate').click(); assert.match(await page.locator('#diagnostics').innerText(), /корректны/); await page.locator('#commit').click(); await page.waitForFunction(() => document.querySelector('#draft-state').textContent.startsWith('Сохранено')); await page.locator('#publish').click(); await page.waitForTimeout(700); assert.match(await page.locator('#revision-list').innerText(), /Browser test/); await page.screenshot({ path: evidence + '/project.png', fullPage: true }); });
    await check('explicit rollback creates a new revision without deleting reports', async () => { page.once('dialog', d => d.accept()); await page.locator('[data-rollback]').last().click(); await page.waitForTimeout(700); assert.match(await page.locator('#revision-list').innerText(), /Restore/); await page.locator('[data-tab="reports"]').click(); assert.equal(await page.locator('#report-runs .success').count(), 1); });
    await check('public browser alarm notification and acknowledgement follow emergent state', async () => { await page.locator('#notifications').click(); await page.locator('[data-tab="scheme"]').click(); await page.locator('[data-system="electrical"]').click(); await page.locator('[data-node="GRID"]').click(); await page.locator('[data-param="voltage"]').fill('0.4'); await page.locator('[data-set="voltage"]').click(); await page.waitForFunction(() => Number(document.querySelector('#alarm-count').textContent) > 0, {}, { timeout: 90000 }); await page.locator('[data-tab="alarms"]').click(); await page.locator('[data-ack]').first().click(); await page.waitForFunction(() => document.querySelector('#alarm-list').textContent.includes('Квитировано')); await page.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return (await r.getNotifications()).some(n => n.title.includes('Аларм')); }); /* Provider-to-phone delivery is not asserted by this local browser check. */ await page.screenshot({ path: evidence + '/alarms.png', fullPage: true }); });
    await check('offline PWA reload resumes persisted state, report artifacts and local revisions', async () => { await page.locator('#pause').click(); await page.waitForTimeout(500); const clock = await page.locator('#clock').innerText(); await context.setOffline(true); await page.reload(); await page.locator('#application').waitFor({ state: 'visible', timeout: 20000 }); assert.equal(await page.locator('#clock').innerText(), clock); assert.equal(await page.locator('#pause').innerText(), 'Продолжить'); assert.equal(await page.locator('[data-group]').count(), 17); assert.equal(await page.locator('[data-node]').count(), 41); await page.locator('[data-tab="reports"]').click(); await page.locator('#report-runs .success').first().waitFor(); await page.locator('[data-artifact]').first().click(); await page.frameLocator('#report-preview').locator('h1').waitFor(); });
    await check('offline installation loads the lazy 3D bundle from the public cache', async () => {
        await page.locator('[data-tab="scheme"]').click(); await page.locator('[data-system="auxiliary"]').click();
        await page.locator('#view-3d').click(); await page.locator('#scene3d canvas').waitFor({state:'visible',timeout:20000});
        await page.locator('#view-2d').click();
    });
    await check('a second tab cannot silently become another database writer', async () => { const tab = await context.newPage(); await tab.goto(base + 'demo/'); await tab.locator('#memory').waitFor({ state: 'visible', timeout: 15000 }); assert.match(await tab.locator('#loading').innerText(), /another tab/); await tab.close(); });
    await check('mobile 2D and 3D have no horizontal document overflow', async () => { await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-tab="scheme"]').click(); await page.locator('[data-system="coreA"]').click(); await page.waitForTimeout(500); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: evidence + '/mobile.png', fullPage: true }); await page.locator('[data-system="auxiliary"]').click(); await page.locator('#view-3d').click(); await page.waitForTimeout(500); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({path:evidence+'/mobile-3d.png', fullPage:true}); await page.locator('#view-2d').click(); });
    await context.setOffline(false);
    await check('authenticated Node receives operator commands and publishes SSE without a local simulation', async () => { const remote = await browser.newContext({ viewport: { width: 1440, height: 980 } }); const p = await remote.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(base + 'app/'); await p.locator('#login').waitFor(); await p.locator('[name="user"]').fill(process.env.SCADA_USER ?? 'engineer'); await p.locator('[name="password"]').fill(process.env.SCADA_PASSWORD ?? 'test-password-only-9284'); await p.locator('#login button').click(); await p.locator('#application').waitFor({ state: 'visible', timeout: 15000 }); assert.match(await p.locator('#mode').innerText(), /NODE.JS/); assert.equal(p.workers().length, 0); const clock = await p.locator('#clock').innerText(); await p.waitForTimeout(400); assert.notEqual(await p.locator('#clock').innerText(), clock); await p.locator('[data-tab="controls"]').click(); await p.locator('[data-control-input="MAKEUP"]').fill('0.16'); await p.locator('[data-operate="MAKEUP"]').click(); await p.waitForFunction(() => document.querySelector('[data-control="MAKEUP"] [data-demand]').textContent === '0.16'); assert.equal(await p.locator('#error').isVisible(), false); await p.screenshot({ path: evidence + '/server.png', fullPage: true }); await p.locator('#logout').click(); await p.locator('#login').waitFor(); await remote.close(); });
    assert.deepEqual(errors, []);
    await writeFile(evidence + '/browser-summary.json', JSON.stringify({ checks, errors, browser: browser.version() }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, browser: browser.version() }));
}
catch (error) {
    await page.screenshot({ path: evidence + '/failure.png', fullPage: true }).catch(() => { });
    await writeFile(evidence + '/browser-summary.json', JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
    console.error(await page.locator('body').innerText().catch(() => ''));
    throw error;
}
finally {
    await browser.close();
}
