import type Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export function initializeDatabase(db: SqliteDatabase) {
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Todo'
        CHECK (status IN ('Todo', 'In Progress', 'Review', 'Done')),
      priority TEXT NOT NULL DEFAULT 'Medium'
        CHECK (priority IN ('Low', 'Medium', 'High')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comment_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      previous_body TEXT NOT NULL,
      edited_at TEXT NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_comments_issue_id ON comments(issue_id);
    CREATE INDEX IF NOT EXISTS idx_comment_edits_comment_id ON comment_edits(comment_id);
  `);
}
