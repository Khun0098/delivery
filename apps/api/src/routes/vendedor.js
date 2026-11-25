import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, V } from '../security.js';
import { subscribe } from '../realtime.js';
import { carregarPedido, intervaloDia, mudarStatusVendedor } from '../services/orders.js';
import { getHorarios, statusFuncionamento } from '../services/funcionamento.js';
import { tx } from '../db.js';

const ATIVOS = ['novo', 'preparando', 'pronto', 'em_entrega'];

function detectarImagem(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function registerVendedor(r, { db, config, audit, RAW }) {
  const A = { auth: 'vendedor' };
  // IMPORTANTE: nenhuma rota abaixo lê estabelecimento_id do corpo/URL. O escopo é sempre ctx.est.id (da sessão).
  const donoDe = (tabela, id, estId) => {
    const sqls = {
      categorias: 'SELECT id FROM categorias WHERE id = ? AND estabelecimento_id = ?',
      produtos: 'SELECT id FROM produtos WHERE id = ? AND estabelecimento_id = ?',
    };
    const row = db.prepare(sqls[tabela]).get(id, estId);
    if (!row) throw new HttpError(404, 'Registro não encontrado');
    return row;
  };

  // ---------- Pedidos / central ----------
  r.get('/vendedor/pedidos', A, (ctx) => {
    const modo = ctx.query.modo === 'historico' ? 'historico' : 'ativos';
    let ids;
    if (modo === 'ativos') {
      ids = db.prepare(`SELECT id FROM pedidos WHERE estabelecimento_id = ? AND publicado_em IS NOT NULL AND status IN (${ATIVOS.map(() => '?').join(',')}) ORDER BY id`).all(ctx.est.id, ...ATIVOS);
    } else {
      const { inicio, fim } = intervaloDia(config, ctx.query.data);
      ids = db.prepare('SELECT id FROM pedidos WHERE estabelecimento_id = ? AND publicado_em IS NOT NULL AND criado_em >= ? AND criado_em < ? ORDER BY id DESC LIMIT 500').all(ctx.est.id, inicio, fim);
    }
    return { pedidos: ids.map(({ id }) => { const { pix_payload, ...p } = carregarPedido(db, id); return p; }) };
  });

  r.get('/vendedor/pedidos/:id', A, (ctx) => {
    const row = db.prepare('SELECT id FROM pedidos WHERE id = ? AND estabelecimento_id = ? AND publicado_em IS NOT NULL').get(V.id(ctx.params.id), ctx.est.id);
    if (!row) throw new HttpError(404, 'Pedido não encontrado');
    const { pix_payload, ...p } = carregarPedido(db, row.id);
    return { pedido: p };
  });

  r.post('/vendedor/pedidos/:id/status', A, (ctx) => {
    const novo = V.enum(ctx.body.status, 'Status', ['preparando', 'pronto', 'em_entrega', 'entregue', 'recusado', 'cancelado']);
    const p = mudarStatusVendedor(db, ctx.est.id, V.id(ctx.params.id), novo, ctx.body.motivo, ctx.user);
    audit(ctx, 'pedido.status', `${p.codigo} -> ${novo}`);
    const { pix_payload, ...resto } = p;
    return { pedido: resto };
  });

  // Canal em tempo real da loja: é aqui que a campainha dispara. Nenhum outro site assina este canal.
  r.get('/vendedor/eventos', A, (ctx) => {
    subscribe(`loja:${ctx.est.id}`, ctx.req, ctx.res);
    return RAW;
  });

  // ---------- Dashboard / financeiro ----------
  r.get('/vendedor/dashboard', A, (ctx) => {
    const { inicio, fim } = intervaloDia(config);
    const q = (sql, ...a) => db.prepare(sql).get(ctx.est.id, ...a);
    const pend = q("SELECT COUNT(*) n FROM pedidos WHERE estabelecimento_id = ? AND publicado_em IS NOT NULL AND status = 'novo'").n;
    const andamento = q("SELECT COUNT(*) n FROM pedidos WHERE estabelecimento_id = ? AND status IN ('preparando','pronto','em_entrega')").n;
    const hoje = q("SELECT COUNT(*) n, COALESCE(SUM(total),0) faturamento FROM pedidos WHERE estabelecimento_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em < ?", inicio, fim);
    const recusados = q("SELECT COUNT(*) n FROM pedidos WHERE estabelecimento_id = ? AND status IN ('recusado','cancelado') AND criado_em >= ? AND criado_em < ?", inicio, fim).n;
    const recebidos = q('SELECT COUNT(*) n FROM pedidos WHERE estabelecimento_id = ? AND publicado_em IS NOT NULL AND criado_em >= ? AND criado_em < ?', inicio, fim).n;
    return {
      pendentes: pend, em_andamento: andamento, recebidos_hoje: recebidos, entregues_hoje: hoje.n,
      faturamento_hoje: hoje.faturamento, ticket_medio_hoje: hoje.n ? Math.round(hoje.faturamento / hoje.n) : 0, cancelados_hoje: recusados,
      status: statusFuncionamento(ctx.est, getHorarios(db, ctx.est.id), config.tzOffsetHours),
    };
  });

  r.get('/vendedor/financeiro', A, (ctx) => {
    const hojeStr = new Date(Date.now() + config.tzOffsetHours * 3600e3).toISOString().slice(0, 10);
    const de = ctx.query.de || hojeStr.slice(0, 8) + '01';
    const ate = ctx.query.ate || hojeStr;
    const ini = intervaloDia(config, de).inicio;
    const fim = intervaloDia(config, ate).fim;
    if (Date.parse(fim) - Date.parse(ini) > 366 * 86400e3) throw new HttpError(422, 'Período máximo de 1 ano');
    const base = "estabelecimento_id = ? AND status = 'entregue' AND criado_em >= ? AND criado_em < ?";
    const resumo = db.prepare(`SELECT COUNT(*) pedidos, COALESCE(SUM(total),0) faturamento, COALESCE(SUM(taxa_entrega),0) taxas FROM pedidos WHERE ${base}`).get(ctx.est.id, ini, fim);
    const porForma = db.prepare(`SELECT forma_pagamento, COUNT(*) pedidos, SUM(total) total FROM pedidos WHERE ${base} GROUP BY forma_pagamento ORDER BY total DESC`).all(ctx.est.id, ini, fim);
    const off = config.tzOffsetHours * 3600;
    const porDia = db.prepare(`SELECT date(strftime('%s', criado_em) + ${Math.trunc(off)}, 'unixepoch') dia, COUNT(*) pedidos, SUM(total) total FROM pedidos WHERE ${base} GROUP BY dia ORDER BY dia`).all(ctx.est.id, ini, fim);
    const topProdutos = db.prepare(
      `SELECT i.nome, SUM(i.quantidade) quantidade, SUM(i.total) total FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.estabelecimento_id = ? AND p.status = 'entregue' AND p.criado_em >= ? AND p.criado_em < ? GROUP BY i.nome ORDER BY quantidade DESC LIMIT 10`
    ).all(ctx.est.id, ini, fim);
    const cancel = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE estabelecimento_id = ? AND status IN ('recusado','cancelado') AND criado_em >= ? AND criado_em < ?").get(ctx.est.id, ini, fim).n;
    return { periodo: { de, ate }, ...resumo, ticket_medio: resumo.pedidos ? Math.round(resumo.faturamento / resumo.pedidos) : 0, cancelados: cancel, por_forma: porForma, por_dia: porDia, top_produtos: topProdutos };
  });

  // ---------- Funcionamento / dados da loja ----------
  r.get('/vendedor/loja', A, (ctx) => {
    const { id, slug, nome, descricao, categoria, logo_url, banner_url, telefone, endereco, aberto_manual, pedido_minimo, taxa_entrega, tempo_min, tempo_max, aceita_retirada } = ctx.est;
    const horarios = getHorarios(db, id);
    return {
      loja: { id, slug, nome, descricao, categoria, logo_url, banner_url, telefone, endereco, aberto_manual: !!aberto_manual, pedido_minimo, taxa_entrega, tempo_min, tempo_max, aceita_retirada: !!aceita_retirada },
      horarios, status: statusFuncionamento(ctx.est, horarios, config.tzOffsetHours),
    };
  });

  r.post('/vendedor/loja/aberto', A, (ctx) => {
    const aberto = V.bool(ctx.body.aberto, 'Aberto');
    db.prepare('UPDATE estabelecimentos SET aberto_manual = ? WHERE id = ?').run(aberto ? 1 : 0, ctx.est.id);
    audit(ctx, aberto ? 'loja.abrir' : 'loja.pausar');
    return { aberto_manual: aberto };
  });

  r.patch('/vendedor/loja', A, (ctx) => {
    const b = ctx.body;
    if (b.tempo_max != null && b.tempo_min != null && b.tempo_max < b.tempo_min) throw new HttpError(422, 'O tempo máximo deve ser maior que o mínimo');
    db.prepare(`UPDATE estabelecimentos SET nome=?, descricao=?, telefone=?, endereco=?, logo_url=?, banner_url=?, pedido_minimo=?, taxa_entrega=?, tempo_min=?, tempo_max=?, aceita_retirada=? WHERE id=?`).run(
      V.str(b.nome, 'Nome', { min: 2, max: 80 }), V.str(b.descricao, 'Descrição', { max: 300, optional: true }) ?? '', V.phone(b.telefone, { optional: true }),
      V.str(b.endereco, 'Endereço', { max: 200, optional: true }) ?? '', V.url(b.logo_url, 'Logo'), V.url(b.banner_url, 'Banner'),
      V.int(b.pedido_minimo, 'Pedido mínimo', { max: 1_000_000 }), V.int(b.taxa_entrega, 'Taxa de entrega', { max: 1_000_000 }),
      V.int(b.tempo_min, 'Tempo mínimo', { min: 1, max: 600 }), V.int(b.tempo_max, 'Tempo máximo', { min: 1, max: 600 }),
      V.bool(b.aceita_retirada, 'Retirada') ? 1 : 0, ctx.est.id
    );
    audit(ctx, 'loja.editar');
    return { ok: true };
  });

  r.put('/vendedor/horarios', A, (ctx) => {
    if (!Array.isArray(ctx.body.horarios) || ctx.body.horarios.length > 40) throw new HttpError(422, 'Horários inválidos');
    const hs = ctx.body.horarios.map((h) => ({ dia: V.int(h.dia_semana, 'Dia', { max: 6 }), abre: V.time(h.abre, 'Abertura'), fecha: V.time(h.fecha, 'Fechamento') }));
    tx(db, () => {
      db.prepare('DELETE FROM horarios WHERE estabelecimento_id = ?').run(ctx.est.id);
      const ins = db.prepare('INSERT INTO horarios (estabelecimento_id, dia_semana, abre, fecha) VALUES (?,?,?,?)');
      for (const h of hs) ins.run(ctx.est.id, h.dia, h.abre, h.fecha);
    });
    audit(ctx, 'loja.horarios');
    return { ok: true };
  });

  // ---------- Cardápio ----------
  r.get('/vendedor/cardapio', A, (ctx) => {
    const cats = db.prepare('SELECT * FROM categorias WHERE estabelecimento_id = ? ORDER BY ordem, id').all(ctx.est.id);
    const prods = db.prepare('SELECT * FROM produtos WHERE estabelecimento_id = ? ORDER BY ordem, id').all(ctx.est.id);
    const grupos = db.prepare('SELECT g.* FROM grupos_opcoes g JOIN produtos p ON p.id = g.produto_id WHERE p.estabelecimento_id = ? ORDER BY g.ordem, g.id').all(ctx.est.id);
    const opcoes = db.prepare('SELECT o.* FROM opcoes o JOIN grupos_opcoes g ON g.id = o.grupo_id JOIN produtos p ON p.id = g.produto_id WHERE p.estabelecimento_id = ? ORDER BY o.ordem, o.id').all(ctx.est.id);
    const ops = new Map(), grs = new Map();
    for (const o of opcoes) (ops.get(o.grupo_id) || ops.set(o.grupo_id, []).get(o.grupo_id)).push({ ...o, ativo: !!o.ativo });
    for (const g of grupos) (grs.get(g.produto_id) || grs.set(g.produto_id, []).get(g.produto_id)).push({ ...g, opcoes: ops.get(g.id) || [] });
    return {
      categorias: cats.map((c) => ({ ...c, ativa: !!c.ativa, produtos: prods.filter((p) => p.categoria_id === c.id).map((p) => ({ ...p, ativo: !!p.ativo, restrito_18: !!p.restrito_18, grupos: grs.get(p.id) || [] })) })),
    };
  });

  r.post('/vendedor/categorias', A, (ctx) => {
    const ordem = db.prepare('SELECT COALESCE(MAX(ordem),0)+1 n FROM categorias WHERE estabelecimento_id = ?').get(ctx.est.id).n;
    const id = db.prepare('INSERT INTO categorias (estabelecimento_id, nome, ordem) VALUES (?,?,?)').run(ctx.est.id, V.str(ctx.body.nome, 'Nome', { max: 60 }), ordem).lastInsertRowid;
    ctx.status = 201;
    return { id };
  });
  r.patch('/vendedor/categorias/:id', A, (ctx) => {
    const id = donoDe('categorias', V.id(ctx.params.id), ctx.est.id).id;
    db.prepare('UPDATE categorias SET nome = ?, ordem = ?, ativa = ? WHERE id = ?').run(V.str(ctx.body.nome, 'Nome', { max: 60 }), V.int(ctx.body.ordem ?? 0, 'Ordem', { max: 9999 }), V.bool(ctx.body.ativa ?? true, 'Ativa') ? 1 : 0, id);
    return { ok: true };
  });
  r.del('/vendedor/categorias/:id', A, (ctx) => {
    const id = donoDe('categorias', V.id(ctx.params.id), ctx.est.id).id;
    if (db.prepare('SELECT 1 FROM produtos WHERE categoria_id = ?').get(id)) throw new HttpError(409, 'Mova ou exclua os produtos desta categoria antes de removê-la');
    db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
    return { ok: true };
  });

  function lerProduto(b, estId) {
    const cat = donoDe('categorias', V.id(b.categoria_id, 'Categoria'), estId).id;
    const preco = V.int(b.preco, 'Preço', { max: 10_000_000 });
    const precoOrig = V.int(b.preco_original, 'Preço original', { max: 10_000_000, optional: true });
    if (precoOrig != null && precoOrig < preco) throw new HttpError(422, 'O preço original deve ser maior ou igual ao preço atual');
    const grupos = b.grupos === undefined ? [] : b.grupos;
    if (!Array.isArray(grupos) || grupos.length > 15) throw new HttpError(422, 'Grupos de opções inválidos');
    return {
      cat, preco, precoOrig, nome: V.str(b.nome, 'Nome', { min: 2, max: 120 }), descricao: V.str(b.descricao, 'Descrição', { max: 600, optional: true }) ?? '',
      imagem: V.url(b.imagem_url, 'Imagem'), ativo: V.bool(b.ativo ?? true, 'Ativo') ? 1 : 0, r18: V.bool(b.restrito_18 ?? false, 'Restrito') ? 1 : 0,
      grupos: grupos.map((g) => {
        const minimo = V.int(g.minimo ?? 0, 'Mínimo', { max: 50 }), maximo = V.int(g.maximo ?? 1, 'Máximo', { min: 1, max: 50 });
        if (minimo > maximo) throw new HttpError(422, `Em "${g.titulo}", o mínimo não pode ser maior que o máximo`);
        if (!Array.isArray(g.opcoes) || g.opcoes.length > 60) throw new HttpError(422, 'Opções inválidas');
        if (g.opcoes.filter((o) => o.ativo !== false).length < minimo) throw new HttpError(422, `O grupo "${g.titulo}" exige mais opções ativas do que existem`);
        return {
          titulo: V.str(g.titulo, 'Título do grupo', { max: 80 }), descricao: V.str(g.descricao, 'Descrição do grupo', { max: 120, optional: true }) ?? '', minimo, maximo,
          opcoes: g.opcoes.map((o) => ({ nome: V.str(o.nome, 'Nome da opção', { max: 80 }), preco: V.int(o.preco_adicional ?? 0, 'Preço adicional', { max: 1_000_000 }), imagem: V.url(o.imagem_url, 'Imagem da opção'), ativo: o.ativo === false ? 0 : 1 })),
        };
      }),
    };
  }

  function gravarGrupos(produtoId, grupos) {
    db.prepare('DELETE FROM grupos_opcoes WHERE produto_id = ?').run(produtoId);
    const insG = db.prepare('INSERT INTO grupos_opcoes (produto_id, titulo, descricao, minimo, maximo, ordem) VALUES (?,?,?,?,?,?)');
    const insO = db.prepare('INSERT INTO opcoes (grupo_id, nome, preco_adicional, imagem_url, ativo, ordem) VALUES (?,?,?,?,?,?)');
    grupos.forEach((g, gi) => {
      const gid = insG.run(produtoId, g.titulo, g.descricao, g.minimo, g.maximo, gi).lastInsertRowid;
      g.opcoes.forEach((o, oi) => insO.run(gid, o.nome, o.preco, o.imagem, o.ativo, oi));
    });
  }

  r.post('/vendedor/produtos', A, (ctx) => {
    const p = lerProduto(ctx.body, ctx.est.id);
    const id = tx(db, () => {
      const ordem = db.prepare('SELECT COALESCE(MAX(ordem),0)+1 n FROM produtos WHERE categoria_id = ?').get(p.cat).n;
      const pid = db.prepare('INSERT INTO produtos (estabelecimento_id, categoria_id, nome, descricao, preco, preco_original, imagem_url, ativo, restrito_18, ordem) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(ctx.est.id, p.cat, p.nome, p.descricao, p.preco, p.precoOrig, p.imagem, p.ativo, p.r18, ordem).lastInsertRowid;
      gravarGrupos(pid, p.grupos);
      return pid;
    });
    audit(ctx, 'produto.criar', `${id} ${p.nome}`);
    ctx.status = 201;
    return { id };
  });

  r.put('/vendedor/produtos/:id', A, (ctx) => {
    const id = donoDe('produtos', V.id(ctx.params.id), ctx.est.id).id;
    const p = lerProduto(ctx.body, ctx.est.id);
    tx(db, () => {
      db.prepare('UPDATE produtos SET categoria_id=?, nome=?, descricao=?, preco=?, preco_original=?, imagem_url=?, ativo=?, restrito_18=? WHERE id=? AND estabelecimento_id=?')
        .run(p.cat, p.nome, p.descricao, p.preco, p.precoOrig, p.imagem, p.ativo, p.r18, id, ctx.est.id);
      gravarGrupos(id, p.grupos);
    });
    audit(ctx, 'produto.editar', `${id} ${p.nome}`);
    return { ok: true };
  });

  // Pausar/ativar rapidamente (ex.: acabou o estoque) e ajustar preço sem reenviar o produto inteiro.
  r.patch('/vendedor/produtos/:id', A, (ctx) => {
    const id = donoDe('produtos', V.id(ctx.params.id), ctx.est.id).id;
    if (ctx.body.ativo !== undefined) db.prepare('UPDATE produtos SET ativo = ? WHERE id = ?').run(V.bool(ctx.body.ativo, 'Ativo') ? 1 : 0, id);
    if (ctx.body.preco !== undefined) db.prepare('UPDATE produtos SET preco = ? WHERE id = ?').run(V.int(ctx.body.preco, 'Preço', { max: 10_000_000 }), id);
    audit(ctx, 'produto.ajuste', `${id} ${JSON.stringify(ctx.body)}`);
    return { ok: true };
  });

  r.del('/vendedor/produtos/:id', A, (ctx) => {
    const id = donoDe('produtos', V.id(ctx.params.id), ctx.est.id).id;
    db.prepare('DELETE FROM produtos WHERE id = ?').run(id); // itens de pedidos antigos guardam nome e preço próprios
    audit(ctx, 'produto.excluir', String(id));
    return { ok: true };
  });

  // ---------- Upload de imagens (base64 em JSON; validação por assinatura do arquivo) ----------
  r.post('/vendedor/upload', { ...A, maxBody: 3_500_000 }, (ctx) => {
    const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.data || ''));
    if (!m) throw new HttpError(422, 'Imagem inválida');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 2_500_000) throw new HttpError(413, 'Imagem acima de 2,5 MB');
    const ext = detectarImagem(buf);
    if (!ext) throw new HttpError(415, 'Use PNG, JPG ou WEBP');
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, name), buf);
    ctx.status = 201;
    return { url: `${config.publicApiUrl}/uploads/${name}` };
  });
}
