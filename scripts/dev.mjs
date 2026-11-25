// Sobe API (4000) + os 3 sites (4001 cliente, 4002 vendedor, 4003 admin). Cria dados de demonstração se o banco estiver vazio.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../apps/api/src/config.js';
import { openDb } from '../apps/api/src/db.js';
import { seed } from './seed.mjs';

const db = openDb(config.dbPath);
const vazio = !db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
if (vazio) {
  console.log('Banco vazio: criando dados de demonstração…');
  await seed(db, { senhaAdmin: 'Admin#12345', senhaVendedor: 'Vendedor#12345', senhaCliente: 'Cliente#12345', log: console.log });
}
db.close();

const run = (file, args = []) => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(config.root, file), ...args], { stdio: 'inherit' });
const procs = [run('apps/api/server.js'), run('scripts/serve-sites.mjs')];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop); process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (c) => { if (c) { console.error('Processo encerrou com erro', c); stop(); process.exit(c); } }));

setTimeout(() => {
  console.log(`\n  Cliente  ${config.origins.cliente}\n  Vendedor ${config.origins.vendedor}\n  Admin    ${config.origins.admin}\n  API      ${config.publicApiUrl}\n`);
  if (vazio) console.log('  Logins de teste (desenvolvimento):\n   cliente@teste.local / Cliente#12345\n   vendedor@acaipapum.local / Vendedor#12345\n   admin@delivery.local / Admin#12345\n');
}, 600);
