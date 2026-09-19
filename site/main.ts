import './styles.css';
import './i18n';
import './studio.css';
import { mountProjectPicker } from './project-picker';
mountProjectPicker();
import { configureAppUpdates } from './pwa';
import { mountCommands } from './commands';
import './commands.css';
mountCommands();
const shortcut = document.querySelector('#command-launcher kbd');
if (shortcut) shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
import { mountStudio } from './studio';
mountStudio().catch(error => {
  const status = document.getElementById('studio-diagnostics');
  if (status) status.textContent = 'Не удалось открыть среду. Обновите страницу.';
  console.error(error);
});

// Updating is explicit, and the workspace can veto losing an in-memory draft.
configureAppUpdates(async registration => {
  if (!window.dispatchEvent(new Event('saturn-before-update', { cancelable: true }))) {
    throw new Error('Сначала сохраните копию серверного черновика или скачайте проект.');
  }
  if (!registration.waiting) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      reject(new Error('Версия пока не активирована. Попробуйте ещё раз.'));
    }, 12000);
    function changed() { clearTimeout(timeout); resolve(); location.reload(); }
    navigator.serviceWorker.addEventListener('controllerchange', changed, { once: true });
    registration.waiting!.postMessage({ type: 'SATURN_SKIP_WAITING' });
  });
});
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const menu = document.querySelector<HTMLDetailsElement>('.export-options');
  if (menu?.open && (target?.closest('.export-options button') || !target?.closest('.export-options'))) menu.open = false;
});
