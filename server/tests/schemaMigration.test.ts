import Database from 'better-sqlite3';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ActivityRepository,
  CommentRepository,
  createDatabase,
  getTinyTrackerSchemaVersion,
  IssueRepository,
  SCHEMA_VERSION,
  TABLE_NAMES
} from '../src/db/index.js';

type NameRow = {
  name: string;
};

async function withTempDatabasePath<T>(run: (databasePath: string) => Promise<T> | T): Promise<T> {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tinytracker-schema-'));
  const databasePath = path.join(tempDir, 'tracker.sqlite');

  try {
    return await run(databasePath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createRawDatabase(databasePath: string): Database.Database {
  return new Database(databasePath);
}

function getTableNames(database: Database.Database): string[] {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as NameRow[]
  ).map((row) => row.name);
}

function getIndexNames(database: Database.Database): string[] {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as NameRow[]
  ).map((row) => row.name);
}

function getColumnNames(database: Database.Database, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as NameRow[]).map(
    (row) => row.name
  );
}

function expectCurrentSchema(database: Database.Database): void {
  expect(getTinyTrackerSchemaVersion(database)).toBe(SCHEMA_VERSION);
  expect(getTableNames(database)).toEqual([
    TABLE_NAMES.activityEvents,
    TABLE_NAMES.commentEditHistory,
    TABLE_NAMES.comments,
    TABLE_NAMES.issues
  ]);
  expect(getColumnNames(database, TABLE_NAMES.issues)).toEqual(
    expect.arrayContaining(['labels', 'due_date', 'archived_at'])
  );
  expect(getIndexNames(database)).toEqual(
    expect.arrayContaining([
      'idx_activity_events_issue_id_created_at',
      'idx_comment_edit_history_comment_id_edited_at',
      'idx_comments_issue_id_created_at',
      'idx_issues_archived_at_created_at'
    ])
  );
}

function createLegacyIssuesOnlyDatabase(databasePath: string): void {
  const database = createRawDatabase(databasePath);
  const now = new Date('2026-06-15T00:00:00.000Z').toISOString();

  try {
    database
      .prepare(`
        CREATE TABLE issues (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
      .run();
    database
      .prepare(`
        INSERT INTO issues (id, title, description, status, priority, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @createdAt, @updatedAt)
      `)
      .run({
        id: 'legacy-issue',
        title: 'Legacy issue',
        description: 'Created before schema versioning',
        status: 'todo',
        priority: 'high',
        createdAt: now,
        updatedAt: now
      });
  } finally {
    database.close();
  }
}

function createLegacyCommentsDatabase(databasePath: string): void {
  const database = createRawDatabase(databasePath);
  const now = new Date('2026-06-15T00:00:00.000Z').toISOString();

  try {
    database.exec(`
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database
      .prepare(`
        INSERT INTO issues (id, title, description, status, priority, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @createdAt, @updatedAt)
      `)
      .run({
        id: 'legacy-comment-issue',
        title: 'Legacy comment issue',
        description: '',
        status: 'review',
        priority: 'medium',
        createdAt: now,
        updatedAt: now
      });
    database
      .prepare(`
        INSERT INTO comments (id, issue_id, body, created_at, updated_at)
        VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
      `)
      .run({
        id: 'legacy-comment',
        issueId: 'legacy-comment-issue',
        body: 'Legacy comment body',
        createdAt: now,
        updatedAt: now
      });
  } finally {
    database.close();
  }
}

function createPartialIssueColumnDatabase(databasePath: string): void {
  const database = createRawDatabase(databasePath);
  const now = new Date('2026-06-15T00:00:00.000Z').toISOString();

  try {
    database.exec(`
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database
      .prepare(`
        INSERT INTO issues (id, title, description, status, priority, labels, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @labels, @createdAt, @updatedAt)
      `)
      .run({
        id: 'partial-column-issue',
        title: 'Partial issue columns',
        description: '',
        status: 'in_progress',
        priority: 'low',
        labels: JSON.stringify(['legacy']),
        createdAt: now,
        updatedAt: now
      });
  } finally {
    database.close();
  }
}

describe('schema migrations', () => {
  it('initializes a fresh database with the current schema version', async () => {
    await withTempDatabasePath((databasePath) => {
      const database = createDatabase(databasePath);

      try {
        expectCurrentSchema(database);
      } finally {
        database.close();
      }
    });
  });

  it('reopens an already-current database without changing existing rows', async () => {
    await withTempDatabasePath((databasePath) => {
      const firstDatabase = createDatabase(databasePath);
      const firstIssueRepository = new IssueRepository(firstDatabase);
      const created = firstIssueRepository.create({
        title: 'Repeatable migration issue',
        labels: ['schema'],
        dueDate: '2999-12-31'
      });

      expectCurrentSchema(firstDatabase);
      firstDatabase.close();

      const secondDatabase = createDatabase(databasePath);
      const secondIssueRepository = new IssueRepository(secondDatabase);

      try {
        expectCurrentSchema(secondDatabase);
        expect(secondIssueRepository.getById(created.id)).toMatchObject({
          id: created.id,
          title: 'Repeatable migration issue',
          labels: ['schema'],
          dueDate: '2999-12-31',
          archivedAt: null
        });
      } finally {
        secondDatabase.close();
      }
    });
  });

  it('upgrades an unversioned issues-only legacy database and preserves API/export behavior', async () => {
    await withTempDatabasePath(async (databasePath) => {
      createLegacyIssuesOnlyDatabase(databasePath);

      const migratedDatabase = createDatabase(databasePath);
      const issueRepository = new IssueRepository(migratedDatabase);
      const activityRepository = new ActivityRepository(migratedDatabase);

      try {
        expectCurrentSchema(migratedDatabase);
        expect(issueRepository.getById('legacy-issue')).toMatchObject({
          id: 'legacy-issue',
          title: 'Legacy issue',
          labels: [],
          dueDate: null,
          archivedAt: null
        });
        expect(activityRepository.listByIssueId('legacy-issue')).toEqual([]);
      } finally {
        migratedDatabase.close();
      }

      const app = createApp({ databasePath });
      const listResponse = await request(app).get('/api/issues').expect(200);
      const exportResponse = await request(app).get('/api/export').expect(200);

      expect(listResponse.body.items).toHaveLength(1);
      expect(listResponse.body.items[0]).toMatchObject({
        id: 'legacy-issue',
        archivedAt: null
      });
      expect(exportResponse.body).toMatchObject({
        exportVersion: 1,
        issues: [
          expect.objectContaining({
            id: 'legacy-issue',
            labels: [],
            dueDate: null,
            archivedAt: null,
            comments: [],
            activityEvents: []
          })
        ]
      });
    });
  });

  it('upgrades a legacy issues-and-comments database for history and activity writes', async () => {
    await withTempDatabasePath((databasePath) => {
      createLegacyCommentsDatabase(databasePath);

      const database = createDatabase(databasePath);
      const commentRepository = new CommentRepository(database);
      const activityRepository = new ActivityRepository(database);

      try {
        expectCurrentSchema(database);
        expect(commentRepository.listByIssueId('legacy-comment-issue')).toMatchObject([
          {
            id: 'legacy-comment',
            issueId: 'legacy-comment-issue',
            body: 'Legacy comment body'
          }
        ]);

        expect(commentRepository.update('legacy-comment', { body: 'Updated legacy comment' })).toMatchObject({
          id: 'legacy-comment',
          body: 'Updated legacy comment'
        });
        expect(commentRepository.getHistory('legacy-comment')).toHaveLength(1);
        expect(activityRepository.listByIssueId('legacy-comment-issue').map((event) => event.type)).toEqual([
          'comment_edited'
        ]);
      } finally {
        database.close();
      }
    });
  });

  it('upgrades partial issue-column legacy databases idempotently', async () => {
    await withTempDatabasePath((databasePath) => {
      createPartialIssueColumnDatabase(databasePath);

      const firstDatabase = createDatabase(databasePath);
      const firstRepository = new IssueRepository(firstDatabase);

      try {
        expectCurrentSchema(firstDatabase);
        expect(firstRepository.getById('partial-column-issue')).toMatchObject({
          id: 'partial-column-issue',
          labels: ['legacy'],
          dueDate: null,
          archivedAt: null
        });
      } finally {
        firstDatabase.close();
      }

      const secondDatabase = createDatabase(databasePath);

      try {
        expectCurrentSchema(secondDatabase);
      } finally {
        secondDatabase.close();
      }
    });
  });

  it('rejects databases created by a newer unsupported schema version', async () => {
    await withTempDatabasePath((databasePath) => {
      const database = createRawDatabase(databasePath);
      database.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
      database.close();

      expect(() => createDatabase(databasePath)).toThrow(
        `Unsupported TinyTracker schema version ${SCHEMA_VERSION + 1}`
      );
    });
  });

  it('does not mark an unrecoverable legacy schema as current when migration verification fails', async () => {
    await withTempDatabasePath((databasePath) => {
      const database = createRawDatabase(databasePath);
      database.exec(`
        CREATE TABLE issues (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      database.close();

      expect(() => createDatabase(databasePath)).toThrow(
        'TinyTracker schema is missing required issues columns'
      );

      const reopened = createRawDatabase(databasePath);

      try {
        expect(getTinyTrackerSchemaVersion(reopened)).toBe(0);
      } finally {
        reopened.close();
      }
    });
  });
});
