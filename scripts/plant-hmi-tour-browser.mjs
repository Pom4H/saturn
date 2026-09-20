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
      #tour-caption{position:fixed;left:50%;bottom:18px;z-index:999998;transform:translateX(-50%);min-width:520px;max-width:1050px;padding:12px 18px;background:#102f3dee;color:#fff;border:1px solid #5f8997;font:600 16px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px #102d3a55;pointer-events:none}
      body.tour-plc-focus #inspector{position:fixed!important;z-index:99990;left:90px;right:90px;top:70px;bottom:74px;max-height:none!important;overflow:auto;background:#f7fbfc;border:2px solid #179bad;padding:18px 28px;box-shadow:0 20px 70px #102d3a55}
      body.tour-plc-focus #inspector>p.eyebrow,body.tour-plc-focus #inspector>h2{max-width:1040px;margin-left:auto;margin-right:auto}
      body.tour-plc-focus #plc-front{max-width:1040px;margin:8px auto 12px}
      body.tour-plc-focus #plc-front svg{width:100%!important;max-height:590px!important}
      body.tour-plc-focus #inspector>.signals,body.tour-plc-focus #inspector>#build-plc,body.tour-plc-focus #inspector>.model-limit,body.tour-plc-focus #inspector>h3,body.tour-plc-focus #inspector>.terminal-panel{display:none!important}
    `;
    document.head.append(style);
    const cursor=document.createElement('div');cursor.id='tour-cursor';
    const caption=document.createElement('div');caption.id='tour-caption';
    caption.textContent='Saturn PLC · интерактивный HMI на дисплее контроллера';
    document.body.append(cursor,caption);
  });
}
async function caption(text,ms=800){await page.evaluate(text=>document.querySelector('#tour-caption').textContent=text,text);await page.waitForTimeout(ms);}
async function point(selector){
  const locator=page.locator(selector).first();await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();if(!box)throw new Error('Cannot point at '+selector);
  await page.evaluate(({x,y})=>{const c=document.querySelector('#tour-cursor');c.style.left=x+'px';c.style.top=y+'px';},{x:box.x+box.width/2,y:box.y+box.height/2});
  await page.waitForTimeout(500);return locator;
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

  await caption('Это HMI именно на 320×240 дисплее Saturn PLC. Управление — четыре физические клавиши вокруг экрана.',1700);
  await click('[data-tab="scheme"]');
  await click('[data-system="commissioning"]','Открываем стенд Saturn PLC');
  await click('#diagram [data-node="SATURN-1"]','Выбираем контроллер SATURN-1');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('SATURN-1'));
  await page.evaluate(()=>document.body.classList.add('tour-plc-focus'));
  await page.waitForTimeout(700);
  await caption('Крупный план: это 320×240 дисплей контроллера и его четыре физические клавиши',1700);

  await click('#plc-front [data-plc-button="right"]','Правая физическая клавиша → экран I/O');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('Входы / выходы'));
  await caption('Экран I/O рендерится самим FBD runtime из .fbdbin',1300);

  await click('#plc-front [data-plc-button="right"]','Ещё вправо → управляемая нагрузка');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('Управляемая нагрузка'));
  await caption('Здесь контроллер показывает RELAY-1, LAMP-1 и собственный MANUAL setpoint',1400);

  await click('#plc-front [data-plc-button="down"]','DOWN → ручной выход OFF');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('ВЫКЛ'));
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===0);
  await caption('MANUAL=0 → FBD вычисляет DO1=0 → реле и лампа выключены',1500);

  await click('#plc-front [data-plc-button="up"]','UP → ручной выход ON');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('ВКЛ'));
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===1);
  await caption('MANUAL=1 хранится внутри FBD runtime → DO1=1',1800);

  await page.evaluate(()=>document.body.classList.remove('tour-plc-focus'));
  await page.waitForTimeout(650);
  await click('#diagram [data-node="RELAY-1"]','Переходим к устройству, которым управляет DO1: RELAY-1');
  await page.waitForTimeout(700);
  await click('#diagram [data-node="LAMP-1"]','И дальше к LAMP-1 — лампа включена реальным выходом контроллера');
  await page.waitForTimeout(1300);

  await click('#diagram [data-node="SATURN-1"]','Возвращаемся к Saturn PLC — состояние HMI сохранено');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('Управляемая нагрузка'));
  await page.evaluate(()=>document.body.classList.add('tour-plc-focus'));
  await page.waitForTimeout(500);
  await click('#plc-front [data-plc-button="left"]','LEFT → обратно к I/O');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('Входы / выходы'));
  await click('#plc-front [data-plc-button="left"]','LEFT → главный экран');
  await page.waitForFunction(()=>document.querySelector('#plc-front .runtime-hmi')?.textContent?.includes('SATURN-1'));

  await page.evaluate(()=>document.body.classList.remove('tour-plc-focus'));
  await page.waitForTimeout(500);
  await click('#view-3d','Та же установка в 3D');
  await page.locator('#scene3d canvas').waitFor({state:'visible'});
  await page.waitForTimeout(900);
  await click('[data-node3d="SATURN-1"]','SATURN-1 в 3D — тот же runtime и тот же HMI state');
  await page.waitForTimeout(700);
  await click('[data-node3d="LAMP-1"]','LAMP-1 получает тот же DO1 через реле');
  await caption('Одна модель: интерактивный дисплей контроллера → FBD setpoint → DO1 → устройство и его анимация',2200);

  await page.waitForTimeout(700);
  const raw=await video.path();
  await context.close();await browser.close();
  const webm=output+'/saturn-plc-native-hmi-tour.webm';await rename(raw,webm);
  const mp4=output+'/saturn-plc-native-hmi-tour.mp4';
  const ffmpeg=spawnSync('ffmpeg',['-y','-i',webm,'-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',mp4],{stdio:'inherit'});
  if(ffmpeg.error?.code==='ENOENT')console.log('System ffmpeg unavailable; keeping Playwright WebM:',webm);
  else if(ffmpeg.status!==0)console.warn('MP4 conversion failed; keeping Playwright WebM:',webm);
  else console.log(mp4);
} catch(error) {
  await context.close().catch(()=>{});await browser.close().catch(()=>{});throw error;
}
