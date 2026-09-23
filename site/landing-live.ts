/** Mount the real Saturn product surfaces only on the top-level landing.
 * The IDE frame points back to this page in embed mode, so it must never mount
 * another copy of the landing inside itself. */
export function mountLandingLive(): void {
  if (new URLSearchParams(location.search).has('embed')) return;
  const section = document.getElementById('workflow');
  if (!section) return;

  const frames = {
    engineer: section.querySelector<HTMLIFrameElement>('.engineer-proof .live-product-frame'),
    operator: section.querySelector<HTMLIFrameElement>('.operator-proof .live-product-frame'),
  };

  function load(role: keyof typeof frames): void {
    const frame = frames[role];
    if (!frame || frame.src) return;
    const source = frame.dataset.liveSrc;
    if (!source) return;
    frame.src = source;
  }

  const selectedRole = (): keyof typeof frames =>
    (section.querySelector<HTMLInputElement>('input[name="landing-role"]:checked')?.value === 'operator' ? 'operator' : 'engineer');

  section.querySelectorAll<HTMLInputElement>('input[name="landing-role"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) load(input.value === 'operator' ? 'operator' : 'engineer');
    });
  });

  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    load(selectedRole());
  }, { rootMargin: '500px' });
  observer.observe(section);
}
