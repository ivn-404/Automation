/**
 * Static file server for allure-history/ so every saved run is browsable
 * from one index page (Allure SPAs need http://, not file://).
 *
 * Usage: node scripts/serve-allure-history.mjs [port]
 * Env:   SGAP_ALLURE_HISTORY_ROOT — absolute path to allure-history
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? process.env.SGAP_ALLURE_HISTORY_PORT ?? 5055);
const root = process.env.SGAP_ALLURE_HISTORY_ROOT
  ? path.resolve(process.env.SGAP_ALLURE_HISTORY_ROOT)
  : path.resolve(process.cwd(), 'allure-history');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function contentType(filePath) {
  return TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const abs = path.resolve(base, normalized);
  if (!abs.startsWith(base)) {
    return undefined;
  }
  return abs;
}

const server = createServer((req, res) => {
  const urlPath = req.url === '/' || req.url === undefined ? '/index.html' : req.url;
  const target = safeJoin(root, urlPath);
  if (target === undefined) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let filePath = target;
  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    res.writeHead(404).end('Not found');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }

  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(body);
  } catch {
    res.writeHead(500).end('Read error');
  }
});

server.listen(port, '127.0.0.1', () => {
  // Detached; keep alive until killed.
});
