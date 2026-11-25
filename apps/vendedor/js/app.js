/* Site do VENDEDOR (painel privado). Toda autorização real acontece na API; esta interface só reflete o que o servidor permite. */
(() => {
  'use strict';
  const API = window.APP_CONFIG.API_URL;
  const $shell = document.getElementById('shell');
  const $modal = document.getElementById('modal-root');

  // ---------- utilitários ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const toCents = (s) => { const n = parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
  const inCents = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const FORMAS = { pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro' };

  async function api(method, path, body) {
    let res;
    try { res = await fetch(API + path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw Object.assign(new Error('Sem conexão com o servidor.'), { status: 0 }); }
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && me) { me = null; desconectar(); location.hash = '#/login'; }
    if (!res.ok) throw Object.assign(new Error(json.erro || 'Algo deu errado.'), { status: res.status, codigo: json.codigo });
    return json;
  }
  function toast(msg) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    document.getElementById('toasts').append(el); setTimeout(() => el.remove(), 6000);
  }

  // ---------- campainha (exclusiva deste painel) ----------
  const bell = {
    ctx: null, timer: null, onchange: () => {},
    init() {
      if (this.ctx) return;
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.ctx.onstatechange = () => this.onchange(); } catch { this.ctx = null; }
    },
    get pronta() { return !!this.ctx && this.ctx.state === 'running'; },
    async liberar() { this.init(); try { await this.ctx.resume(); } catch { /* precisa de gesto do usuário */ } this.onchange(); },
    nota(freq, t, dur) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = freq; o.connect(g); g.connect(this.ctx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    },
    tocar() {
      if (!this.pronta) return;
      const t = this.ctx.currentTime;
      [[880, 0], [1175, 0.2], [880, 0.5], [1175, 0.7]].forEach(([f, d]) => this.nota(f, t + d, 0.22));
    },
    /** Toca repetidamente enquanto houver pedido aguardando aceite. */
    sincronizar(pendentes) {
      if (pendentes > 0 && !this.timer) { this.tocar(); this.timer = setInterval(() => this.tocar(), 4000); }
      if (pendentes === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
    },
  };
  document.addEventListener('click', () => { if (me && !bell.pronta) bell.liberar(); }, { capture: true });

  // ---------- estado ----------
  let me = null;               // { usuario, estabelecimento }
  let loja = null;             // dados da loja e status de funcionamento
  const pedidos = new Map();   // pedidos ativos (novo, preparando, pronto, em_entrega)
  let es = null, conectado = false;
  const ATIVOS = ['novo', 'preparando', 'pronto', 'em_entrega'];
  const pendentes = () => [...pedidos.values()].filter((p) => p.status === 'novo').length;

  function aplicarPedido(p) {
    if (ATIVOS.includes(p.status)) pedidos.set(p.id, p); else pedidos.delete(p.id);
    sincronizarUI();
  }
  function sincronizarUI() {
    const n = pendentes();
    bell.sincronizar(n);
    document.title = n ? `(${n}) Novo pedido! – Painel` : 'Painel do vendedor';
    const c = document.getElementById('cnt-pedidos'); if (c) { c.textContent = n; c.hidden = !n; }
    if (location.hash.startsWith('#/pedidos')) desenharCentral();
    if (location.hash === '#/' || location.hash === '') carregarDashboardSilencioso();
  }
  async function recarregarAtivos() {
    const { pedidos: lista } = await api('GET', '/vendedor/pedidos?modo=ativos');
    pedidos.clear(); lista.forEach((p) => pedidos.set(p.id, p)); sincronizarUI();
  }
  function conectar() {
    if (es || !me) return;
    es = new EventSource(API + '/vendedor/eventos', { withCredentials: true });
    es.addEventListener('conectado', () => { conectado = true; marcarConexao(); recarregarAtivos().catch(() => {}); }); // ao (re)conectar, recupera o que passou
    es.addEventListener('pedido.novo', (e) => { const p = JSON.parse(e.data); aplicarPedido(p); toast(`Novo pedido ${p.codigo} · ${brl(p.total)}`); });
    es.addEventListener('pedido.atualizado', (e) => aplicarPedido(JSON.parse(e.data)));
    es.onerror = () => { conectado = false; marcarConexao(); };
  }
  function desconectar() { if (es) es.close(); es = null; conectado = false; bell.sincronizar(0); pedidos.clear(); }
  function marcarConexao() { const el = document.getElementById('conexao'); if (el) { el.className = 'conexao' + (conectado ? ' on' : ''); el.lastChild.textContent = conectado ? 'Recebendo pedidos em tempo real' : 'Reconectando…'; } }

  // ---------- modais ----------
  const fechar = () => { $modal.innerHTML = ''; $modal.onclick = null; };
  function modal({ titulo, corpo, rodape = '', largo = false }) {
    $modal.innerHTML = `<div class="overlay" data-x><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" ${largo ? 'style="width:min(860px,100%)"' : ''}><header><h2>${esc(titulo)}</h2><button class="btn peq" data-x aria-label="Fechar">✕</button></header><div class="corpo">${corpo}</div><footer>${rodape}</footer></div></div>`;
    $modal.firstElementChild.addEventListener('click', (e) => { if (e.target.hasAttribute('data-x') && (e.target.classList.contains('overlay') || e.target.tagName === 'BUTTON')) fechar(); });
    document.onkeydown = (e) => { if (e.key === 'Escape') fechar(); };
  }
  function pedirTexto({ titulo, label, valor = '', opcoes = null }) {
    return new Promise((ok) => {
      modal({ titulo, corpo: `<form id="pt">${opcoes ? `<label class="campo"><span>Motivo</span><select id="sel">${opcoes.map((o) => `<option>${esc(o)}</option>`).join('')}<option value="">Outro (escrever abaixo)</option></select></label>` : ''}
        <label class="campo"><span>${esc(label)}</span><input id="txt" value="${esc(valor)}" maxlength="200" ${opcoes ? '' : 'required'}></label><button hidden></button></form>`,
        rodape: '<button class="btn" id="nao">Cancelar</button><button class="btn prim" id="sim">Confirmar</button>' });
      const fim = (v) => { fechar(); ok(v); };
      document.getElementById('nao').onclick = () => fim(null);
      const conf = () => { const t = document.getElementById('txt').value.trim(); const s = document.getElementById('sel')?.value; const v = t || s; if (v && v.length >= 3) fim(v); else document.getElementById('txt').focus(); };
      document.getElementById('sim').onclick = conf; document.getElementById('pt').onsubmit = (e) => { e.preventDefault(); conf(); };
      document.getElementById('txt').focus();
    });
  }

  // ---------- roteador ----------
  const TITULOS = { '#/': 'Visão geral', '#/pedidos': 'Central de pedidos', '#/cardapio': 'Cardápio', '#/loja': 'Loja e horários', '#/financeiro': 'Financeiro' };
  async function rotear() {
    fechar();
    const hash = location.hash || '#/';
    if (!me) { if (hash !== '#/login') { location.hash = '#/login'; return; } return telaLogin(); }
    if (hash === '#/login') { location.hash = '#/'; return; }
    if (!document.getElementById('conteudo')) desenharShell();
    document.querySelectorAll('.lateral a[href]').forEach((a) => { if (a.getAttribute('href') === hash) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.getElementById('titulo').textContent = TITULOS[hash] || 'Painel';
    const rota = { '#/': telaDashboard, '#/pedidos': telaPedidos, '#/cardapio': telaCardapio, '#/loja': telaLoja, '#/financeiro': telaFinanceiro }[hash];
    try { await (rota || telaDashboard)(); } catch (e) {
      const alvo = document.getElementById('conteudo'); // pode já não existir se a pessoa saiu da conta durante o carregamento
      if (alvo && me) alvo.innerHTML = `<div class="erro">${esc(e.message)}</div>`;
    }
  }

  // ---------- login ----------
  function telaLogin(erro = '') {
    $shell.innerHTML = `<div class="login"><div class="cartao"><h1>Painel do vendedor</h1><p>Acesso exclusivo para estabelecimentos cadastrados.</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}<form id="f"><label class="campo"><span>E-mail</span><input name="email" type="email" required autocomplete="username" autofocus></label>
      <label class="campo"><span>Senha</span><input name="senha" type="password" required autocomplete="current-password"></label><button class="btn prim" style="width:100%">Entrar</button></form>
      <p style="margin-top:16px;font-size:.85rem">Ainda não tem acesso? Fale com o administrador da plataforma.</p></div></div>`;
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('POST', '/vendedor/auth/login', Object.fromEntries(new FormData(ev.target)));
        await iniciarSessao(); location.hash = '#/pedidos'; rotear();
      } catch (e) { telaLogin(e.message); }
    };
  }
  async function iniciarSessao() {
    me = await api('GET', '/vendedor/auth/me');
    bell.init(); conectar(); await recarregarAtivos();
  }

  // ---------- estrutura ----------
  function desenharShell() {
    $shell.innerHTML = `<div class="app"><nav class="lateral" aria-label="Principal"><div class="nome">${esc(me.estabelecimento.nome)}</div><div class="sub">${esc(me.usuario.nome)}</div>
      <a href="#/">Visão geral</a><a href="#/pedidos">Pedidos <span class="cnt" id="cnt-pedidos" hidden>0</span></a><a href="#/cardapio">Cardápio</a><a href="#/loja">Loja e horários</a><a href="#/financeiro">Financeiro</a>
      <a class="fim" href="#/sair" id="sair">Sair</a></nav>
      <div class="barra"><h1 id="titulo"></h1><div class="conexao" id="conexao"><i></i><span>Conectando…</span></div>
        <label class="interruptor"><input type="checkbox" id="aberto"><span class="trilho"></span><span id="aberto-t">Loja</span></label></div>
      <main><div id="faixa"></div><div id="conteudo"></div></main></div>`;
    document.getElementById('sair').onclick = async (e) => { e.preventDefault(); await api('POST', '/vendedor/auth/logout').catch(() => {}); me = null; desconectar(); location.hash = '#/login'; };
    document.getElementById('aberto').onchange = async (e) => {
      try { await api('POST', '/vendedor/loja/aberto', { aberto: e.target.checked }); await atualizarLoja(); } catch (er) { toast(er.message); await atualizarLoja(); }
    };
    bell.onchange = faixaSom; faixaSom(); marcarConexao(); atualizarLoja(); sincronizarUI();
  }
  function faixaSom() {
    const el = document.getElementById('faixa'); if (!el) return;
    el.innerHTML = bell.pronta ? '' : `<div class="faixa-som">🔕 O som de novos pedidos está desativado neste navegador. <button class="btn prim" id="som">Ativar alerta sonoro</button></div>`;
    const b = document.getElementById('som'); if (b) b.onclick = () => { bell.liberar().then(() => bell.tocar()); };
  }
  async function atualizarLoja() {
    loja = await api('GET', '/vendedor/loja');
    const cb = document.getElementById('aberto'); if (!cb) return;
    cb.checked = loja.loja.aberto_manual;
    const s = loja.status;
    document.getElementById('aberto-t').textContent = s.aberto ? 'Aberta para pedidos' : s.motivo === 'pausado' ? 'Pausada (não recebe pedidos)' : s.abre_as ? `Fora do horário · abre às ${s.abre_as}` : 'Fora do horário';
    document.getElementById('aberto').title = 'Ligada: a loja recebe pedidos dentro do horário. Desligada: pausa os pedidos agora.';
  }

  // ---------- dashboard ----------
  async function telaDashboard() {
    const d = await api('GET', '/vendedor/dashboard');
    document.getElementById('conteudo').innerHTML = `<div class="kpis">
      <a class="kpi ${d.pendentes ? 'alerta' : ''}" href="#/pedidos"><small>Aguardando aceite</small><b>${d.pendentes}</b></a>
      <a class="kpi" href="#/pedidos"><small>Em andamento</small><b>${d.em_andamento}</b></a>
      <div class="kpi"><small>Pedidos recebidos hoje</small><b>${d.recebidos_hoje}</b></div>
      <div class="kpi"><small>Faturamento de hoje (entregues)</small><b>${brl(d.faturamento_hoje)}</b></div>
      <div class="kpi"><small>Ticket médio</small><b>${brl(d.ticket_medio_hoje)}</b></div>
      <div class="kpi"><small>Recusados e cancelados hoje</small><b>${d.cancelados_hoje}</b></div></div>
      <div class="cartao"><h2>Funcionamento</h2><p>${d.status.aberto ? '<span class="pill verde">Aberta para pedidos</span>' : `<span class="pill verm">Fechada para pedidos</span> ${d.status.motivo === 'pausado' ? 'Você pausou a loja. Use a chave no topo para reabrir.' : ''}`}</p>
      <p class="det">Os clientes só conseguem pedir quando a loja está aberta. Ajuste os horários em <a href="#/loja"><b>Loja e horários</b></a>.</p></div>`;
  }
  async function carregarDashboardSilencioso() { try { if (document.querySelector('.kpis')) await telaDashboard(); } catch { /* ignora */ } }

  // ---------- central de pedidos ----------
  let aba = 'ativos';
  async function telaPedidos() {
    document.getElementById('conteudo').innerHTML = `<div style="display:flex;gap:8px;margin-bottom:14px"><button class="btn peq" data-aba="ativos">Em aberto</button><button class="btn peq" data-aba="historico">Histórico de hoje</button></div><div id="central"></div>`;
    document.getElementById('conteudo').onclick = clique;
    await desenharCentral();
  }
  async function desenharCentral() {
    const alvo = document.getElementById('central'); if (!alvo) return;
    document.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('prim', b.dataset.aba === aba));
    if (aba === 'historico') {
      const { pedidos: lista } = await api('GET', '/vendedor/pedidos?modo=historico');
      alvo.innerHTML = lista.length ? `<div class="cartao"><table><thead><tr><th>Código</th><th>Hora</th><th>Cliente</th><th>Pagamento</th><th class="n">Total</th><th>Situação</th></tr></thead><tbody>${lista.map((p) => `<tr><td><b>${esc(p.codigo)}</b></td><td>${hora(p.criado_em)}</td><td>${esc(p.cliente_nome)}</td><td>${esc(FORMAS[p.forma_pagamento])}</td><td class="n">${brl(p.total)}</td><td>${esc(p.status_label)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Nenhum pedido hoje até agora.</div>';
      return;
    }
    const por = (s) => [...pedidos.values()].filter((p) => p.status === s).sort((a, b) => a.id - b.id);
    const col = (cls, titulo, lista) => `<section class="col ${cls}" aria-label="${titulo}"><h2>${titulo}<span>${lista.length}</span></h2><div class="lista">${lista.length ? lista.map(cartao).join('') : '<div class="vazio">Sem pedidos</div>'}</div></section>`;
    alvo.innerHTML = `<div class="colunas">${col('novos', 'Novos', por('novo'))}${col('', 'Em preparo', por('preparando'))}${col('', 'Prontos', por('pronto'))}${col('', 'Em entrega', por('em_entrega'))}</div>`;
  }
  function cartao(p) {
    const acoes = {
      novo: `<button class="btn ok" data-st="preparando" data-id="${p.id}">Aceitar</button><button class="btn perigo" data-rec="${p.id}">Recusar</button>`,
      preparando: `<button class="btn prim" data-st="pronto" data-id="${p.id}">Marcar como pronto</button><button class="btn perigo peq" data-can="${p.id}">Cancelar</button>`,
      pronto: p.tipo_entrega === 'entrega' ? `<button class="btn prim" data-st="em_entrega" data-id="${p.id}">Saiu para entrega</button>` : `<button class="btn ok" data-st="entregue" data-id="${p.id}">Entregue ao cliente</button>`,
      em_entrega: `<button class="btn ok" data-st="entregue" data-id="${p.id}">Confirmar entrega</button><button class="btn perigo peq" data-can="${p.id}">Cancelar</button>`,
    }[p.status] || '';
    const a = p.endereco;
    return `<article class="pedido ${p.status === 'novo' ? 'novo' : ''}"><div class="topo"><span class="cod">${esc(p.codigo)}</span><span class="t">${hora(p.criado_em)} · ${p.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}</span></div>
      <div class="det"><b>${esc(p.cliente_nome)}</b> · ${esc(p.cliente_telefone)}</div>
      <ul>${p.itens.map((i) => `<li><b>${i.quantidade}× ${esc(i.nome)}</b>${i.opcoes.map((o) => `<small>+ ${esc(o.nome)}</small>`).join('')}${i.observacao ? `<small>Obs.: ${esc(i.observacao)}</small>` : ''}</li>`).join('')}</ul>
      ${p.observacao ? `<div class="det">Observação: <b>${esc(p.observacao)}</b></div>` : ''}
      ${a ? `<div class="det">${esc(a.rua)}, ${esc(a.numero)}${a.complemento ? ' – ' + esc(a.complemento) : ''} · ${esc(a.bairro)}${a.referencia ? ` (${esc(a.referencia)})` : ''}</div>` : ''}
      <div class="det"><b>${brl(p.total)}</b> · ${esc(FORMAS[p.forma_pagamento])} ${p.pagamento_status === 'pago' ? '<span class="pill verde">Pago</span>' : '<span class="pill ambar">Cobrar na entrega</span>'}${p.troco_para ? ` · troco para ${brl(p.troco_para)}` : ''}</div>
      <div class="acoes">${acoes}</div></article>`;
  }
  async function mudar(id, status, motivo) {
    try { const { pedido } = await api('POST', `/vendedor/pedidos/${id}/status`, { status, motivo }); aplicarPedido(pedido); }
    catch (e) { toast(e.message); recarregarAtivos().catch(() => {}); }
  }
  async function clique(ev) {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.aba) { aba = t.dataset.aba; return desenharCentral(); }
    if (t.dataset.st) return mudar(Number(t.dataset.id), t.dataset.st);
    if (t.dataset.rec) { const m = await pedirTexto({ titulo: 'Recusar pedido', label: 'Detalhe (opcional se escolher um motivo)', opcoes: ['Sem estoque de um item', 'Loja sem capacidade no momento', 'Fora da área de entrega', 'Fechando em breve'] }); if (m) mudar(Number(t.dataset.rec), 'recusado', m); }
    if (t.dataset.can) { const m = await pedirTexto({ titulo: 'Cancelar pedido', label: 'Motivo do cancelamento' }); if (m) mudar(Number(t.dataset.can), 'cancelado', m); }
  }

  // ---------- cardápio ----------
  async function telaCardapio() {
    const render = async () => {
      const { categorias } = await api('GET', '/vendedor/cardapio');
      document.getElementById('conteudo').innerHTML = `<div style="display:flex;gap:8px;margin-bottom:6px"><button class="btn prim" data-nova-cat>+ Nova categoria</button></div>
        ${categorias.length ? categorias.map((c) => `<div class="cat-t"><h2>${esc(c.nome)} ${c.ativa ? '' : '<span class="pill">oculta</span>'}</h2><button class="btn peq" data-prod-novo="${c.id}">+ Produto</button><button class="btn peq" data-cat-ren="${c.id}" data-nome="${esc(c.nome)}">Renomear</button><button class="btn peq perigo" data-cat-del="${c.id}">Excluir</button></div>
          ${c.produtos.length ? c.produtos.map((p) => `<div class="linha-prod ${p.ativo ? '' : 'off'}">${safeUrl(p.imagem_url) ? `<img src="${esc(p.imagem_url)}" alt="">` : `<div class="ph">${esc(p.nome[0])}</div>`}
            <div><b>${esc(p.nome)}</b><small>${p.grupos.length ? p.grupos.length + ' grupo(s) de adicionais' : 'Sem adicionais'}${p.restrito_18 ? ' · +18' : ''}</small></div>
            <label class="sr" for="pr${p.id}">Preço de ${esc(p.nome)}</label><input class="preco-edit" id="pr${p.id}" data-preco="${p.id}" value="${inCents(p.preco)}" inputmode="decimal">
            <label class="interruptor"><input type="checkbox" data-ativo="${p.id}" ${p.ativo ? 'checked' : ''}><span class="trilho"></span><span class="sr">Disponível</span></label>
            <span style="display:flex;gap:6px"><button class="btn peq" data-edit="${p.id}">Editar</button><button class="btn peq perigo" data-del="${p.id}">Excluir</button></span></div>`).join('') : '<div class="vazio">Nenhum produto nesta categoria.</div>'}`).join('')
          : '<div class="vazio">Seu cardápio está vazio. Crie uma categoria para começar.</div>'}`;
      const cont = document.getElementById('conteudo'); cont._cats = categorias;
    };
    await render();
    const cont = document.getElementById('conteudo');
    const achar = (id) => cont._cats.flatMap((c) => c.produtos).find((p) => p.id === id);
    cont.onchange = async (e) => {
      try {
        if (e.target.dataset.ativo) await api('PATCH', `/vendedor/produtos/${e.target.dataset.ativo}`, { ativo: e.target.checked });
        if (e.target.dataset.preco) { const c = toCents(e.target.value); if (!Number.isFinite(c) || c < 0) { toast('Preço inválido'); return render(); } await api('PATCH', `/vendedor/produtos/${e.target.dataset.preco}`, { preco: c }); toast('Preço atualizado'); }
        await render();
      } catch (er) { toast(er.message); render(); }
    };
    cont.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if ('novaCat' in b.dataset) { const n = await pedirTexto({ titulo: 'Nova categoria', label: 'Nome da categoria' }); if (n) { await api('POST', '/vendedor/categorias', { nome: n }); await render(); } }
        if (b.dataset.catRen) { const n = await pedirTexto({ titulo: 'Renomear categoria', label: 'Nome', valor: b.dataset.nome }); if (n) { await api('PATCH', `/vendedor/categorias/${b.dataset.catRen}`, { nome: n }); await render(); } }
        if (b.dataset.catDel && confirm('Excluir esta categoria?')) { await api('DELETE', `/vendedor/categorias/${b.dataset.catDel}`); await render(); }
        if (b.dataset.del && confirm('Excluir este produto? Pedidos antigos continuam guardados.')) { await api('DELETE', `/vendedor/produtos/${b.dataset.del}`); await render(); }
        if (b.dataset.edit) editor(achar(Number(b.dataset.edit)), cont._cats, render);
        if (b.dataset.prodNovo) editor(null, cont._cats, render, Number(b.dataset.prodNovo));
      } catch (er) { toast(er.message); }
    };
  }

  function editor(p, cats, depois, catId) {
    const g = p ? JSON.parse(JSON.stringify(p.grupos)) : [];
    const opHtml = (o, gi, oi) => `<div class="op-ed"><input aria-label="Nome da opção" data-gi="${gi}" data-oi="${oi}" data-k="nome" value="${esc(o.nome)}" maxlength="80" placeholder="Nome (ex.: Granola)">
      <input aria-label="Preço adicional" data-gi="${gi}" data-oi="${oi}" data-k="preco" value="${inCents(o.preco_adicional)}" inputmode="decimal" placeholder="0,00">
      <label class="interruptor"><input type="checkbox" data-gi="${gi}" data-oi="${oi}" data-k="ativo" ${o.ativo === false || o.ativo === 0 ? '' : 'checked'}><span class="trilho"></span><span class="sr">Ativa</span></label>
      <button class="btn peq perigo" type="button" data-rm-op="${gi}.${oi}" aria-label="Remover opção">✕</button></div>`;
    const gruposHtml = () => g.map((x, gi) => `<div class="grupo-ed"><div class="grade g3"><label class="campo" style="grid-column:span 3"><span>Nome do grupo (ex.: Caldas)</span><input data-gk="titulo" data-gi="${gi}" value="${esc(x.titulo)}" maxlength="80"></label>
      <label class="campo"><span>Mínimo de escolhas</span><input data-gk="minimo" data-gi="${gi}" type="number" min="0" max="50" value="${x.minimo}"></label>
      <label class="campo"><span>Máximo de escolhas</span><input data-gk="maximo" data-gi="${gi}" type="number" min="1" max="50" value="${x.maximo}"></label>
      <label class="campo"><span>Instrução ao cliente</span><input data-gk="descricao" data-gi="${gi}" value="${esc(x.descricao || '')}" maxlength="120"></label></div>
      <div class="det">Opções (preço adicional zero = grátis)</div>${x.opcoes.map((o, oi) => opHtml(o, gi, oi)).join('')}
      <button class="btn peq" type="button" data-add-op="${gi}">+ Opção</button> <button class="btn peq perigo" type="button" data-rm-g="${gi}">Remover grupo</button></div>`).join('');
    const corpo = () => `<div id="ed-erro"></div><div class="grade g2"><label class="campo" style="grid-column:span 2"><span>Nome do produto</span><input id="e-nome" value="${esc(p?.nome || '')}" maxlength="120" required></label>
      <label class="campo"><span>Categoria</span><select id="e-cat">${cats.map((c) => `<option value="${c.id}" ${c.id === (p?.categoria_id ?? catId) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>Preço (R$)</span><input id="e-preco" value="${inCents(p?.preco)}" inputmode="decimal" placeholder="0,00"></label>
      <label class="campo"><span>Preço original, se estiver em promoção (R$)</span><input id="e-orig" value="${inCents(p?.preco_original)}" inputmode="decimal"></label>
      <label class="campo"><span>Imagem (endereço)</span><input id="e-img" value="${esc(p?.imagem_url || '')}" placeholder="https://…"></label>
      <label class="campo" style="grid-column:span 2"><span>Descrição</span><textarea id="e-desc" rows="2" maxlength="600">${esc(p?.descricao || '')}</textarea></label>
      <label class="campo"><span>Ou envie uma imagem (PNG, JPG ou WEBP, até 2,5 MB)</span><input id="e-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div><label class="interruptor"><input type="checkbox" id="e-ativo" ${p?.ativo === false ? '' : 'checked'}><span class="trilho"></span>Disponível para pedidos</label><br><br>
      <label class="interruptor"><input type="checkbox" id="e-r18" ${p?.restrito_18 ? 'checked' : ''}><span class="trilho"></span>Venda proibida para menores de 18</label></div></div>
      <h3>Adicionais e opções</h3><div id="grupos">${gruposHtml()}</div><button class="btn" type="button" id="add-g">+ Grupo de opções</button>`;
    modal({ titulo: p ? `Editar: ${p.nome}` : 'Novo produto', corpo: corpo(), largo: true, rodape: '<button class="btn" id="cancela">Cancelar</button><button class="btn prim" id="salva">Salvar produto</button>' });
    const raiz = $modal;
    const redraw = () => { document.getElementById('grupos').innerHTML = gruposHtml(); };
    raiz.oninput = raiz.onchange = (e) => {
      const d = e.target.dataset;
      if (d.gk) g[d.gi][d.gk] = ['minimo', 'maximo'].includes(d.gk) ? Number(e.target.value) : e.target.value;
      if (d.k) { const o = g[d.gi].opcoes[d.oi]; if (d.k === 'nome') o.nome = e.target.value; if (d.k === 'preco') o.preco_adicional = toCents(e.target.value || '0'); if (d.k === 'ativo') o.ativo = e.target.checked; }
    };
    raiz.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (b.id === 'add-g') { g.push({ titulo: '', descricao: '', minimo: 0, maximo: 1, opcoes: [{ nome: '', preco_adicional: 0, ativo: true }] }); redraw(); }
      if (d.addOp) { g[d.addOp].opcoes.push({ nome: '', preco_adicional: 0, ativo: true }); redraw(); }
      if (d.rmOp) { const [gi, oi] = d.rmOp.split('.').map(Number); g[gi].opcoes.splice(oi, 1); redraw(); }
      if (d.rmG) { g.splice(Number(d.rmG), 1); redraw(); }
      if (b.id === 'cancela') fechar();
      if (b.id === 'salva') salvar();
    });
    document.getElementById('e-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
      try { const r = await api('POST', '/vendedor/upload', { data: url }); document.getElementById('e-img').value = r.url; toast('Imagem enviada'); } catch (er) { toast(er.message); }
    };
    async function salvar() {
      const preco = toCents(document.getElementById('e-preco').value), origTxt = document.getElementById('e-orig').value.trim();
      const body = {
        categoria_id: Number(document.getElementById('e-cat').value), nome: document.getElementById('e-nome').value, descricao: document.getElementById('e-desc').value,
        preco, preco_original: origTxt ? toCents(origTxt) : null, imagem_url: document.getElementById('e-img').value.trim() || null,
        ativo: document.getElementById('e-ativo').checked, restrito_18: document.getElementById('e-r18').checked,
        grupos: g.map((x) => ({ titulo: x.titulo, descricao: x.descricao, minimo: x.minimo, maximo: x.maximo, opcoes: x.opcoes.map((o) => ({ nome: o.nome, preco_adicional: Number.isFinite(o.preco_adicional) ? o.preco_adicional : 0, imagem_url: o.imagem_url || null, ativo: o.ativo !== false && o.ativo !== 0 })) })),
      };
      if (!Number.isFinite(preco) || preco < 0) return (document.getElementById('ed-erro').innerHTML = '<div class="erro">Informe um preço válido, como 14,90.</div>');
      try { await api(p ? 'PUT' : 'POST', p ? `/vendedor/produtos/${p.id}` : '/vendedor/produtos', body); fechar(); toast('Produto salvo'); depois(); }
      catch (e) { document.getElementById('ed-erro').innerHTML = `<div class="erro">${esc(e.message)}</div>`; document.querySelector('.modal .corpo').scrollTop = 0; }
    }
  }

  // ---------- loja e horários ----------
  async function telaLoja() {
    await atualizarLoja();
    const l = loja.loja; const hs = loja.horarios.map((h) => ({ ...h }));
    const horasHtml = () => hs.map((h, i) => `<div class="grade g4" style="align-items:end;margin-bottom:6px"><label class="campo" style="margin:0"><span>Dia</span><select data-h="${i}" data-k="dia_semana">${DIAS.map((d, n) => `<option value="${n}" ${n === h.dia_semana ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="campo" style="margin:0"><span>Abre</span><input type="time" data-h="${i}" data-k="abre" value="${esc(h.abre)}"></label><label class="campo" style="margin:0"><span>Fecha</span><input type="time" data-h="${i}" data-k="fecha" value="${esc(h.fecha)}"></label>
      <button class="btn peq perigo" data-rm-h="${i}">Remover</button></div>`).join('') || '<div class="det">Sem horários: a loja fica aberta sempre que a chave do topo estiver ligada.</div>';
    document.getElementById('conteudo').innerHTML = `<div class="cartao"><h2>Dados da loja</h2><div id="l-erro"></div><form id="fl"><div class="grade g2">
      <label class="campo"><span>Nome</span><input name="nome" value="${esc(l.nome)}" required maxlength="80"></label><label class="campo"><span>Telefone (WhatsApp)</span><input name="telefone" value="${esc(l.telefone || '')}"></label>
      <label class="campo" style="grid-column:span 2"><span>Descrição</span><input name="descricao" value="${esc(l.descricao)}" maxlength="300"></label>
      <label class="campo" style="grid-column:span 2"><span>Endereço</span><input name="endereco" value="${esc(l.endereco)}" maxlength="200"></label>
      <label class="campo"><span>Logo (endereço da imagem)</span><input name="logo_url" value="${esc(l.logo_url || '')}"></label><label class="campo"><span>Banner (endereço da imagem)</span><input name="banner_url" value="${esc(l.banner_url || '')}"></label>
      <label class="campo"><span>Pedido mínimo (R$)</span><input name="pedido_minimo" value="${inCents(l.pedido_minimo)}" inputmode="decimal"></label><label class="campo"><span>Taxa de entrega (R$)</span><input name="taxa_entrega" value="${inCents(l.taxa_entrega)}" inputmode="decimal"></label>
      <label class="campo"><span>Tempo mínimo (min)</span><input name="tempo_min" type="number" min="1" value="${l.tempo_min}"></label><label class="campo"><span>Tempo máximo (min)</span><input name="tempo_max" type="number" min="1" value="${l.tempo_max}"></label></div>
      <label class="interruptor"><input type="checkbox" name="aceita_retirada" ${l.aceita_retirada ? 'checked' : ''}><span class="trilho"></span>Aceitar retirada no local</label><p><button class="btn prim">Salvar dados</button></p></form></div>
      <div class="cartao"><h2>Horário de funcionamento</h2><div id="horas">${horasHtml()}</div><p><button class="btn" id="add-h">+ Adicionar horário</button> <button class="btn prim" id="save-h">Salvar horários</button></p></div>`;
    const c = document.getElementById('conteudo');
    document.getElementById('fl').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const v = (k) => f.get(k);
      try {
        await api('PATCH', '/vendedor/loja', { nome: v('nome'), descricao: v('descricao'), telefone: v('telefone') || null, endereco: v('endereco'), logo_url: v('logo_url') || null, banner_url: v('banner_url') || null,
          pedido_minimo: toCents(v('pedido_minimo') || '0'), taxa_entrega: toCents(v('taxa_entrega') || '0'), tempo_min: Number(v('tempo_min')), tempo_max: Number(v('tempo_max')), aceita_retirada: f.has('aceita_retirada') });
        toast('Dados salvos'); await atualizarLoja(); me.estabelecimento.nome = v('nome'); document.querySelector('.lateral .nome').textContent = v('nome');
      } catch (er) { document.getElementById('l-erro').innerHTML = `<div class="erro">${esc(er.message)}</div>`; }
    };
    c.onchange = (e) => { const d = e.target.dataset; if (d.h !== undefined) hs[d.h][d.k] = d.k === 'dia_semana' ? Number(e.target.value) : e.target.value; };
    c.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'add-h') { hs.push({ dia_semana: 1, abre: '09:00', fecha: '18:00' }); document.getElementById('horas').innerHTML = horasHtml(); }
      if (b.dataset.rmH !== undefined) { hs.splice(Number(b.dataset.rmH), 1); document.getElementById('horas').innerHTML = horasHtml(); }
      if (b.id === 'save-h') { try { await api('PUT', '/vendedor/horarios', { horarios: hs }); toast('Horários salvos'); await atualizarLoja(); } catch (er) { toast(er.message); } }
    };
  }

  // ---------- financeiro ----------
  async function telaFinanceiro() {
    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    let de = hoje.slice(0, 8) + '01', ate = hoje;
    const carregar = async () => {
      const f = await api('GET', `/vendedor/financeiro?de=${de}&ate=${ate}`);
      const max = Math.max(1, ...f.por_dia.map((d) => d.total));
      document.getElementById('res').innerHTML = `<div class="kpis"><div class="kpi"><small>Faturamento</small><b>${brl(f.faturamento)}</b></div><div class="kpi"><small>Pedidos entregues</small><b>${f.pedidos}</b></div><div class="kpi"><small>Ticket médio</small><b>${brl(f.ticket_medio)}</b></div><div class="kpi"><small>Taxas de entrega</small><b>${brl(f.taxas)}</b></div><div class="kpi"><small>Cancelados e recusados</small><b>${f.cancelados}</b></div></div>
        <div class="cartao"><h2>Faturamento por dia</h2>${f.por_dia.length ? `<div class="barras">${f.por_dia.map((d) => `<div title="${d.dia}: ${brl(d.total)}"><span style="height:${Math.max(2, (d.total / max) * 120)}px"></span>${d.dia.slice(8)}</div>`).join('')}</div>` : '<div class="vazio">Sem vendas no período.</div>'}</div>
        <div class="grade g2"><div class="cartao"><h2>Por forma de pagamento</h2><table><tbody>${f.por_forma.map((x) => `<tr><td>${esc(FORMAS[x.forma_pagamento])}</td><td class="n">${x.pedidos} ped.</td><td class="n">${brl(x.total)}</td></tr>`).join('') || '<tr><td class="vazio">—</td></tr>'}</tbody></table></div>
        <div class="cartao"><h2>Mais vendidos</h2><table><tbody>${f.top_produtos.map((x) => `<tr><td>${esc(x.nome)}</td><td class="n">${x.quantidade} un.</td><td class="n">${brl(x.total)}</td></tr>`).join('') || '<tr><td class="vazio">—</td></tr>'}</tbody></table></div></div>`;
    };
    document.getElementById('conteudo').innerHTML = `<div class="cartao"><form id="ff" class="grade g3" style="align-items:end"><label class="campo" style="margin:0"><span>De</span><input type="date" name="de" value="${de}"></label><label class="campo" style="margin:0"><span>Até</span><input type="date" name="ate" value="${ate}"></label><button class="btn prim">Atualizar</button></form></div><div id="res"></div>`;
    document.getElementById('ff').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); de = f.get('de'); ate = f.get('ate'); carregar().catch((er) => toast(er.message)); };
    await carregar();
  }

  window.addEventListener('hashchange', rotear);
  (async function iniciar() {
    try { await iniciarSessao(); } catch { me = null; }
    rotear();
  })();
})();
