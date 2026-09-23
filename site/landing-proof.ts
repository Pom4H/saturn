/** Only CI-captured Saturn screens are shown. Local builds keep a useful text fallback. */
export function mountLandingProof(): void {
  const section = document.getElementById('workflow');
  if (!section) return;
  async function load(): Promise<void> {
    try {
      const response = await fetch(new URL('./site/assets/landing-proof.json', document.baseURI));
      if (!response.ok) return;
      const proof: unknown = await response.json();
      if (!proof || typeof proof !== 'object' || !('available' in proof) || proof.available !== true
        || !('revision' in proof) || typeof proof.revision !== 'string'
        || !/^(?:[a-f0-9]{40}|local-\d+)$/.test(proof.revision)) return;
      const revision = document.querySelector<HTMLMetaElement>('meta[name="saturn-revision"]')?.content;
      if (revision !== proof.revision) return; // Never present screenshots from a different build as current evidence.
      for (const role of ['engineer', 'operator']) {
        const figure = section!.querySelector<HTMLElement>(`[data-proof="${role}"]`);
        const link = figure?.querySelector<HTMLAnchorElement>('.proof-image');
        const image = figure?.querySelector<HTMLImageElement>('img');
        const dark = figure?.querySelector<HTMLSourceElement>('source');
        if (!figure || !link || !image || !dark) continue;
        const asset = (theme: string) => new URL(`./site/assets/proof-${role}-${theme}.png`, document.baseURI).href;
        dark.srcset = asset('dark');
        image.src = asset('light');
        link.href = asset(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        link.addEventListener('click', () => { link.href = image.currentSrc || image.src; });
        link.hidden = false;
        image.addEventListener('error', () => { link.hidden = true; }, { once: true });
        const status = figure.querySelector('.proof-status');
        if (status) status.textContent = 'Снимок из работающего Saturn. Расчётные данные.';
      }
      const origin = document.getElementById('proof-origin');
      if (origin) origin.textContent = `Насосный стенд на одном сервере Saturn. Проверен путь от публикации до команды оператора, изменения расхода и подтверждения предупреждения. Сборка ${proof.revision.slice(0, 8)}. Это симуляция, не подключение к оборудованию.`;
      section!.dataset.proof = 'ready';
    } catch {
      // Offline / unavailable evidence does not block the editor or invent a replacement screenshot.
    }
  }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    void load();
  }, { rootMargin: '400px' });
  observer.observe(section);
}
