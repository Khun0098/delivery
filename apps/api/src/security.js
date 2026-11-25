import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { now } from './db.js';

const scrypt = promisify(crypto.scrypt);

// ---------- Senhas ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

const DUMMY_HASH = 'scrypt$' + Buffer.alloc(16).toString('base64') + '$' + Buffer.alloc(64).toString('base64');

export async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored || DUMMY_HASH).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected) && stored !== DUMMY_HASH;
}

// ---------- Sessões ----------
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db, config, user, req, ip) {
  const token = newToken();
  const ttl = config.sessionTtlMs[user.tipo];
  db.prepare(
    'INSERT INTO sessoes (token_hash, usuario_id, tipo, expira_em, criado_em, ip, user_agent) VALUES (?,?,?,?,?,?,?)'
  ).run(hashToken(token), user.id, user.tipo, Date.now() + ttl, now(), ip, String(req.headers['user-agent'] || '').slice(0, 200));
  return { token, maxAgeSec: Math.floor(ttl / 1000) };
}

export function findSession(db, token, area) {
  if (!token || token.length < 20) return null;
  const row = db.prepare(
    `SELECT u.id, u.tipo, u.nome, u.email, u.telefone, u.estabelecimento_id, u.ativo, s.expira_em, s.token_hash, s.tipo AS sessao_tipo
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`
  ).get(hashToken(token));
  if (!row) return null;
  if (row.expira_em < Date.now()) {
    db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  // A sessão só vale na área para a qual foi emitida, e o usuário precisa ser do mesmo tipo.
  if (row.sessao_tipo !== area || row.tipo !== area || !row.ativo) return null;
  return row;
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
}

// ---------- Cookies ----------
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, { maxAgeSec, config }) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${config.cookieSameSite}; Max-Age=${maxAgeSec}`;
  if (config.cookieSecure || config.cookieSameSite === 'None') c += '; Secure';
  return c;
}

// ---------- Limite de requisições ----------
export class RateLimiter {
  constructor() { this.hits = new Map(); }
  /** Retorna true se ainda dentro do limite. */
  take(key, limit, windowMs) {
    const t = Date.now();
    let e = this.hits.get(key);
    if (!e || e.reset < t) { e = { n: 0, reset: t + windowMs }; this.hits.set(key, e); }
    e.n++;
    return e.n <= limit;
  }
  reset(key) { this.hits.delete(key); }
  sweep() { const t = Date.now(); for (const [k, e] of this.hits) if (e.reset < t) this.hits.delete(k); }
}

// ---------- Validação ----------
export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const invalid = (msg) => new HttpError(422, msg, 'VALIDACAO');

export const V = {
  str(x, label, { min = 1, max = 255, optional = false } = {}) {
    if (x === undefined || x === null || x === '') {
      if (optional) return null;
      throw invalid(`${label} é obrigatório`);
    }
    if (typeof x !== 'string') throw invalid(`${label} inválido`);
    const s = x.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (s.length < min) throw invalid(`${label} deve ter ao menos ${min} caractere(s)`);
    if (s.length > max) throw invalid(`${label} deve ter no máximo ${max} caracteres`);
    return s;
  },
  int(x, label, { min = 0, max = 1e9, optional = false } = {}) {
    if (x === undefined || x === null || x === '') {
      if (optional) return null;
      throw invalid(`${label} é obrigatório`);
    }
    const n = typeof x === 'string' && /^-?\d+$/.test(x) ? Number(x) : x;
    if (!Number.isInteger(n) || n < min || n > max) throw invalid(`${label} inválido`);
    return n;
  },
  bool(x, label, { optional = false } = {}) {
    if (x === undefined || x === null) {
      if (optional) return null;
      throw invalid(`${label} é obrigatório`);
    }
    if (typeof x !== 'boolean') throw invalid(`${label} inválido`);
    return x;
  },
  email(x) {
    const s = V.str(x, 'E-mail', { max: 160 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw invalid('E-mail inválido');
    return s;
  },
  password(x) {
    if (typeof x !== 'string' || x.length < 8) throw invalid('A senha deve ter ao menos 8 caracteres');
    if (x.length > 128) throw invalid('Senha muito longa');
    return x;
  },
  phone(x, { optional = false } = {}) {
    if ((x === undefined || x === null || x === '') && optional) return null;
    const d = String(x ?? '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) throw invalid('Telefone inválido (use DDD + número)');
    return d;
  },
  url(x, label, { optional = true } = {}) {
    if (x === undefined || x === null || x === '') {
      if (optional) return null;
      throw invalid(`${label} é obrigatório`);
    }
    if (typeof x !== 'string' || x.length > 500 || !/^https?:\/\/[^\s]+$/i.test(x)) throw invalid(`${label} inválida`);
    return x;
  },
  enum(x, label, values) {
    if (!values.includes(x)) throw invalid(`${label} inválido`);
    return x;
  },
  time(x, label) {
    if (typeof x !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) throw invalid(`${label} deve estar no formato HH:MM`);
    return x;
  },
  id(x, label = 'ID') { return V.int(x, label, { min: 1 }); },
};

export const slugify = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
