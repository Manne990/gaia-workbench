import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ActivityRepository,
  CommentRepository,
  createDatabase,
  IssueRepository
} from '../src/db/index.js';
import { seedDemoData } from '../src/seedDemoData.js';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

describe('demo data seed command', () => {
  it('seeds representative demo data into the configured database and skips duplicates on rerun', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'tinytracker-demo-seed-'));
    const databasePath = path.join(tempDir, 'tracker.sqlite');

    try {
      const firstRun = seedDemoData(databasePath);
      const secondRun = seedDemoData(databasePath);

      expect(firstRun).toMatchObject({
        databasePath,
        createdIssues: 4,
        skippedIssues: 0,
        updatedIssues: 1,
        createdComments: 5,
        skippedComments: 0,
        editedComments: 1
      });
      expect(secondRun).toMatchObject({
        databasePath,
        createdIssues: 0,
        skippedIssues: 4,
        updatedIssues: 0,
        createdComments: 0,
        skippedComments: 5,
        editedComments: 0
      });

      const database = createDatabase(databasePath);
      const issueRepository = new IssueRepository(database);
      const commentRepository = new CommentRepository(database);
      const activityRepository = new ActivityRepository(database);

      try {
        const issues = issueRepository.list();
        const byTitle = new Map(issues.map((issue) => [issue.title, issue]));
        const overdue = byTitle.get('Demo: Fix overdue activity review');
        const done = byTitle.get('Demo: Close resolved mobile polish');
        const onboarding = byTitle.get('Demo: Triage onboarding feedback');
        const exportSnapshot = byTitle.get('Demo: Export tracker snapshot');

        expect(issues).toHaveLength(4);
        expect(onboarding).toMatchObject({
          dueDate: null,
          isOverdue: false
        });
        expect(overdue).toMatchObject({
          status: 'in_progress',
          priority: 'high',
          labels: ['demo', 'activity'],
          dueDate: '2000-01-01',
          isOverdue: true
        });
        expect(done).toMatchObject({
          status: 'done',
          priority: 'low',
          labels: ['demo', 'mobile'],
          dueDate: '2000-01-01',
          isOverdue: false
        });
        expect(onboarding).toBeDefined();
        expect(exportSnapshot).toMatchObject({
          status: 'review',
          priority: 'medium',
          labels: ['demo', 'export'],
          dueDate: '2999-06-30'
        });

        const comments = commentRepository.listByIssueId(onboarding!.id);
        const editedComment = comments.find((comment) =>
          comment.body.includes('grouped by dashboard area')
        );

        expect(comments).toHaveLength(2);
        expect(editedComment).toBeDefined();
        expect(commentRepository.getHistory(editedComment!.id)).toHaveLength(1);
        expect(activityRepository.listByIssueId(onboarding!.id).map((event) => event.type)).toEqual(
          expect.arrayContaining(['issue_created', 'comment_added', 'comment_edited'])
        );
        expect(
          activityRepository.listByIssueId(exportSnapshot!.id).map((event) => event.type)
        ).toEqual(
          expect.arrayContaining(['issue_created', 'issue_status_changed', 'issue_priority_changed'])
        );
      } finally {
        database.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses DATABASE_PATH when invoked through the npm seed script', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'tinytracker-demo-seed-cli-'));
    const databasePath = path.join(tempDir, 'tracker.sqlite');
    const env = { ...process.env, DATABASE_PATH: databasePath };

    try {
      const firstOutput = execFileSync(npmCommand, ['run', 'seed:demo', '--silent'], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8'
      });
      const secondOutput = execFileSync(npmCommand, ['run', 'seed:demo', '--silent'], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8'
      });

      expect(firstOutput).toContain(`TinyTracker demo seed complete (${databasePath})`);
      expect(firstOutput).toContain('issues created: 4');
      expect(firstOutput).toContain('issue transitions recorded: 1');
      expect(secondOutput).toContain(`TinyTracker demo seed complete (${databasePath})`);
      expect(secondOutput).toContain('issues created: 0');
      expect(secondOutput).toContain('issues skipped: 4');

      const database = createDatabase(databasePath);
      const issueRepository = new IssueRepository(database);

      try {
        expect(issueRepository.list()).toHaveLength(4);
      } finally {
        database.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
