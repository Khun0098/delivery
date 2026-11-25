import { config } from '../apps/api/src/config.js';
import { openDb, now } from '../apps/api/src/db.js';
import { hashPassword } from '../apps/api/src/security.js';

const D = 100; // valores em centavos

const COMPLEMENTOS_GRATIS = ['Cereal chocoball', 'Paçoca', 'Granola', 'Coco ralado', 'Granulado de chocolate'];
const CALDAS = ['Caramelo', 'Leite condensado', 'Chocolate', 'Morango'];
const EXTRAS = ['Ovomaltine', 'Confetes de chocolates', 'Leite em pó', 'Granola', 'Paçoca', 'Nestón', 'Coco ralado', 'Granulado de chocolate'];

const grupoGratis = (titulo, desc, minimo, maximo) => ({ titulo, descricao: desc, minimo, maximo, opcoes: COMPLEMENTOS_GRATIS.map((nome) => ({ nome, preco_adicional: 0 })) });

/** Cria (ou completa) os dados de demonstração. Seguro para rodar mais de uma vez. */
export async function seed(db, { senhaAdmin, senhaVendedor, senhaCliente, log = () => {} } = {}) {
  const t = now();
  const user = async (tipo, nome, email, senha, estId = null, tel = null) => {
    const ex = db.prepare('SELECT id FROM usuarios WHERE email = ? AND tipo = ?').get(email, tipo);
    if (ex) return ex.id;
    log(`  criado ${tipo}: ${email}`);
    return db.prepare('INSERT INTO usuarios (tipo, nome, email, telefone, senha_hash, estabelecimento_id, criado_em) VALUES (?,?,?,?,?,?,?)')
      .run(tipo, nome, email, tel, await hashPassword(senha), estId, t).lastInsertRowid;
  };

  await user('admin', 'Administrador Geral', 'admin@delivery.local', senhaAdmin);

  // ---------- Loja 1: Açaí Papum (cardápio baseado nos prints) ----------
  if (!db.prepare("SELECT 1 FROM estabelecimentos WHERE slug = 'acai-papum'").get()) {
    const est = db.prepare(`INSERT INTO estabelecimentos (slug, nome, descricao, categoria, endereco, pedido_minimo, taxa_entrega, tempo_min, tempo_max, criado_em)
      VALUES ('acai-papum','Açaí Papum','Pediu, chegou, gelou! Açaí cremoso, puro e geladinho, sem cristais de gelo.','Açaí','Centro',990,0,43,53,?)`).run(t).lastInsertRowid;
    const hor = db.prepare('INSERT INTO horarios (estabelecimento_id, dia_semana, abre, fecha) VALUES (?,?,?,?)');
    for (let d = 0; d < 7; d++) hor.run(est, d, '13:00', '23:00'); // horário de fechamento é um exemplo: ajuste no painel do vendedor

    const cat = (nome, ordem) => db.prepare('INSERT INTO categorias (estabelecimento_id, nome, ordem) VALUES (?,?,?)').run(est, nome, ordem).lastInsertRowid;
    const c1 = cat('Pápum Gourmet - Monte seu Açaí', 1), c2 = cat('Bebidas', 2);
    const prod = (c, nome, desc, preco, orig, grupos = [], r18 = 0) => {
      const pid = db.prepare('INSERT INTO produtos (estabelecimento_id, categoria_id, nome, descricao, preco, preco_original, restrito_18) VALUES (?,?,?,?,?,?,?)').run(est, c, nome, desc, preco, orig, r18).lastInsertRowid;
      grupos.forEach((g, gi) => {
        const gid = db.prepare('INSERT INTO grupos_opcoes (produto_id, titulo, descricao, minimo, maximo, ordem) VALUES (?,?,?,?,?,?)').run(pid, g.titulo, g.descricao, g.minimo, g.maximo, gi).lastInsertRowid;
        g.opcoes.forEach((o, oi) => db.prepare('INSERT INTO opcoes (grupo_id, nome, preco_adicional, ordem) VALUES (?,?,?,?)').run(gid, o.nome, o.preco_adicional, oi));
      });
    };

    prod(c1, 'Açaí Artesanal de 200ml + 3 complementos grátis', 'Açaí cremoso, puro e geladinho, sem cristais de gelo. Escolha até 3 acompanhamentos grátis. Monte o seu.', 1490, 1990, [
      grupoGratis('Adicionais Grátis', 'Escolha pelo menos 1 opção (até 3).', 1, 3),
      { titulo: 'Caldas', descricao: 'Escolha até 1 opção.', minimo: 0, maximo: 1, opcoes: CALDAS.map((nome) => ({ nome, preco_adicional: 0 })) },
      { titulo: 'Que tal acrescentar mais?', descricao: 'Escolha até 4 opções.', minimo: 0, maximo: 4, opcoes: EXTRAS.map((nome) => ({ nome, preco_adicional: 250 })) },
    ]);
    prod(c1, 'Combo Duas Tentações Cookies & Cream + Ferrero Rocher 200ml', 'Duas tentações em um só pedido! De um lado, a cremosidade irresistível do Cookies & Cream. Do outro, a explosão de sabor do Ferrero Rocher.', 3890, 5990);
    prod(c1, 'Pápum Gourmet - Cookies & Cream', 'Creme de Cookies & Cream. Uma combinação irresistível de creme aveludado com o sabor inconfundível de Cookies.', 2290, 2990);
    prod(c1, 'Pápum Gourmet - Trufadão Ferrero Rocher + 2 complementos grátis', 'O clássico bombom virou açaí! Copo intensamente recheado com camadas da legítima Nutella pura e a crocância irresistível do Ferrero Rocher.', 2290, 2990,
      [grupoGratis('Complementos grátis', 'Escolha até 2 opções.', 0, 2)]);
    prod(c1, 'Pápum Gourmet - Trufadão Ninho c/ Nutella + 2 complementos grátis', 'O verdadeiro trufado! Copo mega recheado com camadas generosas de Nutella pura e nosso exclusivo e cremoso creme de Ninho.', 2290, 2990,
      [grupoGratis('Complementos grátis', 'Escolha até 2 opções.', 0, 2)]);
    prod(c2, 'Coca-Cola Pet Mini 200 ml', 'Garrafa 200ml.', 399, null);
    prod(c2, 'Água Mineral com Gás 500ml Passa Quatro', 'Garrafa 500ml.', 700, null);
    prod(c2, 'Cerveja Heineken Latão', 'Cerveja Heineken latão. Venda proibida para menores de 18 anos.', 1200, null, [], 1);
    log('  criada loja: Açaí Papum');
  }
  const estA = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'acai-papum'").get().id;
  await user('vendedor', 'Dono do Açaí Papum', 'vendedor@acaipapum.local', senhaVendedor, estA);

  // ---------- Loja 2: prova do isolamento entre estabelecimentos ----------
  if (!db.prepare("SELECT 1 FROM estabelecimentos WHERE slug = 'pizzaria-demo'").get()) {
    const est = db.prepare(`INSERT INTO estabelecimentos (slug, nome, descricao, categoria, endereco, pedido_minimo, taxa_entrega, tempo_min, tempo_max, criado_em)
      VALUES ('pizzaria-demo','Pizzaria Demo','Pizzas artesanais no forno a lenha.','Pizza','Bairro Jardim',2500,500,40,60,?)`).run(t).lastInsertRowid;
    const c = db.prepare("INSERT INTO categorias (estabelecimento_id, nome, ordem) VALUES (?,?,1)").run(est, 'Pizzas').lastInsertRowid;
    db.prepare('INSERT INTO produtos (estabelecimento_id, categoria_id, nome, descricao, preco) VALUES (?,?,?,?,?)').run(est, c, 'Pizza Margherita', 'Molho de tomate, muçarela e manjericão.', 4500);
    db.prepare('INSERT INTO produtos (estabelecimento_id, categoria_id, nome, descricao, preco) VALUES (?,?,?,?,?)').run(est, c, 'Pizza Calabresa', 'Calabresa fatiada e cebola.', 4800);
    log('  criada loja: Pizzaria Demo');
  }
  const estB = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'pizzaria-demo'").get().id;
  await user('vendedor', 'Dono da Pizzaria', 'vendedor@pizzariademo.local', senhaVendedor, estB);

  await user('cliente', 'Cliente Teste', 'cliente@teste.local', senhaCliente, null, '11999990000');
  return { estA, estB };
}

// Execução direta: node scripts/seed.mjs
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const env = process.env;
  const senhas = { senhaAdmin: env.SEED_ADMIN_PASSWORD || 'Admin#12345', senhaVendedor: env.SEED_VENDEDOR_PASSWORD || 'Vendedor#12345', senhaCliente: env.SEED_CLIENTE_PASSWORD || 'Cliente#12345' };
  const db = openDb(config.dbPath);
  console.log('Criando dados de demonstração em', config.dbPath);
  await seed(db, { ...senhas, log: console.log });
  console.log('\nLogins de DESENVOLVIMENTO (troque as senhas antes de publicar):');
  console.log(`  Cliente : cliente@teste.local            / ${senhas.senhaCliente}`);
  console.log(`  Vendedor: vendedor@acaipapum.local       / ${senhas.senhaVendedor}`);
  console.log(`  Vendedor: vendedor@pizzariademo.local    / ${senhas.senhaVendedor}`);
  console.log(`  Admin   : admin@delivery.local           / ${senhas.senhaAdmin}`);
  db.close();
}
