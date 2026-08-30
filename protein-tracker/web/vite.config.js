import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Die App laeuft vollstaendig im Geraet – es gibt keinen Server und damit
// auch keinen Proxy mehr. `base: './'` ist noetig, damit dieselben Dateien
// sowohl unter einer Web-Adresse als auch in der Android-App funktionieren,
// die ihre Inhalte aus dem App-Paket laedt.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
  optimizeDeps: { exclude: ['@protein-tracker/core'] },
});
