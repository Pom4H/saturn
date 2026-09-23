import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { checkOriginalAnatomy } from './svg-reference-check.mjs';

/** Reuses an already mounted real landing. No alternate renderer or production test API. */
export async function checkHoverAndSvg(page) {
  const shell = page.locator('#studio-shell');
  const source = page.locator('#studio-editor .cm-content');
  await page.locator('#studio-svg [data-anatomy="saturn-pump"]').waitFor();
  assert.equal(await shell.locator('[data-anatomy="saturn-tank"]').count(), 1);
  assert(await shell.locator('[data-anatomy="saturn-pump"] circle').count() >= 10, 'Original pump bolts, body and rotor remain detailed');
  for (const [id, port, x, y] of [['P-01', 'inlet', 0, 96], ['P-01', 'outlet', 76, 0], ['TK-01', 'outlet', 170, 184]]) {
    const anchor = page.locator(`#studio-svg [data-node="${id}"] [data-symbol-port="${port}"]`);
    assert.equal(await anchor.getAttribute('data-anchor-x'), String(x));
    assert.equal(await anchor.getAttribute('data-anchor-y'), String(y));
  }
  for (const kind of ['pump','tank']) {
    const anatomy = shell.locator(`[data-anatomy="saturn-${kind}"]`);
    assert.equal(await anatomy.locator('[transform*="scale"]').count(), 0, 'No miniature SVG adapter');
  }
  const playing = await page.locator('#studio-play').getAttribute('aria-pressed') === 'true';
  if (!playing) await page.locator('#studio-play').click();
  await page.waitForFunction(() => Number(document.querySelector('#studio-svg')?.dataset.sequence) > 1);
  const rotor = page.locator('#studio-svg [data-node="P-01"] [data-part="rotor"]');
  assert(Number(await rotor.getAttribute('data-rpm')) > 0, 'The actual Kernel supplies rotation, not an invented animation');
  await page.locator('#studio-play').click();
  await checkOriginalAnatomy(page);
  await mkdir('test-results/release-shell', { recursive: true });
  await shell.screenshot({ path: 'test-results/release-shell/native-equipment.png' });
  const sequence = await page.locator('#studio-svg').getAttribute('data-sequence');
  const angle = await rotor.getAttribute('transform');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#studio-svg').getAttribute('data-sequence'), sequence, 'Pause also pauses the model');
  assert.equal(await rotor.getAttribute('transform'), angle);

  const initial = await source.evaluate(node => node.cmTile.view.state.doc.toString());
  const d = page.locator('#studio-svg [data-connection="suction"] path').first();
  const before = await d.getAttribute('d');
  const pump = page.locator('#studio-svg [data-node="P-01"]');
  await pump.scrollIntoViewIfNeeded();
  const box = await pump.boundingBox(); assert(box);
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .65); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6 + 30, box.y + box.height * .65 + 25, { steps: 5 });
  assert.notEqual(await d.getAttribute('d'), before, 'Canonical pipe follows detailed pump before drop');
  assert.equal(await source.evaluate(node => node.cmTile.view.state.doc.toString()), initial);
  await page.mouse.up();
  assert.notEqual(await source.evaluate(node => node.cmTile.view.state.doc.toString()), initial);
  await page.locator('#studio-undo').click();
  assert.equal(await source.evaluate(node => node.cmTile.view.state.doc.toString()), initial);

  // DOM position follows the real CodeMirror state, including virtualization and scroll.
  await source.evaluate(node => {
    const view = node.cmTile.view, at = view.state.doc.toString().indexOf("simulation('TK-01'") + 4;
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  });
  await source.scrollIntoViewIfNeeded();
  const point = await source.evaluate(node => {
    const view = node.cmTile.view, at = view.state.doc.toString().indexOf("simulation('TK-01'") + 4;
    const box = view.coordsAtPos(at); return { x: box.left + 2, y: (box.top + box.bottom) / 2 };
  });
  await page.mouse.move(point.x, point.y);
  const tooltip = page.locator('.saturn-jsdoc'); await tooltip.waitFor({ timeout: 15000 });
  assert.match(await tooltip.innerText(), /@example/);
  assert.match(await tooltip.innerText(), /TK-01/);
  assert((await tooltip.locator('p').first().innerText()).length > 25);
  const layout = await tooltip.evaluate(dom => {
    const box = dom.getBoundingClientRect(), summary = dom.querySelector('p').getBoundingClientRect();
    const signature = dom.querySelector('.saturn-jsdoc-signature').getBoundingClientRect();
    return { left: box.left, right: box.right, bottom: box.bottom, top: box.top, summaryBottom: summary.bottom, signatureHeight: signature.height, width: innerWidth, height: innerHeight };
  });
  assert(layout.left >= 0 && layout.right <= layout.width + 1 && layout.top >= 0 && layout.bottom <= layout.height + 1);
  assert(layout.signatureHeight <= 91 && layout.summaryBottom <= layout.bottom, 'Inferred generic types never push JSDoc out of view');
  await page.screenshot({ path: 'test-results/release-shell/jsdoc-hover.png' });
  await page.mouse.move(4, 4);
  if (playing) await page.locator('#studio-play').click();
  console.log('PASS: detailed shared SVGs, preserved anchors, real Kernel pause, drag/undo and bounded actual JSDoc hover.');
}
