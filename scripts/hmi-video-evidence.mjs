import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

const evidence=process.env.PWA_EVIDENCE_DIR??'plant-test-results';
await mkdir(evidence+'/video',{recursive:true});
await mkdir('.plant',{recursive:true});
await build({
  entryPoints:['plant/tests/hmi-video-browser.ts'],
  outfile:'.plant/hmi-video-browser.js',
  bundle:true,
  format:'iife',
  platform:'browser',
  target:'es2022',
  minify:true,
  define:{'process.env.NODE_ENV':'"production"'},
});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({
  viewport:{width:1280,height:720},
  recordVideo:{dir:evidence+'/video',size:{width:1280,height:720}},
});
const page=await context.newPage();
const video=page.video();
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#0b1115;color:#dce8ec;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
body{display:grid;grid-template-rows:58px 1fr;overflow:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid #26323a;background:#10181d}
.brand{font-weight:750;letter-spacing:.04em}.tag{font:12px ui-monospace,monospace;color:#7f9aa6}
main{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:24px;padding:28px}
.stage{display:flex;align-items:center;justify-content:center;border:1px solid #27363e;background:#0d151a;min-width:0}
#plc-front{width:min(860px,100%)}#plc-front>svg{display:block;width:100%;height:auto}
aside{border:1px solid #27363e;background:#111a1f;padding:20px;display:flex;flex-direction:column;gap:18px}
h1{font-size:15px;margin:0 0 6px}.muted{font-size:12px;color:#76909c}
.metric{display:grid;grid-template-columns:1fr auto;gap:12px;border-top:1px solid #26333a;padding-top:14px}.metric b{font:600 18px ui-monospace,monospace}
.badge{display:inline-flex;width:max-content;padding:5px 8px;border:1px solid #31515d;border-radius:4px;font:11px ui-monospace,monospace;color:#75d5e3}
.path{margin-top:auto;font:11px/1.5 ui-monospace,monospace;color:#66818d}
</style></head><body>
<header><div class="brand">SATURN ENGINEERING</div><div class="tag">DIGITAL TWIN · FIRMVERSE WASM</div></header>
<main>
<section class="stage"><div id="plc-front"></div></section>
<aside>
<div><span class="badge">LIVE WASM</span><h1>Saturn PLC · HMI runtime</h1><div class="muted">ControllerVM executes the PLC. React projects the immutable 320×240 frame.</div></div>
<div class="metric"><span>AI1</span><b id="ai">—</b></div>
<div class="metric"><span>DO1</span><b id="do">—</b></div>
<div class="metric"><span>model time</span><b id="model-time">—</b></div>
<div class="path">ControllerVM → Firmverse WASM → HMI frame → SaturnHmi320 → SVG pixels</div>
</aside>
</main></body></html>`);
await page.addScriptTag({path:'.plant/hmi-video-browser.js'});
await page.waitForFunction(()=>window.__saturnHmiVideoReady===true);
await page.waitForTimeout(6200);
await page.screenshot({path:evidence+'/saturn-wasm-hmi-final.png',fullPage:true});
await context.close();
if(video)await video.saveAs(evidence+'/saturn-wasm-hmi.webm');
await browser.close();
console.log('Recorded '+evidence+'/saturn-wasm-hmi.webm');
