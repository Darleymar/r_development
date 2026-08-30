import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import { openDb } from './db.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const db = openDb();
const app = createApp(db);

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// Kamerazugriff im Browser braucht HTTPS (Ausnahme: localhost). Liegen
// Zertifikate vor – z.B. aus mkcert – wird zusaetzlich HTTPS bedient.
const certPath = process.env.PT_TLS_CERT;
const keyPath = process.env.PT_TLS_KEY;

if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const tlsPort = Number(process.env.PT_TLS_PORT ?? 3443);
  https
    .createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
    .listen(tlsPort, HOST, () => {
      console.log(`HTTPS  https://localhost:${tlsPort}`);
      for (const addr of localAddresses()) console.log(`       https://${addr}:${tlsPort}`);
    });
}

http.createServer(app).listen(PORT, HOST, () => {
  console.log(`HTTP   http://localhost:${PORT}`);
  for (const addr of localAddresses()) console.log(`       http://${addr}:${PORT}`);
  if (!certPath) {
    console.log('Hinweis: fuer den Barcode-Scan auf dem Handy HTTPS bereitstellen (PT_TLS_CERT/PT_TLS_KEY).');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
