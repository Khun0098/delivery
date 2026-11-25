// Serve cada site em SUA PRÓPRIA origem/porta. Em produção, use nginx/CDN (veja deploy/nginx.conf).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../apps/api/src/config.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const apiUrl = config.publicApiUrl;

function serve(area, dir) {
  const origin = new URL(config.origins[area]);
  const port = Number(origin.port || 80);
  const csp = [
    "default-src 'self'", `connect-src 'self' ${apiUrl}`, "img-src 'self' data: https: http:", "style-src 'self' 'unsafe-inline'",
    "script-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = {
      'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-cache',
    };
    // O endereço da API vem do ambiente, sem precisar editar o arquivo.
    if (url.pathname === '/config.js') {
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.js'] });
      return res.end(`window.APP_CONFIG = ${JSON.stringify({ API_URL: apiUrl })};`);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, '0.0.0.0', () => console.log(`Site ${area.padEnd(8)} → ${config.origins[area]}`));
  return server;
}

const root = config.root;
const only = process.argv[2]; // opcional: cliente | vendedor | admin
for (const area of ['cliente', 'vendedor', 'admin']) {
  if (only && only !== area) continue;
  serve(area, path.join(root, 'apps', area));
}
