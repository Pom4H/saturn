import assert from 'node:assert/strict';
import { checkLandingDemo } from './site-landing-check.mjs';
import { checkShellUx } from './site-shell-ux-check.mjs';
import { captureLandingProof, checkLandingStory } from './landing-proof.mjs';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const port=4194, origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/site-dev.mjs'],{env:{...process.env,PORT:String(port),...(process.argv.includes('--built')?{SATURN_SITE_DIR:'dist/plant/site'}:{})},stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
let browser;
try{
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error(output);
    try{if((await fetch(origin)).ok)break;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{channel:'chrome'})});
  await checkLandingDemo(browser, origin + '/?mode=demo');
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin + '/?mode=ide');
  await page.waitForSelector('#studio-spatial canvas',{state:'attached'});
  await page.waitForFunction(()=>document.getElementById('project-switch')?.options.length>0);

  assert.match(await page.locator('h1').innerText(),/Инженерная IDE/);
  assert.equal(await page.locator('.surface-nav .surface-tab').count(),3,'Project shell exposes stable engineering surfaces');
  assert(await page.locator('#environment-trigger').isVisible(),'Environment is persistent application context');
  assert.equal(await page.locator('#revision-source').textContent(),'demo');
  assert.equal(await page.locator('#revision-published').textContent(),'—');
  assert.equal(await page.locator('#revision-applied').textContent(),'—');
  assert(await page.locator('#studio-editor-pane').isVisible(),'Source and diagram are visible together');
  assert.equal(await page.locator('#studio-svg [data-node]').count(),5,'Canonical pump demo renders');

  await page.locator('#studio-3d').click();
  await page.locator('[data-node3d="V-01"]').click();
  await page.locator('#studio-2d').click();
  assert.equal(await page.locator('#studio-selected').textContent(),'V-01','Selection survives projection changes');

  // Killer feature: visual movement edits the canonical TypeScript source.
  await page.locator('#inspector-close').click();
  if(!await page.locator('#studio-editor-pane').isVisible())await page.locator('#studio-code').click();
  const source=page.locator('#studio-editor .cm-content');
  const before=await source.innerText();
  const pipe=page.locator('#studio-svg [data-edge]').filter({has:page.locator('[data-water]')}).first().locator('[data-water]');
  const pipeBefore=await pipe.getAttribute('d');
  const pump=page.locator('#studio-svg [data-node="P-01"]');
  await pump.scrollIntoViewIfNeeded();
  const box=await pump.boundingBox();
  assert(box,'Pump must be visible');
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.75);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.6+28,box.y+box.height*.75+16,{steps:4});
  assert.notEqual(await pipe.getAttribute('d'),pipeBefore,'Pipe route follows the pump before pointer release');
  assert.equal(await source.innerText(),before,'Source remains unchanged during drag preview');
  await page.mouse.up();
  await page.waitForFunction(previous=>document.querySelector('#studio-editor .cm-content')?.textContent!==previous,before);
  const after=await source.innerText();
  assert.notEqual(after,before,'Diagram drag must mutate TypeScript source');
  assert.match(after,/x:\s*\d+/);
  assert.match(after,/y:\s*\d+/);

  await mkdir('test-results/release-shell',{recursive:true});
  await page.screenshot({path:'test-results/release-shell/saturn-release-shell.png',fullPage:true});
  await checkShellUx(page);
  const animated=await browser.newContext({reducedMotion:'no-preference'});
  const diagram=await animated.newPage();
  await diagram.goto(pathToFileURL(resolve('docs/assets/saturn-domain-model.svg')).href);
  const animations=await diagram.evaluate(()=>['.rotor','.flow','.level'].map(selector=>getComputedStyle(document.querySelector(selector)).animationName));
  assert.deepEqual(animations,['rotate','current','water-level'],'README equipment and water animate in the rendered SVG');
  await animated.close();
  assert.deepEqual(errors,[]);
  await context.close();
  await captureLandingProof(browser, process.argv.includes('--built') ? 'dist/plant/site' : 'dist/site');
  await checkLandingStory(browser, origin);
  console.log('PASS: release shell; Project/Surface/Environment; provenance; 2D/3D projection; visual drag -> canonical TypeScript.');
}finally{
  await browser?.close();
  server.kill('SIGTERM');
}
