/* Ambiente do ADMINISTRADOR GERAL. Separado dos sites do cliente e do vendedor; a autorização real é feita na API. */
(() => {
  'use strict';
  const API = window.APP_CONFIG.API_URL;
  const $ = document.getElementById('shell');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dt = (i) => new Date(i).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  let me = null;

  async function api(method, path, body) {
    const res = await fetch(API + path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error('Sem conexão com o servidor.'); });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 && me) { me = null; location.hash = '#/login'; }
    if (!res.ok) throw new Error(j.erro || 'Algo deu errado.');
    return j;
  }
  const toast = (m) => { const e = document.createElement('div'); e.className = 'toast'; e.textContent = m; document.getElementById('toasts').append(e); setTimeout(() => e.remove(), 4000); };

  const ABAS = [['#/', 'Resumo'], ['#/lojas', 'Estabelecimentos'], ['#/vendedores', 'Vendedores'], ['#/pedidos', 'Pedidos'], ['#/auditoria', 'Auditoria']];
  function casca(html) {
    const h = location.hash || '#/';
    $.innerHTML = `<header class="topo"><b>Administração da plataforma</b><span class="aviso">Ambiente restrito</span><nav class="abas" aria-label="Seções">${ABAS.map(([a, t]) => `<a href="${a}" ${a === h ? 'aria-current="page"' : ''}>${t}</a>`).join('')}<button id="sair">Sair</button></nav></header><main>${html}</main>`;
    document.getElementById('sair').onclick = async () => { await api('POST', '/admin/auth/logout').catch(() => {}); me = null; location.hash = '#/login'; rotear(); };
  }

  function login(erro = '') {
    $.innerHTML = `<div class="login"><div class="cartao"><h2>Administração</h2>${erro ? `<div class="erro">${esc(erro)}</div>` : ''}<form id="f"><label class="campo"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="campo"><span>Senha</span><input name="senha" type="password" required autocomplete="current-password"></label><button class="btn prim" style="width:100%">Entrar</button></form></div></div>`;
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      try { me = (await api('POST', '/admin/auth/login', Object.fromEntries(new FormData(e.target)))).usuario; location.hash = '#/'; rotear(); } catch (er) { login(er.message); }
    };
  }

  async function rotear() {
    const h = location.hash || '#/';
    if (!me) { if (h !== '#/login') { location.hash = '#/login'; return; } return login(); }
    if (h === '#/login') { location.hash = '#/'; return; }
    try {
      if (h === '#/') { const r = await api('GET', '/admin/resumo'); casca(`<div class="kpis"><div class="kpi"><small>Estabelecimentos ativos</small><b>${r.estabelecimentos.ativos ?? 0}/${r.estabelecimentos.n}</b></div><div class="kpi"><small>Vendedores</small><b>${r.vendedores}</b></div><div class="kpi"><small>Clientes</small><b>${r.clientes}</b></div><div class="kpi"><small>Pedidos hoje</small><b>${r.pedidos_hoje.n}</b></div><div class="kpi"><small>Volume hoje</small><b>${brl(r.pedidos_hoje.total)}</b></div></div>`); }
      else if (h === '#/lojas') await lojas();
      else if (h === '#/vendedores') await vendedores();
      else if (h === '#/pedidos') { const { pedidos } = await api('GET', '/admin/pedidos'); casca(`<div class="cartao"><h2>Últimos pedidos (todas as lojas)</h2><table><thead><tr><th>Código</th><th>Loja</th><th>Data</th><th>Situação</th><th>Pagamento</th><th>Total</th></tr></thead><tbody>${pedidos.map((p) => `<tr><td><b>${esc(p.codigo)}</b></td><td>${esc(p.estabelecimento)}</td><td>${dt(p.criado_em)}</td><td>${esc(p.status)}</td><td>${esc(p.forma_pagamento)} · ${esc(p.pagamento_status)}</td><td>${brl(p.total)}</td></tr>`).join('')}</tbody></table></div>`); }
      else if (h === '#/auditoria') { const { registros } = await api('GET', '/admin/auditoria'); casca(`<div class="cartao"><h2>Registro de ações</h2><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th><th>IP</th></tr></thead><tbody>${registros.map((r) => `<tr><td>${dt(r.criado_em)}</td><td>${esc(r.tipo || '—')} ${r.usuario_id ?? ''}</td><td>${esc(r.acao)}</td><td>${esc(r.detalhe || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>`); }
      else { location.hash = '#/'; }
    } catch (e) { casca(`<div class="erro">${esc(e.message)}</div>`); }
  }

  async function lojas() {
    const { estabelecimentos } = await api('GET', '/admin/estabelecimentos');
    casca(`<div class="cartao"><h2>Cadastrar estabelecimento e seu primeiro vendedor</h2><div id="erro"></div><form id="f"><div class="g2">
      <label class="campo"><span>Nome do estabelecimento</span><input name="nome" required maxlength="80"></label><label class="campo"><span>Categoria</span><input name="categoria" value="Outros" maxlength="40"></label>
      <label class="campo"><span>Nome do vendedor</span><input name="vnome" required></label><label class="campo"><span>E-mail de acesso</span><input name="vemail" type="email" required></label>
      <label class="campo"><span>Senha inicial (mínimo 8 caracteres)</span><input name="vsenha" type="password" minlength="8" required autocomplete="new-password"></label></div><button class="btn prim">Cadastrar</button></form></div>
      <div class="cartao"><h2>Estabelecimentos</h2><table><thead><tr><th>Nome</th><th>Identificador</th><th>Categoria</th><th>Vendedores</th><th>Pedidos</th><th>Situação</th><th></th></tr></thead><tbody>${estabelecimentos.map((e) => `<tr><td><b>${esc(e.nome)}</b></td><td>${esc(e.slug)}</td><td>${esc(e.categoria)}</td><td>${e.vendedores}</td><td>${e.pedidos}</td><td><span class="pill ${e.ativo ? 'ok' : 'ruim'}">${e.ativo ? 'Ativo' : 'Suspenso'}</span></td>
      <td><button class="btn peq ${e.ativo ? 'perigo' : ''}" data-id="${e.id}" data-ativo="${e.ativo ? 0 : 1}">${e.ativo ? 'Suspender' : 'Reativar'}</button></td></tr>`).join('')}</tbody></table></div>`);
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
      try { await api('POST', '/admin/estabelecimentos', { nome: d.nome, categoria: d.categoria, vendedor: { nome: d.vnome, email: d.vemail, senha: d.vsenha } }); toast('Estabelecimento cadastrado'); lojas(); }
      catch (e) { document.getElementById('erro').innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
    };
    document.querySelector('main').onclick = async (ev) => {
      const b = ev.target.closest('[data-id]'); if (!b) return;
      const suspender = b.dataset.ativo === '0';
      if (suspender && !confirm('Suspender este estabelecimento? Os vendedores serão desconectados e a loja sairá da busca.')) return;
      try { await api('PATCH', `/admin/estabelecimentos/${b.dataset.id}`, { ativo: !suspender }); lojas(); } catch (e) { toast(e.message); }
    };
  }

  async function vendedores() {
    const [{ vendedores: vs }, { estabelecimentos }] = await Promise.all([api('GET', '/admin/vendedores'), api('GET', '/admin/estabelecimentos')]);
    casca(`<div class="cartao"><h2>Novo vendedor para um estabelecimento existente</h2><div id="erro"></div><form id="f"><div class="g2"><label class="campo"><span>Estabelecimento</span><select name="estabelecimento_id">${estabelecimentos.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')}</select></label>
      <label class="campo"><span>Nome</span><input name="nome" required></label><label class="campo"><span>E-mail</span><input name="email" type="email" required></label><label class="campo"><span>Senha inicial</span><input name="senha" type="password" minlength="8" required autocomplete="new-password"></label></div><button class="btn prim">Criar vendedor</button></form></div>
      <div class="cartao"><h2>Vendedores</h2><table><thead><tr><th>Nome</th><th>E-mail</th><th>Estabelecimento</th><th>Situação</th><th></th></tr></thead><tbody>${vs.map((v) => `<tr><td>${esc(v.nome)}</td><td>${esc(v.email)}</td><td>${esc(v.estabelecimento)}</td><td><span class="pill ${v.ativo ? 'ok' : 'ruim'}">${v.ativo ? 'Ativo' : 'Bloqueado'}</span></td>
      <td><button class="btn peq" data-toggle="${v.id}" data-ativo="${v.ativo ? 0 : 1}">${v.ativo ? 'Bloquear' : 'Desbloquear'}</button> <button class="btn peq" data-senha="${v.id}">Redefinir senha</button></td></tr>`).join('')}</tbody></table></div>`);
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); d.estabelecimento_id = Number(d.estabelecimento_id);
      try { await api('POST', '/admin/vendedores', d); toast('Vendedor criado'); vendedores(); } catch (e) { document.getElementById('erro').innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
    };
    document.querySelector('main').onclick = async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.toggle) { await api('PATCH', `/admin/vendedores/${b.dataset.toggle}`, { ativo: b.dataset.ativo === '1' }); vendedores(); }
        if (b.dataset.senha) { const s = prompt('Nova senha (mínimo 8 caracteres). O vendedor será desconectado:'); if (s) { await api('PATCH', `/admin/vendedores/${b.dataset.senha}`, { senha: s }); toast('Senha redefinida'); } }
      } catch (e) { toast(e.message); }
    };
  }

  window.addEventListener('hashchange', rotear);
  (async () => { try { me = (await api('GET', '/admin/auth/me')).usuario; } catch { me = null; } rotear(); })();
})();
