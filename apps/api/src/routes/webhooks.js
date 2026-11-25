import { HttpError } from '../security.js';
import { verificarAssinatura } from '../services/payments.js';
import { confirmarPagamento } from '../services/orders.js';

export function registerWebhooks(r, { db, config }) {
  // Chamado pelo gateway de pagamento (servidor → servidor). Autenticado por assinatura HMAC, não por cookie.
  r.post('/webhooks/pagamentos', (ctx) => {
    const secret = config.payments.webhookSecret;
    if (!secret) throw new HttpError(404, 'Rota não encontrada');
    if (!verificarAssinatura(secret, ctx.raw, ctx.req.headers['x-signature'])) throw new HttpError(401, 'Assinatura inválida');
    if (ctx.body.status !== 'pago') return { ok: true, ignorado: true };
    const p = db.prepare('SELECT id FROM pedidos WHERE codigo = ?').get(String(ctx.body.pedido_codigo || ''));
    if (!p) throw new HttpError(404, 'Pedido não encontrado');
    confirmarPagamento(db, p.id);
    return { ok: true };
  });
}
