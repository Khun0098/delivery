// Monta a demonstração: os 3 sites REAIS (apps/*) + servidor simulado, tudo em um único arquivo.
//   node demo/build.mjs  ->  demo/index.html (abre com duplo clique)  e  demo/artifact.html (fragmento para publicar)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const safeJs = (s) => s.replace(/<\/script/gi, '<\\/script');
const shim = read('demo/shim.js');

function site(area) {
  let html = read('apps', area, 'index.html');
  html = html.replace(/<link rel="stylesheet" href="css\/app.css">/, () => `<style>${read('apps', area, 'css/app.css')}</style>`);
  html = html.replace(/<script src="config.js"><\/script>/, () => `<script>${safeJs(shim)}\nwindow.APP_CONFIG = { API_URL: 'http://demo.local' };</script>`);
  html = html.replace(/<script src="js\/app.js"><\/script>/, () => `<script>${safeJs(read('apps', area, 'js/app.js'))}</script>`);
  if (/src="(js|config)/.test(html) || /href="css/.test(html)) throw new Error(`referência externa restante em ${area}`);
  return html;
}
const SITES = Object.fromEntries(['cliente', 'vendedor', 'admin'].map((a) => [a, site(a)]));
const embed = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const fragment = `<title>Plataforma Delivery</title>
<style>
  :root { --bg: #f3f0f8; --painel: #ffffff; --fg: #1f1230; --mut: #655a74; --linha: #ddd5ea; --acc: #3a1161; --acc-fg: #ffffff; --lima: #a6e03d; --aviso: #fff3cf; --aviso-fg: #5c4300; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #120d1a; --painel: #1b1327; --fg: #f1eafa; --mut: #a99bbd; --linha: #31254a; --acc: #a6e03d; --acc-fg: #1f1230; --aviso: #3a2f0e; --aviso-fg: #ffd978; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #120d1a; --painel: #1b1327; --fg: #f1eafa; --mut: #a99bbd; --linha: #31254a; --acc: #a6e03d; --acc-fg: #1f1230; --aviso: #3a2f0e; --aviso-fg: #ffd978; color-scheme: dark; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 "Segoe UI", system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; }
  .gutter { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .barra { background: var(--painel); border-bottom: 1px solid var(--linha); padding-block: 10px; display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
  .barra h1 { margin: 0; font-size: 1rem; letter-spacing: -.01em; }
  .abas { display: flex; gap: 4px; flex-wrap: wrap; }
  .abas button { border: 1px solid var(--linha); background: transparent; color: var(--fg); padding: 7px 14px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; }
  .abas button[aria-pressed="true"] { background: var(--acc); color: var(--acc-fg); border-color: var(--acc); }
  .abas button:focus-visible, .dica button:focus-visible, .reset:focus-visible { outline: 3px solid var(--lima); outline-offset: 2px; }
  .reset { margin-left: auto; border: 0; background: transparent; color: var(--mut); text-decoration: underline; cursor: pointer; font: inherit; }
  .dicas { background: var(--painel); border-bottom: 1px solid var(--linha); padding-block: 8px; display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; color: var(--mut); }
  .dica { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
  .dica code { background: var(--bg); padding: 2px 6px; border-radius: 4px; color: var(--fg); overflow-wrap: anywhere; }
  .dica button { border: 1px solid var(--linha); background: var(--bg); color: var(--fg); border-radius: 6px; padding: 3px 10px; font: inherit; font-weight: 600; cursor: pointer; }
  .aviso { background: var(--aviso); color: var(--aviso-fg); padding-block: 6px; font-size: .85rem; }
  .palco { flex: 1; min-height: 0; display: flex; gap: 2px; background: var(--linha); }
  .palco iframe { display: none; flex: 1; min-width: 0; width: 100%; height: 100%; border: 0; background: #fff; }
  .palco[data-modo="cliente"] #f-cliente, .palco[data-modo="vendedor"] #f-vendedor, .palco[data-modo="admin"] #f-admin,
  .palco[data-modo="duplo"] #f-cliente, .palco[data-modo="duplo"] #f-vendedor { display: block; }
  @media (max-width: 899px) { .so-largo { display: none; } }
</style>
<header class="barra gutter">
  <h1>Plataforma Delivery</h1>
  <div class="abas" role="group" aria-label="Escolha o site">
    <button type="button" data-modo="cliente" aria-pressed="true">Site do cliente</button>
    <button type="button" data-modo="vendedor" aria-pressed="false">Site do vendedor</button>
    <button type="button" data-modo="admin" aria-pressed="false">Admin</button>
    <button type="button" data-modo="duplo" aria-pressed="false" class="so-largo">Cliente e vendedor lado a lado</button>
  </div>
  <button type="button" class="reset" id="reset">Reiniciar demonstração</button>
</header>
<div class="dicas gutter" id="dicas"></div>
<div class="aviso gutter">Demonstração com dados fictícios, guardados só nesta página. Os três sites são o código real do projeto; o servidor é simulado aqui dentro.</div>
<main class="palco" id="palco" data-modo="cliente"></main>
<script>${safeJs(read('demo/backend.js'))}</script>
<script>
(() => {
  const SITES = ${embed(SITES)};
  const palco = document.getElementById('palco');
  const TITULOS = { cliente: 'Site do cliente', vendedor: 'Site do vendedor', admin: 'Administração' };
  const frames = {};
  for (const a of Object.keys(SITES)) {
    const f = document.createElement('iframe');
    f.id = 'f-' + a; f.title = TITULOS[a]; f.srcdoc = SITES[a]; palco.append(f); frames[a] = f;
  }
  const LOGINS = {
    cliente: ['cliente@teste.local', 'Cliente#12345'],
    vendedor: ['vendedor@acaipapum.local', 'Vendedor#12345'],
    admin: ['admin@delivery.local', 'Admin#12345'],
  };
  const dicas = document.getElementById('dicas');
  function preencher(area) {
    const f = frames[area], w = f.contentWindow;
    const tentar = () => {
      const d = f.contentDocument, email = d && d.querySelector('input[name=email]'), senha = d && d.querySelector('input[name=senha]');
      if (!email || !senha) return false;
      email.value = LOGINS[area][0]; senha.value = LOGINS[area][1]; senha.focus(); return true;
    };
    if (tentar()) return;
    if (area === 'cliente') w.location.hash = '#/entrar';
    let n = 0; const t = setInterval(() => { if (tentar() || ++n > 40) clearInterval(t); }, 50);
  }
  function desenharDicas(modo) {
    const areas = modo === 'duplo' ? ['cliente', 'vendedor'] : [modo];
    dicas.replaceChildren();
    for (const a of areas) {
      const box = document.createElement('div'); box.className = 'dica';
      const t = document.createElement('span'); t.textContent = TITULOS[a] + ' — login de teste:';
      const c = document.createElement('code'); c.textContent = LOGINS[a][0] + ' / ' + LOGINS[a][1];
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Preencher'; b.onclick = () => preencher(a);
      box.append(t, c, b);
      if (a === 'vendedor') { const n = document.createElement('span'); n.textContent = 'Clique na tela do vendedor para liberar o som da campainha.'; box.append(n); }
      dicas.append(box);
    }
  }
  function escolher(modo) {
    palco.dataset.modo = modo;
    document.querySelectorAll('.abas button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
    desenharDicas(modo);
  }
  document.querySelector('.abas').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) escolher(b.dataset.modo); });
  document.getElementById('reset').onclick = () => location.reload();
  escolher('cliente');
})();
</script>`;

fs.writeFileSync(path.join(root, 'demo/artifact.html'), fragment);
fs.writeFileSync(path.join(root, 'demo/index.html'), `<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>\n${fragment}\n</body></html>\n`);
console.log('demo/index.html', Math.round(fs.statSync(path.join(root, 'demo/index.html')).size / 1024), 'KB');
