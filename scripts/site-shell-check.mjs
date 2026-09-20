import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

/** Integrated Shell checks. Notification APIs are intercepted before application code runs. */
export async function checkShell(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const errors = [];
  try {
    await context.addInitScript(() => {
      localStorage.setItem('saturn.ui.language', 'ru');
      const state = window.__shellNotificationTest = { permission: 'default', requests: 0, shows: [], nextPermission: 'granted' };
      // Never ask the host browser for permission or display a host notification.
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => state.permission });
      Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: async () => {
        state.requests++;
        state.permission = state.nextPermission;
        return state.permission;
      } });
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'showNotification', { configurable: true, value: async (title, options) => {
        state.shows.push({ title, options });
      } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('#studio-spatial canvas', { state: 'attached' });
    await page.waitForFunction(() => document.getElementById('project-switch')?.options.length > 0);
    await mkdir('test-results/site-studio', { recursive: true });
    // Project switching is a styled, searchable popover, including keyboard selection.
    assert(await page.locator('#project-switch').evaluate(node => node.hidden));
    await page.locator('#project-trigger').click();
    await page.locator('#project-picker-search').fill('тепловой');
    await page.locator('#project-picker-search').press('Enter');
    assert.equal(await page.locator('#project-switch').inputValue(), 'example:thermal');
    await page.locator('#project-trigger').click();
    await page.locator('#project-picker-search').fill('насосная');
    await page.locator('#project-picker-search').press('ArrowDown');
    await page.locator('#project-picker-search').press('Enter');
    assert.equal(await page.locator('#project-switch').inputValue(), 'example:pump');
    await page.locator('#project-trigger').click();
    await page.locator('#project-picker-search').fill('does-not-exist');
    assert.equal(await page.locator('#project-picker-list [role=option]').count(), 0);
    await page.locator('#project-picker-search').press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'project-trigger');
    await page.setViewportSize({ width: 666, height: 732 });
    assert(await page.locator('#inspector-toggle').isDisabled(), 'Empty inspector cannot replace the scene');
    await page.locator('#files-toggle').click();
    assert(await page.locator('.studio-viewport').isVisible(), 'File tree keeps the scene at intermediate widths');
    const header = await page.locator('.shell-topbar').boundingBox();
    assert(header.height < 50, '666px uses a single header row');
    await page.locator('#project-trigger').click();
    const pickerBox = await page.locator('#project-picker').boundingBox();
    assert(pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= 666);
    await page.screenshot({ path: 'test-results/site-studio/project-picker-666.png' });
    await page.locator('#project-picker-search').press('Escape');
    await page.locator('#files-close').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const notificationState = () => page.evaluate(() => window.__shellNotificationTest);
    assert.equal((await notificationState()).requests, 0, 'Loading the Shell must not request notification permission');

    // Ctrl+Shift+P belongs to commands and must not also hit the existing Ctrl+P file handler.
    assert(await page.locator('#file-browser').evaluate(node => node.hidden), 'Fresh Shell starts with the file tree closed');
    await page.locator('#command-launcher').focus();
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#shell-command-dialog').waitFor({ state: 'visible' });
    assert(await page.locator('#file-browser').evaluate(node => node.hidden), 'Command shortcut must not open the file tree underneath');
    const search = page.locator('#shell-command-search');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'shell-command-search');
    const first = await search.getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await search.getAttribute('aria-activedescendant'), first, 'ArrowDown selects another command');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'command-launcher', 'Closing commands restores focus');
    assert(await page.locator('#file-browser').evaluate(node => node.hidden), 'Escape closes only the palette');

    await page.keyboard.press('Control+k');
    await search.fill('переключить 2d');
    assert.equal(await page.locator('#shell-command-results [role="option"]').count(), 1);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#studio-shell').getAttribute('data-mode'), '2d', 'Commands use the existing editor action');
    await page.locator('#command-launcher').click();
    await search.fill('zz-no-matching-command');
    assert.equal(await page.locator('#shell-command-results [role="option"]').count(), 0);
    assert.match(await page.locator('#shell-command-results').innerText(), /не найдены/);
    await page.keyboard.press('Escape');

    // Export is intentionally inside a closed details menu, yet available through the registry.
    assert.equal(await page.locator('.export-options').getAttribute('open'), null);
    await page.locator('#command-launcher').click();
    await search.fill('скачать исходники');
    const downloaded = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    assert.match((await downloaded).suggestedFilename(), /\.(ts|json)$/);
    assert.equal(await page.locator('.export-options').getAttribute('open'), null, 'Palette export does not need to open the menu');

    await page.locator('#shell-help').focus();
    await page.keyboard.press('F1');
    await page.locator('#shell-help-dialog').waitFor({ state: 'visible' });
    await page.locator('#shell-help-search').fill('ревизия');
    assert.equal(await page.locator('.shell-help-article h3').innerText(), 'Проект с сервера');
    assert.match(await page.locator('.shell-help-article').innerText(), /не перезаписывает/);
    await page.screenshot({ path: 'test-results/site-studio/shell-help.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'shell-help');

    // Opening settings and reading permission state must never trigger a permission prompt.
    await page.locator('#shell-notifications').click();
    await page.locator('#app-settings').waitFor({ state: 'visible' });
    assert.equal((await notificationState()).requests, 0, 'Notification settings must not request permission on open');
    assert.equal(await page.locator('#app-notifications-state').innerText(), 'Не включены');
    await page.locator('#app-notifications-allow').click();
    await page.waitForFunction(() => window.__shellNotificationTest.requests === 1);
    assert.equal(await page.locator('#app-notifications-state').innerText(), 'Разрешены');
    assert.equal((await notificationState()).shows.length, 0, 'Granting permission does not send a notification');
    await page.waitForFunction(() => !document.getElementById('app-notifications-test')?.disabled);
    await page.locator('#app-notifications-test').click();
    await page.waitForFunction(() => window.__shellNotificationTest.shows.length === 1);
    assert.equal((await notificationState()).shows[0].title, 'Saturn');
    assert.equal((await notificationState()).requests, 1, 'Test notification must not re-request permission');
    await page.evaluate(() => { window.__shellNotificationTest.permission = 'denied'; window.dispatchEvent(new Event('focus')); });
    assert.equal(await page.locator('#app-notifications-state').innerText(), 'Заблокированы');
    assert(await page.locator('#app-notifications-allow').evaluate(node => node.hidden));
    assert.match(await page.locator('#app-notifications-description').innerText(), /настройках сайта/);
    await page.locator('.app-theme-options label:has([value="light"])').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    const lightBackground = await page.locator('#studio-shell').evaluate(node => getComputedStyle(node).backgroundColor);
    await page.locator('.app-settings-close').click();
    await page.screenshot({ path: 'test-results/site-studio/shell-light.png' });
    await page.reload();
    await page.waitForSelector('#studio-spatial canvas', { state: 'attached' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'Theme survives reload');
    assert.equal((await notificationState()).requests, 0, 'Reload also must not request permission');
    await page.locator('#shell-settings').click();
    assert(await page.locator('[name="app-theme"][value="light"]').isChecked());
    await page.locator('.app-theme-options label:has([value="dark"])').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.notEqual(await page.locator('#studio-shell').evaluate(node => getComputedStyle(node).backgroundColor), lightBackground, 'Theme changes the actual Shell appearance');
    assert.equal(await page.evaluate(() => localStorage.getItem('saturn.ui.theme')), 'dark');
    await page.locator('.app-settings-close').click();
    await page.screenshot({ path: 'test-results/site-studio/shell-dark.png' });
    await page.reload();
    await page.waitForSelector('#studio-spatial canvas', { state: 'attached' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Dark theme also survives reload');

    // A real menu action opens the same settings, without adding another modal instance.
    await page.locator('.export-options summary').click();
    await page.locator('.export-options [data-app-settings]').click();
    assert.equal(await page.locator('#app-settings:visible').count(), 1);
    await page.keyboard.press('Escape');
    await page.locator('.export-options').evaluate(node => { node.open = false; });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#shell-fullscreen').click();
    assert(await page.locator('body').evaluate(node => node.classList.contains('shell-fullscreen')));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Narrow Shell must not overflow the page');
    const topbar = await page.locator('.shell-topbar').evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth }));
    assert(topbar.content <= topbar.width + 1, 'Narrow toolbar must fit its container');
    await page.screenshot({ path: 'test-results/site-studio/shell-mobile.png' });
    await page.keyboard.press('F1');
    await page.locator('#shell-help-dialog').waitFor({ state: 'visible' });
    const helpBox = await page.locator('#shell-help-dialog').boundingBox();
    assert(helpBox && helpBox.x >= 0 && helpBox.x + helpBox.width <= 391, 'Mobile help stays inside viewport');
    assert(await page.locator('#shell-help-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Mobile help has no horizontal overflow');
    await page.screenshot({ path: 'test-results/site-studio/shell-mobile-help.png' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await search.fill('справка');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#shell-help-dialog:visible').count(), 1, 'Palette opens help on a narrow viewport');
    assert.deepEqual(errors, [], 'Shell interactions should produce no unhandled errors');
    console.log('Shell checks passed: commands, help, explicit notifications, themes, menu and mobile layout.');
  } finally {
    await context.close();
  }
}
