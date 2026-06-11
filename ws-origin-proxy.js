// codex app-server rejects WebSocket handshakes that carry an Origin header,
// and browsers always send one. This proxy strips Origin from the upgrade
// request and pipes bytes both ways. No dependencies.
const net = require('net');

const LISTEN = Number(process.argv[2] || 8124);
const TARGET = Number(process.argv[3] || 8123);

net
  .createServer((client) => {
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      client.removeListener('data', onData);
      const head = buf.slice(0, idx).toString();
      const rest = buf.slice(idx + 4);
      const lines = head.split('\r\n').filter((l) => !/^origin:/i.test(l));
      const upstream = net.connect(TARGET, '127.0.0.1', () => {
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (rest.length) upstream.write(rest);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('close', () => upstream.destroy());
    };
    client.on('data', onData);
    client.on('error', () => {});
  })
  .listen(LISTEN, '127.0.0.1', () =>
    console.log(`ws-origin-proxy listening on ws://127.0.0.1:${LISTEN} -> 127.0.0.1:${TARGET}`)
  );
