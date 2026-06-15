import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  type ActivityEvent,
  ActivityRepository,
  type Comment,
  type CommentEditHistory,
  CommentRepository,
  createDatabase,
  type Issue,
  IssueListFilters,
  IssueRepository
} from './db/index.js';

type AppConfig = {
  clientDir?: string;
  databasePath?: string;
};

type ExportedComment = Comment & {
  editHistory: CommentEditHistory[];
};

type ExportedIssue = Issue & {
  comments: ExportedComment[];
  activityEvents: ActivityEvent[];
};

type TrackerExport = {
  exportVersion: 1;
  issues: ExportedIssue[];
};

const DEFAULT_ISSUE_PAGE = 1;
const DEFAULT_ISSUE_LIMIT = 25;
const MAX_ISSUE_LIMIT = 100;

const validationErrorMessages = new Set([
  'title is required',
  'body is required',
  'Invalid issue status',
  'Invalid issue priority',
  'Invalid issue labels',
  'Invalid issue due date',
  'Invalid page parameter',
  'Invalid limit parameter'
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

function parsePositiveIntegerQuery(
  value: unknown,
  defaultValue: number,
  errorMessage: string
): number {
  const queryValue = getOptionalQueryString(value);

  if (queryValue === undefined) {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(queryValue)) {
    throw new Error(errorMessage);
  }

  return Number(queryValue);
}

function getIssueListPagination(query: { page?: unknown; limit?: unknown }) {
  const page = parsePositiveIntegerQuery(
    query.page,
    DEFAULT_ISSUE_PAGE,
    'Invalid page parameter'
  );
  const limit = parsePositiveIntegerQuery(
    query.limit,
    DEFAULT_ISSUE_LIMIT,
    'Invalid limit parameter'
  );

  if (limit > MAX_ISSUE_LIMIT) {
    throw new Error('Invalid limit parameter');
  }

  return { page, limit };
}

function groupBy<T>(items: T[], keySelector: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keySelector(item);
    const group = groups.get(key);

    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function buildTrackerExport(
  issueRepository: IssueRepository,
  commentRepository: CommentRepository,
  activityRepository: ActivityRepository
): TrackerExport {
  const issues = issueRepository.listForExport();
  const issueIds = issues.map((issue) => issue.id);
  const comments = commentRepository.listByIssueIds(issueIds);
  const commentsByIssueId = groupBy(comments, (comment) => comment.issueId);
  const historyByCommentId = groupBy(
    commentRepository.getHistoryByCommentIds(comments.map((comment) => comment.id)),
    (history) => history.commentId
  );
  const activityByIssueId = groupBy(
    activityRepository.listByIssueIds(issueIds),
    (event) => event.issueId
  );

  return {
    exportVersion: 1,
    issues: issues.map((issue) => {
      const exportedComments = (commentsByIssueId.get(issue.id) ?? []).map((comment) => ({
        ...comment,
        editHistory: historyByCommentId.get(comment.id) ?? []
      }));

      return {
        ...issue,
        comments: exportedComments,
        activityEvents: activityByIssueId.get(issue.id) ?? []
      };
    })
  };
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

  app.get('/api/export', (_req, res) => {
    res.status(200).json(buildTrackerExport(issueRepository, commentRepository, activityRepository));
  });

  app.get('/api/issues', (req, res) => {
    const filters: IssueListFilters = {
      status: getOptionalQueryString(req.query.status) as IssueListFilters['status'],
      priority: getOptionalQueryString(req.query.priority) as IssueListFilters['priority'],
      search: getOptionalQueryString(req.query.search)
    };

    try {
      return res.status(200).json(issueRepository.list(filters, getIssueListPagination(req.query)));
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
