import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommentRepository, createDatabase, IssueRepository, TABLE_NAMES } from '../src/db/index.js';

describe('persistence layer', () => {
  it('initializes SQLite tables and persists issue updates', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const tableNames = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;

      expect(tableNames.map((row) => row.name)).toEqual([
        TABLE_NAMES.commentEditHistory,
        TABLE_NAMES.comments,
        TABLE_NAMES.issues
      ]);

      const created = issueRepository.create({
        title: '  Add issue storage  ',
        description: 'Persist issues',
        priority: 'high',
        labels: ['bug', ' storage ', 'bug']
      });

      expect(created).toMatchObject({
        title: 'Add issue storage',
        description: 'Persist issues',
        status: 'todo',
        priority: 'high',
        labels: ['bug', 'storage']
      });

      const secondRepository = new IssueRepository(database);
      const loaded = secondRepository.getById(created.id);
      expect(loaded).toEqual(created);

      const updated = secondRepository.update(created.id, {
        status: 'in_progress',
        priority: 'medium',
        description: 'Persist issues in SQLite',
        labels: ['api', 'docs']
      });

      expect(updated).toMatchObject({
        id: created.id,
        status: 'in_progress',
        priority: 'medium',
        description: 'Persist issues in SQLite',
        labels: ['api', 'docs']
      });

      expect(secondRepository.list()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('preserves issue labels across a file-backed SQLite restart', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'tinytracker-labels-'));
    const databasePath = path.join(tempDir, 'tracker.sqlite');

    try {
      const firstDatabase = createDatabase(databasePath);
      const firstRepository = new IssueRepository(firstDatabase);
      const created = firstRepository.create({
        title: 'Restart labels',
        labels: ['ui', 'persistence']
      });

      firstDatabase.close();

      const secondDatabase = createDatabase(databasePath);
      const secondRepository = new IssueRepository(secondDatabase);

      try {
        expect(secondRepository.getById(created.id)).toMatchObject({
          id: created.id,
          labels: ['ui', 'persistence']
        });
      } finally {
        secondDatabase.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('validates issue and comment input at repository boundaries', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);
    const commentRepository = new CommentRepository(database);

    try {
      const issue = issueRepository.create({ title: 'Validation issue' });

      expect(() => issueRepository.create({ title: '   ' })).toThrow('title is required');
      expect(() =>
        issueRepository.update(issue.id, {
          // @ts-expect-error intentionally invalid for runtime validation
          status: 'archived'
        })
      ).toThrow('Invalid issue status');
      expect(() =>
        issueRepository.update(issue.id, {
          // @ts-expect-error intentionally invalid for runtime validation
          priority: 'urgent'
        })
      ).toThrow('Invalid issue priority');
      expect(() =>
        issueRepository.update(issue.id, {
          // @ts-expect-error intentionally invalid for runtime validation
          labels: 'bug'
        })
      ).toThrow('Invalid issue labels');
      expect(() => issueRepository.update(issue.id, { labels: [''] })).toThrow('Invalid issue labels');
      expect(() => commentRepository.create({ issueId: issue.id, body: '' })).toThrow('body is required');
    } finally {
      database.close();
    }
  });

  it('supports issue status, priority, close, and reopen workflow values', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const statuses = ['todo', 'in_progress', 'review', 'done'] as const;
      const priorities = ['low', 'medium', 'high'] as const;

      for (const status of statuses) {
        const issue = issueRepository.create({
          title: `Status ${status}`,
          status
        });

        expect(issue.status).toBe(status);
      }

      for (const priority of priorities) {
        const issue = issueRepository.create({
          title: `Priority ${priority}`,
          priority
        });

        expect(issue.priority).toBe(priority);
      }

      const issue = issueRepository.create({
        title: 'Workflow issue',
        status: 'in_progress',
        priority: 'high'
      });

      expect(issueRepository.close(issue.id)).toMatchObject({
        id: issue.id,
        status: 'done',
        priority: 'high'
      });
      expect(issueRepository.reopen(issue.id)).toMatchObject({
        id: issue.id,
        status: 'todo',
        priority: 'high'
      });
    } finally {
      database.close();
    }
  });

  it('searches and filters issues by status, priority, title, and description', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const bug = issueRepository.create({
        title: 'Fix login bug',
        description: 'OAuth callback fails on retry',
        status: 'todo',
        priority: 'high'
      });
      const docs = issueRepository.create({
        title: 'Write setup guide',
        description: 'Document local startup and smoke checks',
        status: 'review',
        priority: 'medium'
      });
      issueRepository.create({
        title: 'Polish empty state',
        description: 'Improve dashboard copy',
        status: 'done',
        priority: 'low'
      });

      expect(issueRepository.list({ status: 'review' })).toEqual([docs]);
      expect(issueRepository.list({ priority: 'high' })).toEqual([bug]);
      expect(issueRepository.list({ search: 'oauth' })).toEqual([bug]);
      expect(issueRepository.list({ search: 'SETUP' })).toEqual([docs]);
      expect(issueRepository.list({ status: 'todo', priority: 'high', search: 'login' })).toEqual([bug]);
      expect(issueRepository.list({ status: 'done', priority: 'high' })).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('persists comments and records edit history', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);
    const commentRepository = new CommentRepository(database);

    try {
      const issue = issueRepository.create({ title: 'Comment issue' });
      const comment = commentRepository.create({
        issueId: issue.id,
        body: 'Initial comment'
      });

      expect(commentRepository.listByIssueId(issue.id)).toEqual([comment]);

      const edited = commentRepository.update(comment.id, { body: 'Edited comment' });
      expect(edited).toMatchObject({
        id: comment.id,
        issueId: issue.id,
        body: 'Edited comment'
      });

      expect(commentRepository.getHistory(comment.id)).toHaveLength(1);
      expect(commentRepository.getHistory(comment.id)[0]).toMatchObject({
        commentId: comment.id,
        previousBody: 'Initial comment',
        newBody: 'Edited comment'
      });
    } finally {
      database.close();
    }
  });
});
