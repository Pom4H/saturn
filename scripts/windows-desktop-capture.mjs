import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

const exe = resolve(process.argv[2] ?? 'dist/standalone/saturn.exe');
const out = resolve(process.argv[3] ?? 'standalone-test-results/windows-desktop.png');
mkdirSync(resolve(out, '..'), { recursive: true });

const project = join(tmpdir(), `saturn-capture-project-${process.pid}-${Date.now()}`);
const data = join(tmpdir(), `saturn-capture-data-${process.pid}-${Date.now()}`);
mkdirSync(project, { recursive: true });
mkdirSync(data, { recursive: true });
const demoFiles = ['views.ts','commissioning.ts','wiring.ts','plant.ts','core.ts','cooling.ts','steam.ts','safety.ts','reports.ts','auxiliary.ts','services.ts','training.ts'];
for (const name of demoFiles) copyFileSync(resolve('plant/demo', name), join(project, name));
writeFileSync(join(project, 'scada.project.json'), JSON.stringify({ version: 1, entry: 'plant.ts', files: demoFiles }, null, 2));

const port = 43177;
const saturn = spawn(exe, ['open', project], {
  env: { ...process.env, PORT:String(port), HOST:'127.0.0.1', SCADA_USER:'engineer', SCADA_PASSWORD:'capture-password', SATURN_DATA_DIR:data },
  stdio:['ignore','pipe','pipe'],
  windowsHide:false,
});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

let browser;
try {
  for (let i=0;i<80;i++) {
    if (saturn.exitCode !== null) throw new Error(`Saturn exited early: ${saturn.exitCode}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/plant/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {}
    if (i===79) throw new Error('Saturn did not become healthy');
    await sleep(250);
  }

  const candidates = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const browserPath = candidates.find(p => existsSync(p));
  if (!browserPath) throw new Error('Edge/Chrome executable not found on Windows runner');

  browser = await chromium.launch({
    headless:false,
    executablePath:browserPath,
    args:['--window-size=1536,864','--window-position=192,90','--disable-infobars','--no-first-run'],
  });
  const context = await browser.newContext({ viewport:null });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/plant/login`, { waitUntil:'domcontentloaded' });
  await page.locator('input[name="user"]').fill('engineer');
  await page.locator('input[name="password"]').fill('capture-password');
  await Promise.all([
    page.waitForURL(url => url.pathname === '/' && url.searchParams.get('project') === 'server' && url.hash === '#workspace'),
    page.locator('form button').click(),
  ]);
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(2500);

  execFileSync('ffmpeg', ['-y','-loglevel','error','-f','gdigrab','-draw_mouse','0','-i','desktop','-frames:v','1',out], { stdio:'inherit' });
  if (!existsSync(out)) throw new Error('Desktop screenshot was not created');
  console.log(out);
} finally {
  await browser?.close().catch(()=>{});
  if (saturn.exitCode === null) saturn.kill();
}
