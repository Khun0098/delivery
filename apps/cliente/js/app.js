/* Site do CLIENTE. Não contém nenhuma tela, rota ou chamada de administração. */
(() => {
  'use strict';
  const API = window.APP_CONFIG.API_URL;
  const $app = document.getElementById('app');
  const $topo = document.getElementById('topo');
  const $modal = document.getElementById('modal-root');

  // ---------- utilitários ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch { throw Object.assign(new Error('Sem conexão com o servidor. Verifique sua internet e tente de novo.'), { status: 0 }); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.erro || 'Algo deu errado. Tente novamente.'), { status: res.status, codigo: json.codigo });
    return json;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.getElementById('toasts').append(el);
    setTimeout(() => el.remove(), 4500);
  }

  // ---------- estado ----------
  let user = null;
  let cart = store.get('cart', null); // { slug, estId, estNome, itens: [...] }
  const saveCart = () => { store.set('cart', cart && cart.itens.length ? cart : null); if (!cart?.itens.length) cart = null; renderTopo(); };
  const cartCount = () => (cart ? cart.itens.reduce((s, i) => s + i.quantidade, 0) : 0);
  const cartSubtotal = () => (cart ? cart.itens.reduce((s, i) => s + i.preco_unit * i.quantidade, 0) : 0);

  // ---------- topo ----------
  function renderTopo() {
    $topo.innerHTML = `<div class="topo-in">
      <a class="marca" href="#/"><i></i>Delivery</a>
      <nav aria-label="Principal">
        ${user ? `<a class="nav" href="#/pedidos">Meus pedidos</a><a class="nav" href="#/perfil">${esc(user.nome.split(' ')[0])}</a>`
               : `<a class="nav" href="#/entrar">Entrar</a>`}
        <a class="nav carrinho" href="#/carrinho" aria-label="Carrinho, ${cartCount()} itens">Carrinho<b>${cartCount()}</b></a>
      </nav></div>`;
  }

  // ---------- tempo real (somente os pedidos deste cliente) ----------
  let es = null;
  const pedidoListeners = new Set();
  function conectarEventos() {
    if (es || !user) return;
    es = new EventSource(API + '/cliente/eventos', { withCredentials: true });
    es.addEventListener('pedido.atualizado', (e) => {
      const p = JSON.parse(e.data);
      pedidoListeners.forEach((fn) => fn(p));
      toast(`Pedido ${p.codigo}: ${p.status_label}`);
    });
  }
  function desconectarEventos() { if (es) es.close(); es = null; }

  // ---------- roteador ----------
  const rotas = [
    [/^#\/?$/, home], [/^#\/loja\/([\w-]+)$/, loja], [/^#\/carrinho$/, carrinho], [/^#\/checkout$/, checkout],
    [/^#\/entrar$/, entrar], [/^#\/pedidos$/, pedidos], [/^#\/pedido\/(\d+)$/, pedido], [/^#\/perfil$/, perfil],
  ];
  async function rotear() {
    pedidoListeners.clear();
    closeModal();
    const hash = location.hash.split('?')[0] || '#/';
    for (const [re, fn] of rotas) {
      const m = re.exec(hash);
      if (m) {
        try { await fn(...m.slice(1)); } catch (e) { $app.innerHTML = `<div class="wrap"><div class="vazio"><b>Não foi possível carregar</b>${esc(e.message)}<p><button class="btn" data-act="recarregar">Tentar de novo</button></p></div></div>`; }
        window.scrollTo(0, 0);
        return;
      }
    }
    $app.innerHTML = `<div class="wrap"><div class="vazio"><b>Página não encontrada</b><a class="btn" href="#/">Ir para o início</a></div></div>`;
  }
  const exigeLogin = () => { if (user) return false; store.set('next', location.hash); location.hash = '#/entrar'; return true; };

  // ---------- início ----------
  async function home() {
    let q = '', cat = '';
    const carregar = async () => {
      const data = await api('GET', `/public/estabelecimentos?q=${encodeURIComponent(q)}&categoria=${encodeURIComponent(cat)}`);
      const lista = document.getElementById('lista');
      document.getElementById('chips').innerHTML = [['', 'Todos'], ...data.categorias.map((c) => [c, c])]
        .map(([v, t]) => `<button class="chip" data-cat="${esc(v)}" aria-pressed="${cat === v}">${esc(t)}</button>`).join('');
      lista.innerHTML = data.estabelecimentos.length ? data.estabelecimentos.map(cardLoja).join('')
        : `<div class="vazio" style="grid-column:1/-1"><b>Nada encontrado</b>Tente outro nome, categoria ou produto.</div>`;
    };
    $app.innerHTML = `<section class="hero"><div class="hero-in">
        <h1>Pediu, chegou, <em>gelou!</em></h1>
        <p>Escolha o estabelecimento, monte o pedido do seu jeito e acompanhe cada etapa até a sua porta.</p>
        <form class="busca" id="busca" role="search"><label class="sr" for="q">Buscar estabelecimentos ou produtos</label>
          <input id="q" type="search" placeholder="Busque por loja ou produto: açaí, pizza…" autocomplete="off"><button>Buscar</button></form>
      </div></section>
      <div class="wrap"><div class="chips" id="chips" role="group" aria-label="Categorias"></div>
      <h2 class="titulo">Estabelecimentos</h2><div class="lojas" id="lista"></div></div>`;
    document.getElementById('busca').onsubmit = (e) => { e.preventDefault(); q = document.getElementById('q').value.trim(); carregar(); };
    document.getElementById('chips').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { cat = b.dataset.cat; carregar(); } };
    await carregar();
  }
  function statusTexto(s) {
    if (s.aberto) return '<span class="sel aberto">Aberto</span>';
    if (s.abre_as) return `<span class="sel fechado">Fechado · abre ${s.abre_hoje ? 'às' : DIAS[s.abre_dia] + ' às'} ${esc(s.abre_as)}</span>`;
    return '<span class="sel fechado">Fechado no momento</span>';
  }
  const logoHtml = (e) => (safeUrl(e.logo_url) ? `<img class="logo" src="${esc(e.logo_url)}" alt="">` : `<div class="logo" aria-hidden="true">${esc(e.nome[0])}</div>`);
  const cardLoja = (e) => `<a class="loja-card ${e.status.aberto ? '' : 'fechada'}" href="#/loja/${esc(e.slug)}">${logoHtml(e)}
      <div><h3>${esc(e.nome)}</h3><div class="meta">${esc(e.categoria)} · ${e.tempo_min}–${e.tempo_max} min · ${e.taxa_entrega ? brl(e.taxa_entrega) : 'Entrega grátis'}</div>${statusTexto(e.status)}</div></a>`;

  // ---------- loja e cardápio ----------
  async function loja(slug) {
    const data = await api('GET', `/public/estabelecimentos/${encodeURIComponent(slug)}`);
    const e = data.estabelecimento;
    document.title = `${e.nome} – Delivery`;
    const render = (filtro = '') => {
      const f = filtro.toLowerCase();
      const cats = data.categorias.map((c) => ({ ...c, produtos: c.produtos.filter((p) => !f || p.nome.toLowerCase().includes(f) || p.descricao.toLowerCase().includes(f)) })).filter((c) => c.produtos.length);
      document.getElementById('cardapio').innerHTML = cats.length ? cats.map((c) => `<h2 class="titulo" id="c${c.id}">${esc(c.nome)}</h2><div class="produtos">${c.produtos.map(cardProduto).join('')}</div>`).join('')
        : `<div class="vazio"><b>Nenhum item encontrado</b>Tente buscar por outro nome.</div>`;
    };
    const cardProduto = (p) => `<button class="prod" data-prod="${p.id}"><div class="col"><div><h3>${esc(p.nome)}</h3><p>${esc(p.descricao)}</p>${p.restrito_18 ? '<span class="r18">Venda proibida para menores de 18 anos</span>' : ''}</div>
        <div class="preco ${p.preco_original ? '' : 'normal'}">${p.grupos.some((g) => g.minimo > 0) && !p.preco_original ? 'A partir de ' : ''}${brl(p.preco)}${p.preco_original ? `<s>${brl(p.preco_original)}</s>` : ''}</div></div>
        ${safeUrl(p.imagem_url) ? `<img src="${esc(p.imagem_url)}" alt="" loading="lazy">` : `<div class="ph" aria-hidden="true">${esc(p.nome[0])}</div>`}</button>`;

    $app.innerHTML = `<div class="loja-cab"><div class="in">${logoHtml(e)}<div><h1>${esc(e.nome)}</h1>
        <div class="meta">${esc(e.categoria)} · ${e.tempo_min}–${e.tempo_max} min · ${e.taxa_entrega ? 'Taxa ' + brl(e.taxa_entrega) : 'Entrega grátis'} · Pedido mínimo ${brl(e.pedido_minimo)}</div>${statusTexto(e.status)}</div></div></div>
      ${e.status.aberto ? '' : `<div class="aviso"><div>Loja fechada${e.status.abre_as ? ` · abre ${e.status.abre_hoje ? 'hoje' : DIAS[e.status.abre_dia]} às ${esc(e.status.abre_as)}` : ''}. Você pode ver o cardápio, mas só consegue pedir quando ela abrir.</div></div>`}
      <div class="wrap"><div class="cat-nav"><label class="sr" for="mq">Buscar no cardápio</label><input id="mq" class="menu-busca" type="search" placeholder="Buscar no cardápio"></div><div id="cardapio"></div></div>`;
    render();
    document.getElementById('mq').oninput = (ev) => render(ev.target.value.trim());
    $app.onclick = (ev) => {
      const b = ev.target.closest('[data-prod]');
      if (!b) return;
      const prod = data.categorias.flatMap((c) => c.produtos).find((p) => p.id === Number(b.dataset.prod));
      abrirProduto(prod, e);
    };
  }

  // ---------- modal de produto ----------
  function closeModal() { $modal.innerHTML = ''; document.body.style.overflow = ''; }
  function abrirProduto(p, est) {
    const sel = new Map(p.grupos.map((g) => [g.id, new Set()]));
    let qtd = 1;
    const unit = () => p.preco + p.grupos.reduce((s, g) => s + g.opcoes.filter((o) => sel.get(g.id).has(o.id)).reduce((a, o) => a + o.preco_adicional, 0), 0);
    const okGrupos = () => p.grupos.every((g) => sel.get(g.id).size >= g.minimo);
    const aberto = est.status.aberto;
    const draw = () => {
      const obs = document.getElementById('obs')?.value || '';
      $modal.innerHTML = `<div class="overlay" data-fechar><div class="modal ${safeUrl(p.imagem_url) ? '' : 'sem-foto'}" role="dialog" aria-modal="true" aria-label="${esc(p.nome)}">
        <button class="fechar" data-fechar aria-label="Fechar">✕</button>
        <div class="foto">${safeUrl(p.imagem_url) ? `<img src="${esc(p.imagem_url)}" alt="">` : ''}</div>
        <div class="corpo"><div class="rolagem"><h2>${esc(p.nome)}</h2><p class="meta">${esc(p.descricao)}</p>
          <div class="preco ${p.preco_original ? '' : 'normal'}">${brl(p.preco)}${p.preco_original ? `<s>${brl(p.preco_original)}</s>` : ''}</div>
          ${p.grupos.map((g) => { const n = sel.get(g.id).size; return `<div class="grupo-t"><div><b>${esc(g.titulo)}</b><small>${g.maximo === 1 ? 'Escolha 1 opção' : `Escolha até ${g.maximo} opções`}</small></div>
            ${g.minimo > 0 ? `<span class="badge ${n >= g.minimo ? 'ok' : ''}">${n}/${g.maximo} · obrigatório</span>` : `<span class="badge">${n}/${g.maximo}</span>`}</div>
            ${g.opcoes.map((o) => `<div class="opcao ${g.maximo > 1 ? 'multi' : ''}" role="${g.maximo > 1 ? 'checkbox' : 'radio'}" tabindex="0" aria-checked="${sel.get(g.id).has(o.id)}" data-g="${g.id}" data-o="${o.id}">
              <div class="t">${esc(o.nome)}${o.preco_adicional ? ` <span class="mais">+ ${brl(o.preco_adicional)}</span>` : ''}</div>${safeUrl(o.imagem_url) ? `<img src="${esc(o.imagem_url)}" alt="">` : ''}<span class="marca-op">✓</span></div>`).join('')}`; }).join('')}
          <div class="grupo-t"><div><b>Algum comentário?</b></div><small id="cont">0 / 140</small></div>
          <textarea id="obs" maxlength="140" placeholder="Ex.: sem granola, calda à parte…">${esc(obs)}</textarea>
        </div><div class="rodape"><div class="qtd"><button data-q="-1" aria-label="Menos">−</button><span aria-live="polite">${qtd}</span><button data-q="1" aria-label="Mais">+</button></div>
          <button class="btn" id="add" ${okGrupos() && aberto ? '' : 'disabled'}><span>${aberto ? 'Adicionar' : 'Loja fechada'}</span><span>${brl(unit() * qtd)}</span></button></div></div></div></div>`;
      document.body.style.overflow = 'hidden';
      const ta = document.getElementById('obs'); document.getElementById('cont').textContent = `${ta.value.length} / 140`;
      ta.oninput = () => { document.getElementById('cont').textContent = `${ta.value.length} / 140`; };
    };
    draw();
    const toggle = (gid, oid) => {
      const g = p.grupos.find((x) => x.id === gid), s = sel.get(gid);
      if (s.has(oid)) s.delete(oid);
      else if (g.maximo === 1) { s.clear(); s.add(oid); }
      else if (s.size < g.maximo) s.add(oid);
      else return toast(`Você já escolheu ${g.maximo} em "${g.titulo}"`);
      const scroll = document.querySelector('.rolagem').scrollTop; draw(); document.querySelector('.rolagem').scrollTop = scroll;
    };
    $modal.onclick = (ev) => {
      if (ev.target.closest('[data-fechar]') && (ev.target.classList.contains('overlay') || ev.target.classList.contains('fechar'))) return closeModal();
      const op = ev.target.closest('.opcao'); if (op) return toggle(Number(op.dataset.g), Number(op.dataset.o));
      const q = ev.target.closest('[data-q]'); if (q) { qtd = Math.min(50, Math.max(1, qtd + Number(q.dataset.q))); const sc = document.querySelector('.rolagem').scrollTop; draw(); document.querySelector('.rolagem').scrollTop = sc; return; }
      if (ev.target.closest('#add') && !document.getElementById('add').disabled) {
        if (cart && cart.estId !== est.id && !confirm(`Seu carrinho tem itens de ${cart.estNome}. Deseja esvaziá-lo e começar um pedido em ${est.nome}?`)) return;
        if (!cart || cart.estId !== est.id) cart = { slug: est.slug, estId: est.id, estNome: est.nome, itens: [] };
        const opcoes = p.grupos.flatMap((g) => g.opcoes.filter((o) => sel.get(g.id).has(o.id)).map((o) => ({ id: o.id, nome: o.nome, preco_adicional: o.preco_adicional })));
        const observacao = document.getElementById('obs').value.trim();
        const key = [p.id, opcoes.map((o) => o.id).sort().join('.'), observacao].join('|');
        const ex = cart.itens.find((i) => i.key === key);
        if (ex) ex.quantidade = Math.min(50, ex.quantidade + qtd);
        else cart.itens.push({ key, produto_id: p.id, nome: p.nome, preco_unit: unit(), quantidade: qtd, opcoes, observacao });
        saveCart(); closeModal(); toast('Adicionado ao carrinho');
      }
    };
    $modal.onkeydown = (ev) => {
      if (ev.key === 'Escape') closeModal();
      const op = ev.target.closest?.('.opcao'); if (op && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); toggle(Number(op.dataset.g), Number(op.dataset.o)); document.querySelector(`[data-g="${op.dataset.g}"][data-o="${op.dataset.o}"]`)?.focus(); }
    };
  }

  // ---------- carrinho ----------
  async function carrinho() {
    if (!cart) { $app.innerHTML = `<div class="wrap"><div class="vazio"><b>Seu carrinho está vazio</b>Escolha um estabelecimento e adicione itens.<p><a class="btn" href="#/">Ver estabelecimentos</a></p></div></div>`; return; }
    $app.innerHTML = `<div class="wrap"><h2 class="titulo">Seu pedido em ${esc(cart.estNome)}</h2><div class="duas"><div class="painel">
      ${cart.itens.map((i, idx) => `<div class="item-c"><div class="t"><b>${esc(i.nome)}</b>${i.opcoes.map((o) => `<small>${esc(o.nome)}${o.preco_adicional ? ' + ' + brl(o.preco_adicional) : ''}</small>`).join('')}${i.observacao ? `<small>Obs.: ${esc(i.observacao)}</small>` : ''}
        <div class="qtd" style="display:inline-flex;margin-top:8px"><button data-ci="${idx}" data-d="-1" aria-label="Menos">−</button><span>${i.quantidade}</span><button data-ci="${idx}" data-d="1" aria-label="Mais">+</button></div>
        <button class="chip" data-rm="${idx}" style="margin-left:8px">Remover</button></div><b>${brl(i.preco_unit * i.quantidade)}</b></div>`).join('')}
      <p><a href="#/loja/${esc(cart.slug)}">+ Adicionar mais itens</a></p></div>
      <div class="painel"><h2>Resumo</h2><div class="linha"><span>Subtotal</span><b>${brl(cartSubtotal())}</b></div><div class="linha total"><span>Total parcial</span><span>${brl(cartSubtotal())}</span></div>
      <p class="meta">Taxa de entrega e forma de pagamento são definidas na próxima etapa.</p><a class="btn lima" href="#/checkout" style="width:100%;justify-content:center">Continuar para o pagamento</a></div></div></div>`;
    $app.onclick = (ev) => {
      const m = ev.target.closest('[data-ci]'), r = ev.target.closest('[data-rm]');
      if (m) { const it = cart.itens[Number(m.dataset.ci)]; it.quantidade = Math.min(50, Math.max(1, it.quantidade + Number(m.dataset.d))); saveCart(); carrinho(); }
      if (r) { cart.itens.splice(Number(r.dataset.rm), 1); saveCart(); carrinho(); }
    };
  }

  // ---------- checkout ----------
  async function checkout() {
    if (exigeLogin()) return;
    if (!cart) { location.hash = '#/carrinho'; return; }
    const [{ estabelecimento: est, formas_pagamento }, { enderecos }] = await Promise.all([api('GET', `/public/estabelecimentos/${encodeURIComponent(cart.slug)}`), api('GET', '/cliente/enderecos')]);
    let tipo = 'entrega', forma = formas_pagamento[0].id, endId = enderecos[0]?.id || null;
    const taxa = () => (tipo === 'entrega' ? est.taxa_entrega : 0);
    const draw = () => {
      const erro = document.getElementById('erro')?.innerHTML || '';
      const eh = est.aceita_retirada;
      $app.innerHTML = `<div class="wrap"><h2 class="titulo">Finalizar pedido</h2><div class="duas"><div>
        <div class="painel"><h2>Como você quer receber?</h2>
          <label class="escolha"><input type="radio" name="tipo" value="entrega" ${tipo === 'entrega' ? 'checked' : ''}><span><b>Entrega</b><br><small class="meta">${est.tempo_min}–${est.tempo_max} min · ${est.taxa_entrega ? brl(est.taxa_entrega) : 'grátis'}</small></span></label>
          ${eh ? `<label class="escolha"><input type="radio" name="tipo" value="retirada" ${tipo === 'retirada' ? 'checked' : ''}><span><b>Retirar no local</b><br><small class="meta">${esc(est.endereco || 'Endereço informado pela loja')}</small></span></label>` : ''}</div>
        ${tipo === 'entrega' ? `<div class="painel"><h2>Endereço de entrega</h2>${enderecos.map((a) => `<label class="escolha"><input type="radio" name="end" value="${a.id}" ${a.id === endId ? 'checked' : ''}><span><b>${esc(a.apelido)}</b><br>${esc(a.rua)}, ${esc(a.numero)}${a.complemento ? ' – ' + esc(a.complemento) : ''}<br><small class="meta">${esc(a.bairro)} · ${esc(a.cidade)}</small></span></label>`).join('')}
          <details ${enderecos.length ? '' : 'open'}><summary><b>Adicionar novo endereço</b></summary><form id="fend" style="margin-top:12px">
            <div class="grade2"><label class="campo"><span>Rua</span><input name="rua" required maxlength="120"></label><label class="campo"><span>Número</span><input name="numero" required maxlength="12"></label></div>
            <div class="grade2"><label class="campo"><span>Bairro</span><input name="bairro" required maxlength="80"></label><label class="campo"><span>Cidade</span><input name="cidade" required maxlength="80"></label></div>
            <div class="grade2"><label class="campo"><span>Complemento</span><input name="complemento" maxlength="60"></label><label class="campo"><span>Referência</span><input name="referencia" maxlength="120"></label></div>
            <button class="btn fantasma" type="submit">Salvar endereço</button></form></details></div>` : ''}
        <div class="painel"><h2>Pagamento</h2>${formas_pagamento.map((f) => `<label class="escolha"><input type="radio" name="forma" value="${f.id}" ${f.id === forma ? 'checked' : ''}><span><b>${esc(f.label)}</b>${f.online ? '<br><small class="meta">Pague agora; o pedido segue para a loja assim que for confirmado.</small>' : ''}</span></label>`).join('')}
          ${forma === 'dinheiro' ? `<label class="campo"><span>Troco para (opcional)</span><input id="troco" inputmode="decimal" placeholder="Ex.: 50,00"></label>` : ''}</div>
        <div class="painel"><label class="campo"><span>Observação para a loja (opcional)</span><textarea id="obsped" maxlength="300" rows="2"></textarea></label></div></div>
        <div class="painel"><h2>Resumo</h2>${cart.itens.map((i) => `<div class="linha"><span>${i.quantidade}× ${esc(i.nome)}</span><span>${brl(i.preco_unit * i.quantidade)}</span></div>`).join('')}
          <div class="linha"><span>Subtotal</span><span>${brl(cartSubtotal())}</span></div><div class="linha"><span>Entrega</span><span>${taxa() ? brl(taxa()) : 'Grátis'}</span></div>
          <div class="linha total"><span>Total</span><span>${brl(cartSubtotal() + taxa())}</span></div>
          ${cartSubtotal() < est.pedido_minimo ? `<div class="erro">Pedido mínimo de ${brl(est.pedido_minimo)}. Adicione mais itens.</div>` : ''}
          ${est.status.aberto ? '' : '<div class="erro">Esta loja está fechada no momento.</div>'}
          <div id="erro" aria-live="assertive">${erro}</div>
          <button class="btn lima" id="fin" style="width:100%;justify-content:center" ${est.status.aberto && cartSubtotal() >= est.pedido_minimo && (tipo === 'retirada' || endId) ? '' : 'disabled'}>Finalizar pedido</button></div></div></div>`;
      $app.querySelectorAll('input[name=tipo]').forEach((i) => (i.onchange = () => { tipo = i.value; draw(); }));
      $app.querySelectorAll('input[name=end]').forEach((i) => (i.onchange = () => { endId = Number(i.value); }));
      $app.querySelectorAll('input[name=forma]').forEach((i) => (i.onchange = () => { forma = i.value; draw(); }));
      const fend = document.getElementById('fend');
      if (fend) fend.onsubmit = async (ev) => {
        ev.preventDefault();
        try { const r = await api('POST', '/cliente/enderecos', Object.fromEntries(new FormData(fend))); enderecos.push(r.endereco); endId = r.endereco.id; draw(); }
        catch (e) { document.getElementById('erro').innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
      };
      document.getElementById('fin').onclick = async () => {
        const btn = document.getElementById('fin'); btn.disabled = true;
        const trocoTxt = document.getElementById('troco')?.value.trim();
        const troco = trocoTxt ? Math.round(parseFloat(trocoTxt.replace(/\./g, '').replace(',', '.')) * 100) : null;
        try {
          const r = await api('POST', '/cliente/pedidos', {
            estabelecimento_id: cart.estId, tipo_entrega: tipo, endereco_id: tipo === 'entrega' ? endId : undefined, forma_pagamento: forma,
            troco_para: Number.isFinite(troco) ? troco : undefined, observacao: document.getElementById('obsped').value.trim() || undefined,
            itens: cart.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, observacao: i.observacao || undefined, opcoes: i.opcoes.map((o) => o.id) })),
          });
          cart = null; saveCart(); location.hash = `#/pedido/${r.pedido.id}`;
        } catch (e) {
          if (e.status === 401) { user = null; renderTopo(); return exigeLogin(); }
          document.getElementById('erro').innerHTML = `<div class="erro">${esc(e.message)}</div>`; btn.disabled = false;
        }
      };
    };
    draw();
  }

  // ---------- acompanhamento ----------
  const FLUXO = { entrega: [['novo', 'Pedido enviado à loja'], ['preparando', 'Em preparo'], ['pronto', 'Pronto'], ['em_entrega', 'Saiu para entrega'], ['entregue', 'Entregue']],
    retirada: [['novo', 'Pedido enviado à loja'], ['preparando', 'Em preparo'], ['pronto', 'Pronto para retirada'], ['entregue', 'Retirado']] };
  function etapasHtml(p) {
    const fluxo = FLUXO[p.tipo_entrega]; const idx = fluxo.findIndex(([s]) => s === p.status);
    const feitoAte = p.status === 'entregue' ? fluxo.length : idx;
    return `<ol class="etapas">${fluxo.map(([s, t], i) => `<li class="${i < feitoAte ? 'feito' : i === feitoAte ? 'atual' : ''}"><span class="bolha">${i < feitoAte ? '✓' : ''}</span><span>${esc(t)}</span></li>`).join('')}</ol>`;
  }
  function pedidoHtml(p) {
    const ruim = ['recusado', 'cancelado'].includes(p.status);
    return `<div class="wrap"><p><a href="#/pedidos">← Meus pedidos</a></p><h2 class="titulo">Pedido ${esc(p.codigo)} <span class="status-pill ${ruim ? 'ruim' : p.status === 'entregue' ? 'bom' : ''}">${esc(p.status_label)}</span></h2>
      <div class="duas"><div>
        ${p.status === 'aguardando_pagamento' ? `<div class="painel"><h2>Pague com Pix</h2><p>Copie o código abaixo e pague no app do seu banco. O pedido é enviado à loja assim que o pagamento for confirmado.</p><div class="pix" id="pix">${esc(p.pix_payload)}</div>
          <button class="btn" data-act="copiar">Copiar código</button> <button class="btn fantasma" data-act="cancelar">Cancelar pedido</button>
          ${String(p.pix_payload).startsWith('TESTE-PIX') ? `<p class="meta">Ambiente de testes: <button class="btn fantasma" data-act="simular">Simular pagamento</button></p>` : ''}</div>` : ''}
        ${ruim ? `<div class="painel"><div class="erro">${p.status === 'recusado' ? 'A loja não pôde aceitar o pedido' : 'Pedido cancelado'}${p.motivo ? `: ${esc(p.motivo)}` : ''}.${p.pagamento_status === 'estornar' ? ' O valor pago será estornado.' : ''}</div></div>`
          : p.status === 'aguardando_pagamento' ? '' : `<div class="painel"><h2>Acompanhamento</h2>${etapasHtml(p)}${p.status === 'novo' ? '<p class="meta">Aguardando a loja aceitar o pedido.</p>' : ''}
            ${p.status === 'novo' ? '<button class="btn fantasma" data-act="cancelar">Cancelar pedido</button>' : ''}</div>`}
        <div class="painel"><h2>${p.estabelecimento.nome ? esc(p.estabelecimento.nome) : 'Loja'}</h2>${p.estabelecimento.telefone ? `<p class="meta">Dúvidas? Fale com a loja: ${esc(p.estabelecimento.telefone)}</p>` : ''}
          ${p.itens.map((i) => `<div class="item-c"><div class="t"><b>${i.quantidade}× ${esc(i.nome)}</b>${i.opcoes.map((o) => `<small>${esc(o.nome)}</small>`).join('')}${i.observacao ? `<small>Obs.: ${esc(i.observacao)}</small>` : ''}</div><b>${brl(i.total)}</b></div>`).join('')}</div></div>
      <div class="painel"><h2>Pagamento</h2><div class="linha"><span>Subtotal</span><span>${brl(p.subtotal)}</span></div><div class="linha"><span>Entrega</span><span>${p.taxa_entrega ? brl(p.taxa_entrega) : 'Grátis'}</span></div>
        <div class="linha total"><span>Total</span><span>${brl(p.total)}</span></div><p class="meta">${esc(p.forma_pagamento_label)} · ${p.pagamento_status === 'pago' ? 'Pago' : p.pagamento_status === 'na_entrega' ? 'Pagar na entrega' : p.pagamento_status === 'pendente' ? 'Aguardando pagamento' : esc(p.pagamento_status)}</p>
        ${p.endereco ? `<h2 style="margin-top:16px">Entregar em</h2><p class="meta">${esc(p.endereco.rua)}, ${esc(p.endereco.numero)}${p.endereco.complemento ? ' – ' + esc(p.endereco.complemento) : ''}<br>${esc(p.endereco.bairro)} · ${esc(p.endereco.cidade)}</p>` : ''}</div></div></div>`;
  }
  async function pedido(id) {
    if (exigeLogin()) return;
    let p = (await api('GET', `/cliente/pedidos/${id}`)).pedido;
    const draw = () => { $app.innerHTML = pedidoHtml(p); };
    draw();
    // Atualiza sozinho quando o vendedor muda o status (SSE), sem recarregar.
    pedidoListeners.add((novo) => { if (novo.id === p.id) { p = novo; draw(); } });
    $app.onclick = async (ev) => {
      const a = ev.target.closest('[data-act]')?.dataset.act; if (!a) return;
      try {
        if (a === 'copiar') { await navigator.clipboard?.writeText(p.pix_payload); toast('Código Pix copiado'); }
        if (a === 'simular') { p = (await api('POST', `/cliente/pedidos/${p.id}/pagamento/simular`)).pedido; draw(); }
        if (a === 'cancelar' && confirm('Cancelar este pedido?')) { p = (await api('POST', `/cliente/pedidos/${p.id}/cancelar`)).pedido; draw(); }
      } catch (e) { toast(e.message); }
    };
  }

  async function pedidos() {
    if (exigeLogin()) return;
    const { pedidos: lista } = await api('GET', '/cliente/pedidos');
    $app.innerHTML = `<div class="wrap"><h2 class="titulo">Meus pedidos</h2>${lista.length ? lista.map((p) => `<a class="painel loja-card" style="display:flex;justify-content:space-between" href="#/pedido/${p.id}">
      <div><b>${esc(p.estabelecimento.nome)}</b><div class="meta">${esc(p.codigo)} · ${new Date(p.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${p.itens.reduce((s, i) => s + i.quantidade, 0)} itens</div></div>
      <div style="text-align:right"><b>${brl(p.total)}</b><br><span class="status-pill ${['recusado', 'cancelado'].includes(p.status) ? 'ruim' : p.status === 'entregue' ? 'bom' : ''}">${esc(p.status_label)}</span></div></a>`).join('')
      : `<div class="vazio"><b>Você ainda não fez pedidos</b><a class="btn" href="#/">Ver estabelecimentos</a></div>`}</div>`;
    pedidoListeners.add(() => pedidos());
  }

  // ---------- conta ----------
  async function entrar() {
    let modo = 'login';
    const draw = (erro = '') => {
      $app.innerHTML = `<div class="wrap" style="max-width:460px"><h2 class="titulo">${modo === 'login' ? 'Entrar' : 'Criar conta'}</h2><div class="painel">
        ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}<form id="f">
        ${modo === 'cadastro' ? '<label class="campo"><span>Nome</span><input name="nome" required minlength="2" autocomplete="name"></label><label class="campo"><span>Telefone com DDD</span><input name="telefone" required inputmode="tel" autocomplete="tel" placeholder="11 99999-0000"></label>' : ''}
        <label class="campo"><span>E-mail</span><input name="email" type="email" required autocomplete="email"></label>
        <label class="campo"><span>Senha</span><input name="senha" type="password" required minlength="${modo === 'cadastro' ? 8 : 1}" autocomplete="${modo === 'login' ? 'current-password' : 'new-password'}">${modo === 'cadastro' ? '<small class="meta">Mínimo de 8 caracteres.</small>' : ''}</label>
        <button class="btn lima" style="width:100%;justify-content:center">${modo === 'login' ? 'Entrar' : 'Criar conta'}</button></form>
        <p style="text-align:center"><button class="btn fantasma" id="troca">${modo === 'login' ? 'Não tenho conta' : 'Já tenho conta'}</button></p></div></div>`;
      document.getElementById('troca').onclick = () => { modo = modo === 'login' ? 'cadastro' : 'login'; draw(); };
      document.getElementById('f').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const r = await api('POST', modo === 'login' ? '/cliente/auth/login' : '/cliente/auth/cadastro', Object.fromEntries(new FormData(ev.target)));
          user = r.usuario; renderTopo(); conectarEventos();
          const next = store.get('next', '#/'); store.set('next', null); location.hash = next || '#/';
        } catch (e) { draw(e.message); }
      };
    };
    if (user) { location.hash = '#/'; return; }
    draw();
  }

  async function perfil() {
    if (exigeLogin()) return;
    const draw = (msg = '', erro = '') => {
      $app.innerHTML = `<div class="wrap" style="max-width:560px"><h2 class="titulo">Meu perfil</h2><div class="painel">${msg ? `<p style="color:var(--verde);font-weight:700">${esc(msg)}</p>` : ''}${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
        <form id="f"><label class="campo"><span>Nome</span><input name="nome" required value="${esc(user.nome)}"></label><label class="campo"><span>Telefone</span><input name="telefone" value="${esc(user.telefone || '')}"></label>
        <label class="campo"><span>E-mail</span><input value="${esc(user.email)}" disabled></label>
        <details><summary><b>Alterar senha</b></summary><label class="campo"><span>Senha atual</span><input name="senha_atual" type="password" autocomplete="current-password"></label><label class="campo"><span>Nova senha</span><input name="senha_nova" type="password" minlength="8" autocomplete="new-password"></label></details>
        <p><button class="btn">Salvar alterações</button></p></form><hr style="border:0;border-top:1px solid var(--linha)"><p><button class="btn fantasma" id="sair">Sair da conta</button></p></div></div>`;
      document.getElementById('sair').onclick = async () => { await api('POST', '/cliente/auth/logout').catch(() => {}); user = null; desconectarEventos(); renderTopo(); location.hash = '#/'; };
      document.getElementById('f').onsubmit = async (ev) => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(ev.target)); if (!d.senha_nova) { delete d.senha_nova; delete d.senha_atual; }
        try { await api('PATCH', '/cliente/perfil', d); user = { ...user, nome: d.nome, telefone: d.telefone || null }; renderTopo(); draw('Alterações salvas'); } catch (e) { draw('', e.message); }
      };
    };
    draw();
  }

  // ---------- delegação global ----------
  document.addEventListener('click', (e) => { if (e.target.closest('[data-act="recarregar"]')) rotear(); });
  window.addEventListener('hashchange', rotear);

  (async function iniciar() {
    renderTopo();
    try { user = (await api('GET', '/cliente/auth/me')).usuario; conectarEventos(); } catch { user = null; }
    renderTopo();
    rotear();
  })();
})();
