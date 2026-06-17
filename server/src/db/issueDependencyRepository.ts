import Database from 'better-sqlite3';
import { recordActivityEvent } from './activityRepository.js';
import { Issue, IssueDependencyReference, IssueDependencyState } from './types.js';

type IssueReferenceRow = {
  id: string;
  title: string;
  status: IssueDependencyReference['status'];
  archived_at: string | null;
};

type DependencyRow = {
  issue_id: string;
  depends_on_issue_id: string;
  title: string;
  status: IssueDependencyReference['status'];
  archived_at: string | null;
};

type CountRow = {
  count: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function placeholdersFor(values: string[]): string {
  return values.map(() => '?').join(', ');
}

function mapIssueReference(row: IssueReferenceRow): IssueDependencyReference {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    archivedAt: row.archived_at
  };
}

function isBlockingDependency(issue: IssueDependencyReference): boolean {
  return issue.archivedAt === null && issue.status !== 'done';
}

function getIssueReference(database: Database.Database, issueId: string): IssueDependencyReference | null {
  const row = database
    .prepare(
      `
      SELECT id, title, status, archived_at
      FROM issues
      WHERE id = @issueId
    `
    )
    .get({ issueId }) as IssueReferenceRow | undefined;

  return row ? mapIssueReference(row) : null;
}

function getIssueDependencies(database: Database.Database, issueId: string): IssueDependencyReference[] {
  const rows = database
    .prepare(
      `
      SELECT blocker.id, blocker.title, blocker.status, blocker.archived_at
      FROM issue_dependencies dependency
      INNER JOIN issues blocker ON blocker.id = dependency.depends_on_issue_id
      WHERE dependency.issue_id = @issueId
      ORDER BY dependency.created_at ASC, dependency.rowid ASC
    `
    )
    .all({ issueId }) as IssueReferenceRow[];

  return rows.map(mapIssueReference);
}

function getIssueDependents(database: Database.Database, issueId: string): IssueDependencyReference[] {
  const rows = database
    .prepare(
      `
      SELECT dependent.id, dependent.title, dependent.status, dependent.archived_at
      FROM issue_dependencies dependency
      INNER JOIN issues dependent ON dependent.id = dependency.issue_id
      WHERE dependency.depends_on_issue_id = @issueId
      ORDER BY dependency.created_at ASC, dependency.rowid ASC
    `
    )
    .all({ issueId }) as IssueReferenceRow[];

  return rows.map(mapIssueReference);
}

function dependencyExists(database: Database.Database, issueId: string, dependsOnIssueId: string): boolean {
  const row = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM issue_dependencies
      WHERE issue_id = @issueId AND depends_on_issue_id = @dependsOnIssueId
    `
    )
    .get({ issueId, dependsOnIssueId }) as CountRow;

  return row.count > 0;
}

function wouldCreateCycle(database: Database.Database, issueId: string, dependsOnIssueId: string): boolean {
  const row = database
    .prepare(
      `
      WITH RECURSIVE dependency_chain(issue_id, depends_on_issue_id) AS (
        SELECT issue_id, depends_on_issue_id
        FROM issue_dependencies
        WHERE issue_id = @dependsOnIssueId
        UNION
        SELECT dependency.issue_id, dependency.depends_on_issue_id
        FROM issue_dependencies dependency
        INNER JOIN dependency_chain chain ON dependency.issue_id = chain.depends_on_issue_id
      )
      SELECT COUNT(*) AS count
      FROM dependency_chain
      WHERE depends_on_issue_id = @issueId
    `
    )
    .get({ issueId, dependsOnIssueId }) as CountRow;

  return row.count > 0;
}

export function attachIssueDependencyState(database: Database.Database, issues: Issue[]): Issue[] {
  if (issues.length === 0) {
    return issues;
  }

  const issueIds = issues.map((issue) => issue.id);
  const rows = database
    .prepare(
      `
      SELECT dependency.issue_id,
             dependency.depends_on_issue_id,
             blocker.title,
             blocker.status,
             blocker.archived_at
      FROM issue_dependencies dependency
      INNER JOIN issues blocker ON blocker.id = dependency.depends_on_issue_id
      WHERE dependency.issue_id IN (${placeholdersFor(issueIds)})
      ORDER BY dependency.issue_id ASC, dependency.created_at ASC, dependency.rowid ASC
    `
    )
    .all(...issueIds) as DependencyRow[];
  const dependencyIdsByIssue = new Map<string, string[]>();
  const blockedIssueIds = new Set<string>();

  for (const row of rows) {
    const ids = dependencyIdsByIssue.get(row.issue_id) ?? [];
    ids.push(row.depends_on_issue_id);
    dependencyIdsByIssue.set(row.issue_id, ids);

    if (row.archived_at === null && row.status !== 'done') {
      blockedIssueIds.add(row.issue_id);
    }
  }

  return issues.map((issue) => ({
    ...issue,
    isBlocked: blockedIssueIds.has(issue.id),
    dependsOnIssueIds: dependencyIdsByIssue.get(issue.id) ?? []
  }));
}

export class IssueDependencyNotFoundError extends Error {}

export class IssueDependencyConflictError extends Error {}

export class IssueDependencyRepository {
  constructor(private readonly database: Database.Database) {}

  listByIssueId(issueId: string): IssueDependencyState | null {
    const issue = getIssueReference(this.database, issueId);

    if (!issue) {
      return null;
    }

    const dependencies = getIssueDependencies(this.database, issueId);

    return {
      issueId,
      dependencies,
      dependents: getIssueDependents(this.database, issueId),
      isBlocked: dependencies.some(isBlockingDependency)
    };
  }

  add(issueId: string, dependsOnIssueId: string): IssueDependencyState {
    const transaction = this.database.transaction(() => {
      const issue = getIssueReference(this.database, issueId);
      const dependency = getIssueReference(this.database, dependsOnIssueId);

      if (!issue) {
        throw new IssueDependencyNotFoundError('Issue not found');
      }

      if (!dependency) {
        throw new IssueDependencyNotFoundError('Dependency issue not found');
      }

      if (issueId === dependsOnIssueId) {
        throw new IssueDependencyConflictError('Issue cannot depend on itself');
      }

      if (dependency.archivedAt !== null) {
        throw new IssueDependencyConflictError('Cannot depend on archived issue');
      }

      if (dependencyExists(this.database, issueId, dependsOnIssueId)) {
        throw new IssueDependencyConflictError('Issue dependency already exists');
      }

      if (wouldCreateCycle(this.database, issueId, dependsOnIssueId)) {
        throw new IssueDependencyConflictError(
          'Cannot add dependency because the selected blocker already depends on this issue'
        );
      }

      const timestamp = nowIso();

      this.database
        .prepare(
          `
          INSERT INTO issue_dependencies (issue_id, depends_on_issue_id, created_at, updated_at)
          VALUES (@issueId, @dependsOnIssueId, @timestamp, @timestamp)
        `
        )
        .run({ issueId, dependsOnIssueId, timestamp });

      this.database
        .prepare(
          `
          UPDATE issues
          SET updated_at = @timestamp
          WHERE id = @issueId
        `
        )
        .run({ issueId, timestamp });

      recordActivityEvent(this.database, {
        issueId,
        type: 'issue_dependency_added',
        metadata: { dependsOnIssueId, title: dependency.title },
        createdAt: timestamp
      });

      const state = this.listByIssueId(issueId);

      if (!state) {
        throw new IssueDependencyNotFoundError('Issue not found');
      }

      return state;
    });

    return transaction();
  }

  remove(issueId: string, dependsOnIssueId: string): IssueDependencyState {
    const transaction = this.database.transaction(() => {
      const issue = getIssueReference(this.database, issueId);
      const dependency = getIssueReference(this.database, dependsOnIssueId);

      if (!issue) {
        throw new IssueDependencyNotFoundError('Issue not found');
      }

      if (!dependency || !dependencyExists(this.database, issueId, dependsOnIssueId)) {
        throw new IssueDependencyNotFoundError('Issue dependency not found');
      }

      const timestamp = nowIso();
      const result = this.database
        .prepare(
          `
          DELETE FROM issue_dependencies
          WHERE issue_id = @issueId AND depends_on_issue_id = @dependsOnIssueId
        `
        )
        .run({ issueId, dependsOnIssueId });

      if (result.changes === 0) {
        throw new IssueDependencyNotFoundError('Issue dependency not found');
      }

      this.database
        .prepare(
          `
          UPDATE issues
          SET updated_at = @timestamp
          WHERE id = @issueId
        `
        )
        .run({ issueId, timestamp });

      recordActivityEvent(this.database, {
        issueId,
        type: 'issue_dependency_removed',
        metadata: { dependsOnIssueId, title: dependency.title },
        createdAt: timestamp
      });

      const state = this.listByIssueId(issueId);

      if (!state) {
        throw new IssueDependencyNotFoundError('Issue not found');
      }

      return state;
    });

    return transaction();
  }
}
