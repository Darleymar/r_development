import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import usersRoutes from './routes/users.js';
import productsRoutes from './routes/products.js';
import templatesRoutes from './routes/templates.js';
import workoutsRoutes from './routes/workouts.js';
import logRoutes from './routes/log.js';
import statsRoutes from './routes/stats.js';
import offRoutes from './routes/off.js';
import { serverToday } from './targets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '..', '..', 'web', 'dist');

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, server_today: serverToday() });
  });

  app.use('/api/users', usersRoutes(db));
  app.use('/api/products', productsRoutes(db));
  app.use('/api/templates', templatesRoutes(db));
  app.use('/api/workouts', workoutsRoutes(db));
  app.use('/api/log', logRoutes(db));
  app.use('/api/off', offRoutes(db));
  app.use('/api', statsRoutes(db));

  app.use('/api', (req, res) => res.status(404).json({ error: `Unbekannter Endpunkt: ${req.originalUrl}` }));

  // Im Produktionsbetrieb liefert der Server das gebaute Frontend gleich mit,
  // damit im Heimnetz ein einziger Prozess reicht.
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('*', (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message ?? 'Interner Fehler' });
  });

  return app;
}

export default createApp;
