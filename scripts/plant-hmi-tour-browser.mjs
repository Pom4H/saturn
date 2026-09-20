import { chromium } from '@playwright/test';
import { mkdir, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const output = process.env.HMI_VIDEO_DIR ?? 'plant-tour';
const base = process.env.PWA_URL ?? 'http://127.0.0.1:4176/plant/';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PWA_CHROMIUM || undefined,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
});
context.setDefaultTimeout(20000);
const page = await context.newPage();
const video = page.video();

async function overlay() {
  await page.evaluate(() => {
    const style=document.createElement('style');
    style.textContent=`
      #tour-cursor{position:fixed;z-index:999999;width:24px;height:24px;border:3px solid #10a6b5;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 0 0 5px #10a6b533,0 4px 14px #103b4c55;transition:left .38s cubic-bezier(.2,.8,.2,1),top .38s cubic-bezier(.2,.8,.2,1),transform .12s;background:#fff9}
      #tour-cursor.tap{transform:translate(-50%,-50%) scale(.62);background:#10a6b5}
      #tour-caption{position:fixed;left:50%;bottom:18px;z-index:999998;transform:translateX(-50%);min-width:560px;max-width:1080px;padding:12px 18px;background:#102f3dee;color:#fff;border:1px solid #5f8997;font:600 16px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px #102d3a55;pointer-events:none}
      body.tour-plc-focus #inspector{position:fixed!important;z-index:99990;left:70px;right:70px;top:54px;bottom:66px;max-height:none!important;overflow:hidden;background:#f7fbfc;border:2px solid #179bad;padding:12px 22px;box-shadow:0 20px 70px #102d3a55}
      body.tour-plc-focus #inspector>p.eyebrow,body.tour-plc-focus #inspector>h2{max-width:1180px;margin-left:auto;margin-right:auto}
      body.tour-plc-focus #plc-front{max-width:1180px;margin:0 auto}
      body.tour-plc-focus #plc-front svg{width:100%!important;max-height:690px!important}
      body.tour-plc-focus #inspector>.signals,body.tour-plc-focus #inspector>#build-plc,body.tour-plc-focus #inspector>.model-limit,body.tour-plc-focus #inspector>h3,body.tour-plc-focus #inspector>.terminal-panel{display:none!important}
    `;
    document.head.append(style);
    const cursor=document.createElement('div');cursor.id='tour-cursor';
    const caption=document.createElement('div');caption.id='tour-caption';
    caption.textContent='Saturn PLC · Firmverse display emulator';
    document.body.append(cursor,caption);
  });
}
async function caption(text,ms=800){await page.evaluate(text=>document.querySelector('#tour-caption').textContent=text,text);await page.waitForTimeout(ms);}
async function point(selector){
  const locator=page.locator(selector).first();await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();if(!box)throw new Error('Cannot point at '+selector);
  await page.evaluate(({x,y})=>{const c=document.querySelector('#tour-cursor');c.style.left=x+'px';c.style.top=y+'px';},{x:box.x+box.width/2,y:box.y+box.height/2});
  await page.waitForTimeout(450);return locator;
}
async function click(selector,note){
  if(note)await caption(note,420);const locator=await point(selector);
  await page.evaluate(()=>document.querySelector('#tour-cursor').classList.add('tap'));await locator.click();await page.waitForTimeout(160);
  await page.evaluate(()=>document.querySelector('#tour-cursor').classList.remove('tap'));await page.waitForTimeout(650);
}

try {
  await page.goto(base+'demo/');
  await page.locator('#application').waitFor({state:'visible'});
  await page.waitForTimeout(900);
  await overlay();

  await click('[data-tab="scheme"]');
  await click('[data-system="commissioning"]','Открываем стенд, из которого shell строится автоматически');
  await click('#diagram [data-node="SATURN-1"]','Выбираем физический Saturn PLC');
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="overview"]').waitFor();
  await page.evaluate(()=>document.body.classList.add('tour-plc-focus'));
  await page.waitForTimeout(600);
  await caption('Firmverse собирает 320×240 кадр из topology + live signals. React только рисует готовые команды.',1900);

  await click('#plc-front [data-plc-button="right"]','RIGHT → процессный экран Firmverse display scene');
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="process"]').waitFor();
  await caption('Бак, поток, насос и лампа: координаты анимации считает Firmverse по model time.',1900);

  await click('#plc-front [data-plc-button="right"]','RIGHT → PUMP-1. Управляемое оборудование приоритетно в навигации');
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="device.PUMP-1"]').waitFor();
  await caption('Положение лопастей уже приходит из Firmverse frame. CSS не вращает насос.',1800);

  await click('#plc-front [data-plc-button="down"]','DOWN → STOP через setpoint физического PLC');
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===0,null,{timeout:12000});
  await caption('DO1=0 проходит через точный FBD runtime; по мере падения RPM Firmverse останавливает ротор.',1900);

  await click('#plc-front [data-plc-button="up"]','UP → START через тот же FBD setpoint');
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===1,null,{timeout:12000});
  await caption('DO1=1: модель разгоняет насос, а Firmverse двигает rotor/flow в следующих кадрах.',1900);

  await click('#plc-front [data-plc-button="right"]','RIGHT → резервуар');
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="device.TANK-1"]').waitFor();
  await click('#plc-front [data-plc-button="down"]','DOWN на резервуаре не должен останавливать насос');
  await page.waitForTimeout(350);
  if(Number(await page.locator('#inspector [data-signal="SATURN-1.DO1"] b').innerText())!==1)throw new Error('Non-contextual tank key changed pump output');
  await caption('Контекстное управление: TANK-1 не может случайно изменить MANUAL насоса.',1700);

  await click('#plc-front [data-plc-button="left"]','LEFT → обратно на процесс');
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="process"]').waitFor();
  await click('#plc-front [data-plc-button="left"]','LEFT → обзор');
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="overview"]').waitFor();
  await caption('Один display scene contract: overview, process, equipment, I/O и network.',1800);

  await page.evaluate(()=>document.body.classList.remove('tour-plc-focus'));
  await page.waitForTimeout(550);
  await click('#diagram [data-node="PUMP-1"]','Тот же PUMP-1 в основной SCADA-схеме');
  await page.waitForTimeout(1200);
  await caption('Один runtime state: эмулятор TFT и большая SCADA видят один PUMP-1',1500);

  await click('#view-3d','И тот же объект в 3D');
  await page.locator('#scene3d canvas').waitFor({state:'visible'});
  await page.waitForTimeout(900);
  await click('[data-node3d="PUMP-1"]','PUMP-1 в 3D получает тот же RPM');
  await caption('Plant Model → PLC/FBD + Firmverse display → React SVG projection → SCADA → 3D',2300);

  await page.waitForTimeout(700);
  const raw=await video.path();
  await context.close();await browser.close();
  const webm=output+'/saturn-plc-autoshell-tour.webm';await rename(raw,webm);
  const mp4=output+'/saturn-plc-autoshell-tour.mp4';
  const ffmpeg=spawnSync('ffmpeg',['-y','-i',webm,'-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',mp4],{stdio:'inherit'});
  if(ffmpeg.error?.code==='ENOENT')console.log('System ffmpeg unavailable; keeping Playwright WebM:',webm);
  else if(ffmpeg.status!==0)console.warn('MP4 conversion failed; keeping Playwright WebM:',webm);
  else console.log(mp4);
} catch(error) {
  await context.close().catch(()=>{});await browser.close().catch(()=>{});throw error;
}
