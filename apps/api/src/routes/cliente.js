import { HttpError, V, hashPassword, verifyPassword } from '../security.js';
import { subscribe } from '../realtime.js';
import { cancelarPeloCliente, carregarPedido, confirmarPagamento, criarPedido } from '../services/orders.js';
import { getProvider } from '../services/payments.js';

export function registerCliente(r, { db, config, limiter, RAW }) {
  const A = { auth: 'cliente' };

  r.get('/cliente/perfil', A, (ctx) => ({ usuario: { id: ctx.user.id, nome: ctx.user.nome, email: ctx.user.email, telefone: ctx.user.telefone } }));

  r.patch('/cliente/perfil', A, async (ctx) => {
    const nome = V.str(ctx.body.nome, 'Nome', { min: 2, max: 100 });
    const telefone = V.phone(ctx.body.telefone, { optional: true });
    db.prepare('UPDATE usuarios SET nome = ?, telefone = ? WHERE id = ?').run(nome, telefone, ctx.user.id);
    if (ctx.body.senha_nova) {
      const atual = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(ctx.user.id);
      if (!(await verifyPassword(String(ctx.body.senha_atual || ''), atual.senha_hash))) throw new HttpError(403, 'Senha atual incorreta');
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(await hashPassword(V.password(ctx.body.senha_nova)), ctx.user.id);
    }
    return { ok: true };
  });

  // ---- Endereços ----
  r.get('/cliente/enderecos', A, (ctx) => ({ enderecos: db.prepare('SELECT * FROM enderecos WHERE cliente_id = ? ORDER BY id').all(ctx.user.id) }));
  r.post('/cliente/enderecos', A, (ctx) => {
    const b = ctx.body;
    if (db.prepare('SELECT COUNT(*) n FROM enderecos WHERE cliente_id = ?').get(ctx.user.id).n >= 10) throw new HttpError(422, 'Limite de 10 endereços');
    const id = db.prepare('INSERT INTO enderecos (cliente_id, apelido, cep, rua, numero, complemento, bairro, cidade, uf, referencia) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      ctx.user.id, V.str(b.apelido ?? 'Casa', 'Apelido', { max: 30 }), V.str(b.cep, 'CEP', { max: 9, optional: true }),
      V.str(b.rua, 'Rua', { max: 120 }), V.str(b.numero, 'Número', { max: 12 }), V.str(b.complemento, 'Complemento', { max: 60, optional: true }),
      V.str(b.bairro, 'Bairro', { max: 80 }), V.str(b.cidade, 'Cidade', { max: 80 }), V.str(b.uf, 'UF', { max: 2, optional: true }),
      V.str(b.referencia, 'Referência', { max: 120, optional: true })
    ).lastInsertRowid;
    ctx.status = 201;
    return { endereco: db.prepare('SELECT * FROM enderecos WHERE id = ?').get(id) };
  });
  r.del('/cliente/enderecos/:id', A, (ctx) => {
    const res = db.prepare('DELETE FROM enderecos WHERE id = ? AND cliente_id = ?').run(V.id(ctx.params.id), ctx.user.id);
    if (!res.changes) throw new HttpError(404, 'Endereço não encontrado');
    return { ok: true };
  });

  // ---- Pedidos ----
  r.post('/cliente/pedidos', { ...A, maxBody: 200_000 }, (ctx) => {
    if (!limiter.take(`pedido:${ctx.user.id}`, config.limits.pedidosPor10Min, 10 * 60_000)) throw new HttpError(429, 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
    ctx.status = 201;
    return { pedido: criarPedido(db, config, ctx.user, ctx.body) };
  });

  r.get('/cliente/pedidos', A, (ctx) => {
    const ids = db.prepare('SELECT id FROM pedidos WHERE cliente_id = ? ORDER BY id DESC LIMIT 100').all(ctx.user.id);
    return { pedidos: ids.map(({ id }) => carregarPedido(db, id)) };
  });

  r.get('/cliente/pedidos/:id', A, (ctx) => {
    const row = db.prepare('SELECT id FROM pedidos WHERE id = ? AND cliente_id = ?').get(V.id(ctx.params.id), ctx.user.id);
    if (!row) throw new HttpError(404, 'Pedido não encontrado'); // pedido de outro cliente é tratado como inexistente
    return { pedido: carregarPedido(db, row.id) };
  });

  r.post('/cliente/pedidos/:id/cancelar', A, (ctx) => ({ pedido: cancelarPeloCliente(db, ctx.user.id, V.id(ctx.params.id)) }));

  // Simulação de pagamento Pix: existe SOMENTE com o provedor de teste e fora de produção.
  r.post('/cliente/pedidos/:id/pagamento/simular', A, (ctx) => {
    if (config.isProd || !getProvider(config).modoTeste) throw new HttpError(404, 'Rota não encontrada');
    const row = db.prepare('SELECT id FROM pedidos WHERE id = ? AND cliente_id = ?').get(V.id(ctx.params.id), ctx.user.id);
    if (!row) throw new HttpError(404, 'Pedido não encontrado');
    return { pedido: confirmarPagamento(db, row.id) };
  });

  // ---- Tempo real: somente os pedidos DESTE cliente ----
  r.get('/cliente/eventos', A, (ctx) => {
    subscribe(`cliente:${ctx.user.id}`, ctx.req, ctx.res);
    return RAW;
  });
}
