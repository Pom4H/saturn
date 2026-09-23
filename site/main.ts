import './styles.css';
import './studio.css';
import './landing-demo.css';
import './landing.css';
import { configureAppUpdates } from './pwa';
import './commands.css';
const params = new URLSearchParams(location.search);
if (params.get('embed') === 'shell') document.body.dataset.embed = 'shell';
const demo = params.get('mode') === 'demo' || (document.querySelector<HTMLMetaElement>('meta[name="saturn-shell-mode"]')?.content !== 'ide'
  && params.get('mode') !== 'ide' && !params.has('project')
  && !['#workspace', '#studio'].includes(location.hash) && !location.hash.startsWith('#code=')
  && !matchMedia('(display-mode: standalone)').matches);
document.getElementById('studio-shell')?.setAttribute('data-demo', String(demo));
const shortcut = document.querySelector('#command-launcher kbd');
if (shortcut) shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
async function mountWorkspace() {
  if (demo) {
    const { mountLandingDemo } = await import('./landing-demo');
    const result = mountLandingDemo();
    import('./landing-live').then(({ mountLandingLive }) => mountLandingLive()).catch(console.error);
    return result;
  }
  // Runtime HTML keeps a strict CSP. A workspace host exposes a separate,
  // authenticated document for trusted TypeScript authoring, never for operators.
  if (document.querySelector<HTMLMetaElement>('meta[name="saturn-authoring-entry"]')?.content === '/plant/ide/') {
    try {
      const response = await fetch('/plant/api/session', { signal: AbortSignal.timeout(5000) });
      const session: unknown = response.ok ? await response.json() : null;
      if (session && typeof session === 'object' && 'actor' in session
        && session.actor && typeof session.actor === 'object' && 'role' in session.actor
        && session.actor.role === 'engineer') {
        location.replace('/plant/ide/?project=server#workspace');
        return;
      }
    } catch { /* Offline and unauthenticated entry keeps the local workspace. */ }
  }
  const [{ mountStudio }, { mountProjectPicker }, { mountCommands }] = await Promise.all([
    import('./studio'), import('./project-picker'), import('./commands'),
  ]);
  mountProjectPicker(); mountCommands();
  return mountStudio();
}
mountWorkspace().catch(error => {
  const status = document.getElementById('studio-diagnostics');
  if (status) { status.dataset.error = 'true'; status.textContent = 'Не удалось открыть среду. Обновите страницу.'; }
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
