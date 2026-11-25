import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Valores monetários são sempre inteiros em centavos. Datas em ISO 8601 UTC.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS estabelecimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT 'Outros',
  logo_url TEXT,
  banner_url TEXT,
  telefone TEXT,
  endereco TEXT NOT NULL DEFAULT '',
  aberto_manual INTEGER NOT NULL DEFAULT 1,
  pedido_minimo INTEGER NOT NULL DEFAULT 0,
  taxa_entrega INTEGER NOT NULL DEFAULT 0,
  tempo_min INTEGER NOT NULL DEFAULT 30,
  tempo_max INTEGER NOT NULL DEFAULT 50,
  aceita_retirada INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS horarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  abre TEXT NOT NULL,
  fecha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('cliente','vendedor','admin')),
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT,
  senha_hash TEXT NOT NULL,
  estabelecimento_id INTEGER REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  UNIQUE (email, tipo),
  CHECK ((tipo = 'vendedor' AND estabelecimento_id IS NOT NULL) OR (tipo <> 'vendedor' AND estabelecimento_id IS NULL))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  expira_em INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);

CREATE TABLE IF NOT EXISTS enderecos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  apelido TEXT NOT NULL DEFAULT 'Casa',
  cep TEXT, rua TEXT NOT NULL, numero TEXT NOT NULL, complemento TEXT,
  bairro TEXT NOT NULL, cidade TEXT NOT NULL, uf TEXT, referencia TEXT
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativa INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco INTEGER NOT NULL CHECK (preco >= 0),
  preco_original INTEGER,
  imagem_url TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  restrito_18 INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_produtos_est ON produtos(estabelecimento_id);

CREATE TABLE IF NOT EXISTS grupos_opcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  minimo INTEGER NOT NULL DEFAULT 0,
  maximo INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS opcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo_id INTEGER NOT NULL REFERENCES grupos_opcoes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  preco_adicional INTEGER NOT NULL DEFAULT 0 CHECK (preco_adicional >= 0),
  imagem_url TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id),
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL,
  tipo_entrega TEXT NOT NULL CHECK (tipo_entrega IN ('entrega','retirada')),
  endereco_json TEXT,
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  taxa_entrega INTEGER NOT NULL,
  total INTEGER NOT NULL,
  forma_pagamento TEXT NOT NULL,
  pagamento_status TEXT NOT NULL,
  troco_para INTEGER,
  observacao TEXT,
  motivo TEXT,
  pix_payload TEXT,
  publicado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  aceito_em TEXT, pronto_em TEXT, saiu_em TEXT, entregue_em TEXT, cancelado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_pedidos_est ON pedidos(estabelecimento_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id, criado_em);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER,
  nome TEXT NOT NULL,
  preco_unit INTEGER NOT NULL,
  quantidade INTEGER NOT NULL,
  observacao TEXT,
  total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pedido_item_opcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES pedido_itens(id) ON DELETE CASCADE,
  grupo_titulo TEXT NOT NULL,
  nome TEXT NOT NULL,
  preco_adicional INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pedido_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  usuario_id INTEGER,
  tipo TEXT,
  detalhe TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  tipo TEXT,
  estabelecimento_id INTEGER,
  acao TEXT NOT NULL,
  detalhe TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Executa fn (síncrona) dentro de uma transação. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já encerrada */ }
    throw e;
  }
}

export const now = () => new Date().toISOString();
