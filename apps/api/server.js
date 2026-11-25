import { config } from './src/config.js';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';

const db = openDb(config.dbPath);
const server = createApp({ db, config });

server.listen(config.port, config.host, () => {
  console.log(`API ouvindo em http://localhost:${config.port}`);
  console.log('Origens permitidas:', config.origins);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
}
