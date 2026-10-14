import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createApiHandler, sendJson } from './api.mjs';
import { projectRoot } from './config.mjs';

const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 5173);
const api = createApiHandler();
const vite = production ? null : await (await import('vite')).createServer({
  root: projectRoot,
  server: { middlewareMode: true },
});
const dist = resolve(projectRoot, 'dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = createServer(async (request, response) => {
  try {
    if (await api(request, response)) return;
    if (vite) { vite.middlewares(request, response); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { sendJson(response, 405, { error: 'Method not allowed' }); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { sendJson(response, 400, { error: 'Invalid path' }); return; }
    const file = resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${dist}${sep}`)) { sendJson(response, 404, { error: 'Not found' }); return; }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    if (!response.headersSent) sendJson(response, 404, { error: 'Page not found. Please run npm run build first.' });
    else response.end();
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请设置 PORT 后重试。` : `服务器启动失败：${error.code || error.name}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`棉棉聊天：http://127.0.0.1:${port}`));

async function shutdown() {
  await vite?.close();
  server.close();
  server.closeAllConnections();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
