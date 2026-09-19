import './pwa.css';
import { readAppLanguage, setAppLanguage, t } from './i18n';

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type AppTheme = 'system' | 'light' | 'dark';
type UpdateHandler = (registration: ServiceWorkerRegistration) => Promise<void>;
const THEME_KEY = 'saturn.ui.theme';
let installPrompt: InstallPrompt | undefined;
let registration: ServiceWorkerRegistration | undefined;
let workerError = '';
let busy = false;
let installed = false;
let dialog: HTMLDialogElement | undefined;
let previousFocus: HTMLElement | null = null;
let applyUpdate: UpdateHandler | undefined;
const displayMode = matchMedia('(display-mode: standalone)');

/** The workspace owns saving drafts and deciding whether a reload is safe. */
export function configureAppUpdates(handler: UpdateHandler): void {
  applyUpdate = handler;
  renderSettings();
}

function readTheme(): AppTheme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* UI preferences are optional in restricted browser sessions. */ }
  return 'system';
}
export function setAppTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Keep the in-session choice. */ }
  window.dispatchEvent(new CustomEvent('saturn-theme-change', { detail: { theme } }));
  renderSettings();
}
document.documentElement.dataset.theme = readTheme();

function isInstalled(): boolean {
  return installed || displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function permission(): NotificationPermission | 'unsupported' {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator ? Notification.permission : 'unsupported';
}
function installationHint(): string {
  if (isInstalled()) return t('app.openedAsApp');
  if (installPrompt) return t('app.installReady');
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (ios) return t('app.installIos');
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return t('app.installSafari');
  if (/Edg/.test(ua)) return t('app.installEdge');
  if (/Chrome|Chromium/.test(ua)) return t('app.installChrome');
  return t('app.installGeneric');
}
function offlineReady(): boolean { return Boolean(registration?.active); }
function networkState(): void {
  const node = document.getElementById('studio-network');
  const shell = document.getElementById('studio-shell');
  const serverProject = shell?.dataset.serverProject === 'true' || shell?.dataset.runtimeOnly === 'true';
  if (node) {
    const telemetry = shell?.dataset.telemetry;
    node.textContent = !navigator.onLine ? t('network.offline')
      : serverProject && (telemetry === 'live' || telemetry === 'paused') ? t('network.live')
      : serverProject && telemetry === 'auth' ? t('network.auth')
      : serverProject && (telemetry === 'stale' || telemetry === 'connecting') ? t('network.stale')
      : serverProject ? t('network.reconnecting')
      : offlineReady() ? t('network.local') : t('network.demo');
    node.title = serverProject ? (telemetry === 'live' || telemetry === 'paused' ? t('runtime.connected') : t('runtime.stale')) : offlineReady() ? t('app.offlineReadyTitle') : t('app.offlinePreparingTitle');
  }
  renderSettings();
}
function setText(id: string, value: string): void {
  const node = dialog?.querySelector<HTMLElement>(`#${id}`);
  if (node && node.textContent !== value) node.textContent = value;
}
function settingsMessage(value: string): void { setText('app-settings-message', value); }
function renderSettings(): void {
  if (!dialog) return;
  const get = <T extends HTMLElement>(id: string) => dialog!.querySelector<T>(`#${id}`)!;
  const currentPermission = permission();
  const supported = currentPermission !== 'unsupported';
  setText('app-install-description', installationHint());
  const install = get<HTMLButtonElement>('app-install');
  install.hidden = !installPrompt || isInstalled();
  install.disabled = busy;
  setText('app-install-state', isInstalled() ? t('app.installed') : t('app.browser'));
  setText('app-network-state', navigator.onLine ? t('app.networkAvailable') : t('app.noNetwork'));
  setText('app-offline-state', offlineReady() ? t('app.saved') : workerError || ('serviceWorker' in navigator && window.isSecureContext ? t('app.preparing') : t('app.unavailable')));
  setText('app-update-state', registration?.waiting ? t('app.updateAvailable') : registration?.installing ? t('app.updateDownloading') : offlineReady() ? t('app.updateReady') : t('app.awaiting'));
  const updateNote = get<HTMLElement>('app-update-note');
  updateNote.hidden = !registration?.waiting || Boolean(applyUpdate);
  const update = get<HTMLButtonElement>('app-update');
  update.hidden = !registration?.waiting || !applyUpdate;
  update.disabled = busy;
  get<HTMLButtonElement>('app-check-updates').disabled = busy || !registration || !navigator.onLine;
  const permissionLabels = { granted: t('app.permissionGranted'), denied: t('app.permissionDenied'), default: t('app.permissionDefault'), unsupported: t('app.permissionUnsupported') };
  setText('app-notifications-state', permissionLabels[currentPermission]);
  setText('app-notifications-description', currentPermission === 'denied'
    ? t('app.notificationsDenied')
    : currentPermission === 'unsupported' ? t('app.notificationsUnsupported')
    : currentPermission === 'granted' ? t('app.notificationsGranted')
    : t('app.notificationsDefault'));
  const allow = get<HTMLButtonElement>('app-notifications-allow');
  allow.hidden = !supported || currentPermission !== 'default';
  allow.disabled = busy;
  const test = get<HTMLButtonElement>('app-notifications-test');
  test.hidden = currentPermission !== 'granted';
  test.disabled = busy || !registration?.active || typeof registration.showNotification !== 'function';
  const theme = document.documentElement.dataset.theme ?? 'system';
  dialog.querySelectorAll<HTMLInputElement>('[name="app-theme"]').forEach(input => { input.checked = input.value === theme; });
  const language = readAppLanguage();
  dialog.querySelectorAll<HTMLInputElement>('[name="app-language"]').forEach(input => { input.checked = input.value === language; });
}

function createSettings(): HTMLDialogElement {
  const panel = document.createElement('dialog');
  panel.className = 'app-settings';
  panel.id = 'app-settings';
  panel.setAttribute('aria-labelledby', 'app-settings-title');
  panel.innerHTML = `
    <header class="app-settings-heading"><h2 id="app-settings-title">${t('settings.title')}</h2><button type="button" class="app-settings-close" aria-label="${t('settings.title')}" autofocus>×</button></header>
    <div class="app-settings-body">
      <section class="app-settings-section" aria-labelledby="app-appearance-title">
        <h3 id="app-appearance-title">${t('settings.appearance')}</h3>
        <fieldset class="app-theme-options"><legend class="app-sr-only">${t('settings.theme')}</legend>
          <label><input type="radio" name="app-theme" value="system"><span>${t('settings.themeSystem')}</span></label>
          <label><input type="radio" name="app-theme" value="light"><span>${t('settings.themeLight')}</span></label>
          <label><input type="radio" name="app-theme" value="dark"><span>${t('settings.themeDark')}</span></label>
        </fieldset>
      </section>
      <section class="app-settings-section" aria-labelledby="app-language-title">
        <h3 id="app-language-title">${t('settings.language')}</h3>
        <fieldset class="app-theme-options"><legend class="app-sr-only">${t('settings.language')}</legend>
          <label><input type="radio" name="app-language" value="system"><span>${t('settings.languageSystem')}</span></label>
          <label><input type="radio" name="app-language" value="ru"><span>${t('settings.languageRussian')}</span></label>
          <label><input type="radio" name="app-language" value="en"><span>${t('settings.languageEnglish')}</span></label>
        </fieldset>
      </section>
      <section class="app-settings-section" aria-labelledby="app-install-title">
        <div class="app-settings-row"><h3 id="app-install-title">${t('settings.application')}</h3><span id="app-install-state" class="app-settings-value"></span></div>
        <p id="app-install-description"></p><button type="button" id="app-install">${t('common.install')} Saturn</button>
        <dl class="app-settings-status"><div><dt>${t('settings.network')}</dt><dd id="app-network-state"></dd></div><div><dt>${t('settings.offline')}</dt><dd id="app-offline-state"></dd></div><div><dt>${t('settings.updates')}</dt><dd id="app-update-state"></dd></div></dl>
        <p id="app-update-note" hidden>${t('app.updateNote')}</p>
        <div class="app-settings-actions"><button type="button" id="app-check-updates">${t('settings.checkUpdates')}</button><button type="button" id="app-update" hidden>${t('settings.updateApp')}</button></div>
      </section>
      <section class="app-settings-section" aria-labelledby="app-notifications-title">
        <div class="app-settings-row"><h3 id="app-notifications-title">${t('settings.notifications')}</h3><span id="app-notifications-state" class="app-settings-value"></span></div>
        <p id="app-notifications-description"></p>
        <div class="app-settings-actions"><button type="button" id="app-notifications-allow">${t('settings.allowNotifications')}</button><button type="button" id="app-notifications-test" hidden>${t('settings.testNotification')}</button></div>
        <p class="app-settings-footnote">${t('app.notificationsFootnote')}</p>
      </section>
    </div>
    <div id="app-settings-message" class="app-settings-message" role="status" aria-live="polite"></div>`;
  document.body.append(panel);
  panel.querySelector<HTMLButtonElement>('.app-settings-close')!.onclick = () => panel.close();
  panel.addEventListener('close', () => { if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus(); });
  panel.addEventListener('click', event => {
    if (event.target !== panel) return;
    const rect = panel.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) panel.close();
  });
  panel.querySelectorAll<HTMLInputElement>('[name="app-theme"]').forEach(input => input.addEventListener('change', () => {
    if (input.checked && ['system', 'light', 'dark'].includes(input.value)) setAppTheme(input.value as AppTheme);
  }));
  panel.querySelectorAll<HTMLInputElement>('[name="app-language"]').forEach(input => input.addEventListener('change', () => {
    if (input.checked && ['system', 'ru', 'en'].includes(input.value)) setAppLanguage(input.value as 'system' | 'ru' | 'en');
  }));
  panel.querySelector<HTMLButtonElement>('#app-install')!.onclick = () => { void requestInstall(); };
  panel.querySelector<HTMLButtonElement>('#app-notifications-allow')!.onclick = () => { void requestNotifications(); };
  panel.querySelector<HTMLButtonElement>('#app-notifications-test')!.onclick = () => { void testNotification(); };
  panel.querySelector<HTMLButtonElement>('#app-check-updates')!.onclick = () => { void checkUpdates(); };
  panel.querySelector<HTMLButtonElement>('#app-update')!.onclick = () => { void runUpdate(); };
  return panel;
}
export function openAppSettings(section?: 'notifications'): void {
  dialog ??= createSettings();
  if (dialog.open) { if (section === 'notifications') focusNotifications(); return; }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  settingsMessage('');
  renderSettings();
  dialog.showModal();
  if (section === 'notifications') focusNotifications();
}
function focusNotifications(): void {
  const heading = dialog?.querySelector<HTMLElement>('#app-notifications-title');
  if (heading) { heading.tabIndex = -1; heading.focus(); heading.scrollIntoView({ block: 'nearest' }); }
}
async function runAction(action: () => Promise<void>, failure: string): Promise<void> {
  if (busy) return;
  busy = true; settingsMessage(''); renderSettings();
  try { await action(); } catch { settingsMessage(failure); }
  finally { busy = false; renderSettings(); }
}
async function requestInstall(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  await runAction(async () => {
    installPrompt = undefined;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    settingsMessage(choice.outcome === 'accepted' ? 'Установка запущена.' : 'Можно установить приложение позже.');
  }, 'Не удалось начать установку. Попробуйте через меню браузера.');
}
async function requestNotifications(): Promise<void> {
  if (permission() !== 'default') return;
  await runAction(async () => {
    const result = await Notification.requestPermission();
    settingsMessage(result === 'granted' ? 'Разрешение получено.' : result === 'denied' ? 'Разрешение заблокировано в браузере.' : 'Разрешение пока не предоставлено.');
  }, 'Не удалось запросить разрешение. Проверьте настройки браузера.');
}
async function testNotification(): Promise<void> {
  if (permission() !== 'granted' || !registration?.active) return;
  await runAction(async () => {
    await registration!.showNotification('Saturn', { body: 'Проверочное уведомление. Уведомления на этом устройстве работают.', icon: '/site/assets/icon-192.png', tag: 'saturn-notification-test' });
    settingsMessage('Проверочное уведомление передано системе. Его показ зависит от настроек устройства.');
  }, 'Система не приняла уведомление. Проверьте разрешения браузера и устройства.');
}
async function checkUpdates(): Promise<void> {
  if (!registration) return;
  await runAction(async () => {
    await registration!.update();
    settingsMessage(registration!.installing ? 'Новая версия загружается.' : registration!.waiting ? 'Новая версия готова.' : 'Проверка завершена.');
  }, 'Не удалось проверить обновления. Проверьте подключение к сети.');
}
async function runUpdate(): Promise<void> {
  if (!registration?.waiting || !applyUpdate) return;
  await runAction(() => applyUpdate!(registration!), 'Обновление не выполнено. Ваш проект остаётся открыт.');
}
function observeWorker(worker: ServiceWorker | null): void {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'redundant' && !registration?.active) workerError = 'Не удалось сохранить приложение';
    networkState();
  });
}
async function registerWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { networkState(); return; }
  try {
    registration = await navigator.serviceWorker.register('/saturn-sw.js', { scope: '/' });
    observeWorker(registration.installing);
    registration.addEventListener('updatefound', () => { observeWorker(registration!.installing); renderSettings(); });
    networkState();
    await navigator.serviceWorker.ready;
    networkState();
  } catch { workerError = 'Не удалось подготовить приложение'; networkState(); }
}
window.addEventListener('saturn-project-change', networkState);
window.addEventListener('saturn-telemetry-change', networkState);
window.addEventListener('online', networkState);
window.addEventListener('offline', networkState);
window.addEventListener('focus', renderSettings);
window.addEventListener('saturn-language-change', () => {
  const reopen = Boolean(dialog?.open);
  dialog?.remove(); dialog = undefined;
  networkState();
  if (reopen) openAppSettings();
});
displayMode.addEventListener('change', renderSettings);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallPrompt; renderSettings(); });
window.addEventListener('appinstalled', () => { installed = true; installPrompt = undefined; renderSettings(); });
document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const trigger = event.target.closest<HTMLElement>('[data-install-studio], [data-app-settings]');
  if (trigger) openAppSettings(trigger.dataset.appSettings === 'notifications' || trigger.id === 'shell-notifications' ? 'notifications' : undefined);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', networkState);
if (document.readyState === 'complete') void registerWorker();
else window.addEventListener('load', () => { void registerWorker(); }, { once: true });
networkState();
