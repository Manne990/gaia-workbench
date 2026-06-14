import type { SqliteDatabase } from "./schema.js";

export const issueStatuses = ["Todo", "In Progress", "Review", "Done"] as const;
export const issuePriorities = ["Low", "Medium", "High"] as const;

export type IssueStatus = (typeof issueStatuses)[number];
export type IssuePriority = (typeof issuePriorities)[number];

export interface Issue {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: number;
  issueId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentEdit {
  id: number;
  commentId: number;
  previousBody: string;
  editedAt: string;
}

interface IssueRow {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: number;
  issue_id: number;
  body: string;
  created_at: string;
  updated_at: string;
}

interface CommentEditRow {
  id: number;
  comment_id: number;
  previous_body: string;
  edited_at: string;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  closed?: boolean;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  closed?: boolean;
}

export interface IssueListOptions {
  status?: IssueStatus;
  search?: string;
  title?: string;
  description?: string;
}

export interface AddCommentInput {
  issueId: number;
  body: string;
}

export class IssueRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  createIssue(input: CreateIssueInput): Issue {
    const timestamp = this.now();
    const status = resolveIssueStatus({
      status: input.status,
      closed: input.closed
    });
    const priority = resolveIssuePriority(input.priority);

    const result = this.db
      .prepare<{
        title: string;
        description: string;
        status: IssueStatus;
        priority: IssuePriority;
        createdAt: string;
        updatedAt: string;
      }>(
        `
          INSERT INTO issues (title, description, status, priority, created_at, updated_at)
          VALUES (@title, @description, @status, @priority, @createdAt, @updatedAt)
        `
      )
      .run({
        title: input.title,
        description: input.description ?? "",
        status,
        priority,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    const issue = this.getIssue(Number(result.lastInsertRowid));

    if (!issue) {
      throw new Error("Failed to read issue after insert.");
    }

    return issue;
  }

  getIssue(id: number): Issue | null {
    const row = this.db
      .prepare<[number], IssueRow>(
        `
          SELECT id, title, description, status, priority, created_at, updated_at
          FROM issues
          WHERE id = ?
        `
      )
      .get(id);

    return row ? mapIssue(row) : null;
  }

  listIssues(options: IssueListOptions = {}): Issue[] {
    const whereClauses: string[] = [];
    const params: Record<string, string> = {};

    if (options.status !== undefined) {
      whereClauses.push("status = @status");
      params.status = options.status;
    }

    const titleFilter = options.title?.trim();
    if (titleFilter !== undefined && titleFilter.length > 0) {
      whereClauses.push("title LIKE @titleFilter");
      params.titleFilter = `%${titleFilter}%`;
    }

    const descriptionFilter = options.description?.trim();
    if (descriptionFilter !== undefined && descriptionFilter.length > 0) {
      whereClauses.push("description LIKE @descriptionFilter");
      params.descriptionFilter = `%${descriptionFilter}%`;
    }

    if (options.search !== undefined) {
      const searchFilter = options.search.trim();
      if (searchFilter.length > 0) {
        whereClauses.push("(title LIKE @searchFilter OR description LIKE @searchFilter)");
        params.searchFilter = `%${searchFilter}%`;
      }
    }

    const whereSql =
      whereClauses.length === 0 ? "" : `WHERE ${whereClauses.join(" AND ")}`;

    return this.db
      .prepare<Record<string, string>, IssueRow>(
        `
          SELECT id, title, description, status, priority, created_at, updated_at
          FROM issues
          ${whereSql}
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(params)
      .map(mapIssue);
  }

  updateIssue(id: number, input: UpdateIssueInput): Issue | null {
    const existing = this.getIssue(id);

    if (!existing) {
      return null;
    }

    const status = resolveIssueStatus({
      status: input.status,
      closed: input.closed,
      fallback: existing.status
    });
    const priority = resolveIssuePriority(input.priority ?? existing.priority);

    this.db
      .prepare<{
        id: number;
        title: string;
        description: string;
        status: IssueStatus;
        priority: IssuePriority;
        updatedAt: string;
      }>(
        `
          UPDATE issues
          SET
            title = @title,
            description = @description,
            status = @status,
            priority = @priority,
            updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({
        id,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        status,
        priority,
        updatedAt: this.now()
      });

    return this.getIssue(id);
  }

  addComment(input: AddCommentInput): Comment {
    const timestamp = this.now();
    const result = this.db
      .prepare<{
        issueId: number;
        body: string;
        createdAt: string;
        updatedAt: string;
      }>(
        `
          INSERT INTO comments (issue_id, body, created_at, updated_at)
          VALUES (@issueId, @body, @createdAt, @updatedAt)
        `
      )
      .run({
        issueId: input.issueId,
        body: input.body,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    const comment = this.getComment(Number(result.lastInsertRowid));

    if (!comment) {
      throw new Error("Failed to read comment after insert.");
    }

    return comment;
  }

  getComment(id: number): Comment | null {
    const row = this.db
      .prepare<[number], CommentRow>(
        `
          SELECT id, issue_id, body, created_at, updated_at
          FROM comments
          WHERE id = ?
        `
      )
      .get(id);

    return row ? mapComment(row) : null;
  }

  listComments(issueId: number): Comment[] {
    return this.db
      .prepare<[number], CommentRow>(
        `
          SELECT id, issue_id, body, created_at, updated_at
          FROM comments
          WHERE issue_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(issueId)
      .map(mapComment);
  }

  updateComment(id: number, body: string): Comment | null {
    const existing = this.getComment(id);

    if (!existing) {
      return null;
    }

    const timestamp = this.now();
    const update = this.db.transaction(() => {
      this.db
        .prepare<{
          commentId: number;
          previousBody: string;
          editedAt: string;
        }>(
          `
            INSERT INTO comment_edits (comment_id, previous_body, edited_at)
            VALUES (@commentId, @previousBody, @editedAt)
          `
        )
        .run({
          commentId: id,
          previousBody: existing.body,
          editedAt: timestamp
        });

      this.db
        .prepare<{
          id: number;
          body: string;
          updatedAt: string;
        }>(
          `
            UPDATE comments
            SET body = @body, updated_at = @updatedAt
            WHERE id = @id
          `
        )
        .run({
          id,
          body,
          updatedAt: timestamp
        });
    });

    update();

    return this.getComment(id);
  }

  listCommentEdits(commentId: number): CommentEdit[] {
    return this.db
      .prepare<[number], CommentEditRow>(
        `
          SELECT id, comment_id, previous_body, edited_at
          FROM comment_edits
          WHERE comment_id = ?
          ORDER BY edited_at ASC, id ASC
        `
      )
      .all(commentId)
      .map(mapCommentEdit);
  }
}

const issueStatusMessage =
  "status must be Todo, In Progress, Review, or Done.";
const issuePriorityMessage =
  "priority must be Low, Medium, or High.";

function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === "string" && (issueStatuses as readonly string[]).includes(value);
}

function isIssuePriority(value: unknown): value is IssuePriority {
  return typeof value === "string" && (issuePriorities as readonly string[]).includes(value);
}

function resolveIssueStatus(options: {
  status?: IssueStatus | unknown;
  closed?: unknown;
  fallback?: IssueStatus;
}) {
  if (options.closed !== undefined) {
    if (typeof options.closed !== "boolean") {
      throw new Error("closed must be true or false.");
    }
    return options.closed ? "Done" : "Todo";
  }

  if (options.status === undefined) {
    return options.fallback ?? "Todo";
  }

  if (!isIssueStatus(options.status)) {
    throw new Error(issueStatusMessage);
  }

  return options.status;
}

function resolveIssuePriority(priority: unknown): IssuePriority {
  if (priority === undefined) {
    return "Medium";
  }

  if (!isIssuePriority(priority)) {
    throw new Error(issuePriorityMessage);
  }

  return priority;
}

function mapIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    issueId: row.issue_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCommentEdit(row: CommentEditRow): CommentEdit {
  return {
    id: row.id,
    commentId: row.comment_id,
    previousBody: row.previous_body,
    editedAt: row.edited_at
  };
}
