import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

/** Exercise the real shell; no parallel fixture UI or project persistence. */
export async function checkShellUx(page, { evidence = 'test-results/release-shell', webgl = true } = {}) {
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (!await page.locator('body').evaluate(body => body.classList.contains('shell-fullscreen'))) await page.locator('#shell-fullscreen').click();
  await page.locator('#studio-2d').click();
  if (await page.locator('.studio-inspector').isVisible()) await page.locator('#inspector-close').click();
  if (!await page.locator('#studio-editor-pane').isVisible()) await page.locator('#studio-code').click();
  const source = page.locator('#studio-editor .cm-content');
  const original = await source.innerText();
  const theme = async value => {
    await page.locator('.export-options summary').click();
    await page.locator('#shell-settings').click();
    await page.locator(`.app-theme-options label:has(input[value="${value}"])`).click();
    await page.locator('.app-settings-close').click();
  };
  const appearance = () => page.evaluate(() => ({
    canvas: getComputedStyle(document.querySelector('.studio-viewport')).backgroundColor,
    text: getComputedStyle(document.querySelector('#studio-2d')).color,
    shell: getComputedStyle(document.querySelector('#studio-shell')).getPropertyValue('--shell-bg').trim(),
  }));
  await page.emulateMedia({ colorScheme: 'light' });
  await theme('system');
  const light = await appearance();
  assert.match(light.canvas, /250, 250, 250/, 'System light must not leave a black diagram');
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await appearance();
  assert.notEqual(dark.canvas, light.canvas, 'System theme changes the diagram without remounting');
  assert.notEqual(dark.text, light.text, 'Selected canvas tools retain theme contrast');
  await theme('light');
  assert.equal((await appearance()).canvas, light.canvas, 'Explicit theme overrides dark OS');
  await theme('dark');
  assert.equal((await appearance()).canvas, dark.canvas, 'Explicit dark is consistent');
  if (webgl) {
    await page.locator('#studio-3d').click();
    const clear = () => page.locator('#studio-spatial canvas').evaluate(canvas => Array.from(canvas.getContext('webgl2').getParameter(canvas.getContext('webgl2').COLOR_CLEAR_VALUE)));
    const darkClear = await clear();
    await theme('light');
    const lightClear = await clear();
    assert(lightClear[0] > darkClear[0] + .5, '3D clear colour follows the same live theme');
    await page.screenshot({ path: `${evidence}/shell-light-3d.png` });
    await page.locator('#studio-2d').click();
  } else await theme('light');
  assert.equal(await source.innerText(), original, 'Theme changes must not write authored source');

  await page.locator('#equipment-toggle').click();
  assert(await page.locator('#equipment-search').evaluate(node => node === document.activeElement));
  assert.equal(await page.locator('#studio-catalog,#studio-add').count(), 0, 'No duplicate selector/add path');
  const bounds = await page.locator('#equipment-browser').boundingBox();
  const editor = await page.locator('#studio-editor-pane').boundingBox();
  assert(editor.x >= bounds.x + bounds.width - 1, 'Desktop catalog must not cover code');
  await page.screenshot({ path: `${evidence}/shell-light-catalog.png` });
  await page.locator('#equipment-search').fill('несуществующаядеталь');
  assert(await page.locator('#equipment-empty').isVisible(), 'Empty search explains the result');
  assert.equal(await page.locator('[data-catalog-kind]').count(), 0);
  await page.locator('#equipment-search').fill('насос');
  assert.equal(await page.locator('[data-catalog-kind]').count(), 1);
  assert.equal(await page.locator('[data-catalog-kind="pump"]').getAttribute('aria-label'), 'Добавить: Насос');
  await page.keyboard.press('Escape');
  assert(!await page.locator('#equipment-browser').isVisible());
  assert(await page.locator('#equipment-toggle').evaluate(node => node === document.activeElement), 'Escape returns focus to Add');

  // An ordinary catalog click is one reversible source edit, not an installation.
  await page.locator('#equipment-toggle').click();
  const count = await page.locator('#studio-svg [data-node]').count();
  await page.locator('[data-catalog-kind="pump"]').click();
  assert.equal(await page.locator('#studio-svg [data-node]').count(), count + 1);
  assert(!await page.locator('#equipment-browser').isVisible());
  assert.notEqual(await source.innerText(), original);
  await page.locator('#studio-undo').click();
  assert.equal(await source.innerText(), original, 'Undo restores exact source after insertion');
  if (await page.locator('.studio-inspector').isVisible()) await page.locator('#inspector-close').click();

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 600 });
    if (await page.locator('#equipment-browser').isHidden()) await page.locator('#equipment-toggle').click();
    await page.locator('#equipment-search').fill('');
    const layout = await page.evaluate(() => {
      const browser = document.getElementById('equipment-browser');
      const scrollers = [browser, ...browser.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
      const rect = browser.getBoundingClientRect();
      return { scrollers: scrollers.map(node => node.className), left: rect.left, right: rect.right, bottom:rect.bottom, pageWidth: document.documentElement.scrollWidth, width: innerWidth, content: browser.querySelector('.equipment-browser-content').getBoundingClientRect().toJSON(), scroll: browser.querySelector('.equipment-browser-content').scrollHeight };
    });
    assert.deepEqual(layout.scrollers, ['equipment-browser-content'], `${width}: exactly one catalogue scroll owner`);
    assert(layout.left >= 0 && layout.right <= width + 1, `${width}: catalogue fits the viewport`);
    assert(layout.pageWidth <= layout.width + 1, `${width}: no horizontal page overflow`);
    await page.locator('#studio-tree button').last().scrollIntoViewIfNeeded();
    assert(await page.locator('#equipment-search').isVisible());
    assert(await page.locator('#equipment-close').isVisible(), 'Close remains reachable after scrolling');
    await page.screenshot({ path: `${evidence}/shell-catalog-${width}.png` });
    await page.locator('#equipment-close').click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await theme('dark');
  await page.locator('#equipment-toggle').click();
  await page.screenshot({ path: `${evidence}/shell-dark-catalog.png` });
  await page.locator('#equipment-close').click();
  await theme('system');
  await page.emulateMedia({ colorScheme: 'light' });
  console.log('PASS: shared system/light/dark canvas; direct catalog add/undo; desktop docking; one scroll owner at 320–1440px; search and keyboard focus.');
}
