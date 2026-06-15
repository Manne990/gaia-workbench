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
  IssueDependencyRepository,
  IssueRepository,
  SCHEMA_VERSION,
  SavedFilterViewRepository,
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
  return (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as NameRow[]).map(
    (row) => row.name
  );
}

function getIndexNames(database: Database.Database): string[] {
  return (database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as NameRow[]).map(
    (row) => row.name
  );
}

function getColumnNames(database: Database.Database, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as NameRow[]).map((row) => row.name);
}

function expectCurrentSchema(database: Database.Database): void {
  expect(getTinyTrackerSchemaVersion(database)).toBe(SCHEMA_VERSION);
  expect(getTableNames(database)).toEqual([
    TABLE_NAMES.activityEvents,
    TABLE_NAMES.commentEditHistory,
    TABLE_NAMES.comments,
    TABLE_NAMES.issueDependencies,
    TABLE_NAMES.issues,
    TABLE_NAMES.savedFilterViews
  ]);
  expect(getColumnNames(database, TABLE_NAMES.issueDependencies)).toEqual(
    expect.arrayContaining(['issue_id', 'depends_on_issue_id', 'created_at', 'updated_at'])
  );
  expect(getColumnNames(database, TABLE_NAMES.savedFilterViews)).toEqual(
    expect.arrayContaining([
      'id',
      'name',
      'search',
      'status',
      'priority',
      'label',
      'include_archived',
      'blocked_only',
      'stale_only',
      'page_size',
      'created_at',
      'updated_at'
    ])
  );
  expect(getColumnNames(database, TABLE_NAMES.issues)).toEqual(
    expect.arrayContaining(['labels', 'due_date', 'archived_at'])
  );
  expect(getIndexNames(database)).toEqual(
    expect.arrayContaining([
      'idx_activity_events_issue_id_created_at',
      'idx_comment_edit_history_comment_id_edited_at',
      'idx_comments_issue_id_created_at',
      'idx_issue_dependencies_depends_on_issue_id',
      'idx_issue_dependencies_issue_id',
      'idx_issues_archived_at_created_at',
      'idx_saved_filter_views_name',
      'idx_saved_filter_views_updated_at'
    ])
  );
}

function createVersionOneDatabase(databasePath: string): void {
  const database = createRawDatabase(databasePath);

  try {
    database.exec(`
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        labels TEXT NOT NULL DEFAULT '[]',
        due_date TEXT DEFAULT NULL,
        archived_at TEXT DEFAULT NULL,
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

      CREATE TABLE comment_edit_history (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        previous_body TEXT NOT NULL,
        new_body TEXT NOT NULL,
        edited_at TEXT NOT NULL
      );

      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_activity_events_issue_id_created_at
      ON activity_events (issue_id, created_at);
      CREATE INDEX idx_comment_edit_history_comment_id_edited_at
      ON comment_edit_history (comment_id, edited_at);
      CREATE INDEX idx_comments_issue_id_created_at
      ON comments (issue_id, created_at);
      CREATE INDEX idx_issues_archived_at_created_at
      ON issues (archived_at, created_at);

      PRAGMA user_version = 1;
    `);
  } finally {
    database.close();
  }
}

function seedVersionOneDurableData(databasePath: string): void {
  const database = createRawDatabase(databasePath);
  const createdAt = new Date('2026-06-15T00:00:00.000Z').toISOString();
  const updatedAt = new Date('2026-06-15T01:00:00.000Z').toISOString();

  try {
    database
      .prepare(
        `
        INSERT INTO issues (
          id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        )
        VALUES (
          @id, @title, @description, @status, @priority, @labels, @dueDate, @archivedAt, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id: 'version-one-issue',
        title: 'Version one durable issue',
        description: 'Preserve v1 issue rows',
        status: 'in_progress',
        priority: 'high',
        labels: JSON.stringify(['migration', 'v1']),
        dueDate: '2026-07-01',
        archivedAt: null,
        createdAt,
        updatedAt
      });
    database
      .prepare(
        `
        INSERT INTO comments (id, issue_id, body, created_at, updated_at)
        VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
      `
      )
      .run({
        id: 'version-one-comment',
        issueId: 'version-one-issue',
        body: 'Version one durable comment',
        createdAt,
        updatedAt
      });
    database
      .prepare(
        `
        INSERT INTO comment_edit_history (id, comment_id, previous_body, new_body, edited_at)
        VALUES (@id, @commentId, @previousBody, @newBody, @editedAt)
      `
      )
      .run({
        id: 'version-one-comment-history',
        commentId: 'version-one-comment',
        previousBody: 'Original v1 comment',
        newBody: 'Version one durable comment',
        editedAt: updatedAt
      });
    database
      .prepare(
        `
        INSERT INTO activity_events (id, issue_id, event_type, metadata, created_at)
        VALUES (@id, @issueId, @eventType, @metadata, @createdAt)
      `
      )
      .run({
        id: 'version-one-activity',
        issueId: 'version-one-issue',
        eventType: 'issue_created',
        metadata: JSON.stringify({ title: 'Version one durable issue' }),
        createdAt
      });
  } finally {
    database.close();
  }
}

function createVersionFourDatabaseWithoutStaleFilter(databasePath: string): void {
  createVersionOneDatabase(databasePath);

  const database = createRawDatabase(databasePath);
  const now = new Date('2026-06-15T00:00:00.000Z').toISOString();

  try {
    database.exec(`
      CREATE TABLE saved_filter_views (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE,
        search TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'all' CHECK (status IN ('all', 'todo', 'in_progress', 'review', 'done')),
        priority TEXT NOT NULL DEFAULT 'all' CHECK (priority IN ('all', 'low', 'medium', 'high')),
        include_archived INTEGER NOT NULL DEFAULT 0 CHECK (include_archived IN (0, 1)),
        blocked_only INTEGER NOT NULL DEFAULT 0 CHECK (blocked_only IN (0, 1)),
        page_size INTEGER NOT NULL DEFAULT 25 CHECK (page_size >= 1 AND page_size <= 100),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX idx_saved_filter_views_name
      ON saved_filter_views (name COLLATE NOCASE);
      CREATE INDEX idx_saved_filter_views_updated_at
      ON saved_filter_views (updated_at);

      CREATE TABLE issue_dependencies (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        depends_on_issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (issue_id, depends_on_issue_id)
      );

      CREATE INDEX idx_issue_dependencies_issue_id
      ON issue_dependencies (issue_id);
      CREATE INDEX idx_issue_dependencies_depends_on_issue_id
      ON issue_dependencies (depends_on_issue_id);

      INSERT INTO saved_filter_views (
        id, name, search, status, priority, include_archived, blocked_only, page_size, created_at, updated_at
      )
      VALUES (
        'legacy-saved-view', 'Legacy view', 'legacy', 'review', 'high', 1, 1, 50, '${now}', '${now}'
      );

      PRAGMA user_version = 4;
    `);
  } finally {
    database.close();
  }
}

function createVersionFourDatabaseWithDurableData(databasePath: string): void {
  createVersionFourDatabaseWithoutStaleFilter(databasePath);

  const database = createRawDatabase(databasePath);
  const createdAt = new Date('2026-06-15T00:00:00.000Z').toISOString();
  const updatedAt = new Date('2026-06-15T01:00:00.000Z').toISOString();

  try {
    database
      .prepare(
        `
        INSERT INTO issues (
          id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        )
        VALUES (
          @id, @title, @description, @status, @priority, @labels, @dueDate, @archivedAt, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id: 'version-four-blocker',
        title: 'Version four blocker',
        description: 'Dependency source row',
        status: 'in_progress',
        priority: 'medium',
        labels: JSON.stringify(['migration']),
        dueDate: null,
        archivedAt: null,
        createdAt,
        updatedAt
      });
    database
      .prepare(
        `
        INSERT INTO issues (
          id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        )
        VALUES (
          @id, @title, @description, @status, @priority, @labels, @dueDate, @archivedAt, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id: 'version-four-blocked',
        title: 'Version four blocked issue',
        description: 'Dependency target row',
        status: 'todo',
        priority: 'high',
        labels: JSON.stringify(['migration', 'blocked']),
        dueDate: '2026-08-01',
        archivedAt: null,
        createdAt,
        updatedAt
      });
    database
      .prepare(
        `
        INSERT INTO issue_dependencies (issue_id, depends_on_issue_id, created_at, updated_at)
        VALUES (@issueId, @dependsOnIssueId, @createdAt, @updatedAt)
      `
      )
      .run({
        issueId: 'version-four-blocked',
        dependsOnIssueId: 'version-four-blocker',
        createdAt,
        updatedAt
      });
  } finally {
    database.close();
  }
}

function createLegacyIssuesOnlyDatabase(databasePath: string): void {
  const database = createRawDatabase(databasePath);
  const now = new Date('2026-06-15T00:00:00.000Z').toISOString();

  try {
    database
      .prepare(
        `
        CREATE TABLE issues (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `
      )
      .run();
    database
      .prepare(
        `
        INSERT INTO issues (id, title, description, status, priority, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @createdAt, @updatedAt)
      `
      )
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
      .prepare(
        `
        INSERT INTO issues (id, title, description, status, priority, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @createdAt, @updatedAt)
      `
      )
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
      .prepare(
        `
        INSERT INTO comments (id, issue_id, body, created_at, updated_at)
        VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
      `
      )
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
      .prepare(
        `
        INSERT INTO issues (id, title, description, status, priority, labels, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @labels, @createdAt, @updatedAt)
      `
      )
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

  it('upgrades a version 1 database with saved filter views and dependencies', async () => {
    await withTempDatabasePath((databasePath) => {
      createVersionOneDatabase(databasePath);

      const database = createDatabase(databasePath);

      try {
        expectCurrentSchema(database);
        expect(getTinyTrackerSchemaVersion(database)).toBe(SCHEMA_VERSION);
      } finally {
        database.close();
      }
    });
  });

  it('upgrades existing saved filter views with default stale-only and label filters', async () => {
    await withTempDatabasePath((databasePath) => {
      createVersionFourDatabaseWithoutStaleFilter(databasePath);

      const database = createDatabase(databasePath);
      const savedFilterViewRepository = new SavedFilterViewRepository(database);

      try {
        expectCurrentSchema(database);
        expect(savedFilterViewRepository.list()).toMatchObject([
          {
            id: 'legacy-saved-view',
            name: 'Legacy view',
            search: 'legacy',
            status: 'review',
            priority: 'high',
            label: '',
            includeArchived: true,
            blockedOnly: true,
            staleOnly: false,
            pageSize: 50
          }
        ]);
      } finally {
        database.close();
      }
    });
  });

  it('migrates historical user-version states while preserving durable data', async () => {
    const migrationCases = [
      {
        name: 'version 1 issue, comment, history, and activity rows',
        createLegacyDatabase(databasePath: string) {
          createVersionOneDatabase(databasePath);
          seedVersionOneDurableData(databasePath);
        },
        assertPreservedData(database: Database.Database) {
          const issueRepository = new IssueRepository(database);
          const commentRepository = new CommentRepository(database);
          const activityRepository = new ActivityRepository(database);

          expect(issueRepository.getById('version-one-issue')).toMatchObject({
            id: 'version-one-issue',
            title: 'Version one durable issue',
            description: 'Preserve v1 issue rows',
            status: 'in_progress',
            priority: 'high',
            labels: ['migration', 'v1'],
            dueDate: '2026-07-01',
            archivedAt: null,
            isBlocked: false,
            dependsOnIssueIds: []
          });
          expect(commentRepository.listByIssueId('version-one-issue')).toMatchObject([
            {
              id: 'version-one-comment',
              issueId: 'version-one-issue',
              body: 'Version one durable comment'
            }
          ]);
          expect(commentRepository.getHistory('version-one-comment')).toMatchObject([
            {
              id: 'version-one-comment-history',
              commentId: 'version-one-comment',
              previousBody: 'Original v1 comment',
              newBody: 'Version one durable comment'
            }
          ]);
          expect(activityRepository.listByIssueId('version-one-issue')).toMatchObject([
            {
              id: 'version-one-activity',
              issueId: 'version-one-issue',
              type: 'issue_created',
              metadata: { title: 'Version one durable issue' }
            }
          ]);
        }
      },
      {
        name: 'version 4 saved views and dependency rows',
        createLegacyDatabase(databasePath: string) {
          createVersionFourDatabaseWithDurableData(databasePath);
        },
        assertPreservedData(database: Database.Database) {
          const issueRepository = new IssueRepository(database);
          const issueDependencyRepository = new IssueDependencyRepository(database);
          const savedFilterViewRepository = new SavedFilterViewRepository(database);

          expect(savedFilterViewRepository.getById('legacy-saved-view')).toMatchObject({
            id: 'legacy-saved-view',
            name: 'Legacy view',
            search: 'legacy',
            status: 'review',
            priority: 'high',
            label: '',
            includeArchived: true,
            blockedOnly: true,
            staleOnly: false,
            pageSize: 50
          });
          expect(issueRepository.getById('version-four-blocked')).toMatchObject({
            id: 'version-four-blocked',
            title: 'Version four blocked issue',
            labels: ['migration', 'blocked'],
            dueDate: '2026-08-01',
            isBlocked: true,
            dependsOnIssueIds: ['version-four-blocker']
          });
          expect(issueDependencyRepository.listByIssueId('version-four-blocked')).toMatchObject({
            issueId: 'version-four-blocked',
            isBlocked: true,
            dependencies: [
              {
                id: 'version-four-blocker',
                title: 'Version four blocker',
                status: 'in_progress',
                archivedAt: null
              }
            ],
            dependents: []
          });
        }
      }
    ];

    for (const migrationCase of migrationCases) {
      await withTempDatabasePath((databasePath) => {
        migrationCase.createLegacyDatabase(databasePath);

        const database = createDatabase(databasePath);

        try {
          expectCurrentSchema(database);
          migrationCase.assertPreservedData(database);
        } finally {
          database.close();
        }
      });
    }
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

      expect(() => createDatabase(databasePath)).toThrow('TinyTracker schema is missing required issues columns');

      const reopened = createRawDatabase(databasePath);

      try {
        expect(getTinyTrackerSchemaVersion(reopened)).toBe(0);
      } finally {
        reopened.close();
      }
    });
  });
});
