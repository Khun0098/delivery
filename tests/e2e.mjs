// Testes ponta a ponta: sobem a API real em memória e exercitam segurança, isolamento e tempo real.
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from '../apps/api/src/config.js';
import { openDb } from '../apps/api/src/db.js';
import { createApp } from '../apps/api/src/app.js';
import { seed } from '../scripts/seed.mjs';
import { assinaturaWebhook } from '../apps/api/src/services/payments.js';

const db = openDb(':memory:');
const { estA, estB } = await seed(db, { senhaAdmin: 'Admin#12345', senhaVendedor: 'Vendedor#12345', senhaCliente: 'Cliente#12345' });
db.prepare('DELETE FROM horarios').run(); // sempre aberto durante os testes (o horário é testado à parte)
config.payments.webhookSecret = 'segredo-de-teste';
const LIMITE_PRODUCAO = config.limits.pedidosPor10Min;
config.limits.pedidosPor10Min = 1000; // os testes criam muitos pedidos em sequência
const server = createApp({ db, config });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;

// ---------- utilitários ----------
class Client {
  constructor(area, origin) { this.area = area; this.origin = origin ?? config.origins[area]; this.cookie = ''; }
  async call(method, path, body, { origin = this.origin, noOrigin = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (!noOrigin && origin) headers.Origin = origin;
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (/Max-Age=0/.test(c)) this.cookie = this.cookie.split('; ').filter((x) => !x.startsWith(k + '=')).join('; ');
      else this.cookie = [...this.cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), `${k}=${v}`].join('; ');
    }
    let json = null; try { json = await res.json(); } catch { /* sem corpo */ }
    return { status: res.status, json, headers: res.headers };
  }
  /** Abre um canal SSE e acumula os eventos recebidos. */
  sse(path) {
    const events = []; const waiters = [];
    const req = http.get({ host: '127.0.0.1', port: PORT, path, headers: { Cookie: this.cookie, Origin: this.origin, Accept: 'text/event-stream' } });
    let status = null, buf = '';
    const ready = new Promise((ok) => req.on('response', (res) => {
      status = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!ev) continue;
          const e = { event: ev, data: data ? JSON.parse(data) : null };
          events.push(e);
          waiters.slice().forEach((w) => w(e));
        }
      });
      ok(status);
    }));
    return {
      ready, events, close: () => req.destroy(),
      waitFor: (name, pred = () => true, ms = 2500) => new Promise((ok, fail) => {
        const hit = events.find((e) => e.event === name && pred(e.data));
        if (hit) return ok(hit);
        const t = setTimeout(() => fail(new Error(`Timeout esperando evento "${name}"`)), ms);
        const w = (e) => { if (e.event === name && pred(e.data)) { clearTimeout(t); waiters.splice(waiters.indexOf(w), 1); ok(e); } };
        waiters.push(w);
      }),
    };
  }
}

let passou = 0, falhou = 0;
async function teste(nome, fn) {
  try { await fn(); passou++; console.log('  ✓', nome); } catch (e) { falhou++; console.log("  ✗", nome, "\n     ", e.message.split("\n").slice(0,6).join(" | "), "\n     ", (e.stack.split("\n").find(l=>l.includes("e2e.mjs"))||"")); }
}
const login = async (c, email, senha) => { const r = await c.call('POST', `/${c.area}/auth/login`, { email, senha }); assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.json)}`); return r; };
const cardapioA = async () => (await new Client('cliente').call('GET', '/public/estabelecimentos/acai-papum')).json;

// ---------- clientes ----------
const cli = new Client('cliente'), cli2 = new Client('cliente'), vA = new Client('vendedor'), vB = new Client('vendedor'), adm = new Client('admin');
await login(cli, 'cliente@teste.local', 'Cliente#12345');
await login(vA, 'vendedor@acaipapum.local', 'Vendedor#12345');
await login(vB, 'vendedor@pizzariademo.local', 'Vendedor#12345');
await login(adm, 'admin@delivery.local', 'Admin#12345');
const cad = await cli2.call('POST', '/cliente/auth/cadastro', { nome: 'Outra Pessoa', email: 'outra@teste.local', senha: 'SenhaForte1', telefone: '11988887777' });
assert.equal(cad.status, 201);

const endr = (await cli.call('POST', '/cliente/enderecos', { rua: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP' })).json.endereco;

const menu = await cardapioA();
const acai = menu.categorias[0].produtos.find((p) => p.nome.startsWith('Açaí Artesanal'));
const gGratis = acai.grupos.find((g) => g.titulo === 'Adicionais Grátis');
const gCalda = acai.grupos.find((g) => g.titulo === 'Caldas');
const gExtra = acai.grupos.find((g) => g.titulo.startsWith('Que tal'));
const pedidoBase = (extra = {}) => ({
  estabelecimento_id: menu.estabelecimento.id, tipo_entrega: 'entrega', endereco_id: endr.id, forma_pagamento: 'dinheiro', troco_para: 10000,
  itens: [{ produto_id: acai.id, quantidade: 2, opcoes: [gGratis.opcoes[0].id, gGratis.opcoes[1].id, gExtra.opcoes[0].id] }], ...extra,
});

console.log('\nSeparação de áreas e autorização');

await teste('rotas do vendedor sem login retornam 401', async () => {
  for (const p of ['/vendedor/dashboard', '/vendedor/pedidos', '/vendedor/cardapio', '/vendedor/financeiro', '/admin/resumo', '/cliente/pedidos']) {
    const r = await new Client(p.startsWith('/admin') ? 'admin' : p.startsWith('/cliente') ? 'cliente' : 'vendedor').call('GET', p);
    assert.equal(r.status, 401, p);
  }
});
await teste('sessão de CLIENTE não abre o painel do vendedor nem o admin', async () => {
  const c = new Client('vendedor'); c.cookie = cli.cookie.replace('sid_cliente', 'sid_vendedor'); // tenta reaproveitar o token
  assert.equal((await c.call('GET', '/vendedor/dashboard')).status, 401);
  const a = new Client('admin'); a.cookie = cli.cookie.replace('sid_cliente', 'sid_admin');
  assert.equal((await a.call('GET', '/admin/resumo')).status, 401);
});
await teste('sessão de VENDEDOR não vale nas áreas de cliente e admin', async () => {
  const c = new Client('cliente'); c.cookie = vA.cookie.replace('sid_vendedor', 'sid_cliente');
  assert.equal((await c.call('GET', '/cliente/pedidos')).status, 401);
  const a = new Client('admin'); a.cookie = vA.cookie.replace('sid_vendedor', 'sid_admin');
  assert.equal((await a.call('GET', '/admin/estabelecimentos')).status, 401);
});
await teste('login de vendedor não aceita conta de cliente (e vice-versa)', async () => {
  assert.equal((await new Client('vendedor').call('POST', '/vendedor/auth/login', { email: 'cliente@teste.local', senha: 'Cliente#12345' })).status, 401);
  assert.equal((await new Client('cliente').call('POST', '/cliente/auth/login', { email: 'vendedor@acaipapum.local', senha: 'Vendedor#12345' })).status, 401);
  assert.equal((await new Client('admin').call('POST', '/admin/auth/login', { email: 'vendedor@acaipapum.local', senha: 'Vendedor#12345' })).status, 401);
});
await teste('o painel do vendedor recusa requisições vindas do site do cliente (origem)', async () => {
  const r = await vA.call('GET', '/vendedor/dashboard', undefined, { origin: config.origins.cliente });
  assert.equal(r.status, 403); assert.equal(r.json.codigo, 'ORIGEM');
  const w = await vA.call('POST', '/vendedor/loja/aberto', { aberto: false }, { noOrigin: true }); // escrita sem Origin
  assert.equal(w.status, 403);
});
await teste('CORS só libera as origens cadastradas', async () => {
  const r = await vA.call('GET', '/vendedor/dashboard', undefined, { origin: 'https://site-malicioso.com' });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
await teste('a API pública do cliente não expõe dados sensíveis', async () => {
  const r = await cli.call('GET', '/public/estabelecimentos');
  const txt = JSON.stringify(r.json);
  assert.ok(!/senha|email|vendedor|hash|token/i.test(txt));
});
await teste('força bruta de login é bloqueada (429)', async () => {
  const c = new Client('vendedor'); let ultimo;
  for (let i = 0; i < 10; i++) ultimo = await c.call('POST', '/vendedor/auth/login', { email: 'vendedor@acaipapum.local', senha: 'errada' + i });
  assert.equal(ultimo.status, 429);
});
await teste('logout invalida a sessão no servidor', async () => {
  const c = new Client('cliente'); await login(c, 'cliente@teste.local', 'Cliente#12345');
  const old = c.cookie;
  assert.equal((await c.call('POST', '/cliente/auth/logout')).status, 200);
  const d = new Client('cliente'); d.cookie = old;
  assert.equal((await d.call('GET', '/cliente/auth/me')).status, 401);
});

console.log('\nPedidos, preços e validação no servidor');

await teste('preço enviado pelo cliente é ignorado: total é recalculado no servidor', async () => {
  const body = pedidoBase(); body.itens[0].preco = 1; body.total = 1; body.itens[0].preco_unit = 1;
  const r = await cli.call('POST', '/cliente/pedidos', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  // (14,90 + 2,50) x 2 = 34,80 ; taxa 0
  assert.equal(r.json.pedido.subtotal, 3480); assert.equal(r.json.pedido.total, 3480);
  await cli.call('POST', `/cliente/pedidos/${r.json.pedido.id}/cancelar`);
});
await teste('grupo obrigatório e limite máximo são validados', async () => {
  const semGratis = pedidoBase(); semGratis.itens[0].opcoes = [];
  assert.equal((await cli.call('POST', '/cliente/pedidos', semGratis)).status, 422);
  const demais = pedidoBase(); demais.itens[0].opcoes = gGratis.opcoes.slice(0, 4).map((o) => o.id);
  assert.equal((await cli.call('POST', '/cliente/pedidos', demais)).status, 422);
  const duas = pedidoBase(); duas.itens[0].opcoes = [gGratis.opcoes[0].id, gCalda.opcoes[0].id, gCalda.opcoes[1].id];
  assert.equal((await cli.call('POST', '/cliente/pedidos', duas)).status, 422);
});
await teste('opção de OUTRA loja ou produto de outra loja é rejeitado', async () => {
  const outro = (await new Client('cliente').call('GET', '/public/estabelecimentos/pizzaria-demo')).json.categorias[0].produtos[0];
  const b = pedidoBase(); b.itens = [{ produto_id: outro.id, quantidade: 1 }];
  assert.equal((await cli.call('POST', '/cliente/pedidos', b)).status, 422);
});
await teste('quantidade inválida, carrinho vazio e endereço de terceiros são rejeitados', async () => {
  const q = pedidoBase(); q.itens[0].quantidade = -3;
  assert.equal((await cli.call('POST', '/cliente/pedidos', q)).status, 422);
  assert.equal((await cli.call('POST', '/cliente/pedidos', pedidoBase({ itens: [] }))).status, 422);
  assert.equal((await cli2.call('POST', '/cliente/pedidos', pedidoBase())).status, 422); // endereço pertence ao outro cliente
});
await teste('pedido mínimo e troco são respeitados', async () => {
  const caro = (await cardapioA()).categorias[1].produtos.find((p) => p.nome.startsWith('Coca'));
  const r = await cli.call('POST', '/cliente/pedidos', pedidoBase({ itens: [{ produto_id: caro.id, quantidade: 1 }] }));
  assert.equal(r.status, 422); assert.equal(r.json.codigo, 'MINIMO');
  assert.equal((await cli.call('POST', '/cliente/pedidos', pedidoBase({ troco_para: 100 }))).status, 422);
});
await teste('estabelecimento pausado não recebe pedidos', async () => {
  await vA.call('POST', '/vendedor/loja/aberto', { aberto: false });
  const r = await cli.call('POST', '/cliente/pedidos', pedidoBase());
  assert.equal(r.status, 409); assert.equal(r.json.codigo, 'FECHADO');
  const pub = await cardapioA(); assert.equal(pub.estabelecimento.status.aberto, false);
  await vA.call('POST', '/vendedor/loja/aberto', { aberto: true });
});

console.log('\nTempo real: cliente → vendedor → cliente');

const sseA = vA.sse('/vendedor/eventos'), sseB = vB.sse('/vendedor/eventos'), sseCli = cli.sse('/cliente/eventos'), sseCli2 = cli2.sse('/cliente/eventos');
assert.equal(await sseA.ready, 200); await sseB.ready; await sseCli.ready; await sseCli2.ready;
let pedido;

await teste('pedido finalizado no site do cliente chega sozinho ao painel do vendedor (campainha)', async () => {
  const r = await cli.call('POST', '/cliente/pedidos', pedidoBase());
  assert.equal(r.status, 201); pedido = r.json.pedido;
  assert.equal(pedido.status, 'novo');
  const ev = await sseA.waitFor('pedido.novo', (p) => p.id === pedido.id);
  assert.equal(ev.data.codigo, pedido.codigo);
  assert.equal(ev.data.itens[0].opcoes.length, 3);
  assert.ok(!('pix_payload' in ev.data));
});
await teste('a campainha NÃO toca em outra loja nem no site do cliente', async () => {
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(sseB.events.filter((e) => e.event.startsWith('pedido')).length, 0, 'loja B recebeu evento da loja A');
  assert.equal(sseCli2.events.filter((e) => e.event.startsWith('pedido')).length, 0, 'outro cliente recebeu evento');
  // o canal do vendedor exige sessão de vendedor; o de cliente não serve:
  const c = new Client('vendedor'); c.cookie = cli.cookie.replace('sid_cliente', 'sid_vendedor');
  const s = c.sse('/vendedor/eventos'); assert.equal(await s.ready, 401); s.close();
});
await teste('status só avança por transições válidas', async () => {
  assert.equal((await vA.call('POST', `/vendedor/pedidos/${pedido.id}/status`, { status: 'pronto' })).status, 409);
  assert.equal((await vA.call('POST', `/vendedor/pedidos/${pedido.id}/status`, { status: 'entregue' })).status, 409);
  assert.equal((await vA.call('POST', `/vendedor/pedidos/${pedido.id}/status`, { status: 'recusado' })).status, 422); // sem motivo
});
await teste('mudanças feitas pelo vendedor aparecem automaticamente no acompanhamento do cliente', async () => {
  for (const [st, label] of [['preparando', 'Em preparo'], ['pronto', 'Pronto'], ['em_entrega', 'Saiu para entrega'], ['entregue', 'Entregue']]) {
    const r = await vA.call('POST', `/vendedor/pedidos/${pedido.id}/status`, { status: st });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ev = await sseCli.waitFor('pedido.atualizado', (p) => p.id === pedido.id && p.status === st);
    assert.equal(ev.data.status_label, label);
  }
  const fim = (await cli.call('GET', `/cliente/pedidos/${pedido.id}`)).json.pedido;
  assert.equal(fim.pagamento_status, 'pago');
  assert.deepEqual(fim.historico.map((h) => h.status), ['novo', 'preparando', 'pronto', 'em_entrega', 'entregue']);
});
await teste('recusa exige motivo e o cliente é avisado', async () => {
  const p = (await cli.call('POST', '/cliente/pedidos', pedidoBase())).json.pedido;
  await sseA.waitFor('pedido.novo', (x) => x.id === p.id);
  const r = await vA.call('POST', `/vendedor/pedidos/${p.id}/status`, { status: 'recusado', motivo: 'Sem estoque de açaí' });
  assert.equal(r.status, 200);
  const ev = await sseCli.waitFor('pedido.atualizado', (x) => x.id === p.id && x.status === 'recusado');
  assert.equal(ev.data.motivo, 'Sem estoque de açaí');
});
await teste('cliente cancela enquanto não foi aceito, e não depois', async () => {
  const p = (await cli.call('POST', '/cliente/pedidos', pedidoBase())).json.pedido;
  await sseA.waitFor('pedido.novo', (x) => x.id === p.id);
  await vA.call('POST', `/vendedor/pedidos/${p.id}/status`, { status: 'preparando' });
  assert.equal((await cli.call('POST', `/cliente/pedidos/${p.id}/cancelar`)).status, 409);
  const q = (await cli.call('POST', '/cliente/pedidos', pedidoBase())).json.pedido;
  assert.equal((await cli.call('POST', `/cliente/pedidos/${q.id}/cancelar`)).status, 200);
  await sseA.waitFor('pedido.atualizado', (x) => x.id === q.id && x.status === 'cancelado');
});
await teste('Pix: pedido só chega ao vendedor DEPOIS da confirmação do pagamento', async () => {
  const antes = sseA.events.length;
  const p = (await cli.call('POST', '/cliente/pedidos', pedidoBase({ forma_pagamento: 'pix', troco_para: undefined }))).json.pedido;
  assert.equal(p.status, 'aguardando_pagamento'); assert.ok(p.pix_payload);
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(sseA.events.length, antes, 'vendedor foi avisado antes do pagamento');
  assert.equal((await vA.call('GET', `/vendedor/pedidos/${p.id}`)).status, 404);
  // webhook sem/ com assinatura errada é recusado
  assert.equal((await new Client('x', null).call('POST', '/webhooks/pagamentos', { pedido_codigo: p.codigo, status: 'pago' }, { noOrigin: true })).status, 401);
  const corpo = JSON.stringify({ pedido_codigo: p.codigo, status: 'pago' });
  const ok = await fetch(`http://127.0.0.1:${PORT}/webhooks/pagamentos`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': assinaturaWebhook('segredo-de-teste', corpo) }, body: corpo });
  assert.equal(ok.status, 200);
  const ev = await sseA.waitFor('pedido.novo', (x) => x.id === p.id);
  assert.equal(ev.data.pagamento_status, 'pago');
});

console.log('\nIsolamento entre estabelecimentos e clientes');

await teste('vendedor da loja B não enxerga nem altera pedidos da loja A', async () => {
  assert.equal((await vB.call('GET', `/vendedor/pedidos/${pedido.id}`)).status, 404);
  assert.equal((await vB.call('POST', `/vendedor/pedidos/${pedido.id}/status`, { status: 'cancelado', motivo: 'tentativa' })).status, 404);
  const lista = (await vB.call('GET', '/vendedor/pedidos?modo=historico')).json.pedidos;
  assert.equal(lista.length, 0);
  assert.equal((await vB.call('GET', '/vendedor/dashboard')).json.recebidos_hoje, 0);
});
await teste('vendedor da loja B não edita produtos/categorias da loja A, mesmo mandando estabelecimento_id', async () => {
  assert.equal((await vB.call('PATCH', `/vendedor/produtos/${acai.id}`, { preco: 1 })).status, 404);
  assert.equal((await vB.call('DELETE', `/vendedor/produtos/${acai.id}`)).status, 404);
  assert.equal((await vB.call('PUT', `/vendedor/produtos/${acai.id}`, { categoria_id: menu.categorias[0].id, nome: 'X', preco: 1 })).status, 404);
  const meuCat = (await vB.call('GET', '/vendedor/cardapio')).json.categorias[0].id;
  const r = await vB.call('POST', '/vendedor/produtos', { estabelecimento_id: estA, categoria_id: menu.categorias[0].id, nome: 'Invasor', preco: 100 });
  assert.equal(r.status, 404); // categoria de A não pertence a B
  const ok = await vB.call('POST', '/vendedor/produtos', { estabelecimento_id: estA, categoria_id: meuCat, nome: 'Meu produto', preco: 100 });
  assert.equal(ok.status, 201);
  assert.equal(db.prepare('SELECT estabelecimento_id e FROM produtos WHERE id = ?').get(ok.json.id).e, estB, 'o escopo veio do corpo e não da sessão');
  assert.equal((await vB.call('PATCH', '/vendedor/loja', { nome: 'Hack', estabelecimento_id: estA, descricao: '', telefone: null, endereco: '', pedido_minimo: 0, taxa_entrega: 0, tempo_min: 10, tempo_max: 20, aceita_retirada: true })).status, 200);
  assert.equal(db.prepare('SELECT nome FROM estabelecimentos WHERE id = ?').get(estA).nome, 'Açaí Papum');
});
await teste('cliente não lê nem cancela pedido de outro cliente', async () => {
  assert.equal((await cli2.call('GET', `/cliente/pedidos/${pedido.id}`)).status, 404);
  assert.equal((await cli2.call('POST', `/cliente/pedidos/${pedido.id}/cancelar`)).status, 404);
  assert.equal((await cli2.call('GET', '/cliente/pedidos')).json.pedidos.length, 0);
});
await teste('vendedor edita cardápio e o cliente vê a mudança; produto pausado some e não pode ser pedido', async () => {
  const cat = (await vA.call('GET', '/vendedor/cardapio')).json.categorias[0];
  const novo = await vA.call('POST', '/vendedor/produtos', { categoria_id: cat.id, nome: 'Açaí 500ml', descricao: 'Grande', preco: 2490, grupos: [{ titulo: 'Complementos', minimo: 1, maximo: 2, opcoes: [{ nome: 'Granola', preco_adicional: 0 }, { nome: 'Paçoca', preco_adicional: 300 }] }] });
  assert.equal(novo.status, 201);
  const vis = (await cardapioA()).categorias[0].produtos.find((p) => p.id === novo.json.id);
  assert.equal(vis.preco, 2490); assert.equal(vis.grupos[0].opcoes[1].preco_adicional, 300);
  await vA.call('PATCH', `/vendedor/produtos/${novo.json.id}`, { preco: 2690, ativo: false });
  assert.ok(!(await cardapioA()).categorias[0].produtos.some((p) => p.id === novo.json.id));
  assert.equal((await cli.call('POST', '/cliente/pedidos', pedidoBase({ itens: [{ produto_id: novo.json.id, quantidade: 1, opcoes: [] }] }))).status, 422);
});
await teste('financeiro do vendedor soma apenas pedidos entregues da própria loja', async () => {
  const f = (await vA.call('GET', '/vendedor/financeiro')).json;
  assert.equal(f.pedidos, 1); assert.equal(f.faturamento, 3480); assert.ok(f.top_produtos.length >= 1);
  assert.equal((await vB.call('GET', '/vendedor/financeiro')).json.faturamento, 0);
});
await teste('upload aceita imagem real e rejeita arquivo disfarçado', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(40)]);
  const ok = await vA.call('POST', '/vendedor/upload', { data: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(ok.status, 201); assert.match(ok.json.url, /\/uploads\/[a-f0-9]{32}\.png$/);
  const ruim = await vA.call('POST', '/vendedor/upload', { data: `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}` });
  assert.equal(ruim.status, 415);
});

console.log('\nAdministrador geral');

await teste('admin cria estabelecimento com vendedor; o novo vendedor entra e vê só a própria loja', async () => {
  const r = await adm.call('POST', '/admin/estabelecimentos', { nome: 'Lanchonete Nova', categoria: 'Lanches', vendedor: { nome: 'Maria', email: 'maria@nova.local', senha: 'SenhaForte123' } });
  assert.equal(r.status, 201);
  const m = new Client('vendedor'); await login(m, 'maria@nova.local', 'SenhaForte123');
  assert.equal((await m.call('GET', '/vendedor/cardapio')).json.categorias.length, 0);
  assert.ok([401, 403].includes((await m.call('GET', '/admin/resumo')).status));
  // suspender derruba a sessão e bloqueia o acesso
  assert.equal((await adm.call('PATCH', `/admin/estabelecimentos/${r.json.estabelecimento_id}`, { ativo: false })).status, 200);
  assert.equal((await m.call('GET', '/vendedor/dashboard')).status, 401);
  assert.equal((await new Client('vendedor').call('POST', '/vendedor/auth/login', { email: 'maria@nova.local', senha: 'SenhaForte123' })).status, 200); // login ok…
});
await teste('…mas loja suspensa é barrada em qualquer rota e some da busca pública', async () => {
  const m = new Client('vendedor'); await login(m, 'maria@nova.local', 'SenhaForte123');
  const r = await m.call('GET', '/vendedor/dashboard'); assert.equal(r.status, 403); assert.equal(r.json.codigo, 'SUSPENSO');
  assert.ok(!(await cli.call('GET', '/public/estabelecimentos')).json.estabelecimentos.some((e) => e.slug === 'lanchonete-nova'));
});
await teste('ações administrativas ficam registradas na auditoria', async () => {
  const a = (await adm.call('GET', '/admin/auditoria')).json.registros.map((x) => x.acao);
  assert.ok(a.includes('admin.estabelecimento.criar') && a.includes('login.falha') && a.includes('pedido.status'));
});

[sseA, sseB, sseCli, sseCli2].forEach((s) => s.close());
server.close(); db.close();
console.log(`\n${passou} testes passaram, ${falhou} falharam.`);
process.exit(falhou ? 1 : 0);
