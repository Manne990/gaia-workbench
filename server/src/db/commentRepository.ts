import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { Comment, CommentEditHistory, CommentUpdate, NewComment } from './types.js';

type CommentRow = {
  id: string;
  issue_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

type CommentEditHistoryRow = {
  id: string;
  comment_id: string;
  previous_body: string;
  new_body: string;
  edited_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function mapCommentRow(row: CommentRow): Comment {
  return {
    id: row.id,
    issueId: row.issue_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCommentEditHistoryRow(row: CommentEditHistoryRow): CommentEditHistory {
  return {
    id: row.id,
    commentId: row.comment_id,
    previousBody: row.previous_body,
    newBody: row.new_body,
    editedAt: row.edited_at,
  };
}

export class CommentRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: NewComment): Comment {
    assertNonEmpty(input.issueId, 'issueId');
    assertNonEmpty(input.body, 'body');

    const now = nowIso();
    const id = randomUUID();
    const body = input.body.trim();

    const statement = this.database.prepare(`
      INSERT INTO comments (id, issue_id, body, created_at, updated_at)
      VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
    `);
    statement.run({
      id,
      issueId: input.issueId,
      body,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      issueId: input.issueId,
      body,
      createdAt: now,
      updatedAt: now,
    };
  }

  getById(id: string): Comment | null {
    const row = this.database
      .prepare(`
        SELECT
          id,
          issue_id,
          body,
          created_at,
          updated_at
        FROM comments
        WHERE id = @id
      `)
      .get({ id }) as CommentRow | undefined;

    if (!row) {
      return null;
    }

    return mapCommentRow(row);
  }

  listByIssueId(issueId: string): Comment[] {
    const rows = this.database
      .prepare(`
        SELECT
          id,
          issue_id,
          body,
          created_at,
          updated_at
        FROM comments
        WHERE issue_id = @issueId
        ORDER BY created_at ASC
      `)
      .all({ issueId }) as CommentRow[];

    return rows.map(mapCommentRow);
  }

  update(id: string, input: CommentUpdate): Comment | null {
    assertNonEmpty(input.body, 'body');

    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    const now = nowIso();
    const nextBody = input.body.trim();
    const historyId = randomUUID();
    const updateTransaction = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE comments
        SET body = @body, updated_at = @updatedAt
        WHERE id = @id
      `).run({ id, body: nextBody, updatedAt: now });

      this.database.prepare(`
        INSERT INTO comment_edit_history (id, comment_id, previous_body, new_body, edited_at)
        VALUES (@historyId, @commentId, @previousBody, @newBody, @editedAt)
      `).run({
        historyId,
        commentId: id,
        previousBody: existing.body,
        newBody: nextBody,
        editedAt: now,
      });
    });

    updateTransaction();

    return {
      ...existing,
      body: nextBody,
      updatedAt: now,
    };
  }

  getHistory(commentId: string): CommentEditHistory[] {
    const rows = this.database
      .prepare(`
        SELECT
          id,
          comment_id,
          previous_body,
          new_body,
          edited_at
        FROM comment_edit_history
        WHERE comment_id = @commentId
        ORDER BY edited_at ASC
      `)
      .all({ commentId }) as CommentEditHistoryRow[];

    return rows.map(mapCommentEditHistoryRow);
  }
}
