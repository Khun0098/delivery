import { HttpError } from '../security.js';
import { getHorarios, statusFuncionamento } from '../services/funcionamento.js';
import { FORMAS_PAGAMENTO } from '../services/payments.js';

const CAMPOS_PUBLICOS = (e, status) => ({
  id: e.id, slug: e.slug, nome: e.nome, descricao: e.descricao, categoria: e.categoria,
  logo_url: e.logo_url, banner_url: e.banner_url, endereco: e.endereco,
  pedido_minimo: e.pedido_minimo, taxa_entrega: e.taxa_entrega, tempo_min: e.tempo_min, tempo_max: e.tempo_max,
  aceita_retirada: !!e.aceita_retirada, status,
});

export function registerPublic(r, { db, config }) {
  r.get('/public/estabelecimentos', (ctx) => {
    const q = String(ctx.query.q || '').trim().toLowerCase().slice(0, 60);
    const categoria = String(ctx.query.categoria || '').trim().slice(0, 40);
    const lista = db.prepare('SELECT * FROM estabelecimentos WHERE ativo = 1 ORDER BY nome').all();
    const horarios = db.prepare('SELECT * FROM horarios').all();
    const porEst = new Map();
    for (const h of horarios) (porEst.get(h.estabelecimento_id) || porEst.set(h.estabelecimento_id, []).get(h.estabelecimento_id)).push(h);
    // Também procura nos nomes de produtos ativos, para a busca achar "açaí", "pizza" etc.
    const prods = q ? db.prepare('SELECT DISTINCT estabelecimento_id FROM produtos WHERE ativo = 1 AND lower(nome) LIKE ?').all(`%${q}%`) : [];
    const comProduto = new Set(prods.map((p) => p.estabelecimento_id));
    const out = lista
      .filter((e) => !categoria || e.categoria === categoria)
      .filter((e) => !q || e.nome.toLowerCase().includes(q) || e.categoria.toLowerCase().includes(q) || e.descricao.toLowerCase().includes(q) || comProduto.has(e.id))
      .map((e) => CAMPOS_PUBLICOS(e, statusFuncionamento(e, porEst.get(e.id) || [], config.tzOffsetHours)))
      .sort((a, b) => Number(b.status.aberto) - Number(a.status.aberto));
    const categorias = [...new Set(lista.map((e) => e.categoria))].sort();
    return { estabelecimentos: out, categorias };
  });

  r.get('/public/estabelecimentos/:slug', (ctx) => {
    const e = db.prepare('SELECT * FROM estabelecimentos WHERE slug = ? AND ativo = 1').get(ctx.params.slug);
    if (!e) throw new HttpError(404, 'Estabelecimento não encontrado');
    const horarios = getHorarios(db, e.id);
    const cats = db.prepare('SELECT id, nome FROM categorias WHERE estabelecimento_id = ? AND ativa = 1 ORDER BY ordem, id').all(e.id);
    const prods = db.prepare('SELECT id, categoria_id, nome, descricao, preco, preco_original, imagem_url, restrito_18 FROM produtos WHERE estabelecimento_id = ? AND ativo = 1 ORDER BY ordem, id').all(e.id);
    const grupos = db.prepare(
      `SELECT g.* FROM grupos_opcoes g JOIN produtos p ON p.id = g.produto_id WHERE p.estabelecimento_id = ? AND p.ativo = 1 ORDER BY g.ordem, g.id`
    ).all(e.id);
    const opcoes = db.prepare(
      `SELECT o.* FROM opcoes o JOIN grupos_opcoes g ON g.id = o.grupo_id JOIN produtos p ON p.id = g.produto_id
        WHERE p.estabelecimento_id = ? AND p.ativo = 1 AND o.ativo = 1 ORDER BY o.ordem, o.id`
    ).all(e.id);

    const opsPorGrupo = new Map();
    for (const o of opcoes) (opsPorGrupo.get(o.grupo_id) || opsPorGrupo.set(o.grupo_id, []).get(o.grupo_id))
      .push({ id: o.id, nome: o.nome, preco_adicional: o.preco_adicional, imagem_url: o.imagem_url });
    const grpPorProd = new Map();
    for (const g of grupos) (grpPorProd.get(g.produto_id) || grpPorProd.set(g.produto_id, []).get(g.produto_id))
      .push({ id: g.id, titulo: g.titulo, descricao: g.descricao, minimo: g.minimo, maximo: g.maximo, opcoes: opsPorGrupo.get(g.id) || [] });

    const categorias = cats
      .map((c) => ({
        id: c.id, nome: c.nome,
        produtos: prods.filter((p) => p.categoria_id === c.id).map((p) => ({
          id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, preco_original: p.preco_original,
          imagem_url: p.imagem_url, restrito_18: !!p.restrito_18, grupos: grpPorProd.get(p.id) || [],
        })),
      }))
      .filter((c) => c.produtos.length);

    return {
      estabelecimento: { ...CAMPOS_PUBLICOS(e, statusFuncionamento(e, horarios, config.tzOffsetHours)), horarios, telefone: e.telefone },
      categorias,
      formas_pagamento: Object.entries(FORMAS_PAGAMENTO).map(([id, f]) => ({ id, label: f.label, online: f.online })),
    };
  });
}
