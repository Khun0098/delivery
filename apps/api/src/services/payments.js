import crypto from 'node:crypto';

export const FORMAS_PAGAMENTO = {
  pix: { label: 'Pix', online: true },
  cartao_credito: { label: 'Cartão de crédito na entrega', online: false },
  cartao_debito: { label: 'Cartão de débito na entrega', online: false },
  dinheiro: { label: 'Dinheiro', online: false },
};

/**
 * Provedores de pagamento online (Pix).
 * "mock" gera um código de teste e permite simular o pagamento (apenas fora de produção).
 * Para um gateway real (Mercado Pago, Asaas, Pagar.me, Stripe...), registre um provedor aqui
 * com createCharge(pedido) e aponte o webhook do gateway para POST /webhooks/pagamentos.
 */
const providers = {
  mock: {
    nome: 'mock',
    modoTeste: true,
    createCharge(pedido) {
      const valor = (pedido.total / 100).toFixed(2);
      return { pix_payload: `TESTE-PIX|pedido=${pedido.codigo}|valor=${valor}|ref=${crypto.randomBytes(6).toString('hex')}` };
    },
  },
};

export function getProvider(config) {
  const p = providers[config.payments.provider];
  if (!p) throw new Error(`Provedor de pagamento "${config.payments.provider}" não implementado em services/payments.js`);
  return p;
}

export function assinaturaWebhook(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verificarAssinatura(secret, rawBody, recebida) {
  if (!secret || !recebida) return false;
  const esperada = Buffer.from(assinaturaWebhook(secret, rawBody));
  const recebidaBuf = Buffer.from(String(recebida));
  return esperada.length === recebidaBuf.length && crypto.timingSafeEqual(esperada, recebidaBuf);
}
