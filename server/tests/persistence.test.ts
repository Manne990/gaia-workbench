import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ActivityRepository,
  CommentRepository,
  createDatabase,
  IssueDependencyRepository,
  IssueRepository,
  SavedFilterViewRepository,
  TABLE_NAMES
} from '../src/db/index.js';

describe('persistence layer', () => {
  it('initializes SQLite tables and persists issue updates', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const tableNames = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;

      expect(tableNames.map((row) => row.name)).toEqual([
        TABLE_NAMES.activityEvents,
        TABLE_NAMES.commentEditHistory,
        TABLE_NAMES.comments,
        TABLE_NAMES.issueDependencies,
        TABLE_NAMES.issues,
        TABLE_NAMES.savedFilterViews
      ]);

      const created = issueRepository.create({
        title: '  Add issue storage  ',
        description: 'Persist issues',
        priority: 'high',
        labels: ['bug', ' storage ', 'bug'],
        dueDate: '2999-12-31'
      });

      expect(created).toMatchObject({
        title: 'Add issue storage',
        description: 'Persist issues',
        status: 'todo',
        priority: 'high',
        labels: ['bug', 'storage'],
        dueDate: '2999-12-31',
        isOverdue: false
      });

      const secondRepository = new IssueRepository(database);
      const loaded = secondRepository.getById(created.id);
      expect(loaded).toEqual(created);

      const updated = secondRepository.update(created.id, {
        status: 'in_progress',
        priority: 'medium',
        description: 'Persist issues in SQLite',
        labels: ['api', 'docs'],
        dueDate: '2000-01-01'
      });

      expect(updated).toMatchObject({
        id: created.id,
        status: 'in_progress',
        priority: 'medium',
        description: 'Persist issues in SQLite',
        labels: ['api', 'docs'],
        dueDate: '2000-01-01',
        isOverdue: true
      });

      expect(secondRepository.list().items).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('records issue activity events for creation and representative changes', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);
    const activityRepository = new ActivityRepository(database);

    try {
      const issue = issueRepository.create({
        title: 'Initial title',
        description: 'Initial description',
        status: 'todo',
        priority: 'medium',
        labels: ['ui'],
        dueDate: '2999-12-31'
      });

      issueRepository.update(issue.id, {
        title: 'Updated title',
        description: 'Updated description',
        status: 'review',
        priority: 'high',
        labels: ['api', 'docs'],
        dueDate: '2000-01-01'
      });

      const activity = activityRepository.listByIssueId(issue.id);

      expect(activity.map((event) => event.type)).toEqual([
        'issue_created',
        'issue_title_changed',
        'issue_description_changed',
        'issue_status_changed',
        'issue_priority_changed',
        'issue_due_date_changed',
        'issue_labels_changed'
      ]);
      expect(activity[0].metadata).toEqual({ title: 'Initial title' });
      expect(activity.find((event) => event.type === 'issue_status_changed')?.metadata).toEqual({
        from: 'todo',
        to: 'review'
      });
      expect(activity.find((event) => event.type === 'issue_labels_changed')?.metadata).toEqual({
        from: ['ui'],
        to: ['api', 'docs']
      });
    } finally {
      database.close();
    }
  });

  it('returns an empty activity list for legacy issues without activity history', () => {
    const database = createDatabase(':memory:');
    const activityRepository = new ActivityRepository(database);
    const now = new Date().toISOString();

    try {
      database
        .prepare(
          `
          INSERT INTO issues (id, title, description, status, priority, labels, due_date, created_at, updated_at)
          VALUES (@id, @title, @description, @status, @priority, @labels, @dueDate, @createdAt, @updatedAt)
        `
        )
        .run({
          id: 'legacy-issue',
          title: 'Legacy issue',
          description: '',
          status: 'todo',
          priority: 'medium',
          labels: '[]',
          dueDate: null,
          createdAt: now,
          updatedAt: now
        });

      expect(activityRepository.listByIssueId('legacy-issue')).toEqual([]);
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
        labels: ['ui', 'persistence'],
        dueDate: '2999-12-31'
      });

      firstDatabase.close();

      const secondDatabase = createDatabase(databasePath);
      const secondRepository = new IssueRepository(secondDatabase);

      try {
        expect(secondRepository.getById(created.id)).toMatchObject({
          id: created.id,
          labels: ['ui', 'persistence'],
          dueDate: '2999-12-31',
          isOverdue: false
        });
      } finally {
        secondDatabase.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists saved filter views across a file-backed SQLite restart', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'tinytracker-filter-views-'));
    const databasePath = path.join(tempDir, 'tracker.sqlite');

    try {
      const firstDatabase = createDatabase(databasePath);
      const firstRepository = new SavedFilterViewRepository(firstDatabase);
      const created = firstRepository.create({
        name: ' Review backlog ',
        search: 'api',
        status: 'review',
        priority: 'high',
        includeArchived: true,
        pageSize: 50
      });

      firstDatabase.close();

      const secondDatabase = createDatabase(databasePath);
      const secondRepository = new SavedFilterViewRepository(secondDatabase);

      try {
        expect(secondRepository.getById(created.id)).toEqual(created);
        expect(secondRepository.list()).toEqual([created]);
        expect(() =>
          secondRepository.create({
            name: 'review backlog'
          })
        ).toThrow('Saved view name already exists');

        const renamed = secondRepository.update(created.id, { name: 'Ops backlog', pageSize: 10 });

        expect(renamed).toMatchObject({
          id: created.id,
          name: 'Ops backlog',
          search: 'api',
          status: 'review',
          priority: 'high',
          includeArchived: true,
          pageSize: 10
        });
        expect(secondRepository.delete(created.id)).toBe(true);
        expect(secondRepository.getById(created.id)).toBeNull();
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
      expect(() =>
        issueRepository.update(issue.id, {
          // @ts-expect-error intentionally invalid for runtime validation
          dueDate: 20260615
        })
      ).toThrow('Invalid issue due date');
      expect(() => issueRepository.update(issue.id, { dueDate: '2026-02-30' })).toThrow('Invalid issue due date');
      expect(() => issueRepository.update(issue.id, { dueDate: 'tomorrow' })).toThrow('Invalid issue due date');
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

  it('archives issues as a reversible visibility state with activity history', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);
    const activityRepository = new ActivityRepository(database);

    try {
      const issue = issueRepository.create({
        title: 'Archive repository issue',
        priority: 'high'
      });

      expect(issue.archivedAt).toBeNull();

      const archived = issueRepository.archive(issue.id);

      expect(archived).toMatchObject({
        id: issue.id,
        archivedAt: expect.any(String)
      });
      expect(issueRepository.list().items).toEqual([]);
      expect(issueRepository.list({ includeArchived: true }).items).toEqual([archived]);
      expect(issueRepository.list().summary.totalHighPriority).toBe(0);
      expect(issueRepository.list({ includeArchived: true }).summary.totalHighPriority).toBe(1);
      expect(activityRepository.listByIssueId(issue.id).map((event) => event.type)).toEqual([
        'issue_created',
        'issue_archived'
      ]);

      expect(issueRepository.archive(issue.id)).toEqual(archived);
      expect(activityRepository.listByIssueId(issue.id).map((event) => event.type)).toEqual([
        'issue_created',
        'issue_archived'
      ]);

      const unarchived = issueRepository.unarchive(issue.id);

      expect(unarchived).toMatchObject({
        id: issue.id,
        archivedAt: null
      });
      expect(issueRepository.list().items).toEqual([unarchived]);
      expect(activityRepository.listByIssueId(issue.id).map((event) => event.type)).toEqual([
        'issue_created',
        'issue_archived',
        'issue_unarchived'
      ]);
    } finally {
      database.close();
    }
  });

  it('persists dependencies and derives blocked state at repository boundaries', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);
    const dependencyRepository = new IssueDependencyRepository(database);
    const activityRepository = new ActivityRepository(database);

    try {
      const blocked = issueRepository.create({ title: 'Repository blocked issue' });
      const blocker = issueRepository.create({ title: 'Repository blocker' });
      const downstream = issueRepository.create({ title: 'Repository downstream' });

      expect(dependencyRepository.add(blocked.id, blocker.id)).toMatchObject({
        issueId: blocked.id,
        isBlocked: true,
        dependencies: [
          {
            id: blocker.id,
            title: 'Repository blocker',
            status: 'todo',
            archivedAt: null
          }
        ]
      });
      expect(issueRepository.getById(blocked.id)).toMatchObject({
        isBlocked: true,
        dependsOnIssueIds: [blocker.id]
      });
      expect(issueRepository.list().items.find((issue) => issue.id === blocked.id)).toMatchObject({
        isBlocked: true,
        dependsOnIssueIds: [blocker.id]
      });
      expect(() => dependencyRepository.add(blocked.id, blocker.id)).toThrow('Issue dependency already exists');
      expect(() => dependencyRepository.add(blocked.id, blocked.id)).toThrow('Issue cannot depend on itself');

      dependencyRepository.add(blocker.id, downstream.id);
      expect(() => dependencyRepository.add(downstream.id, blocked.id)).toThrow('Issue dependency cycle detected');

      issueRepository.close(blocker.id);
      expect(issueRepository.getById(blocked.id)).toMatchObject({
        isBlocked: false,
        dependsOnIssueIds: [blocker.id]
      });

      issueRepository.reopen(blocker.id);
      issueRepository.archive(blocker.id);
      expect(issueRepository.getById(blocked.id)).toMatchObject({
        isBlocked: false,
        dependsOnIssueIds: [blocker.id]
      });
      expect(() => dependencyRepository.add(downstream.id, blocker.id)).toThrow('Cannot depend on archived issue');

      dependencyRepository.remove(blocked.id, blocker.id);
      expect(issueRepository.getById(blocked.id)).toMatchObject({
        isBlocked: false,
        dependsOnIssueIds: []
      });
      expect(activityRepository.listByIssueId(blocked.id).map((event) => event.type)).toEqual([
        'issue_created',
        'issue_dependency_added',
        'issue_dependency_removed'
      ]);
    } finally {
      database.close();
    }
  });

  it('derives overdue state from due date and status', () => {
    const database = createDatabase(':memory:');
    const issueRepository = new IssueRepository(database);

    try {
      const withoutDueDate = issueRepository.create({ title: 'No due date' });
      const overdue = issueRepository.create({
        title: 'Past due active issue',
        dueDate: '2000-01-01'
      });
      const donePastDue = issueRepository.create({
        title: 'Past due done issue',
        status: 'done',
        dueDate: '2000-01-01'
      });
      const future = issueRepository.create({
        title: 'Future issue',
        dueDate: '2999-12-31'
      });

      expect(withoutDueDate).toMatchObject({ dueDate: null, isOverdue: false });
      expect(overdue).toMatchObject({ dueDate: '2000-01-01', isOverdue: true });
      expect(donePastDue).toMatchObject({ dueDate: '2000-01-01', isOverdue: false });
      expect(future).toMatchObject({ dueDate: '2999-12-31', isOverdue: false });

      expect(issueRepository.update(overdue.id, { status: 'done' })).toMatchObject({
        dueDate: '2000-01-01',
        isOverdue: false
      });
      expect(issueRepository.update(donePastDue.id, { dueDate: null })).toMatchObject({
        dueDate: null,
        isOverdue: false
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

      expect(issueRepository.list({ status: 'review' }).items).toEqual([docs]);
      expect(issueRepository.list({ priority: 'high' }).items).toEqual([bug]);
      expect(issueRepository.list({ search: 'oauth' }).items).toEqual([bug]);
      expect(issueRepository.list({ search: 'SETUP' }).items).toEqual([docs]);
      expect(issueRepository.list({ status: 'todo', priority: 'high', search: 'login' }).items).toEqual([bug]);
      expect(issueRepository.list({ status: 'done', priority: 'high' }).items).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('persists comments and records edit history', () => {
    const database = createDatabase(':memory:');
    const activityRepository = new ActivityRepository(database);
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

      expect(activityRepository.listByIssueId(issue.id).map((event) => event.type)).toEqual([
        'issue_created',
        'comment_added',
        'comment_edited'
      ]);

      expect(commentRepository.update(comment.id, { body: '  Edited comment  ' })).toMatchObject({
        id: comment.id,
        body: 'Edited comment'
      });
      expect(commentRepository.getHistory(comment.id)).toHaveLength(1);
      expect(activityRepository.listByIssueId(issue.id).map((event) => event.type)).toEqual([
        'issue_created',
        'comment_added',
        'comment_edited'
      ]);
    } finally {
      database.close();
    }
  });

  it('bulk reads comments, comment history, and activity for export assembly', () => {
    const database = createDatabase(':memory:');
    const activityRepository = new ActivityRepository(database);
    const issueRepository = new IssueRepository(database);
    const commentRepository = new CommentRepository(database);

    function groupIdsBy<T extends { id: string }>(items: T[], keySelector: (item: T) => string): Map<string, string[]> {
      const groups = new Map<string, string[]>();

      for (const item of items) {
        const key = keySelector(item);
        groups.set(key, [...(groups.get(key) ?? []), item.id]);
      }

      return groups;
    }

    try {
      const firstIssue = issueRepository.create({ title: 'Bulk export first issue' });
      const secondIssue = issueRepository.create({ title: 'Bulk export second issue' });
      const firstComment = commentRepository.create({
        issueId: firstIssue.id,
        body: 'First issue first comment'
      });
      const secondComment = commentRepository.create({
        issueId: firstIssue.id,
        body: 'First issue second comment'
      });
      const thirdComment = commentRepository.create({
        issueId: secondIssue.id,
        body: 'Second issue comment'
      });

      commentRepository.update(firstComment.id, { body: 'First issue first comment edit one' });
      commentRepository.update(firstComment.id, { body: 'First issue first comment edit two' });
      commentRepository.update(thirdComment.id, { body: 'Second issue comment edit' });

      const commentsByIssueId = groupIdsBy(
        commentRepository.listByIssueIds([secondIssue.id, firstIssue.id]),
        (comment) => comment.issueId
      );
      const historyByCommentId = groupIdsBy(
        commentRepository.getHistoryByCommentIds([thirdComment.id, secondComment.id, firstComment.id]),
        (history) => history.commentId
      );
      const activityByIssueId = groupIdsBy(
        activityRepository.listByIssueIds([secondIssue.id, firstIssue.id]),
        (event) => event.issueId
      );

      expect(commentsByIssueId.get(firstIssue.id)).toEqual(
        commentRepository.listByIssueId(firstIssue.id).map((comment) => comment.id)
      );
      expect(commentsByIssueId.get(secondIssue.id)).toEqual(
        commentRepository.listByIssueId(secondIssue.id).map((comment) => comment.id)
      );
      expect(historyByCommentId.get(firstComment.id)).toEqual(
        commentRepository.getHistory(firstComment.id).map((history) => history.id)
      );
      expect(historyByCommentId.get(secondComment.id)).toBeUndefined();
      expect(historyByCommentId.get(thirdComment.id)).toEqual(
        commentRepository.getHistory(thirdComment.id).map((history) => history.id)
      );
      expect(activityByIssueId.get(firstIssue.id)).toEqual(
        activityRepository.listByIssueId(firstIssue.id).map((event) => event.id)
      );
      expect(activityByIssueId.get(secondIssue.id)).toEqual(
        activityRepository.listByIssueId(secondIssue.id).map((event) => event.id)
      );
      expect(commentRepository.listByIssueIds([])).toEqual([]);
      expect(commentRepository.getHistoryByCommentIds([])).toEqual([]);
      expect(activityRepository.listByIssueIds([])).toEqual([]);
    } finally {
      database.close();
    }
  });
});
