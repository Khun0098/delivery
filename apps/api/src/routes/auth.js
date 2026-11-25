import { now } from '../db.js';
import { HttpError, V, createSession, hashPassword, verifyPassword, hashToken } from '../security.js';

const publicUser = (u) => ({ id: u.id, tipo: u.tipo, nome: u.nome, email: u.email, telefone: u.telefone ?? null, estabelecimento_id: u.estabelecimento_id ?? null });

export function registerAuth(r, { db, config, limiter, audit }) {
  async function login(ctx, area) {
    const email = V.email(ctx.body.email);
    const senha = typeof ctx.body.senha === 'string' ? ctx.body.senha : '';
    const chave = `login:${area}:${ctx.ip}:${email}`;
    if (!limiter.take(chave, 8, 15 * 60_000)) throw new HttpError(429, 'Muitas tentativas de login. Aguarde 15 minutos.');
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND tipo = ?').get(email, area);
    // Sempre calcula o hash (mesmo sem usuário) para não revelar se o e-mail existe pelo tempo de resposta.
    const ok = await verifyPassword(senha, u?.senha_hash);
    if (!u || !ok || !u.ativo) {
      audit({ ...ctx, user: null }, 'login.falha', `${area}:${email}`);
      throw new HttpError(401, 'E-mail ou senha incorretos');
    }
    limiter.reset(chave);
    const { token, maxAgeSec } = createSession(db, config, u, ctx.req, ctx.ip);
    ctx.setCookie(`sid_${area}`, token, maxAgeSec);
    audit({ ...ctx, user: u }, 'login.ok');
    return { usuario: publicUser(u) };
  }

  function logout(ctx, area) {
    db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(ctx.sessionToken));
    ctx.clearCookie(`sid_${area}`);
    return { ok: true };
  }

  // ---- Cliente ----
  r.post('/cliente/auth/cadastro', { area: 'cliente' }, async (ctx) => {
    if (!limiter.take(`cadastro:${ctx.ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'Muitos cadastros deste dispositivo. Tente mais tarde.');
    const nome = V.str(ctx.body.nome, 'Nome', { min: 2, max: 100 });
    const email = V.email(ctx.body.email);
    const senha = V.password(ctx.body.senha);
    const telefone = V.phone(ctx.body.telefone, { optional: true });
    if (db.prepare("SELECT 1 FROM usuarios WHERE email = ? AND tipo = 'cliente'").get(email)) throw new HttpError(409, 'Já existe uma conta com este e-mail');
    const id = db.prepare("INSERT INTO usuarios (tipo, nome, email, telefone, senha_hash, criado_em) VALUES ('cliente',?,?,?,?,?)")
      .run(nome, email, telefone, await hashPassword(senha), now()).lastInsertRowid;
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    const { token, maxAgeSec } = createSession(db, config, u, ctx.req, ctx.ip);
    ctx.setCookie('sid_cliente', token, maxAgeSec);
    ctx.status = 201;
    return { usuario: publicUser(u) };
  });
  r.post('/cliente/auth/login', { area: 'cliente' }, (ctx) => login(ctx, 'cliente'));
  r.post('/cliente/auth/logout', { auth: 'cliente' }, (ctx) => logout(ctx, 'cliente'));
  r.get('/cliente/auth/me', { auth: 'cliente' }, (ctx) => ({ usuario: publicUser(ctx.user) }));

  // ---- Vendedor (login exclusivo; não existe cadastro público) ----
  r.post('/vendedor/auth/login', { area: 'vendedor' }, (ctx) => login(ctx, 'vendedor'));
  r.post('/vendedor/auth/logout', { auth: 'vendedor' }, (ctx) => logout(ctx, 'vendedor'));
  r.get('/vendedor/auth/me', { auth: 'vendedor' }, (ctx) => ({
    usuario: publicUser(ctx.user),
    estabelecimento: { id: ctx.est.id, nome: ctx.est.nome, slug: ctx.est.slug, logo_url: ctx.est.logo_url },
  }));

  // ---- Admin geral ----
  r.post('/admin/auth/login', { area: 'admin' }, (ctx) => login(ctx, 'admin'));
  r.post('/admin/auth/logout', { auth: 'admin' }, (ctx) => logout(ctx, 'admin'));
  r.get('/admin/auth/me', { auth: 'admin' }, (ctx) => ({ usuario: publicUser(ctx.user) }));
}
