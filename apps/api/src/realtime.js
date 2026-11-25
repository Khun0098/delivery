// Tempo real via Server-Sent Events. Canais:
//   loja:{estabelecimento_id}  -> somente o painel do vendedor daquela loja
//   cliente:{cliente_id}       -> somente o cliente dono dos pedidos
const channels = new Map();

export function subscribe(channel, req, res, { origin } = {}) {
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  }
  res.writeHead(200, headers);
  res.write('retry: 3000\n\n');
  res.write(`event: conectado\ndata: {}\n\n`);

  let set = channels.get(channel);
  if (!set) channels.set(channel, (set = new Set()));
  set.add(res);

  const cleanup = () => {
    set.delete(res);
    if (set.size === 0) channels.delete(channel);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

export function publish(channel, event, data) {
  const set = channels.get(channel);
  if (!set) return 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
  return set.size;
}

export function listenerCount(channel) {
  return channels.get(channel)?.size || 0;
}

const hb = setInterval(() => {
  for (const set of channels.values()) for (const res of set) res.write(': ping\n\n');
}, 20000);
hb.unref();
