import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

// Kamerazugriff braucht HTTPS, sobald nicht ueber localhost getestet wird.
// Liegen Zertifikate (z.B. aus mkcert) unter certs/, wird der Dev-Server
// automatisch mit TLS gestartet.
const cert = 'certs/cert.pem';
const key = 'certs/key.pem';
const https = fs.existsSync(cert) && fs.existsSync(key)
  ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // im Heimnetz auch vom Handy erreichbar
    port: 5173,
    https,
    proxy: {
      '/api': {
        target: process.env.PT_API ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
