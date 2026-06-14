import Database from 'better-sqlite3';

const createIssuesTable = `
  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    labels TEXT NOT NULL DEFAULT '[]',
    due_date TEXT DEFAULT NULL,
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

function ensureIssueColumn(database: Database.Database, columnName: string, definition: string): void {
  const columns = database.prepare('PRAGMA table_info(issues)').all() as Array<{ name: string }>;
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    database.exec(`ALTER TABLE issues ADD COLUMN ${definition};`);
  }
}

export function ensureTinyTrackerSchema(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  database.exec(createIssuesTable);
  ensureIssueColumn(database, 'labels', "labels TEXT NOT NULL DEFAULT '[]'");
  ensureIssueColumn(database, 'due_date', 'due_date TEXT DEFAULT NULL');
  database.exec(createCommentsTable);
  database.exec(createCommentEditHistoryTable);
}

export const TABLE_NAMES = {
  issues: 'issues',
  comments: 'comments',
  commentEditHistory: 'comment_edit_history'
} as const;
