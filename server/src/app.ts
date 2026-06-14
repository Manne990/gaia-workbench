import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

type AppConfig = {
  clientDir?: string;
};

export function createApp(config: AppConfig = {}) {
  const app = express();
  const { clientDir } = config;
  const resolvedClientDir = clientDir
    ? path.resolve(clientDir)
    : null;

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'TinyTracker' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'TinyTracker' });
  });

  if (resolvedClientDir && fs.existsSync(resolvedClientDir)) {
    app.use(express.static(resolvedClientDir));

    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(resolvedClientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.status(200).json({ status: 'ok', service: 'TinyTracker' });
    });
  }

  return app;
}

export default createApp;
