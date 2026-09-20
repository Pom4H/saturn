import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const evidence=process.env.PWA_EVIDENCE_DIR??'plant-test-results';
await mkdir(evidence,{recursive:true});
const base=process.env.PWA_URL??'http://127.0.0.1:4176/plant/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1680,height:1100}});
const page=await context.newPage();
try{
  await page.goto(base+'demo/');
  await page.locator('#application').waitFor({state:'visible',timeout:20000});
  await page.locator('[data-system="commissioning"]').click();
  await page.locator('#diagram [data-node="SATURN-1"]').click();

  const lcd=page.locator('#plc-front .runtime-hmi');
  await lcd.locator('[data-firmverse-display]').waitFor();
  assert.equal(await lcd.getAttribute('data-renderer'),'react');
  assert.ok(await lcd.locator('[data-firmverse-command]').count()>10);

  await page.locator('#plc-front [data-plc-button="right"]').click();
  await lcd.locator('[data-hmi-page="process"]').waitFor();
  assert.ok(await lcd.locator('[data-source="tank"]').count()>0);
  assert.ok(await lcd.locator('[data-source="pump"]').count()>0);
  assert.ok(await lcd.locator('[data-source="flow-in"]').count()>0);
  await page.screenshot({path:evidence+'/firmverse-display-process.png',fullPage:true});

  await page.locator('#plc-front [data-plc-button="right"]').click();
  await lcd.locator('[data-hmi-page="device.PUMP-1"]').waitFor();
  await page.locator('#plc-front [data-plc-button="up"]').click();
  await page.waitForFunction(()=>Number(document.querySelector('#inspector [data-signal="SATURN-1.DO1"] b')?.textContent)===1,null,{timeout:12000});

  const rotor=lcd.locator('polygon[data-source="pump"]').first();
  await rotor.waitFor({timeout:12000});
  await page.waitForTimeout(700);
  const rotorA=await rotor.getAttribute('points');
  const timeA=Number(await lcd.locator('[data-firmverse-display]').getAttribute('data-display-time'));
  await page.waitForTimeout(350);
  const rotorB=await rotor.getAttribute('points');
  const timeB=Number(await lcd.locator('[data-firmverse-display]').getAttribute('data-display-time'));
  assert.ok(timeB>timeA,'model time must advance');
  assert.notEqual(rotorA,rotorB,'Firmverse must advance rotor polygon geometry');

  const packet=lcd.locator('circle[data-source="pump-flow"]').first();
  await packet.waitFor({timeout:12000});
  const packetA=[await packet.getAttribute('cx'),await packet.getAttribute('cy')];
  await page.waitForTimeout(350);
  const packetB=[await packet.getAttribute('cx'),await packet.getAttribute('cy')];
  assert.notDeepEqual(packetA,packetB,'Firmverse must move flow packets');

  const visibleAnimations=await lcd.locator('[data-firmverse-display] [data-firmverse-command]').evaluateAll(nodes=>nodes.reduce((count,node)=>count+node.getAnimations().length,0));
  assert.equal(visibleAnimations,0,'visible equipment motion must not be CSS/WebAnimation driven');
  await page.screenshot({path:evidence+'/firmverse-display-pump.png',fullPage:true});
  console.log(JSON.stringify({renderer:'firmverse-display-emulator',rotorMoved:true,flowMoved:true,visibleBrowserAnimations:visibleAnimations,timeA,timeB}));
}finally{
  await context.close();await browser.close();
}
