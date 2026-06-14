import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActivityRepository,
  CommentRepository,
  createDatabase,
  IssueListFilters,
  IssueRepository
} from './db/index.js';

type AppConfig = {
  clientDir?: string;
  databasePath?: string;
};

const validationErrorMessages = new Set([
  'title is required',
  'body is required',
  'Invalid issue status',
  'Invalid issue priority',
  'Invalid issue labels',
  'Invalid issue due date'
]);

function isValidationError(error: unknown): error is Error {
  return error instanceof Error && validationErrorMessages.has(error.message);
}

function getOptionalQueryString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}

export function createApp(config: AppConfig = {}) {
  const app = express();
  const clientDir = config.clientDir ? path.resolve(config.clientDir) : null;
  const database = createDatabase(config.databasePath ?? ':memory:');
  const issueRepository = new IssueRepository(database);
  const commentRepository = new CommentRepository(database);
  const activityRepository = new ActivityRepository(database);

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'TinyTracker' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'TinyTracker' });
  });

  app.get('/api/issues', (req, res) => {
    const filters: IssueListFilters = {
      status: getOptionalQueryString(req.query.status) as IssueListFilters['status'],
      priority: getOptionalQueryString(req.query.priority) as IssueListFilters['priority'],
      search: getOptionalQueryString(req.query.search)
    };

    try {
      return res.status(200).json(issueRepository.list(filters));
    } catch (error) {
      if (isValidationError(error)) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
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
      return res.status(201).json(issue);
    } catch (error) {
      if (isValidationError(error)) {
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
      if (isValidationError(error)) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/issues/:id/close', (req, res) => {
    const issue = issueRepository.close(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.post('/api/issues/:id/reopen', (req, res) => {
    const issue = issueRepository.reopen(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.get('/api/issues/:id/comments', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(commentRepository.listByIssueId(issue.id));
  });

  app.get('/api/issues/:id/activity', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(activityRepository.listByIssueId(issue.id));
  });

  app.post('/api/issues/:id/comments', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    try {
      const comment = commentRepository.create({
        issueId: issue.id,
        body: req.body?.body
      });

      return res.status(201).json(comment);
    } catch (error) {
      if (isValidationError(error)) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  });

  app.put('/api/comments/:id', (req, res) => {
    try {
      const comment = commentRepository.update(req.params.id, req.body ?? {});

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      return res.status(200).json(comment);
    } catch (error) {
      if (isValidationError(error)) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/comments/:id/history', (req, res) => {
    const comment = commentRepository.getById(req.params.id);

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    return res.status(200).json(commentRepository.getHistory(comment.id));
  });

  if (clientDir && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));

    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ status: 'ok', service: 'TinyTracker' });
    });
  }

  return app;
}

export default createApp;
