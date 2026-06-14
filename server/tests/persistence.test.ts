import { createDatabase } from '../src/db/database.js';
import { CommentRepository } from '../src/db/commentRepository.js';
import { IssueRepository } from '../src/db/issueRepository.js';

describe('persistence layer', () => {
  it('persists issues with defaults and updates', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const created = issueRepository.create({
        title: 'Fix login',
        description: 'Password reset flow',
      });

      const listed = issueRepository.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(created);

      const loaded = issueRepository.getById(created.id);
      expect(loaded).toMatchObject({
        id: created.id,
        title: 'Fix login',
        description: 'Password reset flow',
        status: 'todo',
        priority: 'medium',
      });

      const updated = issueRepository.update(created.id, {
        status: 'in_progress',
        priority: 'high',
      });
      expect(updated).not.toBeNull();
      expect(updated).toMatchObject({
        status: 'in_progress',
        priority: 'high',
      });
      expect(updated?.updatedAt).not.toEqual(created.updatedAt);
    } finally {
      database.close();
    }
  });

  it('supports comment persistence and edit history', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);
    const commentRepository = new CommentRepository(database);

    try {
      const issue = issueRepository.create({ title: 'Bug' });
      const comment = commentRepository.create({
        issueId: issue.id,
        body: 'Initial comment',
      });

      const comments = commentRepository.listByIssueId(issue.id);
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        id: comment.id,
        body: 'Initial comment',
      });

      const updated = commentRepository.update(comment.id, { body: 'Edited comment' });
      expect(updated).toMatchObject({
        body: 'Edited comment',
        issueId: issue.id,
      });

      const history = commentRepository.getHistory(comment.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        commentId: comment.id,
        previousBody: 'Initial comment',
        newBody: 'Edited comment',
      });
    } finally {
      database.close();
    }
  });

  it('rejects invalid issue status transitions at repository boundary', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const issue = issueRepository.create({ title: 'Invalid status test' });

      expect(() => {
        issueRepository.update(issue.id, {
          // @ts-expect-error intentionally invalid
          status: 'archived',
        });
      }).toThrow('Invalid issue status');
    } finally {
      database.close();
    }
  });
});
