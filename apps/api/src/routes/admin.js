import { now, tx } from '../db.js';
import { HttpError, V, hashPassword, slugify } from '../security.js';
import { intervaloDia } from '../services/orders.js';

export function registerAdmin(r, { db, config, audit }) {
  const A = { auth: 'admin' };

  r.get('/admin/resumo', A, (ctx) => {
    const { inicio, fim } = intervaloDia(config);
    const n = (sql, ...a) => db.prepare(sql).get(...a);
    return {
      estabelecimentos: n('SELECT COUNT(*) n, SUM(ativo) ativos FROM estabelecimentos'),
      clientes: n("SELECT COUNT(*) n FROM usuarios WHERE tipo = 'cliente'").n,
      vendedores: n("SELECT COUNT(*) n FROM usuarios WHERE tipo = 'vendedor'").n,
      pedidos_hoje: n('SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM pedidos WHERE publicado_em IS NOT NULL AND criado_em >= ? AND criado_em < ?', inicio, fim),
    };
  });

  r.get('/admin/estabelecimentos', A, () => ({
    estabelecimentos: db.prepare(
      `SELECT e.id, e.slug, e.nome, e.categoria, e.ativo, e.aberto_manual, e.criado_em,
              (SELECT COUNT(*) FROM usuarios u WHERE u.estabelecimento_id = e.id) vendedores,
              (SELECT COUNT(*) FROM pedidos p WHERE p.estabelecimento_id = e.id AND p.publicado_em IS NOT NULL) pedidos
         FROM estabelecimentos e ORDER BY e.id DESC`
    ).all(),
  }));

  // Cria o estabelecimento e o primeiro usuário vendedor dele, de forma atômica.
  r.post('/admin/estabelecimentos', A, async (ctx) => {
    const b = ctx.body;
    const nome = V.str(b.nome, 'Nome', { min: 2, max: 80 });
    const slug = slugify(b.slug || nome);
    if (!slug) throw new HttpError(422, 'Identificador (slug) inválido');
    if (db.prepare('SELECT 1 FROM estabelecimentos WHERE slug = ?').get(slug)) throw new HttpError(409, 'Já existe um estabelecimento com este identificador');
    const vend = b.vendedor || {};
    const vNome = V.str(vend.nome, 'Nome do vendedor', { min: 2, max: 100 });
    const vEmail = V.email(vend.email);
    const vSenha = V.password(vend.senha);
    if (db.prepare("SELECT 1 FROM usuarios WHERE email = ? AND tipo = 'vendedor'").get(vEmail)) throw new HttpError(409, 'Já existe um vendedor com este e-mail');
    const hash = await hashPassword(vSenha);
    const categoria = V.str(b.categoria ?? 'Outros', 'Categoria', { max: 40 });
    const out = tx(db, () => {
      const eid = db.prepare('INSERT INTO estabelecimentos (slug, nome, categoria, descricao, endereco, criado_em) VALUES (?,?,?,?,?,?)')
        .run(slug, nome, categoria, V.str(b.descricao, 'Descrição', { max: 300, optional: true }) ?? '', V.str(b.endereco, 'Endereço', { max: 200, optional: true }) ?? '', now()).lastInsertRowid;
      const uid = db.prepare("INSERT INTO usuarios (tipo, nome, email, senha_hash, estabelecimento_id, criado_em) VALUES ('vendedor',?,?,?,?,?)").run(vNome, vEmail, hash, eid, now()).lastInsertRowid;
      return { estabelecimento_id: eid, vendedor_id: uid, slug };
    });
    audit(ctx, 'admin.estabelecimento.criar', slug);
    ctx.status = 201;
    return out;
  });

  r.patch('/admin/estabelecimentos/:id', A, (ctx) => {
    const id = V.id(ctx.params.id);
    if (!db.prepare('SELECT 1 FROM estabelecimentos WHERE id = ?').get(id)) throw new HttpError(404, 'Estabelecimento não encontrado');
    const ativo = V.bool(ctx.body.ativo, 'Ativo');
    db.prepare('UPDATE estabelecimentos SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
    if (!ativo) db.prepare("DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE estabelecimento_id = ?)").run(id); // derruba sessões dos vendedores
    audit(ctx, ativo ? 'admin.estabelecimento.ativar' : 'admin.estabelecimento.suspender', String(id));
    return { ok: true };
  });

  r.get('/admin/vendedores', A, (ctx) => ({
    vendedores: db.prepare(
      `SELECT u.id, u.nome, u.email, u.ativo, u.estabelecimento_id, e.nome estabelecimento FROM usuarios u JOIN estabelecimentos e ON e.id = u.estabelecimento_id
        WHERE u.tipo = 'vendedor' ORDER BY u.id DESC`
    ).all(),
  }));

  r.post('/admin/vendedores', A, async (ctx) => {
    const eid = V.id(ctx.body.estabelecimento_id, 'Estabelecimento');
    if (!db.prepare('SELECT 1 FROM estabelecimentos WHERE id = ?').get(eid)) throw new HttpError(404, 'Estabelecimento não encontrado');
    const email = V.email(ctx.body.email);
    if (db.prepare("SELECT 1 FROM usuarios WHERE email = ? AND tipo = 'vendedor'").get(email)) throw new HttpError(409, 'Já existe um vendedor com este e-mail');
    const id = db.prepare("INSERT INTO usuarios (tipo, nome, email, senha_hash, estabelecimento_id, criado_em) VALUES ('vendedor',?,?,?,?,?)")
      .run(V.str(ctx.body.nome, 'Nome', { min: 2, max: 100 }), email, await hashPassword(V.password(ctx.body.senha)), eid, now()).lastInsertRowid;
    audit(ctx, 'admin.vendedor.criar', `${id} loja ${eid}`);
    ctx.status = 201;
    return { id };
  });

  r.patch('/admin/vendedores/:id', A, async (ctx) => {
    const id = V.id(ctx.params.id);
    if (!db.prepare("SELECT 1 FROM usuarios WHERE id = ? AND tipo = 'vendedor'").get(id)) throw new HttpError(404, 'Vendedor não encontrado');
    if (ctx.body.ativo !== undefined) {
      const ativo = V.bool(ctx.body.ativo, 'Ativo');
      db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
      if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    }
    if (ctx.body.senha) {
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(await hashPassword(V.password(ctx.body.senha)), id);
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    }
    audit(ctx, 'admin.vendedor.editar', String(id));
    return { ok: true };
  });

  r.get('/admin/pedidos', A, () => ({
    pedidos: db.prepare(
      `SELECT p.id, p.codigo, p.status, p.total, p.forma_pagamento, p.pagamento_status, p.criado_em, e.nome estabelecimento
         FROM pedidos p JOIN estabelecimentos e ON e.id = p.estabelecimento_id WHERE p.publicado_em IS NOT NULL ORDER BY p.id DESC LIMIT 100`
    ).all(),
  }));

  r.get('/admin/auditoria', A, () => ({
    registros: db.prepare('SELECT id, usuario_id, tipo, estabelecimento_id, acao, detalhe, ip, criado_em FROM auditoria ORDER BY id DESC LIMIT 200').all(),
  }));
}
