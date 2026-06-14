import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { Issue, IssueListFilters, IssuePriority, IssueStatus, IssueUpdate, NewIssue } from './types.js';

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
  labels: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertValidStatus(value: unknown): asserts value is IssueStatus {
  if (typeof value !== 'string' || !VALID_STATUSES.includes(value as IssueStatus)) {
    throw new Error('Invalid issue status');
  }
}

function assertValidPriority(value: unknown): asserts value is IssuePriority {
  if (typeof value !== 'string' || !VALID_PRIORITIES.includes(value as IssuePriority)) {
    throw new Error('Invalid issue priority');
  }
}

function normalizeLabels(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('Invalid issue labels');
  }

  const labels: string[] = [];
  const seen = new Set<string>();

  for (const label of value) {
    if (typeof label !== 'string') {
      throw new Error('Invalid issue labels');
    }

    const trimmed = label.trim();

    if (trimmed.length === 0 || trimmed.length > 32) {
      throw new Error('Invalid issue labels');
    }

    const key = trimmed.toLowerCase();

    if (!seen.has(key)) {
      labels.push(trimmed);
      seen.add(key);
    }
  }

  return labels;
}

function parseLabels(value: string): string[] {
  try {
    return normalizeLabels(JSON.parse(value));
  } catch {
    return [];
  }
}

function todayLocalDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function normalizeDueDate(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Invalid issue due date');
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isRealDate) {
    throw new Error('Invalid issue due date');
  }

  return value;
}

function isIssueOverdue(dueDate: string | null, status: IssueStatus): boolean {
  return dueDate !== null && status !== 'done' && dueDate < todayLocalDate();
}

function mapIssueRow(row: IssueRow): Issue {
  const dueDate = normalizeDueDate(row.due_date);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    labels: parseLabels(row.labels),
    dueDate,
    isOverdue: isIssueOverdue(dueDate, row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export class IssueRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: NewIssue): Issue {
    assertNonEmptyString(input.title, 'title');

    const now = nowIso();
    const issue: Issue = {
      id: randomUUID(),
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      status: input.status ?? DEFAULT_STATUS,
      priority: input.priority ?? DEFAULT_PRIORITY,
      labels: normalizeLabels(input.labels),
      dueDate: normalizeDueDate(input.dueDate),
      isOverdue: false,
      createdAt: now,
      updatedAt: now
    };

    assertValidStatus(issue.status);
    assertValidPriority(issue.priority);
    issue.isOverdue = isIssueOverdue(issue.dueDate, issue.status);

    this.database
      .prepare(`
        INSERT INTO issues (id, title, description, status, priority, labels, due_date, created_at, updated_at)
        VALUES (@id, @title, @description, @status, @priority, @labels, @dueDate, @createdAt, @updatedAt)
      `)
      .run({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        labels: JSON.stringify(issue.labels),
        dueDate: issue.dueDate,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt
      });

    return issue;
  }

  getById(id: string): Issue | null {
    const row = this.database
      .prepare(`
        SELECT id, title, description, status, priority, labels, due_date, created_at, updated_at
        FROM issues
        WHERE id = @id
      `)
      .get({ id }) as IssueRow | undefined;

    return row ? mapIssueRow(row) : null;
  }

  list(filters: IssueListFilters = {}): Issue[] {
    const clauses: string[] = [];
    const values: Record<string, string> = {};

    if (filters.status !== undefined) {
      assertValidStatus(filters.status);
      clauses.push('status = @status');
      values.status = filters.status;
    }

    if (filters.priority !== undefined) {
      assertValidPriority(filters.priority);
      clauses.push('priority = @priority');
      values.priority = filters.priority;
    }

    const search = filters.search?.trim().toLowerCase();
    if (search) {
      clauses.push("(LOWER(title) LIKE @search ESCAPE '\\' OR LOWER(description) LIKE @search ESCAPE '\\')");
      values.search = `%${escapeLikePattern(search)}%`;
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database
      .prepare(`
        SELECT id, title, description, status, priority, labels, due_date, created_at, updated_at
        FROM issues
        ${whereClause}
        ORDER BY created_at DESC, id DESC
      `)
      .all(values) as IssueRow[];

    return rows.map(mapIssueRow);
  }

  update(id: string, input: IssueUpdate): Issue | null {
    if (
      input.title === undefined &&
      input.description === undefined &&
      input.status === undefined &&
      input.priority === undefined &&
      input.labels === undefined &&
      input.dueDate === undefined
    ) {
      return this.getById(id);
    }

    const fields: string[] = [];
    const values: Record<string, string | null> = { id };

    if (input.title !== undefined) {
      assertNonEmptyString(input.title, 'title');
      fields.push('title = @title');
      values.title = input.title.trim();
    }

    if (input.description !== undefined) {
      fields.push('description = @description');
      values.description = input.description.trim();
    }

    if (input.status !== undefined) {
      assertValidStatus(input.status);
      fields.push('status = @status');
      values.status = input.status;
    }

    if (input.priority !== undefined) {
      assertValidPriority(input.priority);
      fields.push('priority = @priority');
      values.priority = input.priority;
    }

    if (input.labels !== undefined) {
      fields.push('labels = @labels');
      values.labels = JSON.stringify(normalizeLabels(input.labels));
    }

    if (input.dueDate !== undefined) {
      fields.push('due_date = @dueDate');
      values.dueDate = normalizeDueDate(input.dueDate);
    }

    const updatedAt = nowIso();
    fields.push('updated_at = @updatedAt');
    values.updatedAt = updatedAt;

    const result = this.database
      .prepare(`
        UPDATE issues
        SET ${fields.join(', ')}
        WHERE id = @id
      `)
      .run(values);

    if (result.changes === 0) {
      return null;
    }

    return this.getById(id);
  }

  close(id: string): Issue | null {
    return this.update(id, { status: 'done' });
  }

  reopen(id: string): Issue | null {
    return this.update(id, { status: DEFAULT_STATUS });
  }
}
