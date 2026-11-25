import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { now } from './db.js';
import { HttpError, RateLimiter, findSession, parseCookies, purgeExpiredSessions, serializeCookie } from './security.js';
import { expirarPixPendentes } from './services/orders.js';
import { registerAuth } from './routes/auth.js';
import { registerPublic } from './routes/public.js';
import { registerCliente } from './routes/cliente.js';
import { registerVendedor } from './routes/vendedor.js';
import { registerAdmin } from './routes/admin.js';
import { registerWebhooks } from './routes/webhooks.js';

export const RAW = Symbol('raw'); // handler já escreveu a resposta (SSE, arquivos)

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createApp({ db, config }) {
  const limiter = new RateLimiter();
  const routes = [];

  const add = (method) => (pattern, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, opts, handler });
  };
  const r = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), del: add('DELETE') };

  const audit = (ctx, acao, detalhe) => {
    db.prepare('INSERT INTO auditoria (usuario_id, tipo, estabelecimento_id, acao, detalhe, ip, criado_em) VALUES (?,?,?,?,?,?,?)')
      .run(ctx.user?.id ?? null, ctx.user?.tipo ?? ctx.area ?? null, ctx.user?.estabelecimento_id ?? null, acao,
        detalhe == null ? null : String(typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)).slice(0, 500), ctx.ip, now());
  };
  const deps = { db, config, limiter, audit, RAW };

  registerPublic(r, deps);
  registerAuth(r, deps);
  registerCliente(r, deps);
  registerVendedor(r, deps);
  registerAdmin(r, deps);
  registerWebhooks(r, deps);

  r.get('/health', (ctx) => ({ ok: true }));
  r.get('/uploads/:file', (ctx) => {
    const m = /^([a-f0-9]{32})\.(png|jpg|webp)$/.exec(ctx.params.file);
    if (!m) throw new HttpError(404, 'Arquivo não encontrado');
    const file = path.join(config.uploadDir, ctx.params.file);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Arquivo não encontrado');
    ctx.res.writeHead(200, {
      'Content-Type': MIME[m[2]],
      'Cache-Control': 'public, max-age=604800, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    fs.createReadStream(file).pipe(ctx.res);
    return RAW;
  });

  const clientIp = (req) => {
    if (config.trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'Requisição muito grande');
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  function sendJson(res, status, data, extraHeaders = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(body);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ip = clientIp(req);
    const origin = req.headers.origin;
    const allowedOrigins = Object.values(config.origins);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }

    if (!limiter.take(`ip:${ip}`, 900, 60_000)) throw new HttpError(429, 'Muitas requisições. Aguarde um instante.');

    let route, params = {};
    for (const rt of routes) {
      if (rt.method !== req.method) continue;
      const m = rt.re.exec(url.pathname);
      if (!m) continue;
      route = rt;
      rt.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      break;
    }
    if (!route) throw new HttpError(404, 'Rota não encontrada');

    const { auth, area, maxBody = 1_000_000 } = route.opts;
    const ctx = { req, res, url, params, query: Object.fromEntries(url.searchParams), ip, origin, body: {}, raw: null, user: null, est: null, area: auth || area || null, cookies: [] };

    // 1) Origem: cada área só responde ao seu próprio site.
    const areaForOrigin = auth || area;
    if (areaForOrigin) {
      const expected = config.origins[areaForOrigin];
      if (origin && origin !== expected) throw new HttpError(403, 'Origem não autorizada para esta área', 'ORIGEM');
      if (UNSAFE.has(req.method) && !origin) throw new HttpError(403, 'Origem ausente', 'ORIGEM');
    }

    // 2) Autenticação e autorização — SEMPRE no servidor.
    if (auth) {
      const token = parseCookies(req.headers.cookie)[`sid_${auth}`];
      const user = findSession(db, token, auth);
      if (!user) throw new HttpError(401, 'Sessão expirada ou inexistente. Faça login.', 'NAO_AUTENTICADO');
      ctx.user = user;
      ctx.sessionToken = token;
      if (auth === 'vendedor') {
        const est = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(user.estabelecimento_id);
        if (!est) throw new HttpError(403, 'Estabelecimento não encontrado', 'PROIBIDO');
        if (!est.ativo) throw new HttpError(403, 'Estabelecimento suspenso. Fale com o suporte.', 'SUSPENSO');
        ctx.est = est; // o escopo do vendedor vem SEMPRE da sessão, nunca do corpo ou da URL
      }
    }

    // 3) Corpo
    if (UNSAFE.has(req.method)) {
      const buf = await readBody(req, maxBody);
      ctx.raw = buf;
      if (buf.length) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Use Content-Type: application/json');
        try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
        if (ctx.body === null || typeof ctx.body !== 'object') throw new HttpError(400, 'Corpo inválido');
      }
    }

    ctx.setCookie = (name, value, maxAgeSec) => ctx.cookies.push(serializeCookie(name, value, { maxAgeSec, config }));
    ctx.clearCookie = (name) => ctx.cookies.push(serializeCookie(name, '', { maxAgeSec: 0, config }));

    const out = await route.handler(ctx);
    if (out === RAW) return;
    const headers = ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : {};
    sendJson(res, ctx.status || 200, out ?? { ok: true }, headers);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return sendJson(res, err.status, { erro: err.message, codigo: err.code || null });
      console.error('[erro]', req.method, req.url, err);
      sendJson(res, 500, { erro: 'Erro interno do servidor' });
    });
  });

  // Manutenção periódica
  const timers = [
    setInterval(() => { purgeExpiredSessions(db); limiter.sweep(); }, 10 * 60_000),
    setInterval(() => { try { expirarPixPendentes(db, config); } catch (e) { console.error('[pix-timeout]', e); } }, 60_000),
  ];
  timers.forEach((t) => t.unref());
  server.on('close', () => timers.forEach(clearInterval));
  purgeExpiredSessions(db);

  return server;
}
