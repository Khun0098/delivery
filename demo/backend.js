/* Servidor SIMULADO para a demonstração. Roda dentro da página, guarda tudo em memória e reproduz as regras do backend real
   (apps/api): validação de pedido, transições de status, isolamento por loja e eventos em tempo real. */
(() => {
  'use strict';
  const TZ = -3;
  const nowIso = () => new Date().toISOString();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  class Err extends Error { constructor(status, msg, codigo) { super(msg); this.status = status; this.codigo = codigo; } }
  const bad = (m) => new Err(422, m, 'VALIDACAO');
  let ID = 1000; const nid = () => ++ID;

  const S = { est: [], horarios: [], cats: [], prods: [], users: [], enderecos: [], pedidos: [], audit: [] };
  const sessions = { cliente: null, vendedor: null, admin: null };

  // ---------- dados de demonstração (mesmo cardápio do seed real) ----------
  const GRATIS = ['Cereal chocoball', 'Paçoca', 'Granola', 'Coco ralado', 'Granulado de chocolate'];
  const CALDAS = ['Caramelo', 'Leite condensado', 'Chocolate', 'Morango'];
  const EXTRAS = ['Ovomaltine', 'Confetes de chocolates', 'Leite em pó', 'Granola', 'Paçoca', 'Nestón', 'Coco ralado', 'Granulado de chocolate'];
  const ops = (nomes, preco) => nomes.map((nome) => ({ id: nid(), nome, preco_adicional: preco, imagem_url: null, ativo: true }));
  const grupo = (titulo, descricao, minimo, maximo, opcoes) => ({ id: nid(), titulo, descricao, minimo, maximo, opcoes });
  const est = (o) => { const e = { id: nid(), logo_url: null, banner_url: null, telefone: '11999990001', aberto_manual: true, aceita_retirada: true, ativo: true, criado_em: nowIso(), ...o }; S.est.push(e); return e; };
  const cat = (e, nome) => { const c = { id: nid(), est: e.id, nome, ordem: S.cats.filter((x) => x.est === e.id).length + 1, ativa: true }; S.cats.push(c); return c; };
  const prod = (e, c, nome, descricao, preco, orig = null, grupos = [], r18 = false) => { const p = { id: nid(), est: e.id, categoria_id: c.id, nome, descricao, preco, preco_original: orig, imagem_url: null, ativo: true, restrito_18: r18, grupos }; S.prods.push(p); return p; };
  const user = (tipo, nome, email, senha, estId = null, telefone = null) => { const u = { id: nid(), tipo, nome, email, senha, est: estId, telefone, ativo: true }; S.users.push(u); return u; };

  function seed() {
    const a = est({ slug: 'acai-papum', nome: 'Açaí Papum', descricao: 'Pediu, chegou, gelou! Açaí cremoso, puro e geladinho, sem cristais de gelo.', categoria: 'Açaí', endereco: 'Centro', pedido_minimo: 990, taxa_entrega: 0, tempo_min: 43, tempo_max: 53 });
    const c1 = cat(a, 'Pápum Gourmet - Monte seu Açaí'), c2 = cat(a, 'Bebidas');
    prod(a, c1, 'Açaí Artesanal de 200ml + 3 complementos grátis', 'Açaí cremoso, puro e geladinho, sem cristais de gelo. Escolha até 3 acompanhamentos grátis. Monte o seu.', 1490, 1990, [
      grupo('Adicionais Grátis', 'Escolha pelo menos 1 opção (até 3).', 1, 3, ops(GRATIS, 0)), grupo('Caldas', 'Escolha até 1 opção.', 0, 1, ops(CALDAS, 0)), grupo('Que tal acrescentar mais?', 'Escolha até 4 opções.', 0, 4, ops(EXTRAS, 250))]);
    prod(a, c1, 'Combo Duas Tentações Cookies & Cream + Ferrero Rocher 200ml', 'Duas tentações em um só pedido! De um lado, a cremosidade irresistível do Cookies & Cream. Do outro, a explosão de sabor do Ferrero Rocher.', 3890, 5990);
    prod(a, c1, 'Pápum Gourmet - Cookies & Cream', 'Creme de Cookies & Cream. Uma combinação irresistível de creme aveludado com o sabor inconfundível de Cookies.', 2290, 2990);
    prod(a, c1, 'Pápum Gourmet - Trufadão Ferrero Rocher + 2 complementos grátis', 'O clássico bombom virou açaí! Copo intensamente recheado com camadas da legítima Nutella pura e a crocância irresistível do Ferrero Rocher.', 2290, 2990, [grupo('Complementos grátis', 'Escolha até 2 opções.', 0, 2, ops(GRATIS, 0))]);
    prod(a, c1, 'Pápum Gourmet - Trufadão Ninho c/ Nutella + 2 complementos grátis', 'O verdadeiro trufado! Copo mega recheado com camadas generosas de Nutella pura e nosso exclusivo e cremoso creme de Ninho.', 2290, 2990, [grupo('Complementos grátis', 'Escolha até 2 opções.', 0, 2, ops(GRATIS, 0))]);
    prod(a, c2, 'Coca-Cola Pet Mini 200 ml', 'Garrafa 200ml.', 399);
    prod(a, c2, 'Água Mineral com Gás 500ml Passa Quatro', 'Garrafa 500ml.', 700);
    prod(a, c2, 'Cerveja Heineken Latão', 'Cerveja Heineken latão. Venda proibida para menores de 18 anos.', 1200, null, [], true);
    const b = est({ slug: 'pizzaria-demo', nome: 'Pizzaria Demo', descricao: 'Pizzas artesanais no forno a lenha.', categoria: 'Pizza', endereco: 'Bairro Jardim', pedido_minimo: 2500, taxa_entrega: 500, tempo_min: 40, tempo_max: 60 });
    const cb = cat(b, 'Pizzas');
    prod(b, cb, 'Pizza Margherita', 'Molho de tomate, muçarela e manjericão.', 4500);
    prod(b, cb, 'Pizza Calabresa', 'Calabresa fatiada e cebola.', 4800);
    user('admin', 'Administrador Geral', 'admin@delivery.local', 'Admin#12345');
    user('vendedor', 'Dono do Açaí Papum', 'vendedor@acaipapum.local', 'Vendedor#12345', a.id);
    user('vendedor', 'Dono da Pizzaria', 'vendedor@pizzariademo.local', 'Vendedor#12345', b.id);
    user('cliente', 'Cliente Teste', 'cliente@teste.local', 'Cliente#12345', null, '11999990000');
  }
  seed();

  // ---------- utilidades de regra ----------
  const STATUS_LABEL = { aguardando_pagamento: 'Aguardando pagamento', novo: 'Aguardando aceite', preparando: 'Em preparo', pronto: 'Pronto', em_entrega: 'Saiu para entrega', entregue: 'Entregue', recusado: 'Recusado', cancelado: 'Cancelado' };
  const FORMAS = { pix: { label: 'Pix', online: true }, cartao_credito: { label: 'Cartão de crédito na entrega', online: false }, cartao_debito: { label: 'Cartão de débito na entrega', online: false }, dinheiro: { label: 'Dinheiro', online: false } };
  const TRANS = { novo: ['preparando', 'recusado'], preparando: ['pronto', 'cancelado'], pronto: ['em_entrega', 'entregue', 'cancelado'], em_entrega: ['entregue', 'cancelado'] };
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const horariosDe = (id) => S.horarios.filter((h) => h.est === id).map(({ dia_semana, abre, fecha }) => ({ dia_semana, abre, fecha })).sort((a, b) => a.dia_semana - b.dia_semana || toMin(a.abre) - toMin(b.abre));

  function statusFunc(e) {
    const hs = horariosDe(e.id);
    if (!e.ativo) return { aberto: false, motivo: 'inativo', abre_as: null, abre_hoje: false };
    if (!e.aberto_manual) return { aberto: false, motivo: 'pausado', abre_as: null, abre_hoje: false };
    if (!hs.length) return { aberto: true, motivo: null, abre_as: null, abre_hoje: false };
    const local = new Date(Date.now() + TZ * 3600e3), dia = local.getUTCDay(), min = local.getUTCHours() * 60 + local.getUTCMinutes();
    for (const h of hs) {
      const a = toMin(h.abre), f = toMin(h.fecha);
      if (h.dia_semana === dia && (f > a ? min >= a && min < f : min >= a)) return { aberto: true, motivo: null, abre_as: null, abre_hoje: false };
      if (h.dia_semana === (dia + 6) % 7 && f <= a && min < f) return { aberto: true, motivo: null, abre_as: null, abre_hoje: false };
    }
    const hoje = hs.filter((h) => h.dia_semana === dia && toMin(h.abre) > min);
    if (hoje.length) return { aberto: false, motivo: 'fechado', abre_as: hoje[0].abre, abre_hoje: true };
    for (let i = 1; i <= 7; i++) { const d = (dia + i) % 7; const x = hs.filter((h) => h.dia_semana === d); if (x.length) return { aberto: false, motivo: 'fechado', abre_as: x[0].abre, abre_hoje: false, abre_dia: d }; }
    return { aberto: false, motivo: 'fechado', abre_as: null, abre_hoje: false };
  }
  const dayRange = (str) => {
    const off = TZ * 3600e3; let ini;
    if (str) { if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw bad('Data inválida'); ini = Date.parse(str + 'T00:00:00Z'); } else ini = Math.floor((Date.now() + off) / 86400e3) * 86400e3;
    return { inicio: new Date(ini - off).toISOString(), fim: new Date(ini - off + 86400e3).toISOString() };
  };
  const str = (x, label, { min = 1, max = 255, optional = false } = {}) => {
    if (x === undefined || x === null || x === '') { if (optional) return null; throw bad(`${label} é obrigatório`); }
    if (typeof x !== 'string') throw bad(`${label} inválido`);
    const s = x.trim(); if (s.length < min) throw bad(`${label} deve ter ao menos ${min} caractere(s)`); if (s.length > max) throw bad(`${label} é longo demais`); return s;
  };
  const int = (x, label, { min = 0, max = 1e9, optional = false } = {}) => {
    if (x === undefined || x === null || x === '') { if (optional) return null; throw bad(`${label} é obrigatório`); }
    if (!Number.isInteger(x) || x < min || x > max) throw bad(`${label} inválido`); return x;
  };
  const audit = (u, acao, detalhe) => S.audit.unshift({ id: nid(), usuario_id: u?.id ?? null, tipo: u?.tipo ?? null, estabelecimento_id: u?.est ?? null, acao, detalhe: detalhe ?? null, ip: 'demo', criado_em: nowIso() });

  // ---------- tempo real ----------
  const channels = new Map();
  function publish(ch, ev, data) { (channels.get(ch) || []).forEach((cb) => { try { cb(ev, clone(data)); } catch { /* aba fechada */ } }); }
  function subscribe(area, cb) {
    const u = userFor(area); if (!u) return null;
    const ch = area === 'vendedor' ? `loja:${u.est}` : `cliente:${u.id}`;
    if (!channels.has(ch)) channels.set(ch, new Set()); channels.get(ch).add(cb);
    return () => channels.get(ch)?.delete(cb);
  }

  // ---------- pedidos ----------
  const codigo = () => { const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c; do { c = 'PP'; for (let i = 0; i < 6; i++) c += al[Math.floor(Math.random() * al.length)]; } while (S.pedidos.some((p) => p.codigo === c)); return c; };
  const view = (p) => {
    const e = S.est.find((x) => x.id === p.est);
    return { id: p.id, codigo: p.codigo, status: p.status, status_label: STATUS_LABEL[p.status], estabelecimento_id: p.est, estabelecimento: { id: e.id, nome: e.nome, slug: e.slug, telefone: e.telefone, logo_url: e.logo_url }, cliente_id: p.cliente_id,
      tipo_entrega: p.tipo_entrega, endereco: p.endereco, cliente_nome: p.cliente_nome, cliente_telefone: p.cliente_telefone, subtotal: p.subtotal, taxa_entrega: p.taxa_entrega, total: p.total,
      forma_pagamento: p.forma, forma_pagamento_label: FORMAS[p.forma].label, pagamento_status: p.pagamento_status, troco_para: p.troco_para, observacao: p.observacao, motivo: p.motivo, pix_payload: p.pix_payload,
      publicado_em: p.publicado_em, criado_em: p.criado_em, atualizado_em: p.atualizado_em, itens: p.itens, historico: p.historico };
  };
  const paraLoja = (p) => { const v = view(p); delete v.pix_payload; return v; };
  function notificar(p, evLoja = 'pedido.atualizado') {
    if (p.publicado_em) publish(`loja:${p.est}`, evLoja, paraLoja(p));
    publish(`cliente:${p.cliente_id}`, 'pedido.atualizado', view(p));
  }
  const hist = (p, status, detalhe) => p.historico.push({ status, detalhe: detalhe ?? null, criado_em: nowIso() });

  function criarPedido(cli, b) {
    const e = S.est.find((x) => x.id === b.estabelecimento_id && x.ativo); if (!e) throw new Err(404, 'Estabelecimento não encontrado');
    const tipo = b.tipo_entrega; if (!['entrega', 'retirada'].includes(tipo)) throw bad('Tipo de entrega inválido');
    const forma = b.forma_pagamento; if (!FORMAS[forma]) throw bad('Forma de pagamento inválida');
    if (!Array.isArray(b.itens) || !b.itens.length) throw bad('O carrinho está vazio');
    if (!statusFunc(e).aberto) throw new Err(409, 'Este estabelecimento está fechado no momento', 'FECHADO');
    if (tipo === 'retirada' && !e.aceita_retirada) throw bad('Este estabelecimento não oferece retirada');
    let end = null;
    if (tipo === 'entrega') { end = S.enderecos.find((x) => x.id === b.endereco_id && x.cliente_id === cli.id); if (!end) throw bad('Endereço inválido'); }
    let subtotal = 0; const itens = [];
    for (const it of b.itens) {
      const pr = S.prods.find((x) => x.id === it.produto_id && x.est === e.id && x.ativo); if (!pr) throw bad('Um dos produtos não está mais disponível');
      const qtd = int(it.quantidade, 'Quantidade', { min: 1, max: 50 });
      const ids = new Set(it.opcoes || []); if (ids.size !== (it.opcoes || []).length) throw bad('Opções repetidas');
      const cont = new Map(), esc = [];
      for (const oid of ids) {
        const g = pr.grupos.find((gg) => gg.opcoes.some((o) => o.id === oid && o.ativo)); if (!g) throw bad('Opção inválida para o produto');
        cont.set(g.id, (cont.get(g.id) || 0) + 1); esc.push({ g, o: g.opcoes.find((o) => o.id === oid) });
      }
      for (const g of pr.grupos) { const n = cont.get(g.id) || 0; if (n < g.minimo) throw bad(`Escolha ao menos ${g.minimo} em "${g.titulo}" (${pr.nome})`); if (n > g.maximo) throw bad(`Escolha no máximo ${g.maximo} em "${g.titulo}" (${pr.nome})`); }
      const unit = pr.preco + esc.reduce((s, x) => s + x.o.preco_adicional, 0), total = unit * qtd; subtotal += total;
      itens.push({ id: nid(), nome: pr.nome, preco_unit: unit, quantidade: qtd, observacao: it.observacao || null, total, opcoes: esc.map((x) => ({ grupo: x.g.titulo, nome: x.o.nome, preco_adicional: x.o.preco_adicional })) });
    }
    if (subtotal < e.pedido_minimo) throw new Err(422, `Pedido mínimo de R$ ${(e.pedido_minimo / 100).toFixed(2).replace('.', ',')}`, 'MINIMO');
    const taxa = tipo === 'entrega' ? e.taxa_entrega : 0, total = subtotal + taxa;
    let troco = null; if (forma === 'dinheiro' && b.troco_para != null) { troco = int(b.troco_para, 'Troco para', { min: 1 }); if (troco < total) throw bad('O valor do troco deve ser maior ou igual ao total'); }
    const online = FORMAS[forma].online, cod = codigo(), t = nowIso();
    const p = { id: nid(), codigo: cod, est: e.id, cliente_id: cli.id, status: online ? 'aguardando_pagamento' : 'novo', tipo_entrega: tipo, cliente_nome: cli.nome, cliente_telefone: cli.telefone || '11999990000',
      endereco: end ? { apelido: end.apelido, rua: end.rua, numero: end.numero, complemento: end.complemento, bairro: end.bairro, cidade: end.cidade, uf: end.uf, cep: end.cep, referencia: end.referencia } : null,
      subtotal, taxa_entrega: taxa, total, forma, pagamento_status: online ? 'pendente' : 'na_entrega', troco_para: troco, observacao: b.observacao || null, motivo: null,
      pix_payload: online ? `TESTE-PIX|pedido=${cod}|valor=${(total / 100).toFixed(2)}` : null, publicado_em: online ? null : t, criado_em: t, atualizado_em: t, itens, historico: [] };
    hist(p, p.status, 'Pedido criado'); S.pedidos.push(p); notificar(p, 'pedido.novo'); return p;
  }
  function confirmarPagamento(p) {
    if (p.pagamento_status === 'pago') return p;
    if (p.status !== 'aguardando_pagamento') throw new Err(409, 'Este pedido não aguarda pagamento');
    p.pagamento_status = 'pago'; p.status = 'novo'; p.publicado_em = p.atualizado_em = nowIso(); hist(p, 'novo', 'Pagamento confirmado'); notificar(p, 'pedido.novo'); return p;
  }
  function mudarStatus(estId, id, novo, motivoRaw, u) {
    const p = S.pedidos.find((x) => x.id === id && x.est === estId && x.publicado_em); if (!p) throw new Err(404, 'Pedido não encontrado');
    const ok = (TRANS[p.status] || []).filter((s) => p.status !== 'pronto' || (p.tipo_entrega === 'entrega' ? s !== 'entregue' : s !== 'em_entrega'));
    if (!ok.includes(novo)) throw new Err(409, `Não é possível mudar de "${STATUS_LABEL[p.status]}" para "${STATUS_LABEL[novo] || novo}"`);
    const motivo = ['recusado', 'cancelado'].includes(novo) ? str(motivoRaw, 'Motivo', { min: 3, max: 200 }) : null;
    p.status = novo; p.atualizado_em = nowIso(); if (motivo) p.motivo = motivo;
    if (novo === 'entregue' && p.pagamento_status === 'na_entrega') p.pagamento_status = 'pago';
    if (motivo) p.pagamento_status = p.pagamento_status === 'pago' ? 'estornar' : 'cancelado';
    hist(p, novo, motivo); audit(u, 'pedido.status', `${p.codigo} -> ${novo}`); notificar(p); return p;
  }

  // ---------- rotas ----------
  const routes = [];
  const R = (method, re, auth, fn) => routes.push({ method, re: new RegExp('^' + re.replace(/:([a-z_]+)/g, '([^/]+)') + '/?$'), auth, fn });
  const userFor = (area) => { const u = S.users.find((x) => x.id === sessions[area] && x.tipo === area && x.ativo); return u || null; };
  const estDe = (u) => S.est.find((e) => e.id === u.est);
  const pubUser = (u) => ({ id: u.id, tipo: u.tipo, nome: u.nome, email: u.email, telefone: u.telefone, estabelecimento_id: u.est });
  const loginArea = (area) => (c) => {
    const email = str(c.body.email, 'E-mail').toLowerCase(), u = S.users.find((x) => x.email === email && x.tipo === area);
    if (!u || u.senha !== c.body.senha || !u.ativo) { audit(null, 'login.falha', `${area}:${email}`); throw new Err(401, 'E-mail ou senha incorretos'); }
    sessions[area] = u.id; audit(u, 'login.ok'); return { usuario: pubUser(u) };
  };
  const logoutArea = (area) => () => { sessions[area] = null; return { ok: true }; };

  // público
  const camposPub = (e) => ({ id: e.id, slug: e.slug, nome: e.nome, descricao: e.descricao, categoria: e.categoria, logo_url: e.logo_url, banner_url: e.banner_url, endereco: e.endereco, pedido_minimo: e.pedido_minimo, taxa_entrega: e.taxa_entrega, tempo_min: e.tempo_min, tempo_max: e.tempo_max, aceita_retirada: e.aceita_retirada, status: statusFunc(e) });
  R('GET', '/public/estabelecimentos', null, (c) => {
    const q = String(c.query.q || '').toLowerCase(), cat = c.query.categoria || '', todos = S.est.filter((e) => e.ativo);
    const lista = todos.filter((e) => !cat || e.categoria === cat).filter((e) => !q || e.nome.toLowerCase().includes(q) || e.categoria.toLowerCase().includes(q) || e.descricao.toLowerCase().includes(q) || S.prods.some((p) => p.est === e.id && p.ativo && p.nome.toLowerCase().includes(q)))
      .map(camposPub).sort((a, b) => Number(b.status.aberto) - Number(a.status.aberto));
    return { estabelecimentos: lista, categorias: [...new Set(todos.map((e) => e.categoria))].sort() };
  });
  R('GET', '/public/estabelecimentos/:slug', null, (c) => {
    const e = S.est.find((x) => x.slug === c.params.slug && x.ativo); if (!e) throw new Err(404, 'Estabelecimento não encontrado');
    const categorias = S.cats.filter((x) => x.est === e.id && x.ativa).sort((a, b) => a.ordem - b.ordem).map((ct) => ({ id: ct.id, nome: ct.nome,
      produtos: S.prods.filter((p) => p.categoria_id === ct.id && p.ativo).map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, preco_original: p.preco_original, imagem_url: p.imagem_url, restrito_18: p.restrito_18,
        grupos: p.grupos.map((g) => ({ id: g.id, titulo: g.titulo, descricao: g.descricao, minimo: g.minimo, maximo: g.maximo, opcoes: g.opcoes.filter((o) => o.ativo).map(({ id, nome, preco_adicional, imagem_url }) => ({ id, nome, preco_adicional, imagem_url })) })) })) })).filter((x) => x.produtos.length);
    return { estabelecimento: { ...camposPub(e), horarios: horariosDe(e.id), telefone: e.telefone }, categorias, formas_pagamento: Object.entries(FORMAS).map(([id, f]) => ({ id, label: f.label, online: f.online })) };
  });

  // cliente
  R('POST', '/cliente/auth/login', null, loginArea('cliente'));
  R('POST', '/cliente/auth/logout', 'cliente', logoutArea('cliente'));
  R('GET', '/cliente/auth/me', 'cliente', (c) => ({ usuario: pubUser(c.user) }));
  R('POST', '/cliente/auth/cadastro', null, (c) => {
    const email = str(c.body.email, 'E-mail').toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('E-mail inválido');
    if (typeof c.body.senha !== 'string' || c.body.senha.length < 8) throw bad('A senha deve ter ao menos 8 caracteres');
    if (S.users.some((x) => x.email === email && x.tipo === 'cliente')) throw new Err(409, 'Já existe uma conta com este e-mail');
    const u = user('cliente', str(c.body.nome, 'Nome', { min: 2 }), email, c.body.senha, null, String(c.body.telefone || '').replace(/\D/g, '') || null);
    sessions.cliente = u.id; c.status = 201; return { usuario: pubUser(u) };
  });
  R('PATCH', '/cliente/perfil', 'cliente', (c) => { c.user.nome = str(c.body.nome, 'Nome', { min: 2 }); c.user.telefone = c.body.telefone || null; if (c.body.senha_nova) { if (c.body.senha_atual !== c.user.senha) throw new Err(403, 'Senha atual incorreta'); c.user.senha = c.body.senha_nova; } return { ok: true }; });
  R('GET', '/cliente/enderecos', 'cliente', (c) => ({ enderecos: S.enderecos.filter((x) => x.cliente_id === c.user.id) }));
  R('POST', '/cliente/enderecos', 'cliente', (c) => {
    const b = c.body, a = { id: nid(), cliente_id: c.user.id, apelido: str(b.apelido ?? 'Casa', 'Apelido', { max: 30 }), cep: b.cep || null, rua: str(b.rua, 'Rua'), numero: str(b.numero, 'Número', { max: 12 }), complemento: b.complemento || null, bairro: str(b.bairro, 'Bairro'), cidade: str(b.cidade, 'Cidade'), uf: b.uf || null, referencia: b.referencia || null };
    S.enderecos.push(a); c.status = 201; return { endereco: a };
  });
  R('DELETE', '/cliente/enderecos/:id', 'cliente', (c) => { const i = S.enderecos.findIndex((x) => x.id === Number(c.params.id) && x.cliente_id === c.user.id); if (i < 0) throw new Err(404, 'Endereço não encontrado'); S.enderecos.splice(i, 1); return { ok: true }; });
  R('POST', '/cliente/pedidos', 'cliente', (c) => { c.status = 201; return { pedido: view(criarPedido(c.user, c.body)) }; });
  R('GET', '/cliente/pedidos', 'cliente', (c) => ({ pedidos: S.pedidos.filter((p) => p.cliente_id === c.user.id).slice().reverse().map(view) }));
  const meuPedido = (c) => { const p = S.pedidos.find((x) => x.id === Number(c.params.id) && x.cliente_id === c.user.id); if (!p) throw new Err(404, 'Pedido não encontrado'); return p; };
  R('GET', '/cliente/pedidos/:id', 'cliente', (c) => ({ pedido: view(meuPedido(c)) }));
  R('POST', '/cliente/pedidos/:id/cancelar', 'cliente', (c) => {
    const p = meuPedido(c); if (!['aguardando_pagamento', 'novo'].includes(p.status)) throw new Err(409, 'O pedido já foi aceito pelo estabelecimento e não pode mais ser cancelado por aqui. Entre em contato com a loja.');
    p.pagamento_status = p.pagamento_status === 'pago' ? 'estornar' : 'cancelado'; p.status = 'cancelado'; p.motivo = 'Cancelado pelo cliente'; p.atualizado_em = nowIso(); hist(p, 'cancelado', 'Cancelado pelo cliente'); notificar(p); return { pedido: view(p) };
  });
  R('POST', '/cliente/pedidos/:id/pagamento/simular', 'cliente', (c) => ({ pedido: view(confirmarPagamento(meuPedido(c))) }));

  // vendedor
  R('POST', '/vendedor/auth/login', null, loginArea('vendedor'));
  R('POST', '/vendedor/auth/logout', 'vendedor', logoutArea('vendedor'));
  R('GET', '/vendedor/auth/me', 'vendedor', (c) => ({ usuario: pubUser(c.user), estabelecimento: { id: c.est.id, nome: c.est.nome, slug: c.est.slug, logo_url: c.est.logo_url } }));
  R('GET', '/vendedor/eventos', 'vendedor', () => ({ ok: true }));
  R('GET', '/vendedor/pedidos', 'vendedor', (c) => {
    let l;
    if (c.query.modo === 'historico') { const { inicio, fim } = dayRange(c.query.data); l = S.pedidos.filter((p) => p.est === c.est.id && p.publicado_em && p.criado_em >= inicio && p.criado_em < fim).reverse(); }
    else l = S.pedidos.filter((p) => p.est === c.est.id && p.publicado_em && ['novo', 'preparando', 'pronto', 'em_entrega'].includes(p.status));
    return { pedidos: l.map(paraLoja) };
  });
  R('POST', '/vendedor/pedidos/:id/status', 'vendedor', (c) => ({ pedido: paraLoja(mudarStatus(c.est.id, Number(c.params.id), c.body.status, c.body.motivo, c.user)) }));
  R('GET', '/vendedor/dashboard', 'vendedor', (c) => {
    const { inicio, fim } = dayRange(), mine = S.pedidos.filter((p) => p.est === c.est.id && p.publicado_em), hoje = mine.filter((p) => p.criado_em >= inicio && p.criado_em < fim), ent = hoje.filter((p) => p.status === 'entregue'), fat = ent.reduce((s, p) => s + p.total, 0);
    return { pendentes: mine.filter((p) => p.status === 'novo').length, em_andamento: mine.filter((p) => ['preparando', 'pronto', 'em_entrega'].includes(p.status)).length, recebidos_hoje: hoje.length, entregues_hoje: ent.length, faturamento_hoje: fat, ticket_medio_hoje: ent.length ? Math.round(fat / ent.length) : 0, cancelados_hoje: hoje.filter((p) => ['recusado', 'cancelado'].includes(p.status)).length, status: statusFunc(c.est) };
  });
  R('GET', '/vendedor/financeiro', 'vendedor', (c) => {
    const hoje = new Date(Date.now() + TZ * 3600e3).toISOString().slice(0, 10), de = c.query.de || hoje.slice(0, 8) + '01', ate = c.query.ate || hoje, ini = dayRange(de).inicio, fim = dayRange(ate).fim;
    const m = S.pedidos.filter((p) => p.est === c.est.id && p.publicado_em && p.criado_em >= ini && p.criado_em < fim), ent = m.filter((p) => p.status === 'entregue'), fat = ent.reduce((s, p) => s + p.total, 0);
    const agr = (kf) => { const o = {}; ent.forEach((p) => { const k = kf(p); o[k] ||= { pedidos: 0, total: 0 }; o[k].pedidos++; o[k].total += p.total; }); return o; };
    const top = {}; ent.forEach((p) => p.itens.forEach((i) => { top[i.nome] ||= { nome: i.nome, quantidade: 0, total: 0 }; top[i.nome].quantidade += i.quantidade; top[i.nome].total += i.total; }));
    return { periodo: { de, ate }, pedidos: ent.length, faturamento: fat, taxas: ent.reduce((s, p) => s + p.taxa_entrega, 0), ticket_medio: ent.length ? Math.round(fat / ent.length) : 0, cancelados: m.filter((p) => ['recusado', 'cancelado'].includes(p.status)).length,
      por_forma: Object.entries(agr((p) => p.forma)).map(([forma_pagamento, v]) => ({ forma_pagamento, ...v })).sort((a, b) => b.total - a.total),
      por_dia: Object.entries(agr((p) => new Date(Date.parse(p.criado_em) + TZ * 3600e3).toISOString().slice(0, 10))).map(([dia, v]) => ({ dia, ...v })).sort((a, b) => a.dia.localeCompare(b.dia)),
      top_produtos: Object.values(top).sort((a, b) => b.quantidade - a.quantidade).slice(0, 10) };
  });
  const lojaView = (e) => ({ id: e.id, slug: e.slug, nome: e.nome, descricao: e.descricao, categoria: e.categoria, logo_url: e.logo_url, banner_url: e.banner_url, telefone: e.telefone, endereco: e.endereco, aberto_manual: e.aberto_manual, pedido_minimo: e.pedido_minimo, taxa_entrega: e.taxa_entrega, tempo_min: e.tempo_min, tempo_max: e.tempo_max, aceita_retirada: e.aceita_retirada });
  R('GET', '/vendedor/loja', 'vendedor', (c) => ({ loja: lojaView(c.est), horarios: horariosDe(c.est.id), status: statusFunc(c.est) }));
  R('POST', '/vendedor/loja/aberto', 'vendedor', (c) => { if (typeof c.body.aberto !== 'boolean') throw bad('Aberto inválido'); c.est.aberto_manual = c.body.aberto; audit(c.user, c.body.aberto ? 'loja.abrir' : 'loja.pausar'); return { aberto_manual: c.est.aberto_manual }; });
  R('PATCH', '/vendedor/loja', 'vendedor', (c) => {
    const b = c.body; if (b.tempo_max < b.tempo_min) throw bad('O tempo máximo deve ser maior que o mínimo');
    Object.assign(c.est, { nome: str(b.nome, 'Nome', { min: 2, max: 80 }), descricao: b.descricao || '', telefone: b.telefone || null, endereco: b.endereco || '', logo_url: b.logo_url || null, banner_url: b.banner_url || null, pedido_minimo: int(b.pedido_minimo, 'Pedido mínimo'), taxa_entrega: int(b.taxa_entrega, 'Taxa de entrega'), tempo_min: int(b.tempo_min, 'Tempo mínimo', { min: 1 }), tempo_max: int(b.tempo_max, 'Tempo máximo', { min: 1 }), aceita_retirada: !!b.aceita_retirada });
    audit(c.user, 'loja.editar'); return { ok: true };
  });
  R('PUT', '/vendedor/horarios', 'vendedor', (c) => {
    if (!Array.isArray(c.body.horarios)) throw bad('Horários inválidos');
    const hs = c.body.horarios.map((h) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.abre) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.fecha)) throw bad('Use o formato HH:MM'); return { est: c.est.id, dia_semana: int(h.dia_semana, 'Dia', { max: 6 }), abre: h.abre, fecha: h.fecha }; });
    S.horarios = S.horarios.filter((h) => h.est !== c.est.id).concat(hs); return { ok: true };
  });
  R('POST', '/vendedor/upload', 'vendedor', () => { throw new Err(501, 'O envio de imagens não existe na demonstração. Cole o endereço de uma imagem no campo "Imagem".'); });
  R('GET', '/vendedor/cardapio', 'vendedor', (c) => ({ categorias: S.cats.filter((x) => x.est === c.est.id).sort((a, b) => a.ordem - b.ordem).map((ct) => ({ id: ct.id, nome: ct.nome, ordem: ct.ordem, ativa: ct.ativa, produtos: S.prods.filter((p) => p.categoria_id === ct.id).map((p) => ({ id: p.id, categoria_id: p.categoria_id, nome: p.nome, descricao: p.descricao, preco: p.preco, preco_original: p.preco_original, imagem_url: p.imagem_url, ativo: p.ativo, restrito_18: p.restrito_18, grupos: p.grupos })) })) }));
  const minhaCat = (c, id) => { const x = S.cats.find((k) => k.id === Number(id) && k.est === c.est.id); if (!x) throw new Err(404, 'Registro não encontrado'); return x; };
  const meuProd = (c) => { const x = S.prods.find((k) => k.id === Number(c.params.id) && k.est === c.est.id); if (!x) throw new Err(404, 'Registro não encontrado'); return x; };
  R('POST', '/vendedor/categorias', 'vendedor', (c) => { const ct = cat(c.est, str(c.body.nome, 'Nome', { max: 60 })); c.status = 201; return { id: ct.id }; });
  R('PATCH', '/vendedor/categorias/:id', 'vendedor', (c) => { const ct = minhaCat(c, c.params.id); ct.nome = str(c.body.nome, 'Nome', { max: 60 }); if (c.body.ordem != null) ct.ordem = c.body.ordem; if (c.body.ativa != null) ct.ativa = !!c.body.ativa; return { ok: true }; });
  R('DELETE', '/vendedor/categorias/:id', 'vendedor', (c) => { const ct = minhaCat(c, c.params.id); if (S.prods.some((p) => p.categoria_id === ct.id)) throw new Err(409, 'Mova ou exclua os produtos desta categoria antes de removê-la'); S.cats = S.cats.filter((x) => x !== ct); return { ok: true }; });
  const lerProd = (c) => {
    const b = c.body, ct = minhaCat(c, b.categoria_id), preco = int(b.preco, 'Preço', { max: 1e7 }), orig = int(b.preco_original, 'Preço original', { max: 1e7, optional: true });
    if (orig != null && orig < preco) throw bad('O preço original deve ser maior ou igual ao preço atual');
    return { categoria_id: ct.id, nome: str(b.nome, 'Nome', { min: 2, max: 120 }), descricao: b.descricao || '', preco, preco_original: orig, imagem_url: b.imagem_url || null, ativo: b.ativo !== false, restrito_18: !!b.restrito_18,
      grupos: (b.grupos || []).map((g) => { const minimo = int(g.minimo ?? 0, 'Mínimo'), maximo = int(g.maximo ?? 1, 'Máximo', { min: 1 }); if (minimo > maximo) throw bad(`Em "${g.titulo}", o mínimo não pode ser maior que o máximo`); if ((g.opcoes || []).filter((o) => o.ativo !== false).length < minimo) throw bad(`O grupo "${g.titulo}" exige mais opções ativas do que existem`);
        return { id: nid(), titulo: str(g.titulo, 'Título do grupo', { max: 80 }), descricao: g.descricao || '', minimo, maximo, opcoes: g.opcoes.map((o) => ({ id: nid(), nome: str(o.nome, 'Nome da opção', { max: 80 }), preco_adicional: int(o.preco_adicional ?? 0, 'Preço adicional'), imagem_url: o.imagem_url || null, ativo: o.ativo !== false })) }; }) };
  };
  R('POST', '/vendedor/produtos', 'vendedor', (c) => { const d = lerProd(c), p = { id: nid(), est: c.est.id, ...d }; S.prods.push(p); audit(c.user, 'produto.criar', p.nome); c.status = 201; return { id: p.id }; });
  R('PUT', '/vendedor/produtos/:id', 'vendedor', (c) => { const p = meuProd(c); Object.assign(p, lerProd(c)); audit(c.user, 'produto.editar', p.nome); return { ok: true }; });
  R('PATCH', '/vendedor/produtos/:id', 'vendedor', (c) => { const p = meuProd(c); if (c.body.ativo !== undefined) p.ativo = !!c.body.ativo; if (c.body.preco !== undefined) p.preco = int(c.body.preco, 'Preço', { max: 1e7 }); return { ok: true }; });
  R('DELETE', '/vendedor/produtos/:id', 'vendedor', (c) => { const p = meuProd(c); S.prods = S.prods.filter((x) => x !== p); return { ok: true }; });

  // admin
  R('POST', '/admin/auth/login', null, loginArea('admin'));
  R('POST', '/admin/auth/logout', 'admin', logoutArea('admin'));
  R('GET', '/admin/auth/me', 'admin', (c) => ({ usuario: pubUser(c.user) }));
  R('GET', '/admin/resumo', 'admin', () => { const { inicio, fim } = dayRange(), h = S.pedidos.filter((p) => p.publicado_em && p.criado_em >= inicio && p.criado_em < fim); return { estabelecimentos: { n: S.est.length, ativos: S.est.filter((e) => e.ativo).length }, clientes: S.users.filter((u) => u.tipo === 'cliente').length, vendedores: S.users.filter((u) => u.tipo === 'vendedor').length, pedidos_hoje: { n: h.length, total: h.reduce((s, p) => s + p.total, 0) } }; });
  R('GET', '/admin/estabelecimentos', 'admin', () => ({ estabelecimentos: S.est.slice().reverse().map((e) => ({ id: e.id, slug: e.slug, nome: e.nome, categoria: e.categoria, ativo: e.ativo ? 1 : 0, aberto_manual: e.aberto_manual, criado_em: e.criado_em, vendedores: S.users.filter((u) => u.est === e.id).length, pedidos: S.pedidos.filter((p) => p.est === e.id && p.publicado_em).length })) }));
  R('POST', '/admin/estabelecimentos', 'admin', (c) => {
    const b = c.body, nome = str(b.nome, 'Nome', { min: 2, max: 80 }), slug = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (S.est.some((e) => e.slug === slug)) throw new Err(409, 'Já existe um estabelecimento com este identificador');
    const v = b.vendedor || {}, email = str(v.email, 'E-mail').toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('E-mail inválido'); if (typeof v.senha !== 'string' || v.senha.length < 8) throw bad('A senha deve ter ao menos 8 caracteres');
    if (S.users.some((u) => u.email === email && u.tipo === 'vendedor')) throw new Err(409, 'Já existe um vendedor com este e-mail');
    const e = est({ slug, nome, categoria: b.categoria || 'Outros', descricao: '', endereco: '', pedido_minimo: 0, taxa_entrega: 0, tempo_min: 30, tempo_max: 50 }), u = user('vendedor', str(v.nome, 'Nome do vendedor', { min: 2 }), email, v.senha, e.id);
    audit(c.user, 'admin.estabelecimento.criar', slug); c.status = 201; return { estabelecimento_id: e.id, vendedor_id: u.id, slug };
  });
  R('PATCH', '/admin/estabelecimentos/:id', 'admin', (c) => { const e = S.est.find((x) => x.id === Number(c.params.id)); if (!e) throw new Err(404, 'Estabelecimento não encontrado'); e.ativo = !!c.body.ativo; if (!e.ativo) S.users.filter((u) => u.est === e.id).forEach((u) => { if (sessions.vendedor === u.id) sessions.vendedor = null; }); audit(c.user, e.ativo ? 'admin.estabelecimento.ativar' : 'admin.estabelecimento.suspender', String(e.id)); return { ok: true }; });
  R('GET', '/admin/vendedores', 'admin', () => ({ vendedores: S.users.filter((u) => u.tipo === 'vendedor').reverse().map((u) => ({ id: u.id, nome: u.nome, email: u.email, ativo: u.ativo ? 1 : 0, estabelecimento_id: u.est, estabelecimento: estDe(u).nome })) }));
  R('POST', '/admin/vendedores', 'admin', (c) => { const b = c.body, e = S.est.find((x) => x.id === b.estabelecimento_id); if (!e) throw new Err(404, 'Estabelecimento não encontrado'); const email = str(b.email, 'E-mail').toLowerCase(); if (S.users.some((u) => u.email === email && u.tipo === 'vendedor')) throw new Err(409, 'Já existe um vendedor com este e-mail'); if (typeof b.senha !== 'string' || b.senha.length < 8) throw bad('A senha deve ter ao menos 8 caracteres'); const u = user('vendedor', str(b.nome, 'Nome', { min: 2 }), email, b.senha, e.id); audit(c.user, 'admin.vendedor.criar', String(u.id)); c.status = 201; return { id: u.id }; });
  R('PATCH', '/admin/vendedores/:id', 'admin', (c) => { const u = S.users.find((x) => x.id === Number(c.params.id) && x.tipo === 'vendedor'); if (!u) throw new Err(404, 'Vendedor não encontrado'); if (c.body.ativo !== undefined) u.ativo = !!c.body.ativo; if (c.body.senha) { if (c.body.senha.length < 8) throw bad('A senha deve ter ao menos 8 caracteres'); u.senha = c.body.senha; } if ((!u.ativo || c.body.senha) && sessions.vendedor === u.id) sessions.vendedor = null; audit(c.user, 'admin.vendedor.editar', String(u.id)); return { ok: true }; });
  R('GET', '/admin/pedidos', 'admin', () => ({ pedidos: S.pedidos.filter((p) => p.publicado_em).slice(-100).reverse().map((p) => ({ id: p.id, codigo: p.codigo, status: p.status, total: p.total, forma_pagamento: p.forma, pagamento_status: p.pagamento_status, criado_em: p.criado_em, estabelecimento: estDe({ est: p.est }).nome })) }));
  R('GET', '/admin/auditoria', 'admin', () => ({ registros: S.audit.slice(0, 200) }));

  // ---------- entrada ----------
  window.__demo = {
    subscribe,
    handle(method, path, query, body) {
      try {
        const r = routes.find((x) => x.method === method && x.re.test(path)); if (!r) throw new Err(404, 'Rota não encontrada');
        const m = r.re.exec(path);
        // cada rota tem no máximo um parâmetro (:id ou :slug)
        const c = { method, path, query: query || {}, body: body || {}, params: { id: m[1], slug: m[1] }, status: 200, user: null, est: null };
        if (r.auth) {
          const u = userFor(r.auth); if (!u) throw new Err(401, 'Sessão expirada ou inexistente. Faça login.', 'NAO_AUTENTICADO');
          c.user = u;
          if (r.auth === 'vendedor') { const e = estDe(u); if (!e.ativo) throw new Err(403, 'Estabelecimento suspenso. Fale com o suporte.', 'SUSPENSO'); c.est = e; }
        }
        const out = r.fn(c); return { status: c.status, json: clone(out) };
      } catch (e) {
        if (e instanceof Err) return { status: e.status, json: { erro: e.message, codigo: e.codigo || null } };
        console.error(e); return { status: 500, json: { erro: 'Erro interno da demonstração' } };
      }
    },
  };
})();
