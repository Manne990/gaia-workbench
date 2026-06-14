import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { Issue, IssuePriority, IssueStatus, IssueUpdate, NewIssue } from './types.js';

const VALID_STATUSES: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES: IssuePriority[] = ['low', 'medium', 'high'];
const DEFAULT_STATUS: IssueStatus = 'todo';
const DEFAULT_PRIORITY: IssuePriority = 'medium';

type IssueRow = {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as IssueStatus);
}

function isIssuePriority(value: unknown): value is IssuePriority {
  return typeof value === 'string' && VALID_PRIORITIES.includes(value as IssuePriority);
}

function assertValidStatus(status: unknown): asserts status is IssueStatus {
  if (!isIssueStatus(status)) {
    throw new Error('Invalid issue status');
  }
}

function assertValidPriority(priority: unknown): asserts priority is IssuePriority {
  if (!isIssuePriority(priority)) {
    throw new Error('Invalid issue priority');
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function mapIssueRow(row: IssueRow): Issue {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class IssueRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: NewIssue): Issue {
    assertNonEmpty(input.title, 'title');

    const now = nowIso();
    const id = randomUUID();
    const issue: Issue = {
      id,
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      status: input.status ?? DEFAULT_STATUS,
      priority: input.priority ?? DEFAULT_PRIORITY,
      createdAt: now,
      updatedAt: now,
    };

    assertValidStatus(issue.status);
    assertValidPriority(issue.priority);

    const statement = this.database.prepare(`
      INSERT INTO issues (id, title, description, status, priority, created_at, updated_at)
      VALUES (@id, @title, @description, @status, @priority, @createdAt, @updatedAt)
    `);
    statement.run({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    });

    return issue;
  }

  getById(id: string): Issue | null {
    const row = this.database
      .prepare(`
        SELECT
          id,
          title,
          description,
          status,
          priority,
          created_at,
          updated_at
        FROM issues
        WHERE id = @id
      `)
      .get({ id }) as IssueRow | undefined;

    if (!row) {
      return null;
    }

    return mapIssueRow(row);
  }

  list(): Issue[] {
    const rows = this.database
      .prepare(`
        SELECT
          id,
          title,
          description,
          status,
          priority,
          created_at,
          updated_at
        FROM issues
        ORDER BY created_at DESC
      `)
      .all() as IssueRow[];

    return rows.map(mapIssueRow);
  }

  update(id: string, input: IssueUpdate): Issue | null {
    if (input.title === undefined && input.description === undefined && input.status === undefined && input.priority === undefined) {
      return this.getById(id);
    }

    const setClause: string[] = [];
    const values: Record<string, string> = { id };

    if (input.title !== undefined) {
      assertNonEmpty(input.title, 'title');
      setClause.push('title = @title');
      values.title = input.title.trim();
    }

    if (input.description !== undefined) {
      setClause.push('description = @description');
      values.description = input.description.trim();
    }

    if (input.status !== undefined) {
      assertValidStatus(input.status);
      setClause.push('status = @status');
      values.status = input.status;
    }

    if (input.priority !== undefined) {
      assertValidPriority(input.priority);
      setClause.push('priority = @priority');
      values.priority = input.priority;
    }

    const now = nowIso();
    setClause.push('updated_at = @updatedAt');
    values.updatedAt = now;

    const statement = this.database.prepare(`
      UPDATE issues
      SET ${setClause.join(', ')}
      WHERE id = @id
    `);
    const result = statement.run(values);
    if (result.changes === 0) {
      return null;
    }

    const row = this.getById(id);
    if (!row) {
      return null;
    }

    row.updatedAt = now;
    return row;
  }

  close(id: string): Issue | null {
    return this.update(id, { status: 'done' });
  }

  reopen(id: string): Issue | null {
    return this.update(id, { status: 'todo' });
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM issues WHERE id = @id').run({ id });
  }
}
