import crypto from 'node:crypto';
import { now, tx } from '../db.js';
import { HttpError, V } from '../security.js';
import { publish } from '../realtime.js';
import { getHorarios, statusFuncionamento } from './funcionamento.js';
import { FORMAS_PAGAMENTO, getProvider } from './payments.js';

export const STATUS_LABEL = {
  aguardando_pagamento: 'Aguardando pagamento',
  novo: 'Aguardando aceite',
  preparando: 'Em preparo',
  pronto: 'Pronto',
  em_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
};

const TRANSICOES_VENDEDOR = {
  novo: ['preparando', 'recusado'],
  preparando: ['pronto', 'cancelado'],
  pronto: ['em_entrega', 'entregue', 'cancelado'],
  em_entrega: ['entregue', 'cancelado'],
};
const COLUNA_TEMPO = { preparando: 'aceito_em', pronto: 'pronto_em', em_entrega: 'saiu_em', entregue: 'entregue_em', recusado: 'cancelado_em', cancelado: 'cancelado_em' };

function codigoUnico(db) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = 'PP';
    for (let i = 0; i < 6; i++) c += alfabeto[crypto.randomInt(alfabeto.length)];
    if (!db.prepare('SELECT 1 FROM pedidos WHERE codigo = ?').get(c)) return c;
  }
}

export function carregarPedido(db, id) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return null;
  const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id').all(id);
  const opcoes = db.prepare(
    `SELECT o.* FROM pedido_item_opcoes o JOIN pedido_itens i ON i.id = o.item_id WHERE i.pedido_id = ? ORDER BY o.id`
  ).all(id);
  const porItem = new Map();
  for (const o of opcoes) {
    if (!porItem.has(o.item_id)) porItem.set(o.item_id, []);
    porItem.get(o.item_id).push({ grupo: o.grupo_titulo, nome: o.nome, preco_adicional: o.preco_adicional });
  }
  const historico = db.prepare('SELECT status, detalhe, criado_em FROM pedido_historico WHERE pedido_id = ? ORDER BY id').all(id);
  const est = db.prepare('SELECT id, nome, slug, telefone, logo_url FROM estabelecimentos WHERE id = ?').get(p.estabelecimento_id);
  return {
    id: p.id, codigo: p.codigo, status: p.status, status_label: STATUS_LABEL[p.status] || p.status,
    estabelecimento_id: p.estabelecimento_id, estabelecimento: est, cliente_id: p.cliente_id,
    tipo_entrega: p.tipo_entrega, endereco: p.endereco_json ? JSON.parse(p.endereco_json) : null,
    cliente_nome: p.cliente_nome, cliente_telefone: p.cliente_telefone,
    subtotal: p.subtotal, taxa_entrega: p.taxa_entrega, total: p.total,
    forma_pagamento: p.forma_pagamento, forma_pagamento_label: FORMAS_PAGAMENTO[p.forma_pagamento]?.label,
    pagamento_status: p.pagamento_status, troco_para: p.troco_para, observacao: p.observacao, motivo: p.motivo,
    pix_payload: p.pix_payload, publicado_em: p.publicado_em, criado_em: p.criado_em, atualizado_em: p.atualizado_em,
    itens: itens.map((i) => ({
      id: i.id, nome: i.nome, preco_unit: i.preco_unit, quantidade: i.quantidade, observacao: i.observacao, total: i.total,
      opcoes: porItem.get(i.id) || [],
    })),
    historico,
  };
}

const paraLoja = (p) => { const { pix_payload, ...resto } = p; return resto; };

/** Envia o evento ao painel da loja (se já publicado) e ao cliente dono do pedido. */
export function notificar(db, pedidoId, eventoLoja = 'pedido.atualizado') {
  const p = carregarPedido(db, pedidoId);
  if (!p) return;
  if (p.publicado_em) publish(`loja:${p.estabelecimento_id}`, eventoLoja, paraLoja(p));
  publish(`cliente:${p.cliente_id}`, 'pedido.atualizado', p);
}

const historico = (db, pedidoId, status, user, detalhe) =>
  db.prepare('INSERT INTO pedido_historico (pedido_id, status, usuario_id, tipo, detalhe, criado_em) VALUES (?,?,?,?,?,?)')
    .run(pedidoId, status, user?.id ?? null, user?.tipo ?? 'sistema', detalhe ?? null, now());

// ---------------------------------------------------------------------------
// Criação do pedido: TODOS os preços e regras são recalculados aqui, no servidor.
// ---------------------------------------------------------------------------
export function criarPedido(db, config, cliente, body) {
  const estId = V.id(body.estabelecimento_id, 'Estabelecimento');
  const tipo = V.enum(body.tipo_entrega, 'Tipo de entrega', ['entrega', 'retirada']);
  const forma = V.enum(body.forma_pagamento, 'Forma de pagamento', Object.keys(FORMAS_PAGAMENTO));
  const observacao = V.str(body.observacao, 'Observação', { max: 300, optional: true });
  const telefone = V.phone(body.telefone ?? cliente.telefone);
  if (!Array.isArray(body.itens) || !body.itens.length) throw new HttpError(422, 'O carrinho está vazio');
  if (body.itens.length > 40) throw new HttpError(422, 'Itens demais no carrinho');

  const novoId = tx(db, () => {
    const est = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(estId);
    if (!est || !est.ativo) throw new HttpError(404, 'Estabelecimento não encontrado');
    const func = statusFuncionamento(est, getHorarios(db, est.id), config.tzOffsetHours);
    if (!func.aberto) throw new HttpError(409, 'Este estabelecimento está fechado no momento', 'FECHADO');
    if (tipo === 'retirada' && !est.aceita_retirada) throw new HttpError(422, 'Este estabelecimento não oferece retirada');

    let endereco = null;
    if (tipo === 'entrega') {
      const eid = V.id(body.endereco_id, 'Endereço');
      endereco = db.prepare('SELECT * FROM enderecos WHERE id = ? AND cliente_id = ?').get(eid, cliente.id);
      if (!endereco) throw new HttpError(422, 'Endereço inválido');
    }

    const getProd = db.prepare('SELECT * FROM produtos WHERE id = ? AND estabelecimento_id = ? AND ativo = 1');
    const getGrupos = db.prepare('SELECT * FROM grupos_opcoes WHERE produto_id = ?');
    const getOpcao = db.prepare('SELECT * FROM opcoes WHERE id = ? AND ativo = 1');

    const linhas = [];
    let subtotal = 0;
    for (const raw of body.itens) {
      const produto = getProd.get(V.id(raw.produto_id, 'Produto'), est.id);
      if (!produto) throw new HttpError(422, 'Um dos produtos não está mais disponível');
      const qtd = V.int(raw.quantidade, 'Quantidade', { min: 1, max: 50 });
      const ids = raw.opcoes === undefined ? [] : raw.opcoes;
      if (!Array.isArray(ids) || ids.length > 40) throw new HttpError(422, 'Opções inválidas');
      const unicas = new Set(ids.map((x) => V.id(x, 'Opção')));
      if (unicas.size !== ids.length) throw new HttpError(422, 'Opções repetidas');

      const grupos = getGrupos.all(produto.id);
      const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
      const contagem = new Map();
      const escolhidas = [];
      for (const oid of unicas) {
        const op = getOpcao.get(oid);
        const g = op && grupoPorId.get(op.grupo_id);
        if (!g) throw new HttpError(422, 'Opção inválida para o produto');
        contagem.set(g.id, (contagem.get(g.id) || 0) + 1);
        escolhidas.push({ g, op });
      }
      for (const g of grupos) {
        const n = contagem.get(g.id) || 0;
        if (n < g.minimo) throw new HttpError(422, `Escolha ao menos ${g.minimo} em "${g.titulo}" (${produto.nome})`);
        if (n > g.maximo) throw new HttpError(422, `Escolha no máximo ${g.maximo} em "${g.titulo}" (${produto.nome})`);
      }
      const adicional = escolhidas.reduce((s, { op }) => s + op.preco_adicional, 0);
      const unit = produto.preco + adicional;
      const total = unit * qtd;
      subtotal += total;
      linhas.push({ produto, qtd, unit, total, escolhidas, obs: V.str(raw.observacao, 'Observação do item', { max: 140, optional: true }) });
    }

    if (subtotal < est.pedido_minimo) throw new HttpError(422, `Pedido mínimo de R$ ${(est.pedido_minimo / 100).toFixed(2).replace('.', ',')}`, 'MINIMO');
    const taxa = tipo === 'entrega' ? est.taxa_entrega : 0;
    const total = subtotal + taxa;

    let troco = null;
    if (forma === 'dinheiro' && body.troco_para != null && body.troco_para !== '') {
      troco = V.int(body.troco_para, 'Troco para', { min: 1 });
      if (troco < total) throw new HttpError(422, 'O valor do troco deve ser maior ou igual ao total');
    }

    const online = FORMAS_PAGAMENTO[forma].online;
    const codigo = codigoUnico(db);
    const t = now();
    const pix = online ? getProvider(config).createCharge({ codigo, total }).pix_payload : null;
    const pedidoId = db.prepare(
      `INSERT INTO pedidos (codigo, estabelecimento_id, cliente_id, status, tipo_entrega, endereco_json, cliente_nome, cliente_telefone,
         subtotal, taxa_entrega, total, forma_pagamento, pagamento_status, troco_para, observacao, pix_payload, publicado_em, criado_em, atualizado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      codigo, est.id, cliente.id, online ? 'aguardando_pagamento' : 'novo', tipo,
      endereco ? JSON.stringify({ apelido: endereco.apelido, rua: endereco.rua, numero: endereco.numero, complemento: endereco.complemento, bairro: endereco.bairro, cidade: endereco.cidade, uf: endereco.uf, cep: endereco.cep, referencia: endereco.referencia }) : null,
      cliente.nome, telefone, subtotal, taxa, total, forma, online ? 'pendente' : 'na_entrega', troco, observacao, pix,
      online ? null : t, t, t
    ).lastInsertRowid;

    const insItem = db.prepare('INSERT INTO pedido_itens (pedido_id, produto_id, nome, preco_unit, quantidade, observacao, total) VALUES (?,?,?,?,?,?,?)');
    const insOp = db.prepare('INSERT INTO pedido_item_opcoes (item_id, grupo_titulo, nome, preco_adicional) VALUES (?,?,?,?)');
    for (const l of linhas) {
      const itemId = insItem.run(pedidoId, l.produto.id, l.produto.nome, l.unit, l.qtd, l.obs, l.total).lastInsertRowid;
      for (const { g, op } of l.escolhidas) insOp.run(itemId, g.titulo, op.nome, op.preco_adicional);
    }
    historico(db, pedidoId, online ? 'aguardando_pagamento' : 'novo', { id: cliente.id, tipo: 'cliente' }, 'Pedido criado');
    return pedidoId;
  });

  const pedido = carregarPedido(db, novoId);
  notificar(db, novoId, 'pedido.novo');
  return pedido;
}

/** Pagamento online confirmado (webhook do gateway ou simulação em ambiente de teste). */
export function confirmarPagamento(db, pedidoId) {
  const mudou = tx(db, () => {
    const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!p) throw new HttpError(404, 'Pedido não encontrado');
    if (p.pagamento_status === 'pago') return false;
    if (p.status !== 'aguardando_pagamento') throw new HttpError(409, 'Este pedido não aguarda pagamento');
    const t = now();
    db.prepare("UPDATE pedidos SET pagamento_status = 'pago', status = 'novo', publicado_em = ?, atualizado_em = ? WHERE id = ?").run(t, t, pedidoId);
    historico(db, pedidoId, 'novo', null, 'Pagamento confirmado');
    return true;
  });
  if (mudou) notificar(db, pedidoId, 'pedido.novo'); // a campainha do vendedor toca neste momento
  return carregarPedido(db, pedidoId);
}

export function mudarStatusVendedor(db, estId, pedidoId, novo, motivoRaw, user) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ? AND estabelecimento_id = ? AND publicado_em IS NOT NULL').get(pedidoId, estId);
  if (!p) throw new HttpError(404, 'Pedido não encontrado');
  const permitidos = (TRANSICOES_VENDEDOR[p.status] || []).filter((s) => {
    if (p.status !== 'pronto') return true;
    return p.tipo_entrega === 'entrega' ? s !== 'entregue' : s !== 'em_entrega';
  });
  if (!permitidos.includes(novo)) throw new HttpError(409, `Não é possível mudar de "${STATUS_LABEL[p.status]}" para "${STATUS_LABEL[novo] || novo}"`);
  const motivo = novo === 'recusado' || novo === 'cancelado' ? V.str(motivoRaw, 'Motivo', { min: 3, max: 200 }) : null;

  tx(db, () => {
    const t = now();
    let pag = p.pagamento_status;
    if (novo === 'entregue' && pag === 'na_entrega') pag = 'pago';
    if ((novo === 'recusado' || novo === 'cancelado')) pag = pag === 'pago' ? 'estornar' : 'cancelado';
    const r = db.prepare(`UPDATE pedidos SET status = ?, pagamento_status = ?, motivo = COALESCE(?, motivo), ${COLUNA_TEMPO[novo]} = ?, atualizado_em = ? WHERE id = ? AND status = ?`)
      .run(novo, pag, motivo, t, t, p.id, p.status);
    if (!r.changes) throw new HttpError(409, 'O pedido foi alterado por outra ação. Atualize a tela.');
    historico(db, p.id, novo, user, motivo);
  });
  notificar(db, p.id);
  return carregarPedido(db, p.id);
}

export function cancelarPeloCliente(db, clienteId, pedidoId) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_id = ?').get(pedidoId, clienteId);
  if (!p) throw new HttpError(404, 'Pedido não encontrado');
  if (!['aguardando_pagamento', 'novo'].includes(p.status)) throw new HttpError(409, 'O pedido já foi aceito pelo estabelecimento e não pode mais ser cancelado por aqui. Entre em contato com a loja.');
  tx(db, () => {
    const t = now();
    const pag = p.pagamento_status === 'pago' ? 'estornar' : 'cancelado';
    const r = db.prepare(`UPDATE pedidos SET status = 'cancelado', pagamento_status = ?, motivo = 'Cancelado pelo cliente', cancelado_em = ?, atualizado_em = ? WHERE id = ? AND status = ?`)
      .run(pag, t, t, p.id, p.status);
    if (!r.changes) throw new HttpError(409, 'O pedido foi alterado. Atualize a tela.');
    historico(db, p.id, 'cancelado', { id: clienteId, tipo: 'cliente' }, 'Cancelado pelo cliente');
  });
  notificar(db, p.id);
  return carregarPedido(db, p.id);
}

export function expirarPixPendentes(db, config) {
  const limite = new Date(Date.now() - config.payments.pixTimeoutMin * 60_000).toISOString();
  const vencidos = db.prepare("SELECT id FROM pedidos WHERE status = 'aguardando_pagamento' AND criado_em < ?").all(limite);
  for (const { id } of vencidos) {
    tx(db, () => {
      const t = now();
      db.prepare("UPDATE pedidos SET status = 'cancelado', pagamento_status = 'expirado', motivo = 'Pagamento não confirmado a tempo', cancelado_em = ?, atualizado_em = ? WHERE id = ? AND status = 'aguardando_pagamento'").run(t, t, id);
      historico(db, id, 'cancelado', null, 'Pix expirado');
    });
    notificar(db, id);
  }
  return vencidos.length;
}

/** Limites [início, fim) do dia local, em ISO UTC. */
export function intervaloDia(config, dataStr) {
  const off = config.tzOffsetHours * 3600e3;
  let inicioLocal;
  if (dataStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) throw new HttpError(422, 'Data inválida (use AAAA-MM-DD)');
    inicioLocal = Date.parse(dataStr + 'T00:00:00Z');
    if (Number.isNaN(inicioLocal)) throw new HttpError(422, 'Data inválida');
  } else {
    inicioLocal = Math.floor((Date.now() + off) / 86400e3) * 86400e3;
  }
  return { inicio: new Date(inicioLocal - off).toISOString(), fim: new Date(inicioLocal - off + 86400e3).toISOString() };
}
