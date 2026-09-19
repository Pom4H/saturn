import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const raw = { name:'project-source', setup(b) {
  b.onResolve({filter:/\?raw$/}, a => ({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));
  b.onLoad({filter:/.*/,namespace:'raw'}, async a => ({contents:await readFile(a.path,'utf8'),loader:'text'}));
}};
const out=process.env.SATURN_TOUR_OUT??'product-tour';
await mkdir(out,{recursive:true});
await build({entryPoints:['plant/server.ts'],outfile:'.plant/tour-server.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[raw]});
const {startPlantServer}=await import(pathToFileURL(join(process.cwd(),'.plant/tour-server.mjs')));
const work=await mkdtemp(join(tmpdir(),'saturn-tour-'));
const password=()=>randomBytes(24).toString('base64url');
const passwords={engineer:password(),operator:password(),viewer:password()};
let app,browser;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function login(page,user){await page.goto(app.origin+'/plant/login');await page.locator('[name=user]').fill(user);await page.locator('[name=password]').fill(passwords[user]);await page.locator('#login button').click();await page.locator('#application').waitFor({state:'visible'});await pause(1000);}
async function logout(page){await page.locator('#logout').click();await page.locator('#login').waitFor();await pause(500);}
try{
 app=await startPlantServer({port:0,data:join(work,'plant.sqlite'),repository:join(work,'project.git'),user:'engineer',password:passwords.engineer});
 app.auth.seed('operator',passwords.operator,'operator');app.auth.seed('viewer',passwords.viewer,'viewer');
 browser=await chromium.launch({headless:false,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1600,height:1000},recordVideo:{dir:out,size:{width:1600,height:1000}}});
 const page=await context.newPage();
 await login(page,'engineer');await page.locator('[data-tab=project]').click();page.once('dialog',d=>d.accept('tour.ts'));await page.locator('#new-file').click();await page.locator('#file').selectOption('tour.ts');await page.locator('.cm-content').click();await page.keyboard.insertText("// Created in Saturn engineering UI.\n// Runtime state stays outside source control.\n");await page.locator('#validate').click();await page.locator('#commit-message').fill('Create project from Saturn engineering UI');await page.locator('#commit').click();await page.waitForFunction(()=>document.querySelector('#draft-state')?.textContent?.startsWith('Сохранено'));await page.locator('#publish').click();await pause(1400);await page.locator('[data-tab=scheme]').click();await page.locator('#fit').click();await pause(1800);
 await logout(page);await login(page,'operator');if(await page.locator('[data-tab=project]').isVisible())throw new Error('operator can see project editor');await page.locator('[data-tab=controls]').click();const control=page.locator('[data-operate]').first();const id=await control.getAttribute('data-operate');const input=page.locator('[data-control-input="'+id+'"]');const min=Number(await input.getAttribute('min')),max=Number(await input.getAttribute('max'));await input.fill(String(min+(max-min)*.55));await control.click();await pause(1800);await page.locator('[data-tab=events]').click();await pause(1500);
 await logout(page);await login(page,'viewer');if(await page.locator('[data-tab=project]').isVisible())throw new Error('viewer can see project editor');await page.locator('[data-tab=scheme]').click();await page.locator('#fit').click();await pause(1600);await page.locator('[data-tab=controls]').click();if(await page.locator('[data-operate]:not([disabled])').count())throw new Error('viewer has enabled controls');await pause(1500);await page.locator('[data-tab=reports]').click();await pause(1500);await page.locator('[data-tab=events]').click();await pause(1500);
 const video=page.video();await page.close();await context.close();await copyFile(await video.path(),join(out,'saturn-engineer-operator-viewer.webm'));console.log(JSON.stringify({ok:true,video:join(out,'saturn-engineer-operator-viewer.webm')}));
}finally{await browser?.close().catch(()=>{});await app?.close().catch(()=>{});await rm(work,{recursive:true,force:true});}
