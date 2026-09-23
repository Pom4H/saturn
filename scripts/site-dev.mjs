import { createServer, request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { buildSite } from './site-build.mjs';
// Release checks serve the already-built deployable app, never rebuild it.
if (!process.env.SATURN_SITE_DIR) await buildSite();
const root = resolve(process.env.SATURN_SITE_DIR ?? 'dist/site'), port = Number(process.env.PORT ?? 4190);
const target = new URL(process.env.SATURN_PREVIEW_TARGET ?? 'http://127.0.0.1:4177');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/plant/')) {
    const headers = { ...req.headers, host: target.host };
    // The local preview and its runtime form one origin; never used in production.
    if (headers.origin === `http://127.0.0.1:${port}` || headers.origin === `http://localhost:${port}`) headers.origin = target.origin;
    const upstream = (target.protocol === 'https:' ? httpsRequest : request)(new URL(req.url, target), { method: req.method, headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Локальный runtime не запущен. Запустите npm run plant или задайте SATURN_PREVIEW_TARGET.'); });
    req.pipe(upstream); return;
  }
  try {
    const pathname = decodeURIComponent(url.pathname).replace(/^\/site\//, '/');
    const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Saturn: http://127.0.0.1:${port}/ (runtime ${target.origin})`));
