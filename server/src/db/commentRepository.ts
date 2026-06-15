import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { recordActivityEvent } from './activityRepository.js';
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

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function previewCommentBody(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();

  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function mapCommentRow(row: CommentRow): Comment {
  return {
    id: row.id,
    issueId: row.issue_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCommentEditHistoryRow(row: CommentEditHistoryRow): CommentEditHistory {
  return {
    id: row.id,
    commentId: row.comment_id,
    previousBody: row.previous_body,
    newBody: row.new_body,
    editedAt: row.edited_at
  };
}

function placeholdersFor(values: string[]): string {
  return values.map(() => '?').join(', ');
}

export class CommentRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: NewComment): Comment {
    assertNonEmptyString(input.issueId, 'issueId');
    assertNonEmptyString(input.body, 'body');

    const now = nowIso();
    const comment: Comment = {
      id: randomUUID(),
      issueId: input.issueId,
      body: input.body.trim(),
      createdAt: now,
      updatedAt: now
    };

    const transaction = this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO comments (id, issue_id, body, created_at, updated_at)
          VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
        `)
        .run({
          id: comment.id,
          issueId: comment.issueId,
          body: comment.body,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt
        });

      recordActivityEvent(this.database, {
        issueId: comment.issueId,
        type: 'comment_added',
        metadata: { commentId: comment.id, preview: previewCommentBody(comment.body) },
        createdAt: comment.createdAt
      });
    });

    transaction();
    return comment;
  }

  getById(id: string): Comment | null {
    const row = this.database
      .prepare(`
        SELECT id, issue_id, body, created_at, updated_at
        FROM comments
        WHERE id = @id
      `)
      .get({ id }) as CommentRow | undefined;

    return row ? mapCommentRow(row) : null;
  }

  listByIssueId(issueId: string): Comment[] {
    const rows = this.database
      .prepare(`
        SELECT id, issue_id, body, created_at, updated_at
        FROM comments
        WHERE issue_id = @issueId
        ORDER BY created_at ASC, rowid ASC
      `)
      .all({ issueId }) as CommentRow[];

    return rows.map(mapCommentRow);
  }

  listByIssueIds(issueIds: string[]): Comment[] {
    if (issueIds.length === 0) {
      return [];
    }

    const rows = this.database
      .prepare(`
        SELECT id, issue_id, body, created_at, updated_at
        FROM comments
        WHERE issue_id IN (${placeholdersFor(issueIds)})
        ORDER BY issue_id ASC, created_at ASC, rowid ASC
      `)
      .all(...issueIds) as CommentRow[];

    return rows.map(mapCommentRow);
  }

  update(id: string, input: CommentUpdate): Comment | null {
    assertNonEmptyString(input.body, 'body');

    const current = this.getById(id);
    if (!current) {
      return null;
    }

    const updatedAt = nowIso();
    const nextBody = input.body.trim();
    if (nextBody === current.body) {
      return current;
    }

    const transaction = this.database.transaction(() => {
      this.database
        .prepare(`
          UPDATE comments
          SET body = @body, updated_at = @updatedAt
          WHERE id = @id
        `)
        .run({ id, body: nextBody, updatedAt });

      this.database
        .prepare(`
          INSERT INTO comment_edit_history (id, comment_id, previous_body, new_body, edited_at)
          VALUES (@id, @commentId, @previousBody, @newBody, @editedAt)
        `)
        .run({
          id: randomUUID(),
          commentId: id,
          previousBody: current.body,
          newBody: nextBody,
          editedAt: updatedAt
        });

      recordActivityEvent(this.database, {
        issueId: current.issueId,
        type: 'comment_edited',
        metadata: {
          commentId: id,
          previousPreview: previewCommentBody(current.body),
          newPreview: previewCommentBody(nextBody)
        },
        createdAt: updatedAt
      });
    });

    transaction();
    return this.getById(id);
  }

  getHistory(commentId: string): CommentEditHistory[] {
    const rows = this.database
      .prepare(`
        SELECT id, comment_id, previous_body, new_body, edited_at
        FROM comment_edit_history
        WHERE comment_id = @commentId
        ORDER BY edited_at ASC, rowid ASC
      `)
      .all({ commentId }) as CommentEditHistoryRow[];

    return rows.map(mapCommentEditHistoryRow);
  }

  getHistoryByCommentIds(commentIds: string[]): CommentEditHistory[] {
    if (commentIds.length === 0) {
      return [];
    }

    const rows = this.database
      .prepare(`
        SELECT id, comment_id, previous_body, new_body, edited_at
        FROM comment_edit_history
        WHERE comment_id IN (${placeholdersFor(commentIds)})
        ORDER BY comment_id ASC, edited_at ASC, rowid ASC
      `)
      .all(...commentIds) as CommentEditHistoryRow[];

    return rows.map(mapCommentEditHistoryRow);
  }
}
