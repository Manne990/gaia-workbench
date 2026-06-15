import Database from 'better-sqlite3';

// Add future migrations to MIGRATIONS in version order and bump this value.
// Existing file-backed databases may start at user_version 0.
export const SCHEMA_VERSION = 6;

const createIssuesTable = `
  CREATE TABLE IF NOT EXISTS issues (
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
`;

const createCommentsTable = `
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const createCommentEditHistoryTable = `
  CREATE TABLE IF NOT EXISTS comment_edit_history (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    previous_body TEXT NOT NULL,
    new_body TEXT NOT NULL,
    edited_at TEXT NOT NULL
  );
`;

const createCommentsIssueIndex = `
  CREATE INDEX IF NOT EXISTS idx_comments_issue_id_created_at
  ON comments (issue_id, created_at);
`;

const createCommentEditHistoryCommentIndex = `
  CREATE INDEX IF NOT EXISTS idx_comment_edit_history_comment_id_edited_at
  ON comment_edit_history (comment_id, edited_at);
`;

const createActivityEventsTable = `
  CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
`;

const createActivityEventsIssueIndex = `
  CREATE INDEX IF NOT EXISTS idx_activity_events_issue_id_created_at
  ON activity_events (issue_id, created_at);
`;

const createIssuesArchivedIndex = `
  CREATE INDEX IF NOT EXISTS idx_issues_archived_at_created_at
  ON issues (archived_at, created_at);
`;

const createSavedFilterViewsTable = `
  CREATE TABLE IF NOT EXISTS saved_filter_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE,
    search TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'all' CHECK (status IN ('all', 'todo', 'in_progress', 'review', 'done')),
    priority TEXT NOT NULL DEFAULT 'all' CHECK (priority IN ('all', 'low', 'medium', 'high')),
    label TEXT NOT NULL DEFAULT '',
    include_archived INTEGER NOT NULL DEFAULT 0 CHECK (include_archived IN (0, 1)),
    blocked_only INTEGER NOT NULL DEFAULT 0 CHECK (blocked_only IN (0, 1)),
    stale_only INTEGER NOT NULL DEFAULT 0 CHECK (stale_only IN (0, 1)),
    page_size INTEGER NOT NULL DEFAULT 25 CHECK (page_size >= 1 AND page_size <= 100),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const createSavedFilterViewsNameIndex = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_filter_views_name
  ON saved_filter_views (name COLLATE NOCASE);
`;

const createSavedFilterViewsUpdatedAtIndex = `
  CREATE INDEX IF NOT EXISTS idx_saved_filter_views_updated_at
  ON saved_filter_views (updated_at);
`;

const createIssueDependenciesTable = `
  CREATE TABLE IF NOT EXISTS issue_dependencies (
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    depends_on_issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (issue_id, depends_on_issue_id)
  );
`;

const createIssueDependenciesIssueIndex = `
  CREATE INDEX IF NOT EXISTS idx_issue_dependencies_issue_id
  ON issue_dependencies (issue_id);
`;

const createIssueDependenciesDependsOnIndex = `
  CREATE INDEX IF NOT EXISTS idx_issue_dependencies_depends_on_issue_id
  ON issue_dependencies (depends_on_issue_id);
`;

type Migration = {
  version: number;
  name: string;
  up: (database: Database.Database) => void;
};

type PragmaUserVersionRow = {
  user_version: number;
};

type SchemaNameRow = {
  name: string;
};

type TableColumnRow = {
  name: string;
};

function ensureColumn(database: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition};`);
  }
}

function runCurrentSchemaMigration(database: Database.Database): void {
  database.exec(createIssuesTable);
  ensureColumn(database, TABLE_NAMES.issues, 'labels', "labels TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, TABLE_NAMES.issues, 'due_date', 'due_date TEXT DEFAULT NULL');
  ensureColumn(database, TABLE_NAMES.issues, 'archived_at', 'archived_at TEXT DEFAULT NULL');
  database.exec(createIssuesArchivedIndex);
  database.exec(createActivityEventsTable);
  database.exec(createActivityEventsIssueIndex);
  database.exec(createCommentsTable);
  database.exec(createCommentsIssueIndex);
  database.exec(createCommentEditHistoryTable);
  database.exec(createCommentEditHistoryCommentIndex);
}

function runSavedFilterViewsMigration(database: Database.Database): void {
  database.exec(createSavedFilterViewsTable);
  database.exec(createSavedFilterViewsNameIndex);
  database.exec(createSavedFilterViewsUpdatedAtIndex);
}

function runSavedFilterViewsBlockedOnlyMigration(database: Database.Database): void {
  ensureColumn(
    database,
    TABLE_NAMES.savedFilterViews,
    'blocked_only',
    'blocked_only INTEGER NOT NULL DEFAULT 0 CHECK (blocked_only IN (0, 1))'
  );
}

function runIssueDependenciesMigration(database: Database.Database): void {
  database.exec(createIssueDependenciesTable);
  database.exec(createIssueDependenciesIssueIndex);
  database.exec(createIssueDependenciesDependsOnIndex);
}

function runSavedFilterViewsStaleOnlyMigration(database: Database.Database): void {
  ensureColumn(
    database,
    TABLE_NAMES.savedFilterViews,
    'stale_only',
    'stale_only INTEGER NOT NULL DEFAULT 0 CHECK (stale_only IN (0, 1))'
  );
}

function runSavedFilterViewsLabelMigration(database: Database.Database): void {
  ensureColumn(database, TABLE_NAMES.savedFilterViews, 'label', "label TEXT NOT NULL DEFAULT ''");
}

export const TABLE_NAMES = {
  activityEvents: 'activity_events',
  issues: 'issues',
  comments: 'comments',
  commentEditHistory: 'comment_edit_history',
  issueDependencies: 'issue_dependencies',
  savedFilterViews: 'saved_filter_views'
} as const;

const REQUIRED_TABLES = [
  TABLE_NAMES.activityEvents,
  TABLE_NAMES.commentEditHistory,
  TABLE_NAMES.comments,
  TABLE_NAMES.issueDependencies,
  TABLE_NAMES.issues,
  TABLE_NAMES.savedFilterViews
] as const;

const REQUIRED_INDEXES = [
  'idx_activity_events_issue_id_created_at',
  'idx_comment_edit_history_comment_id_edited_at',
  'idx_comments_issue_id_created_at',
  'idx_issue_dependencies_depends_on_issue_id',
  'idx_issue_dependencies_issue_id',
  'idx_issues_archived_at_created_at',
  'idx_saved_filter_views_name',
  'idx_saved_filter_views_updated_at'
] as const;

const REQUIRED_COLUMNS_BY_TABLE: Record<(typeof REQUIRED_TABLES)[number], readonly string[]> = {
  [TABLE_NAMES.activityEvents]: ['id', 'issue_id', 'event_type', 'metadata', 'created_at'],
  [TABLE_NAMES.commentEditHistory]: ['id', 'comment_id', 'previous_body', 'new_body', 'edited_at'],
  [TABLE_NAMES.comments]: ['id', 'issue_id', 'body', 'created_at', 'updated_at'],
  [TABLE_NAMES.issueDependencies]: ['issue_id', 'depends_on_issue_id', 'created_at', 'updated_at'],
  [TABLE_NAMES.issues]: [
    'id',
    'title',
    'description',
    'status',
    'priority',
    'labels',
    'due_date',
    'archived_at',
    'created_at',
    'updated_at'
  ],
  [TABLE_NAMES.savedFilterViews]: [
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
  ]
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_create_current_schema',
    up: runCurrentSchemaMigration
  },
  {
    version: 2,
    name: '002_create_saved_filter_views',
    up: runSavedFilterViewsMigration
  },
  {
    version: 3,
    name: '003_create_issue_dependencies',
    up: runIssueDependenciesMigration
  },
  {
    version: 4,
    name: '004_add_blocked_only_to_saved_filter_views',
    up: runSavedFilterViewsBlockedOnlyMigration
  },
  {
    version: 5,
    name: '005_add_saved_filter_view_stale_only',
    up: runSavedFilterViewsStaleOnlyMigration
  },
  {
    version: 6,
    name: '006_add_saved_filter_view_label',
    up: runSavedFilterViewsLabelMigration
  }
];

export function getTinyTrackerSchemaVersion(database: Database.Database): number {
  const pragmaResult = database.pragma('user_version');
  const row = Array.isArray(pragmaResult) ? (pragmaResult[0] as PragmaUserVersionRow | undefined) : undefined;

  return row?.user_version ?? 0;
}

function setTinyTrackerSchemaVersion(database: Database.Database, version: number): void {
  database.exec(`PRAGMA user_version = ${version};`);
}

function getExistingTableNames(database: Database.Database): Set<string> {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as SchemaNameRow[];

  return new Set(rows.map((row) => row.name));
}

function getExistingIndexNames(database: Database.Database): Set<string> {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as SchemaNameRow[];

  return new Set(rows.map((row) => row.name));
}

function getExistingColumnNames(database: Database.Database, tableName: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnRow[];

  return new Set(rows.map((row) => row.name));
}

function assertNamesPresent(kind: string, actual: Set<string>, expected: readonly string[]): void {
  const missing = expected.filter((name) => !actual.has(name));

  if (missing.length > 0) {
    throw new Error(`TinyTracker schema is missing required ${kind}: ${missing.join(', ')}`);
  }
}

function verifyTinyTrackerSchema(database: Database.Database): void {
  const tables = getExistingTableNames(database);
  assertNamesPresent('tables', tables, REQUIRED_TABLES);

  for (const tableName of REQUIRED_TABLES) {
    assertNamesPresent(`${tableName} columns`, getExistingColumnNames(database, tableName), [
      ...REQUIRED_COLUMNS_BY_TABLE[tableName]
    ]);
  }

  assertNamesPresent('indexes', getExistingIndexNames(database), REQUIRED_INDEXES);

  const foreignKeyFailures = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyFailures.length > 0) {
    throw new Error('TinyTracker schema foreign key check failed');
  }
}

export function ensureTinyTrackerSchema(database: Database.Database): void {
  database.pragma('foreign_keys = ON');

  const currentVersion = getTinyTrackerSchemaVersion(database);

  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`Unsupported TinyTracker schema version ${currentVersion}; expected ${SCHEMA_VERSION} or lower`);
  }

  if (currentVersion === SCHEMA_VERSION) {
    verifyTinyTrackerSchema(database);
    return;
  }

  const pendingMigrations = MIGRATIONS.filter(
    (migration) => migration.version > currentVersion && migration.version <= SCHEMA_VERSION
  );

  if (pendingMigrations.length === 0) {
    throw new Error(`No TinyTracker schema migration path from version ${currentVersion} to ${SCHEMA_VERSION}`);
  }

  for (const migration of MIGRATIONS) {
    if (!pendingMigrations.includes(migration)) {
      continue;
    }
    migration.up(database);
  }

  verifyTinyTrackerSchema(database);
  setTinyTrackerSchemaVersion(database, SCHEMA_VERSION);
}
