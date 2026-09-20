import { chromium } from '@playwright/test';
import { mkdir, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const output=process.env.SHOWCASE_VIDEO_DIR??'showcase-tour';
const base=process.env.PWA_URL;
if(!base)throw new Error('PWA_URL required');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:output,size:{width:1440,height:900}}});
context.setDefaultTimeout(20000);
const page=await context.newPage(),video=page.video();

async function caption(text,ms){await page.evaluate(text=>{const e=document.querySelector('#showcase-caption');if(e)e.textContent=text;},text);await page.waitForTimeout(ms);}
async function key(name,note,wait=900){if(note)await caption(note,600);await page.locator(`#plc-front [data-plc-button="${name}"]`).click();await page.waitForTimeout(wait);}
try{
  await page.goto(base+'login');
  await page.locator('input[name="user"]').fill('engineer');
  await page.locator('input[name="password"]').fill(process.env.SCADA_PASSWORD??'showcase-demo-2026');
  await page.locator('#login').evaluate(form=>(form).requestSubmit());
  await page.locator('#application').waitFor({state:'visible'});
  await page.evaluate(()=>{
    const style=document.createElement('style');style.textContent=`
      #showcase-caption{position:fixed;z-index:999999;left:50%;bottom:18px;transform:translateX(-50%);padding:10px 16px;border-radius:10px;background:#071a22e8;color:#eefdff;border:1px solid #2b6676;font:600 15px/1.3 system-ui;min-width:520px;text-align:center;pointer-events:none}
      body.showcase-focus #inspector{position:fixed!important;z-index:99990;left:80px;right:80px;top:48px;bottom:58px;max-height:none!important;overflow:hidden;background:#f7fbfc;border:2px solid #179bad;padding:14px 24px;box-shadow:0 20px 70px #102d3a55}
      body.showcase-focus #plc-front{max-width:1180px;margin:0 auto}
      body.showcase-focus #plc-front svg{width:100%!important;max-height:700px!important}
      body.showcase-focus #inspector>.signals,body.showcase-focus #inspector>#build-plc,body.showcase-focus #inspector>.model-limit,body.showcase-focus #inspector>h3,body.showcase-focus #inspector>.terminal-panel{display:none!important}
    `;document.head.append(style);
    const c=document.createElement('div');c.id='showcase-caption';c.textContent='Saturn HMI · Booster Skid';document.body.append(c);
  });
  await page.locator('[data-system="boost"]').click();
  await page.locator('#diagram [data-node="SATURN-DEMO"]').click();
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="overview"]').waitFor();
  await page.evaluate(()=>document.body.classList.add('showcase-focus'));
  await caption('HOME · весь технологический процесс и три главных KPI',6000);

  await key('right','RIGHT · открыть главное управляемое оборудование',900);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="device.P-101"]').waitFor();
  await caption('P-101 · большой rotor + RPM / FLOW / POWER',4500);

  await key('down','DOWN · остановить насос контекстной командой',500);
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-DEMO.DO1"] b')?.textContent)===0);
  await caption('RPM и поток падают — геометрию кадров считает Firmverse',4500);
  await key('up','UP · снова запустить P-101',500);
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-DEMO.DO1"] b')?.textContent)===1);
  await caption('Насос разгоняется, flow packets снова идут по трубопроводу',4500);

  await key('right','RIGHT · следующий объект',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="device.TK-101"]').waitFor();
  await caption('TK-101 · уровень и живая поверхность воды',4500);

  await key('right','RIGHT · регулирующий клапан',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="device.V-101"]').waitFor();
  await caption('V-101 · OPENING / FLOW и контекстное управление',3500);
  await key('down','DOWN · CLOSE',700);await caption('Клапан закрыт',2200);
  await key('up','UP · OPEN',700);await caption('Клапан открыт',2200);

  await key('right','RIGHT · состояние фильтра',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="device.F-101"]').waitFor();
  await caption('F-101 · fouling, перепад давления и сопротивление',4500);

  await key('left','LEFT · всегда возвращает HOME',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="overview"]').waitFor();
  await key('down','DOWN · диагностика I/O',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="io"]').waitFor();
  await caption('I/O · AI1 / AI2 / DO1 / DO2 без лишнего chrome',4300);

  await key('right','RIGHT · сеть',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="network"]').waitFor();
  await caption('NETWORK · Saturn PLC и подключённый RS-485 expansion',4500);

  await key('left','LEFT · HOME',700);
  await page.locator('#plc-front .runtime-hmi [data-hmi-page="overview"]').waitFor();
  await caption('Один shell · четыре клавиши · topology-driven HMI',4200);

  const raw=await video.path();await context.close();await browser.close();
  const webm=output+'/saturn-hmi-showcase.webm';await rename(raw,webm);
  const mp4=output+'/saturn-hmi-showcase-silent.mp4';
  const ff=spawnSync('ffmpeg',['-y','-i',webm,'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',mp4],{stdio:'inherit'});
  if(ff.status!==0)throw new Error('ffmpeg video conversion failed');
  console.log(mp4);
}catch(error){await context.close().catch(()=>{});await browser.close().catch(()=>{});throw error;}
