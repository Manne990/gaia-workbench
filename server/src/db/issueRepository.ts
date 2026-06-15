import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { recordActivityEvent } from './activityRepository.js';
import { attachIssueDependencyState } from './issueDependencyRepository.js';
import {
  BulkIssueStatusUpdateInput,
  BulkIssueStatusUpdateResult,
  Issue,
  IssueListFilters,
  IssueListPaginationInput,
  IssueListResult,
  IssueListSummary,
  IssuePriority,
  IssueStatus,
  IssueAuditSummary,
  IssueUpdate,
  NewActivityEvent,
  NewIssue
} from './types.js';

const VALID_STATUSES: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES: IssuePriority[] = ['low', 'medium', 'high'];
const DEFAULT_STATUS: IssueStatus = 'todo';
const DEFAULT_PRIORITY: IssuePriority = 'medium';
export const STALE_ISSUE_THRESHOLD_DAYS = 30;
const STALE_ISSUE_THRESHOLD_MS = STALE_ISSUE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

export class BulkIssueStatusNotFoundError extends Error {
  constructor(
    readonly notFoundIds: string[],
    readonly duplicateIds: string[]
  ) {
    super('Issue not found');
  }
}

type IssueRow = {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string;
  due_date: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type CountRow = {
  count: number;
};

type StatusCountRow = {
  status: IssueStatus;
  count: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function normalizeIssueDescription(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new Error('Invalid issue description');
  }

  return value.trim();
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
  const isRealDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  if (!isRealDate) {
    throw new Error('Invalid issue due date');
  }

  return value;
}

function isIssueOverdue(dueDate: string | null, status: IssueStatus): boolean {
  return dueDate !== null && status !== 'done' && dueDate < todayLocalDate();
}

export function getStaleIssueCutoffIso(now = new Date()): string {
  return new Date(now.getTime() - STALE_ISSUE_THRESHOLD_MS).toISOString();
}

function labelsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((label, index) => label === right[index]);
}

function buildIssueChangeEvents(current: Issue, updated: Issue): NewActivityEvent[] {
  const events: NewActivityEvent[] = [];
  const issueId = updated.id;
  const createdAt = updated.updatedAt;

  if (current.title !== updated.title) {
    events.push({
      issueId,
      type: 'issue_title_changed',
      metadata: { from: current.title, to: updated.title },
      createdAt
    });
  }

  if (current.description !== updated.description) {
    events.push({
      issueId,
      type: 'issue_description_changed',
      metadata: { from: current.description, to: updated.description },
      createdAt
    });
  }

  if (current.status !== updated.status) {
    events.push({
      issueId,
      type: 'issue_status_changed',
      metadata: { from: current.status, to: updated.status },
      createdAt
    });
  }

  if (current.priority !== updated.priority) {
    events.push({
      issueId,
      type: 'issue_priority_changed',
      metadata: { from: current.priority, to: updated.priority },
      createdAt
    });
  }

  if (current.dueDate !== updated.dueDate) {
    events.push({
      issueId,
      type: 'issue_due_date_changed',
      metadata: { from: current.dueDate, to: updated.dueDate },
      createdAt
    });
  }

  if (!labelsEqual(current.labels, updated.labels)) {
    events.push({
      issueId,
      type: 'issue_labels_changed',
      metadata: { from: current.labels, to: updated.labels },
      createdAt
    });
  }

  return events;
}

function normalizeBulkIssueIds(issueIds: unknown): {
  uniqueIds: string[];
  duplicateIds: string[];
} {
  if (!Array.isArray(issueIds) || issueIds.length === 0) {
    throw new Error('Invalid bulk issue ids');
  }

  const uniqueIds: string[] = [];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();
  const reportedDuplicates = new Set<string>();

  for (const issueId of issueIds) {
    if (typeof issueId !== 'string' || issueId.trim().length === 0) {
      throw new Error('Invalid bulk issue ids');
    }

    const normalizedIssueId = issueId.trim();

    if (seen.has(normalizedIssueId)) {
      if (!reportedDuplicates.has(normalizedIssueId)) {
        duplicateIds.push(normalizedIssueId);
        reportedDuplicates.add(normalizedIssueId);
      }
      continue;
    }

    uniqueIds.push(normalizedIssueId);
    seen.add(normalizedIssueId);
  }

  return { uniqueIds, duplicateIds };
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
    isBlocked: false,
    dependsOnIssueIds: [],
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

type ArchiveFilterMode = 'active' | 'archivedOnly' | 'all';

function buildIssueListWhereClause(
  filters: IssueListFilters,
  archiveMode: ArchiveFilterMode = 'active'
): {
  whereClause: string;
  values: Record<string, string>;
} {
  const clauses: string[] = [];
  const values: Record<string, string> = {};

  if (archiveMode === 'active') {
    clauses.push('archived_at IS NULL');
  } else if (archiveMode === 'archivedOnly') {
    clauses.push('archived_at IS NOT NULL');
  }

  if (filters.status !== undefined) {
    assertValidStatus(filters.status);
    clauses.push('status = @status');
    values.status = filters.status;
  }

  if (filters.blockedOnly === true) {
    clauses.push(
      `
      EXISTS (
        SELECT 1
        FROM issue_dependencies AS dependencies
        INNER JOIN issues AS blocked_dependencies
          ON blocked_dependencies.id = dependencies.depends_on_issue_id
        WHERE dependencies.issue_id = issues.id
          AND blocked_dependencies.archived_at IS NULL
          AND blocked_dependencies.status != 'done'
      )
      `
    );
  }

  if (filters.priority !== undefined) {
    assertValidPriority(filters.priority);
    clauses.push('priority = @priority');
    values.priority = filters.priority;
  }

  const label = filters.label?.trim();
  if (label) {
    clauses.push(
      `
      EXISTS (
        SELECT 1
        FROM json_each(issues.labels) AS issue_labels
        WHERE issue_labels.value = @label
      )
      `
    );
    values.label = label;
  }

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    clauses.push("(LOWER(title) LIKE @search ESCAPE '\\' OR LOWER(description) LIKE @search ESCAPE '\\')");
    values.search = `%${escapeLikePattern(search)}%`;
  }

  if (filters.staleOnly) {
    clauses.push('updated_at <= @staleCutoff');
    values.staleCutoff = getStaleIssueCutoffIso();
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values
  };
}

export class IssueRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: NewIssue): Issue {
    assertNonEmptyString(input.title, 'title');

    const now = nowIso();
    const issue: Issue = {
      id: randomUUID(),
      title: input.title.trim(),
      description: normalizeIssueDescription(input.description),
      status: input.status ?? DEFAULT_STATUS,
      priority: input.priority ?? DEFAULT_PRIORITY,
      labels: normalizeLabels(input.labels),
      dueDate: normalizeDueDate(input.dueDate),
      isOverdue: false,
      isBlocked: false,
      dependsOnIssueIds: [],
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    };

    assertValidStatus(issue.status);
    assertValidPriority(issue.priority);
    issue.isOverdue = isIssueOverdue(issue.dueDate, issue.status);

    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO issues (id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at)
          VALUES (@id, @title, @description, @status, @priority, @labels, @dueDate, @archivedAt, @createdAt, @updatedAt)
        `
        )
        .run({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
          labels: JSON.stringify(issue.labels),
          dueDate: issue.dueDate,
          archivedAt: issue.archivedAt,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt
        });

      recordActivityEvent(this.database, {
        issueId: issue.id,
        type: 'issue_created',
        metadata: { title: issue.title },
        createdAt: issue.createdAt
      });
    });

    transaction();
    return issue;
  }

  duplicate(id: string): Issue | null {
    const source = this.getById(id);

    if (!source) {
      return null;
    }

    return this.create({
      title: `Copy of: ${source.title}`,
      description: source.description,
      priority: source.priority,
      labels: source.labels,
      dueDate: source.dueDate
    });
  }

  getById(id: string): Issue | null {
    const row = this.database
      .prepare(
        `
        SELECT id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        FROM issues
        WHERE id = @id
      `
      )
      .get({ id }) as IssueRow | undefined;

    if (!row) {
      return null;
    }

    return attachIssueDependencyState(this.database, [mapIssueRow(row)])[0] ?? null;
  }

  list(filters: IssueListFilters = {}, pagination: IssueListPaginationInput = { page: 1, limit: 25 }): IssueListResult {
    const archiveMode: ArchiveFilterMode = filters.includeArchived === true ? 'all' : 'active';
    const { whereClause, values } = buildIssueListWhereClause(filters, archiveMode);
    const total = (
      this.database
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM issues
          ${whereClause}
        `
        )
        .get(values) as CountRow
    ).count;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pagination.limit);
    const offset = (pagination.page - 1) * pagination.limit;
    const rows = this.database
      .prepare(
        `
        SELECT id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        FROM issues
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT @limit OFFSET @offset
      `
      )
      .all({ ...values, limit: pagination.limit, offset }) as IssueRow[];

    return {
      items: attachIssueDependencyState(this.database, rows.map(mapIssueRow)),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages,
        hasMore: pagination.page < totalPages,
        hasPrevious: pagination.page > 1 && total > 0
      },
      summary: this.getListSummary(Boolean(filters.includeArchived)),
      sort: {
        field: 'created_at,id',
        direction: 'desc,desc'
      }
    };
  }

  getAuditSummary(filters: IssueListFilters = {}): IssueAuditSummary {
    const scopeArchiveMode: ArchiveFilterMode = filters.includeArchived === true ? 'all' : 'active';
    const scopedFilters = buildIssueListWhereClause(filters, scopeArchiveMode);
    const archivedFilters = buildIssueListWhereClause(filters, 'archivedOnly');

    const statusRows = this.database
      .prepare(
        `
        SELECT status, COUNT(*) AS count
        FROM issues
        ${scopedFilters.whereClause}
        GROUP BY status
        `
      )
      .all(scopedFilters.values) as StatusCountRow[];

    const byStatus: IssueAuditSummary['byStatus'] = {
      todo: 0,
      in_progress: 0,
      review: 0,
      done: 0
    };
    for (const row of statusRows) {
      byStatus[row.status] = row.count;
    }

    const priorityRows = this.database
      .prepare(
        `
        SELECT priority, COUNT(*) AS count
        FROM issues
        ${scopedFilters.whereClause}
        GROUP BY priority
        `
      )
      .all(scopedFilters.values) as Array<{ priority: IssuePriority; count: number }>;

    const byPriority: IssueAuditSummary['byPriority'] = {
      low: 0,
      medium: 0,
      high: 0
    };
    for (const row of priorityRows) {
      byPriority[row.priority] = row.count;
    }

    const totalIssues = (
      this.database
        .prepare(
          `
        SELECT COUNT(*) AS count
        FROM issues
        ${scopedFilters.whereClause}
        `
        )
        .get(scopedFilters.values) as CountRow
    ).count;

    const totalArchivedIssues = (
      this.database
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM issues
          ${archivedFilters.whereClause}
          `
        )
        .get(archivedFilters.values) as CountRow
    ).count;

    const totalBlockedIssues = (
      this.database
        .prepare(
          `
        SELECT COUNT(*) AS count
        FROM issues
        ${scopedFilters.whereClause}
        ${scopedFilters.whereClause ? 'AND' : 'WHERE'} EXISTS (
            SELECT 1
            FROM issue_dependencies AS dependencies
            INNER JOIN issues AS blocked_dependencies
              ON blocked_dependencies.id = dependencies.depends_on_issue_id
            WHERE dependencies.issue_id = issues.id
              AND blocked_dependencies.archived_at IS NULL
              AND blocked_dependencies.status != 'done'
          )
          `
        )
        .get(scopedFilters.values) as CountRow
    ).count;

    const totalOverdueIssues = (
      this.database
        .prepare(
          `
        SELECT COUNT(*) AS count
        FROM issues
        ${scopedFilters.whereClause}
        ${scopedFilters.whereClause ? 'AND' : 'WHERE'} due_date IS NOT NULL
        AND status != 'done'
        AND due_date < @today
        `
        )
        .get({ ...scopedFilters.values, today: todayLocalDate() }) as CountRow
    ).count;

    const totalStaleIssues = (
      this.database
        .prepare(
          `
        SELECT COUNT(*) AS count
        FROM issues
        ${scopedFilters.whereClause}
        ${scopedFilters.whereClause ? 'AND' : 'WHERE'} updated_at <= @staleCutoff
        `
        )
        .get({ ...scopedFilters.values, staleCutoff: getStaleIssueCutoffIso() }) as CountRow
    ).count;

    const dependencyRow = this.database
      .prepare(
        `
        WITH filtered_issues AS (
          SELECT id
          FROM issues
          ${scopedFilters.whereClause}
        )
        SELECT
          (SELECT COUNT(*) FROM issue_dependencies AS dependencies WHERE dependencies.issue_id IN (SELECT id FROM filtered_issues)) AS total,
          (
            SELECT COUNT(*)
            FROM issue_dependencies AS dependencies
            INNER JOIN issues AS blocked_dependencies
              ON blocked_dependencies.id = dependencies.depends_on_issue_id
            WHERE dependencies.issue_id IN (SELECT id FROM filtered_issues)
              AND blocked_dependencies.archived_at IS NULL
              AND blocked_dependencies.status != 'done'
          ) AS blocked
        `
      )
      .get(scopedFilters.values) as { total: number; blocked: number };

    return {
      totalIssues,
      totalArchivedIssues,
      totalBlockedIssues,
      totalOverdueIssues,
      totalStaleIssues,
      byStatus,
      byPriority,
      dependencyEdges: {
        total: dependencyRow.total,
        blocked: dependencyRow.blocked
      }
    };
  }

  listForExport(filters: IssueListFilters = {}): Issue[] {
    const archiveMode: ArchiveFilterMode = filters.includeArchived === false ? 'active' : 'all';
    const { whereClause, values } = buildIssueListWhereClause(filters, archiveMode);

    const rows = this.database
      .prepare(
        `
        SELECT id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        FROM issues
        ${whereClause}
        ORDER BY created_at ASC, id ASC
      `
      )
      .all(values) as IssueRow[];

    return attachIssueDependencyState(this.database, rows.map(mapIssueRow));
  }

  private getListSummary(includeArchived = false): IssueListSummary {
    const totalByStatus: IssueListSummary['totalByStatus'] = {
      todo: 0,
      in_progress: 0,
      review: 0,
      done: 0
    };
    const archiveWhereClause = includeArchived ? '' : 'WHERE archived_at IS NULL';
    const statusRows = this.database
      .prepare(
        `
        SELECT status, COUNT(*) AS count
        FROM issues
        ${archiveWhereClause}
        GROUP BY status
      `
      )
      .all() as StatusCountRow[];

    for (const row of statusRows) {
      totalByStatus[row.status] = row.count;
    }

    const totalHighPriority = (
      this.database
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM issues
          WHERE priority = 'high'
          ${includeArchived ? '' : 'AND archived_at IS NULL'}
        `
        )
        .get() as CountRow
    ).count;

    return {
      totalByStatus,
      totalHighPriority
    };
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
      values.description = normalizeIssueDescription(input.description);
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

    const current = this.getById(id);
    if (!current) {
      return null;
    }

    const transaction = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `
          UPDATE issues
          SET ${fields.join(', ')}
          WHERE id = @id
        `
        )
        .run(values);

      if (result.changes === 0) {
        return null;
      }

      const updated = this.getById(id);
      if (!updated) {
        return null;
      }

      for (const event of buildIssueChangeEvents(current, updated)) {
        recordActivityEvent(this.database, event);
      }

      return updated;
    });

    return transaction();
  }

  bulkUpdateStatus(input: BulkIssueStatusUpdateInput): BulkIssueStatusUpdateResult {
    assertValidStatus(input.status);
    const { uniqueIds, duplicateIds } = normalizeBulkIssueIds(input.issueIds);
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `
        SELECT id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
        FROM issues
        WHERE id IN (${placeholders})
      `
      )
      .all(...uniqueIds) as IssueRow[];
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const notFoundIds = uniqueIds.filter((id) => !rowsById.has(id));

    if (notFoundIds.length > 0) {
      throw new BulkIssueStatusNotFoundError(notFoundIds, duplicateIds);
    }

    const unchangedIds: string[] = [];
    const changedRows: IssueRow[] = [];

    for (const issueId of uniqueIds) {
      const row = rowsById.get(issueId);

      if (!row) {
        continue;
      }

      if (row.status === input.status) {
        unchangedIds.push(issueId);
      } else {
        changedRows.push(row);
      }
    }

    if (changedRows.length === 0) {
      return {
        status: input.status,
        updated: [],
        unchangedIds,
        duplicateIds,
        notFoundIds: []
      };
    }

    const updatedAt = nowIso();
    const transaction = this.database.transaction(() => {
      const updateStatus = this.database.prepare(
        `
        UPDATE issues
        SET status = @status, updated_at = @updatedAt
        WHERE id = @id
      `
      );

      for (const row of changedRows) {
        updateStatus.run({
          id: row.id,
          status: input.status,
          updatedAt
        });

        recordActivityEvent(this.database, {
          issueId: row.id,
          type: 'issue_status_changed',
          metadata: { from: row.status, to: input.status },
          createdAt: updatedAt
        });
      }
    });

    transaction();

    const updatedIssues = changedRows.map((row) =>
      mapIssueRow({
        ...row,
        status: input.status,
        updated_at: updatedAt
      })
    );

    return {
      status: input.status,
      updated: attachIssueDependencyState(this.database, updatedIssues),
      unchangedIds,
      duplicateIds,
      notFoundIds: []
    };
  }

  archive(id: string): Issue | null {
    const current = this.getById(id);

    if (!current) {
      return null;
    }

    if (current.archivedAt) {
      return current;
    }

    const archivedAt = nowIso();
    const transaction = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `
          UPDATE issues
          SET archived_at = @archivedAt, updated_at = @archivedAt
          WHERE id = @id
        `
        )
        .run({ id, archivedAt });

      if (result.changes === 0) {
        return null;
      }

      recordActivityEvent(this.database, {
        issueId: id,
        type: 'issue_archived',
        metadata: { from: current.archivedAt, to: archivedAt },
        createdAt: archivedAt
      });

      return this.getById(id);
    });

    return transaction();
  }

  unarchive(id: string): Issue | null {
    const current = this.getById(id);

    if (!current) {
      return null;
    }

    if (!current.archivedAt) {
      return current;
    }

    const updatedAt = nowIso();
    const transaction = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `
          UPDATE issues
          SET archived_at = NULL, updated_at = @updatedAt
          WHERE id = @id
        `
        )
        .run({ id, updatedAt });

      if (result.changes === 0) {
        return null;
      }

      recordActivityEvent(this.database, {
        issueId: id,
        type: 'issue_unarchived',
        metadata: { from: current.archivedAt, to: null },
        createdAt: updatedAt
      });

      return this.getById(id);
    });

    return transaction();
  }

  close(id: string): Issue | null {
    return this.update(id, { status: 'done' });
  }

  reopen(id: string): Issue | null {
    return this.update(id, { status: DEFAULT_STATUS });
  }
}
