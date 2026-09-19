import type { Scene } from '../src/core';
export function downloadFile(name: string, data: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportHTML(source: string, scene: Scene) {
  const response = await fetch('/site/assets/standalone.js');
  if (!response.ok) throw new Error('Не удалось загрузить модуль автономной схемы');
  const runtime = (await response.text()).replace(/<\/script/gi, '<\\/script');
  const safe = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saturn SCADA — схема</title><style>html,body{height:100%;margin:0;background:#0c0c0f;color:#d7c9e4;font-family:system-ui}body{display:flex;flex-direction:column}header{padding:16px 24px;border-bottom:1px solid #322939;display:flex;align-items:center;justify-content:space-between}button{background:#2a2036;border:1px solid #66517c;border-radius:6px;color:#ddd0f0;padding:8px 15px;cursor:pointer}svg{flex:1;min-height:0;width:100%}.ports,.selection,.node-hit{display:none}.edge-hit{pointer-events:none}.object-label text{fill:#c4b5d4}footer{padding:15px 24px;color:#897598;font-size:11px}</style></head><body><header><b>Saturn SCADA</b><button id="pause">Пауза</button></header><svg id="scene" xmlns="http://www.w3.org/2000/svg"></svg><footer>Учебная схема · исходник встроен в этот файл</footer><script id="source" type="application/json">${safe(source)}</script><script id="model" type="application/json">${safe(scene)}</script><script>${runtime}</script></body></html>`;
  downloadFile('saturn-scene.html', html, 'text/html;charset=utf-8');
}
export function shareURL(source: string) {
  let binary = ''; new TextEncoder().encode(source).forEach(byte => binary += String.fromCharCode(byte));
  const url = new URL(location.href); url.search = ''; url.hash = 'code=' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
  if (url.href.length > 80000) throw new Error('Проект слишком большой для ссылки. Скачайте .ts.');
  return url.href;
}
export function readSharedSource(hash: string) {
  if (!hash.startsWith('#code=')) return null;
  if (hash.length > 80000) throw new Error('Слишком длинная ссылка');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(hash.slice(6).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
}
