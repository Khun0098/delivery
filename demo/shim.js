/* Dentro de cada site (iframe): troca fetch e EventSource pelo servidor simulado da página. O código do site não muda. */
(() => {
  const demo = () => window.parent.__demo;
  window.fetch = (url, opts = {}) => new Promise((resolve) => {
    const u = new URL(url, 'http://demo.local');
    let body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch { /* corpo vazio */ }
    setTimeout(() => {
      const r = demo().handle((opts.method || 'GET').toUpperCase(), u.pathname, Object.fromEntries(u.searchParams), body);
      resolve(new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
    }, 80);
  });
  // Num iframe com srcdoc, "#/rota" seria resolvido contra a página de fora e recarregaria tudo: trata só o trecho após "#".
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const h = a.getAttribute('href');
    if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h;
  }, true);
  window.EventSource = class {
    constructor(url) {
      this.l = {};
      const area = String(url).includes('/vendedor/') ? 'vendedor' : 'cliente';
      this.off = demo().subscribe(area, (ev, data) => this._emit(ev, data));
      setTimeout(() => (this.off ? this._emit('conectado', {}) : this.onerror && this.onerror()), 40);
    }
    addEventListener(name, fn) { (this.l[name] = this.l[name] || []).push(fn); }
    _emit(name, data) { (this.l[name] || []).forEach((fn) => fn({ data: JSON.stringify(data) })); }
    close() { if (this.off) this.off(); }
  };
})();
