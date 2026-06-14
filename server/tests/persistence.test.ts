import { describe, expect, it } from 'vitest';
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
        priority: 'high'
      });

      expect(created).toMatchObject({
        title: 'Add issue storage',
        description: 'Persist issues',
        status: 'todo',
        priority: 'high'
      });

      const secondRepository = new IssueRepository(database);
      const loaded = secondRepository.getById(created.id);
      expect(loaded).toEqual(created);

      const updated = secondRepository.update(created.id, {
        status: 'in_progress',
        priority: 'medium',
        description: 'Persist issues in SQLite'
      });

      expect(updated).toMatchObject({
        id: created.id,
        status: 'in_progress',
        priority: 'medium',
        description: 'Persist issues in SQLite'
      });

      expect(secondRepository.list()).toHaveLength(1);
    } finally {
      database.close();
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
      expect(() => commentRepository.create({ issueId: issue.id, body: '' })).toThrow('body is required');
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
