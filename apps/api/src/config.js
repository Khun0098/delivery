import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const origin = (v, fallback) => (v || fallback).replace(/\/+$/, '');

export const config = {
  root,
  isProd,
  port: Number(env.API_PORT || 4000),
  host: env.API_HOST || '0.0.0.0',
  dbPath: env.DB_PATH || path.join(root, 'data', 'delivery.db'),
  uploadDir: env.UPLOAD_DIR || path.join(root, 'data', 'uploads'),
  publicApiUrl: origin(env.PUBLIC_API_URL, 'http://localhost:4000'),
  // Cada site tem a sua própria origem. A API só aceita cada área vinda da origem correta.
  origins: {
    cliente: origin(env.CLIENTE_ORIGIN, 'http://localhost:4001'),
    vendedor: origin(env.VENDEDOR_ORIGIN, 'http://localhost:4002'),
    admin: origin(env.ADMIN_ORIGIN, 'http://localhost:4003'),
  },
  cookieSameSite: env.COOKIE_SAMESITE || 'Lax', // 'None' só se os sites ficarem em domínios registráveis diferentes
  cookieSecure: isProd || env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  tzOffsetHours: Number(env.TZ_OFFSET_HOURS ?? -3), // America/Sao_Paulo
  limits: {
    pedidosPor10Min: Number(env.RATE_PEDIDOS_10MIN || 15), // por cliente; conta tentativas inválidas também
  },
  sessionTtlMs: {
    cliente: 30 * 24 * 3600e3,
    vendedor: 12 * 3600e3,
    admin: 4 * 3600e3,
  },
  payments: {
    provider: env.PAYMENTS_PROVIDER || 'mock',
    webhookSecret: env.PAYMENTS_WEBHOOK_SECRET || '',
    pixTimeoutMin: Number(env.PIX_TIMEOUT_MIN || 30),
  },
};

export const AREAS = ['cliente', 'vendedor', 'admin'];
