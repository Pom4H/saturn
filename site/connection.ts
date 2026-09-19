/** Keep the launcher a navigation boundary: no credentials or cross-origin API proxy. */
export function serverAppUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Введите полный адрес, например https://saturn.company.ru'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Используйте HTTP(S)-адрес без пароля, параметров и фрагмента.');
  let path = url.pathname.replace(/\/(app\/?|login)$/, '/');
  if (path === '/') path = '/plant/';
  if (!path.endsWith('/')) path += '/';
  url.pathname = path + 'app/'; return url.href;
}
