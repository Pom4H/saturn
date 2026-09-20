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
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: output, size: { width: 1280, height: 720 } },
});
context.setDefaultTimeout(20000);
const page = await context.newPage();
const video = page.video();

async function setupOverlay() {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #tour-cursor{position:fixed;z-index:999999;width:24px;height:24px;border:3px solid #19a7b5;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 0 0 5px #19a7b533,0 4px 14px #103b4c55;transition:left .38s cubic-bezier(.2,.8,.2,1),top .38s cubic-bezier(.2,.8,.2,1),transform .12s;background:#fff8}
      #tour-cursor.tap{transform:translate(-50%,-50%) scale(.65);background:#19a7b5}
      #tour-caption{position:fixed;left:50%;bottom:22px;z-index:999998;transform:translateX(-50%);min-width:420px;max-width:900px;padding:12px 18px;background:#102f3de8;color:#fff;border:1px solid #5f8997;font:600 16px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px #102d3a55;pointer-events:none}
    `;
    document.head.append(style);
    const cursor = document.createElement('div'); cursor.id = 'tour-cursor';
    const caption = document.createElement('div'); caption.id = 'tour-caption';
    caption.textContent = 'Saturn SCADA · Saturn PLC emulator';
    document.body.append(cursor, caption);
  });
}
async function caption(text, ms = 800) {
  await page.evaluate(text => { document.querySelector('#tour-caption').textContent = text; }, text);
  await page.waitForTimeout(ms);
}
async function point(selector) {
  const locator = page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot point at ' + selector);
  await page.evaluate(({x,y}) => {
    const cursor = document.querySelector('#tour-cursor');
    cursor.style.left = x + 'px'; cursor.style.top = y + 'px';
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(520);
  return locator;
}
async function click(selector, note) {
  if (note) await caption(note, 450);
  const locator = await point(selector);
  await page.evaluate(() => document.querySelector('#tour-cursor').classList.add('tap'));
  await locator.click();
  await page.waitForTimeout(180);
  await page.evaluate(() => document.querySelector('#tour-cursor').classList.remove('tap'));
  await page.waitForTimeout(650);
}
async function selectDevice(id, note) {
  await click(`#diagram [data-node="${id}"]`, note);
  await page.waitForTimeout(650);
}

try {
  await page.goto(base + 'demo/');
  await page.locator('#application').waitFor({ state: 'visible' });
  await page.waitForTimeout(1000);
  await setupOverlay();

  await caption('Saturn SCADA: браузерный HMI управляет настоящим Saturn FBD runtime', 1400);
  await click('[data-tab="hmi"]', 'Открываем HMI, описанный в TypeScript');
  await page.locator('#hmi-root [data-hmi-screen="overview"]').waitFor();
  await caption('Обзор: тот же live runtime питает экран, PLC и анимации', 1100);

  await click('#openPlc', 'Переходим на экран SATURN-1');
  await page.locator('#hmi-root [data-hmi-screen="plc"]').waitFor();
  await caption('Сейчас AI1 ≈ 300, DO1 = 0, лампа выключена', 1100);

  await click('#level3', '3 V на тестовом датчике');
  await page.waitForFunction(() => document.querySelector('#aiReadout')?.textContent === '300');
  await page.waitForFunction(() => document.querySelector('#doReadout')?.textContent === '0');
  await caption('FBD runtime оставляет DO1 выключенным', 1000);

  page.once('dialog', dialog => dialog.accept());
  await click('#level7', '7 V → команда проходит через audited operator API');
  await page.waitForFunction(() => document.querySelector('#doReadout')?.textContent === '1', null, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#plcFront .runtime-hmi')?.textContent?.includes('700'), null, { timeout: 5000 });
  await caption('AI1 = 700 → FBD вычисляет DO1 = 1 → реле и лампа включены', 2200);

  await click('#plcBack', 'Возвращаемся на обзор HMI');
  await page.locator('#hmi-root [data-hmi-screen="overview"]').waitFor();
  await caption('Состояние сохраняется: выход PLC и лампа остаются live', 1100);

  await click('[data-tab="scheme"]', 'Теперь посмотрим всю цепочку оборудования');
  await click('[data-system="commissioning"]', 'Commissioning bench');
  await caption('Сигнал идёт через реальные связи схемы', 900);

  await selectDevice('LEVEL-TX', 'LEVEL-TX · аналоговый передатчик');
  await selectDevice('SATURN-1', 'SATURN-1 · вход AI1 и FBD-программа');
  await selectDevice('RELAY-1', 'RELAY-1 · катушка управляется DO1');
  await selectDevice('LAMP-1', 'LAMP-1 · конечное устройство');
  await caption('Лампа включена только потому, что PLC выдал DO1 = 1', 1600);

  await click('#view-3d', 'Переключаем ту же установку в 3D');
  await page.locator('#scene3d canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(900);
  await click('[data-node3d="SATURN-1"]', 'SATURN-1 в 3D — тот же объект и те же сигналы');
  await page.waitForTimeout(900);
  await click('[data-node3d="LAMP-1"]', 'LAMP-1 в 3D — состояние синхронно с HMI');
  await caption('Одна инженерная модель → HMI, 2D, 3D и Saturn PLC runtime', 2200);

  await page.waitForTimeout(800);
  const raw = await video.path();
  await context.close();
  await browser.close();
  const webm = output + '/hmi-saturn-plc-tour.webm';
  await rename(raw, webm);
  const mp4 = output + '/hmi-saturn-plc-tour.mp4';
  const ffmpeg = spawnSync('ffmpeg', ['-y','-i',webm,'-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',mp4], { stdio: 'inherit' });
  if (ffmpeg.status !== 0) throw new Error('ffmpeg conversion failed');
  console.log(mp4);
} catch (error) {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  throw error;
}
