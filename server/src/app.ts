import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createDatabase, IssueRepository } from './db/index.js';

type AppConfig = {
  clientDir?: string;
  databasePath?: string;
};

export function createApp(config: AppConfig = {}) {
  const app = express();
  const { clientDir } = config;
  const databasePath = config.databasePath ?? ':memory:';
  const resolvedClientDir = clientDir
    ? path.resolve(clientDir)
    : null;

  const database = createDatabase(databasePath);
  const issueRepository = new IssueRepository(database);

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'TinyTracker' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'TinyTracker' });
  });

  app.get('/api/issues', (_req, res) => {
    const issues = issueRepository.list();
    res.status(200).json(issues);
  });

  app.get('/api/issues/:id', (req, res) => {
    const issue = issueRepository.getById(req.params.id);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    return res.status(200).json(issue);
  });

  app.post('/api/issues', (req, res) => {
    try {
      const issue = issueRepository.create(req.body ?? {});
      res.status(201).json(issue);
    } catch (error) {
      if (error instanceof Error && error.message === 'title is required') {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof Error && (error.message === 'Invalid issue status' || error.message === 'Invalid issue priority')) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  });

  app.put('/api/issues/:id', (req, res) => {
    try {
      const issue = issueRepository.update(req.params.id, req.body ?? {});
      if (!issue) {
        return res.status(404).json({ error: 'Issue not found' });
      }
      return res.status(200).json(issue);
    } catch (error) {
      if (error instanceof Error && (error.message === 'title is required'
        || error.message === 'Invalid issue status'
        || error.message === 'Invalid issue priority')) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/issues/:id/close', (_req, res) => {
    const issue = issueRepository.close(_req.params.id);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    return res.status(200).json(issue);
  });

  app.post('/api/issues/:id/reopen', (_req, res) => {
    const issue = issueRepository.reopen(_req.params.id);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    return res.status(200).json(issue);
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
