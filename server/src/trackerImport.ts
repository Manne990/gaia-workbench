import Database from 'better-sqlite3';
import {
  ActivityEvent,
  ActivityEventType,
  ActivityMetadata,
  Comment,
  CommentEditHistory,
  Issue,
  IssuePriority,
  IssueStatus,
  SavedFilterPriority,
  SavedFilterStatus,
  SavedFilterView
} from './db/index.js';

type ExportedComment = Comment & {
  editHistory: CommentEditHistory[];
};

type ExportedIssue = Issue & {
  comments: ExportedComment[];
  activityEvents: ActivityEvent[];
};

type TrackerExport = {
  exportVersion: 1;
  issues: ExportedIssue[];
  savedFilterViews: SavedFilterView[];
};

type ImportEntity = 'issue' | 'comment' | 'commentEditHistory' | 'activityEvent' | 'savedFilterView';
export type ImportConflictPolicy = 'skip-conflicts' | 'replace-conflicts';
type ImportDecisionType = 'import' | 'skip-existing' | 'replace-existing' | 'reject';
type ImportMatchType = 'new' | 'exact' | 'changed';
type ImportPolicyDecision = 'import' | 'skip' | 'replace' | 'reject';

type ImportCounts = {
  issues: number;
  comments: number;
  editHistory: number;
  activityEvents: number;
  savedFilterViews: number;
};

export type ImportDecision = {
  entity: ImportEntity;
  sourceId: string | null;
  sourceIndex: number;
  issueId?: string;
  commentId?: string;
  decision: ImportDecisionType;
  matchType?: ImportMatchType;
  policyDecision?: ImportPolicyDecision;
  reasons: string[];
};

export type ImportErrorDetail = {
  code: string;
  path: string;
  message: string;
  value?: unknown;
};

export type ImportSummary = {
  input: ImportCounts;
  toCreate: ImportCounts;
  toReplace: ImportCounts;
  skip: ImportCounts;
  exactMatches: ImportCounts;
  changed: ImportCounts;
  reject: number;
};

export type ImportPlan = {
  valid: boolean;
  exportVersion: number | null;
  policy: ImportConflictPolicy;
  summary: ImportSummary;
  decisions: ImportDecision[];
  errors: ImportErrorDetail[];
  warnings: string[];
};

type ValidationResult = {
  exportVersion: number | null;
  conflictPolicy: ImportConflictPolicy;
  exportData: TrackerExport | null;
  input: ImportCounts;
  decisions: ImportDecision[];
  errors: ImportErrorDetail[];
};

const DEFAULT_IMPORT_CONFLICT_POLICY: ImportConflictPolicy = 'skip-conflicts';
const VALID_IMPORT_CONFLICT_POLICIES: ImportConflictPolicy[] = ['skip-conflicts', 'replace-conflicts'];
const VALID_STATUSES: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES: IssuePriority[] = ['low', 'medium', 'high'];
const VALID_SAVED_FILTER_STATUSES: SavedFilterStatus[] = ['all', ...VALID_STATUSES];
const VALID_SAVED_FILTER_PRIORITIES: SavedFilterPriority[] = ['all', ...VALID_PRIORITIES];
const VALID_ACTIVITY_TYPES: ActivityEventType[] = [
  'issue_created',
  'issue_title_changed',
  'issue_description_changed',
  'issue_status_changed',
  'issue_priority_changed',
  'issue_due_date_changed',
  'issue_labels_changed',
  'issue_archived',
  'issue_unarchived',
  'issue_dependency_added',
  'issue_dependency_removed',
  'comment_added',
  'comment_edited'
];
const ACTIVITY_IMPORT_TYPE_ORDER: Record<ActivityEventType, number> = {
  issue_created: 0,
  issue_title_changed: 1,
  issue_description_changed: 2,
  issue_status_changed: 3,
  issue_priority_changed: 4,
  issue_due_date_changed: 5,
  issue_labels_changed: 6,
  issue_dependency_added: 7,
  comment_added: 8,
  comment_edited: 9,
  issue_dependency_removed: 10,
  issue_archived: 11,
  issue_unarchived: 12
};

const emptyCounts = (): ImportCounts => ({
  issues: 0,
  comments: 0,
  editHistory: 0,
  activityEvents: 0,
  savedFilterViews: 0
});

type ExistingIssueRow = {
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

type ExistingCommentRow = {
  id: string;
  issue_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

type ExistingHistoryRow = {
  id: string;
  comment_id: string;
  previous_body: string;
  new_body: string;
  edited_at: string;
};

type ExistingActivityRow = {
  id: string;
  issue_id: string;
  event_type: ActivityEventType;
  metadata: string;
  created_at: string;
};

type ExistingDependencyRow = {
  issue_id: string;
  depends_on_issue_id: string;
};

type ExistingSavedFilterViewRow = {
  id: string;
  name: string;
  search: string;
  status: SavedFilterStatus;
  priority: SavedFilterPriority;
  label: string;
  include_archived: 0 | 1;
  blocked_only: 0 | 1;
  stale_only: 0 | 1;
  page_size: number;
  created_at: string;
  updated_at: string;
};

function pushError(errors: ImportErrorDetail[], code: string, path: string, message: string, value?: unknown) {
  const error: ImportErrorDetail = { code, path, message };

  if (value !== undefined) {
    error.value = value;
  }

  errors.push(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateObject(
  value: unknown,
  path: string,
  allowedKeys: string[],
  errors: ImportErrorDetail[],
  optionalKeys: string[] = []
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    pushError(errors, 'invalid_type', path, 'Expected an object.', value);
    return null;
  }

  const allowed = new Set([...allowedKeys, ...optionalKeys]);
  const missing = allowedKeys.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));

  for (const key of missing) {
    pushError(errors, 'missing_field', `${path}.${key}`, `Missing required field "${key}".`);
  }

  for (const key of unknown) {
    pushError(errors, 'unknown_field', `${path}.${key}`, `Unknown field "${key}".`);
  }

  return value;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ImportErrorDetail[],
  options: { nonEmpty?: boolean; maxLength?: number } = {}
): string {
  const field = value[key];

  if (typeof field !== 'string') {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be a string.`, field);
    return '';
  }

  if (options.nonEmpty && field.trim().length === 0) {
    pushError(errors, 'invalid_value', `${path}.${key}`, `Field "${key}" must not be empty.`, field);
  }

  if (options.maxLength !== undefined && field.length > options.maxLength) {
    pushError(
      errors,
      'invalid_value',
      `${path}.${key}`,
      `Field "${key}" must be ${options.maxLength} characters or fewer.`,
      field
    );
  }

  return field;
}

function readStringOrNull(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ImportErrorDetail[]
): string | null {
  const field = value[key];

  if (field === null) {
    return null;
  }

  if (typeof field !== 'string') {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be a string or null.`, field);
    return null;
  }

  return field;
}

function readBoolean(value: Record<string, unknown>, key: string, path: string, errors: ImportErrorDetail[]): boolean {
  const field = value[key];

  if (typeof field !== 'boolean') {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be a boolean.`, field);
    return false;
  }

  return field;
}

function readInteger(value: Record<string, unknown>, key: string, path: string, errors: ImportErrorDetail[]): number {
  const field = value[key];

  if (typeof field !== 'number' || !Number.isInteger(field)) {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be an integer.`, field);
    return 0;
  }

  return field;
}

function readArray(value: Record<string, unknown>, key: string, path: string, errors: ImportErrorDetail[]): unknown[] {
  const field = value[key];

  if (!Array.isArray(field)) {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be an array.`, field);
    return [];
  }

  return field;
}

function readImportConflictPolicy(value: Record<string, unknown>, errors: ImportErrorDetail[]): ImportConflictPolicy {
  const field = value.conflictPolicy;

  if (field === undefined) {
    return DEFAULT_IMPORT_CONFLICT_POLICY;
  }

  if (typeof field !== 'string' || !VALID_IMPORT_CONFLICT_POLICIES.includes(field as ImportConflictPolicy)) {
    pushError(
      errors,
      'invalid_import_policy',
      '$.conflictPolicy',
      'Import conflict policy must be skip-conflicts or replace-conflicts.',
      field
    );
    return DEFAULT_IMPORT_CONFLICT_POLICY;
  }

  return field as ImportConflictPolicy;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }

  const timestamp = Date.parse(value);

  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateMetadataValue(
  value: unknown,
  path: string,
  errors: ImportErrorDetail[]
): value is ActivityMetadata[string] {
  if (typeof value === 'string' || value === null) {
    return true;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return true;
  }

  pushError(
    errors,
    'invalid_metadata',
    path,
    'Activity metadata values must be strings, string arrays, or null.',
    value
  );
  return false;
}

function validateMetadata(value: unknown, path: string, errors: ImportErrorDetail[]): ActivityMetadata {
  if (!isRecord(value)) {
    pushError(errors, 'invalid_type', path, 'Activity metadata must be an object.', value);
    return {};
  }

  const metadata: ActivityMetadata = {};

  for (const [key, metadataValue] of Object.entries(value)) {
    if (validateMetadataValue(metadataValue, `${path}.${key}`, errors)) {
      metadata[key] = metadataValue;
    }
  }

  return metadata;
}

function validateLabels(value: unknown, path: string, errors: ImportErrorDetail[]): string[] {
  if (!Array.isArray(value)) {
    pushError(errors, 'invalid_type', path, 'Labels must be an array.', value);
    return [];
  }

  const labels: string[] = [];

  value.forEach((label, index) => {
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 32) {
      pushError(
        errors,
        'invalid_label',
        `${path}[${index}]`,
        'Labels must be non-empty strings of 32 characters or fewer.',
        label
      );
      return;
    }

    labels.push(label);
  });

  return labels;
}

function validateDependsOnIssueIds(
  value: unknown,
  path: string,
  issueId: string,
  errors: ImportErrorDetail[]
): string[] {
  if (!Array.isArray(value)) {
    pushError(errors, 'invalid_type', path, 'dependsOnIssueIds must be an array.', value);
    return [];
  }

  const dependsOnIssueIds: string[] = [];
  const seen = new Set<string>();

  value.forEach((dependsOnIssueId, index) => {
    const dependencyPath = `${path}[${index}]`;

    if (typeof dependsOnIssueId !== 'string' || dependsOnIssueId.trim().length === 0) {
      pushError(errors, 'invalid_dependency', dependencyPath, 'Dependency issue ids must be non-empty strings.', value);
      return;
    }

    if (dependsOnIssueId === issueId) {
      pushError(errors, 'invalid_dependency', dependencyPath, 'An issue cannot depend on itself.', dependsOnIssueId);
      return;
    }

    if (seen.has(dependsOnIssueId)) {
      pushError(errors, 'duplicate_dependency', dependencyPath, 'Duplicate dependency issue id.', dependsOnIssueId);
      return;
    }

    seen.add(dependsOnIssueId);
    dependsOnIssueIds.push(dependsOnIssueId);
  });

  return dependsOnIssueIds;
}

function importedDependencyBlocks(issue: ExportedIssue): boolean {
  return issue.archivedAt === null && issue.status !== 'done';
}

function validateIssueDependencyGraph(
  issues: ExportedIssue[],
  explicitIsBlockedByIssueId: Map<string, boolean>,
  errors: ImportErrorDetail[]
): void {
  const issueIds = new Set(issues.map((issue) => issue.id));
  const issueIndexById = new Map(issues.map((issue, index) => [issue.id, index]));
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const graph = new Map(issues.map((issue) => [issue.id, issue.dependsOnIssueIds]));

  for (const issue of issues) {
    const issueIndex = issueIndexById.get(issue.id) ?? 0;

    issue.dependsOnIssueIds.forEach((dependsOnIssueId, dependencyIndex) => {
      if (!issueIds.has(dependsOnIssueId)) {
        pushError(
          errors,
          'dangling_reference',
          `$.issues[${issueIndex}].dependsOnIssueIds[${dependencyIndex}]`,
          'Dependency issue id must reference another issue in the import payload.',
          dependsOnIssueId
        );
      }
    });

    const explicitIsBlocked = explicitIsBlockedByIssueId.get(issue.id);
    if (explicitIsBlocked !== undefined) {
      const graphIsBlocked = issue.dependsOnIssueIds.some((dependsOnIssueId) => {
        const dependency = issueById.get(dependsOnIssueId);

        return dependency ? importedDependencyBlocks(dependency) : false;
      });

      if (explicitIsBlocked !== graphIsBlocked) {
        pushError(
          errors,
          'inconsistent_dependency_state',
          `$.issues[${issueIndex}].isBlocked`,
          'isBlocked must match the imported dependency graph.',
          explicitIsBlocked
        );
      }
    }
  }

  function reaches(startIssueId: string, targetIssueId: string, visited: Set<string>): boolean {
    if (startIssueId === targetIssueId) {
      return true;
    }

    if (visited.has(startIssueId)) {
      return false;
    }

    visited.add(startIssueId);

    for (const nextIssueId of graph.get(startIssueId) ?? []) {
      if (reaches(nextIssueId, targetIssueId, visited)) {
        return true;
      }
    }

    return false;
  }

  for (const issue of issues) {
    const issueIndex = issueIndexById.get(issue.id) ?? 0;

    issue.dependsOnIssueIds.forEach((dependsOnIssueId, dependencyIndex) => {
      if (issueIds.has(dependsOnIssueId) && reaches(dependsOnIssueId, issue.id, new Set<string>())) {
        pushError(
          errors,
          'dependency_cycle',
          `$.issues[${issueIndex}].dependsOnIssueIds[${dependencyIndex}]`,
          'Dependency graph must not contain cycles.',
          dependsOnIssueId
        );
      }
    });
  }
}

function validateUniqueId(
  id: string,
  entity: ImportEntity,
  path: string,
  seen: Map<ImportEntity, Set<string>>,
  errors: ImportErrorDetail[]
) {
  const entitySet = seen.get(entity) ?? new Set<string>();

  if (entitySet.has(id)) {
    pushError(errors, 'duplicate_id', path, `Duplicate ${entity} id "${id}" in import payload.`, id);
  }

  entitySet.add(id);
  seen.set(entity, entitySet);
}

function placeholdersFor(values: string[]): string {
  return values.map(() => '?').join(', ');
}

function rowsById<Row extends { id: string }>(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [row.id, row]));
}

function parseStoredLabels(value: string): string[] {
  try {
    const labels = JSON.parse(value) as unknown;

    return Array.isArray(labels) && labels.every((label) => typeof label === 'string') ? labels : [];
  } catch {
    return [];
  }
}

function parseStoredMetadata(value: string): ActivityMetadata {
  try {
    const metadata = JSON.parse(value) as unknown;

    return isRecord(metadata) ? (metadata as ActivityMetadata) : {};
  } catch {
    return {};
  }
}

function existingIssueRowsById(database: Database.Database, ids: string[]): Map<string, ExistingIssueRow> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = database
    .prepare(
      `
      SELECT id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at
      FROM issues
      WHERE id IN (${placeholdersFor(ids)})
    `
    )
    .all(...ids) as ExistingIssueRow[];

  return rowsById(rows);
}

function existingCommentRowsById(database: Database.Database, ids: string[]): Map<string, ExistingCommentRow> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = database
    .prepare(
      `
      SELECT id, issue_id, body, created_at, updated_at
      FROM comments
      WHERE id IN (${placeholdersFor(ids)})
    `
    )
    .all(...ids) as ExistingCommentRow[];

  return rowsById(rows);
}

function existingHistoryRowsById(database: Database.Database, ids: string[]): Map<string, ExistingHistoryRow> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = database
    .prepare(
      `
      SELECT id, comment_id, previous_body, new_body, edited_at
      FROM comment_edit_history
      WHERE id IN (${placeholdersFor(ids)})
    `
    )
    .all(...ids) as ExistingHistoryRow[];

  return rowsById(rows);
}

function existingActivityRowsById(database: Database.Database, ids: string[]): Map<string, ExistingActivityRow> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = database
    .prepare(
      `
      SELECT id, issue_id, event_type, metadata, created_at
      FROM activity_events
      WHERE id IN (${placeholdersFor(ids)})
    `
    )
    .all(...ids) as ExistingActivityRow[];

  return rowsById(rows);
}

function existingDependenciesByIssueId(database: Database.Database, issueIds: string[]): Map<string, string[]> {
  if (issueIds.length === 0) {
    return new Map();
  }

  const rows = database
    .prepare(
      `
      SELECT issue_id, depends_on_issue_id
      FROM issue_dependencies
      WHERE issue_id IN (${placeholdersFor(issueIds)})
      ORDER BY issue_id ASC, depends_on_issue_id ASC
    `
    )
    .all(...issueIds) as ExistingDependencyRow[];
  const dependenciesByIssueId = new Map<string, string[]>();

  for (const row of rows) {
    const dependencies = dependenciesByIssueId.get(row.issue_id) ?? [];
    dependencies.push(row.depends_on_issue_id);
    dependenciesByIssueId.set(row.issue_id, dependencies);
  }

  return dependenciesByIssueId;
}

function existingSavedFilterViewRows(database: Database.Database): ExistingSavedFilterViewRow[] {
  return database
    .prepare(
      `
      SELECT id, name, search, status, priority, label, include_archived, blocked_only, stale_only, page_size, created_at, updated_at
      FROM saved_filter_views
    `
    )
    .all() as ExistingSavedFilterViewRow[];
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function canonicalMetadata(value: ActivityMetadata): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, metadataValue]) => [key, Array.isArray(metadataValue) ? [...metadataValue] : metadataValue])
    )
  );
}

function issueMatchType(
  issue: ExportedIssue,
  existingIssues: Map<string, ExistingIssueRow>,
  dependenciesByIssueId: Map<string, string[]>
): ImportMatchType {
  const existing = existingIssues.get(issue.id);

  if (!existing) {
    return 'new';
  }

  const existingDependencies = dependenciesByIssueId.get(issue.id) ?? [];
  const isExact =
    existing.title === issue.title &&
    existing.description === issue.description &&
    existing.status === issue.status &&
    existing.priority === issue.priority &&
    arraysEqual(parseStoredLabels(existing.labels), issue.labels) &&
    existing.due_date === issue.dueDate &&
    existing.archived_at === issue.archivedAt &&
    existing.created_at === issue.createdAt &&
    existing.updated_at === issue.updatedAt &&
    arraysEqual(sortedStrings(existingDependencies), sortedStrings(issue.dependsOnIssueIds));

  return isExact ? 'exact' : 'changed';
}

function commentMatchType(comment: Comment, existingComments: Map<string, ExistingCommentRow>): ImportMatchType {
  const existing = existingComments.get(comment.id);

  if (!existing) {
    return 'new';
  }

  return existing.issue_id === comment.issueId &&
    existing.body === comment.body &&
    existing.created_at === comment.createdAt &&
    existing.updated_at === comment.updatedAt
    ? 'exact'
    : 'changed';
}

function historyMatchType(
  history: CommentEditHistory,
  existingHistories: Map<string, ExistingHistoryRow>
): ImportMatchType {
  const existing = existingHistories.get(history.id);

  if (!existing) {
    return 'new';
  }

  return existing.comment_id === history.commentId &&
    existing.previous_body === history.previousBody &&
    existing.new_body === history.newBody &&
    existing.edited_at === history.editedAt
    ? 'exact'
    : 'changed';
}

function activityMatchType(event: ActivityEvent, existingActivity: Map<string, ExistingActivityRow>): ImportMatchType {
  const existing = existingActivity.get(event.id);

  if (!existing) {
    return 'new';
  }

  return existing.issue_id === event.issueId &&
    existing.event_type === event.type &&
    existing.created_at === event.createdAt &&
    canonicalMetadata(parseStoredMetadata(existing.metadata)) === canonicalMetadata(event.metadata)
    ? 'exact'
    : 'changed';
}

function savedFilterViewMatchesRow(view: SavedFilterView, existing: ExistingSavedFilterViewRow): boolean {
  return (
    existing.name === view.name &&
    existing.search === view.search &&
    existing.status === view.status &&
    existing.priority === view.priority &&
    existing.label === view.label &&
    (existing.include_archived === 1) === view.includeArchived &&
    (existing.blocked_only === 1) === view.blockedOnly &&
    (existing.stale_only === 1) === view.staleOnly &&
    existing.page_size === view.pageSize &&
    existing.created_at === view.createdAt &&
    existing.updated_at === view.updatedAt
  );
}

function countInput(exportData: TrackerExport | null): ImportCounts {
  const counts = emptyCounts();

  if (!exportData) {
    return counts;
  }

  counts.issues = exportData.issues.length;
  counts.savedFilterViews = exportData.savedFilterViews.length;

  for (const issue of exportData.issues) {
    counts.comments += issue.comments.length;
    counts.activityEvents += issue.activityEvents.length;

    for (const comment of issue.comments) {
      counts.editHistory += comment.editHistory.length;
    }
  }

  return counts;
}

function validateTrackerExport(input: unknown): ValidationResult {
  const errors: ImportErrorDetail[] = [];
  const decisions: ImportDecision[] = [];
  const seen = new Map<ImportEntity, Set<string>>();
  const root = validateObject(input, '$', ['exportVersion', 'issues'], errors, ['conflictPolicy', 'savedFilterViews']);

  if (!root) {
    return {
      exportVersion: null,
      conflictPolicy: DEFAULT_IMPORT_CONFLICT_POLICY,
      exportData: null,
      input: emptyCounts(),
      decisions,
      errors
    };
  }

  const conflictPolicy = readImportConflictPolicy(root, errors);
  const exportVersion = root.exportVersion;
  if (exportVersion !== 1) {
    pushError(errors, 'unsupported_version', '$.exportVersion', 'Unsupported export version.', exportVersion);
  }

  const issuesInput = readArray(root, 'issues', '$', errors);
  const savedFilterViewsInput =
    root.savedFilterViews === undefined ? [] : readArray(root, 'savedFilterViews', '$', errors);
  const issues: ExportedIssue[] = [];
  const savedFilterViews: SavedFilterView[] = [];
  const savedFilterViewNames = new Map<string, number>();
  const explicitIsBlockedByIssueId = new Map<string, boolean>();

  issuesInput.forEach((issueInput, issueIndex) => {
    const issuePath = `$.issues[${issueIndex}]`;
    const issueObject = validateObject(
      issueInput,
      issuePath,
      [
        'id',
        'title',
        'description',
        'status',
        'priority',
        'labels',
        'dueDate',
        'isOverdue',
        'createdAt',
        'updatedAt',
        'comments',
        'activityEvents'
      ],
      errors,
      ['archivedAt', 'isBlocked', 'dependsOnIssueIds']
    );

    if (!issueObject) {
      decisions.push({
        entity: 'issue',
        sourceId: null,
        sourceIndex: issueIndex,
        decision: 'reject',
        reasons: ['invalid issue object']
      });
      return;
    }

    const issueId = readString(issueObject, 'id', issuePath, errors, { nonEmpty: true });
    const title = readString(issueObject, 'title', issuePath, errors, { nonEmpty: true });
    const description = readString(issueObject, 'description', issuePath, errors);
    const status = readString(issueObject, 'status', issuePath, errors) as IssueStatus;
    const priority = readString(issueObject, 'priority', issuePath, errors) as IssuePriority;
    const labels = validateLabels(issueObject.labels, `${issuePath}.labels`, errors);
    const dueDate = readStringOrNull(issueObject, 'dueDate', issuePath, errors);
    const isOverdue = readBoolean(issueObject, 'isOverdue', issuePath, errors);
    const hasExplicitIsBlocked = Object.prototype.hasOwnProperty.call(issueObject, 'isBlocked');
    const isBlocked = hasExplicitIsBlocked ? readBoolean(issueObject, 'isBlocked', issuePath, errors) : false;
    const dependsOnIssueIds =
      issueObject.dependsOnIssueIds === undefined
        ? []
        : validateDependsOnIssueIds(issueObject.dependsOnIssueIds, `${issuePath}.dependsOnIssueIds`, issueId, errors);
    const archivedAt =
      issueObject.archivedAt === undefined ? null : readStringOrNull(issueObject, 'archivedAt', issuePath, errors);
    const createdAt = readString(issueObject, 'createdAt', issuePath, errors, { nonEmpty: true });
    const updatedAt = readString(issueObject, 'updatedAt', issuePath, errors, { nonEmpty: true });

    if (issueId) {
      validateUniqueId(issueId, 'issue', `${issuePath}.id`, seen, errors);
      if (hasExplicitIsBlocked && typeof issueObject.isBlocked === 'boolean') {
        explicitIsBlockedByIssueId.set(issueId, isBlocked);
      }
    }

    if (!VALID_STATUSES.includes(status)) {
      pushError(errors, 'invalid_status', `${issuePath}.status`, 'Invalid issue status.', status);
    }

    if (!VALID_PRIORITIES.includes(priority)) {
      pushError(errors, 'invalid_priority', `${issuePath}.priority`, 'Invalid issue priority.', priority);
    }

    if (dueDate !== null && !isValidDateOnly(dueDate)) {
      pushError(errors, 'invalid_due_date', `${issuePath}.dueDate`, 'Invalid issue due date.', dueDate);
    }

    if (!isValidTimestamp(createdAt)) {
      pushError(errors, 'invalid_timestamp', `${issuePath}.createdAt`, 'Invalid createdAt timestamp.', createdAt);
    }

    if (!isValidTimestamp(updatedAt)) {
      pushError(errors, 'invalid_timestamp', `${issuePath}.updatedAt`, 'Invalid updatedAt timestamp.', updatedAt);
    }

    if (archivedAt !== null && !isValidTimestamp(archivedAt)) {
      pushError(errors, 'invalid_timestamp', `${issuePath}.archivedAt`, 'Invalid archivedAt timestamp.', archivedAt);
    }

    const commentsInput = readArray(issueObject, 'comments', issuePath, errors);
    const activityInput = readArray(issueObject, 'activityEvents', issuePath, errors);
    const comments: ExportedComment[] = [];
    const activityEvents: ActivityEvent[] = [];

    commentsInput.forEach((commentInput, commentIndex) => {
      const commentPath = `${issuePath}.comments[${commentIndex}]`;
      const commentObject = validateObject(
        commentInput,
        commentPath,
        ['id', 'issueId', 'body', 'createdAt', 'updatedAt', 'editHistory'],
        errors
      );

      if (!commentObject) {
        decisions.push({
          entity: 'comment',
          sourceId: null,
          sourceIndex: commentIndex,
          issueId,
          decision: 'reject',
          reasons: ['invalid comment object']
        });
        return;
      }

      const commentId = readString(commentObject, 'id', commentPath, errors, { nonEmpty: true });
      const commentIssueId = readString(commentObject, 'issueId', commentPath, errors, {
        nonEmpty: true
      });
      const body = readString(commentObject, 'body', commentPath, errors, { nonEmpty: true });
      const commentCreatedAt = readString(commentObject, 'createdAt', commentPath, errors, {
        nonEmpty: true
      });
      const commentUpdatedAt = readString(commentObject, 'updatedAt', commentPath, errors, {
        nonEmpty: true
      });
      const editHistoryInput = readArray(commentObject, 'editHistory', commentPath, errors);
      const editHistory: CommentEditHistory[] = [];

      if (commentId) {
        validateUniqueId(commentId, 'comment', `${commentPath}.id`, seen, errors);
      }

      if (commentIssueId !== issueId) {
        pushError(
          errors,
          'dangling_reference',
          `${commentPath}.issueId`,
          'Comment issueId must match its parent issue id.',
          commentIssueId
        );
      }

      if (!isValidTimestamp(commentCreatedAt)) {
        pushError(
          errors,
          'invalid_timestamp',
          `${commentPath}.createdAt`,
          'Invalid createdAt timestamp.',
          commentCreatedAt
        );
      }

      if (!isValidTimestamp(commentUpdatedAt)) {
        pushError(
          errors,
          'invalid_timestamp',
          `${commentPath}.updatedAt`,
          'Invalid updatedAt timestamp.',
          commentUpdatedAt
        );
      }

      editHistoryInput.forEach((historyInput, historyIndex) => {
        const historyPath = `${commentPath}.editHistory[${historyIndex}]`;
        const historyObject = validateObject(
          historyInput,
          historyPath,
          ['id', 'commentId', 'previousBody', 'newBody', 'editedAt'],
          errors
        );

        if (!historyObject) {
          decisions.push({
            entity: 'commentEditHistory',
            sourceId: null,
            sourceIndex: historyIndex,
            issueId,
            commentId,
            decision: 'reject',
            reasons: ['invalid comment edit history object']
          });
          return;
        }

        const historyId = readString(historyObject, 'id', historyPath, errors, { nonEmpty: true });
        const historyCommentId = readString(historyObject, 'commentId', historyPath, errors, {
          nonEmpty: true
        });
        const previousBody = readString(historyObject, 'previousBody', historyPath, errors, {
          nonEmpty: true
        });
        const newBody = readString(historyObject, 'newBody', historyPath, errors, {
          nonEmpty: true
        });
        const editedAt = readString(historyObject, 'editedAt', historyPath, errors, {
          nonEmpty: true
        });

        if (historyId) {
          validateUniqueId(historyId, 'commentEditHistory', `${historyPath}.id`, seen, errors);
        }

        if (historyCommentId !== commentId) {
          pushError(
            errors,
            'dangling_reference',
            `${historyPath}.commentId`,
            'Comment edit history commentId must match its parent comment id.',
            historyCommentId
          );
        }

        if (!isValidTimestamp(editedAt)) {
          pushError(errors, 'invalid_timestamp', `${historyPath}.editedAt`, 'Invalid editedAt timestamp.', editedAt);
        }

        editHistory.push({
          id: historyId,
          commentId: historyCommentId,
          previousBody,
          newBody,
          editedAt
        });
      });

      comments.push({
        id: commentId,
        issueId: commentIssueId,
        body,
        createdAt: commentCreatedAt,
        updatedAt: commentUpdatedAt,
        editHistory
      });
    });

    activityInput.forEach((eventInput, eventIndex) => {
      const eventPath = `${issuePath}.activityEvents[${eventIndex}]`;
      const eventObject = validateObject(
        eventInput,
        eventPath,
        ['id', 'issueId', 'type', 'metadata', 'createdAt'],
        errors
      );

      if (!eventObject) {
        decisions.push({
          entity: 'activityEvent',
          sourceId: null,
          sourceIndex: eventIndex,
          issueId,
          decision: 'reject',
          reasons: ['invalid activity event object']
        });
        return;
      }

      const eventId = readString(eventObject, 'id', eventPath, errors, { nonEmpty: true });
      const eventIssueId = readString(eventObject, 'issueId', eventPath, errors, {
        nonEmpty: true
      });
      const eventType = readString(eventObject, 'type', eventPath, errors) as ActivityEventType;
      const metadata = validateMetadata(eventObject.metadata, `${eventPath}.metadata`, errors);
      const eventCreatedAt = readString(eventObject, 'createdAt', eventPath, errors, {
        nonEmpty: true
      });

      if (eventId) {
        validateUniqueId(eventId, 'activityEvent', `${eventPath}.id`, seen, errors);
      }

      if (eventIssueId !== issueId) {
        pushError(
          errors,
          'dangling_reference',
          `${eventPath}.issueId`,
          'Activity event issueId must match its parent issue id.',
          eventIssueId
        );
      }

      if (!VALID_ACTIVITY_TYPES.includes(eventType)) {
        pushError(errors, 'invalid_activity_type', `${eventPath}.type`, 'Invalid activity event type.', eventType);
      }

      if (!isValidTimestamp(eventCreatedAt)) {
        pushError(
          errors,
          'invalid_timestamp',
          `${eventPath}.createdAt`,
          'Invalid createdAt timestamp.',
          eventCreatedAt
        );
      }

      activityEvents.push({
        id: eventId,
        issueId: eventIssueId,
        type: eventType,
        metadata,
        createdAt: eventCreatedAt
      });
    });

    issues.push({
      id: issueId,
      title,
      description,
      status,
      priority,
      labels,
      dueDate,
      isOverdue,
      isBlocked,
      dependsOnIssueIds,
      archivedAt,
      createdAt,
      updatedAt,
      comments,
      activityEvents
    });
  });

  savedFilterViewsInput.forEach((viewInput, viewIndex) => {
    const viewPath = `$.savedFilterViews[${viewIndex}]`;
    const viewObject = validateObject(
      viewInput,
      viewPath,
      [
        'id',
        'name',
        'search',
        'status',
        'priority',
        'label',
        'includeArchived',
        'blockedOnly',
        'staleOnly',
        'pageSize',
        'createdAt',
        'updatedAt'
      ],
      errors
    );

    if (!viewObject) {
      decisions.push({
        entity: 'savedFilterView',
        sourceId: null,
        sourceIndex: viewIndex,
        decision: 'reject',
        reasons: ['invalid saved filter view object']
      });
      return;
    }

    const viewId = readString(viewObject, 'id', viewPath, errors, { nonEmpty: true });
    const name = readString(viewObject, 'name', viewPath, errors, { nonEmpty: true, maxLength: 120 });
    const search = readString(viewObject, 'search', viewPath, errors);
    const status = readString(viewObject, 'status', viewPath, errors) as SavedFilterStatus;
    const priority = readString(viewObject, 'priority', viewPath, errors) as SavedFilterPriority;
    const label = readString(viewObject, 'label', viewPath, errors, { maxLength: 32 });
    const includeArchived = readBoolean(viewObject, 'includeArchived', viewPath, errors);
    const blockedOnly = readBoolean(viewObject, 'blockedOnly', viewPath, errors);
    const staleOnly = readBoolean(viewObject, 'staleOnly', viewPath, errors);
    const pageSize = readInteger(viewObject, 'pageSize', viewPath, errors);
    const createdAt = readString(viewObject, 'createdAt', viewPath, errors, { nonEmpty: true });
    const updatedAt = readString(viewObject, 'updatedAt', viewPath, errors, { nonEmpty: true });

    if (viewId) {
      validateUniqueId(viewId, 'savedFilterView', `${viewPath}.id`, seen, errors);
    }

    if (name.trim().length === 0) {
      pushError(errors, 'invalid_value', `${viewPath}.name`, 'Saved view name must not be empty.', name);
    } else {
      const normalizedName = name.toLocaleLowerCase();
      const previousIndex = savedFilterViewNames.get(normalizedName);

      if (previousIndex !== undefined) {
        pushError(
          errors,
          'duplicate_name',
          `${viewPath}.name`,
          `Duplicate saved view name in import payload; first seen at $.savedFilterViews[${previousIndex}].name.`,
          name
        );
      } else {
        savedFilterViewNames.set(normalizedName, viewIndex);
      }
    }

    if (!VALID_SAVED_FILTER_STATUSES.includes(status)) {
      pushError(errors, 'invalid_status', `${viewPath}.status`, 'Invalid saved view status.', status);
    }

    if (!VALID_SAVED_FILTER_PRIORITIES.includes(priority)) {
      pushError(errors, 'invalid_priority', `${viewPath}.priority`, 'Invalid saved view priority.', priority);
    }

    if (pageSize < 1 || pageSize > 100) {
      pushError(errors, 'invalid_value', `${viewPath}.pageSize`, 'Invalid saved view pageSize.', pageSize);
    }

    if (!isValidTimestamp(createdAt)) {
      pushError(errors, 'invalid_timestamp', `${viewPath}.createdAt`, 'Invalid createdAt timestamp.', createdAt);
    }

    if (!isValidTimestamp(updatedAt)) {
      pushError(errors, 'invalid_timestamp', `${viewPath}.updatedAt`, 'Invalid updatedAt timestamp.', updatedAt);
    }

    savedFilterViews.push({
      id: viewId,
      name,
      search,
      status,
      priority,
      label,
      includeArchived,
      blockedOnly,
      staleOnly,
      pageSize,
      createdAt,
      updatedAt
    });
  });

  validateIssueDependencyGraph(issues, explicitIsBlockedByIssueId, errors);

  const exportData: TrackerExport | null =
    exportVersion === 1
      ? {
          exportVersion: 1,
          issues,
          savedFilterViews
        }
      : null;

  return {
    exportVersion: typeof exportVersion === 'number' ? exportVersion : null,
    conflictPolicy,
    exportData,
    input: countInput(exportData),
    decisions,
    errors
  };
}

function incrementCount(counts: ImportCounts, entity: ImportEntity) {
  if (entity === 'issue') {
    counts.issues += 1;
  } else if (entity === 'comment') {
    counts.comments += 1;
  } else if (entity === 'commentEditHistory') {
    counts.editHistory += 1;
  } else if (entity === 'activityEvent') {
    counts.activityEvents += 1;
  } else {
    counts.savedFilterViews += 1;
  }
}

function makeSummary(input: ImportCounts, decisions: ImportDecision[], errors: ImportErrorDetail[]): ImportSummary {
  const toCreate = emptyCounts();
  const toReplace = emptyCounts();
  const skip = emptyCounts();
  const exactMatches = emptyCounts();
  const changed = emptyCounts();

  for (const decision of decisions) {
    if (decision.decision === 'import') {
      incrementCount(toCreate, decision.entity);
    } else if (decision.decision === 'replace-existing') {
      incrementCount(toReplace, decision.entity);
    } else if (decision.decision === 'skip-existing') {
      incrementCount(skip, decision.entity);
    }

    if (decision.matchType === 'exact') {
      incrementCount(exactMatches, decision.entity);
    } else if (decision.matchType === 'changed') {
      incrementCount(changed, decision.entity);
    }
  }

  return {
    input,
    toCreate,
    toReplace,
    skip,
    exactMatches,
    changed,
    reject: errors.length
  };
}

function collectImportDecisions(
  database: Database.Database,
  exportData: TrackerExport,
  conflictPolicy: ImportConflictPolicy
): ImportDecision[] {
  const issueIds = exportData.issues.map((issue) => issue.id);
  const comments = exportData.issues.flatMap((issue) => issue.comments);
  const commentIds = comments.map((comment) => comment.id);
  const histories = comments.flatMap((comment) => comment.editHistory);
  const historyIds = histories.map((history) => history.id);
  const activityEvents = exportData.issues.flatMap((issue) => issue.activityEvents);
  const activityIds = activityEvents.map((event) => event.id);
  const existingIssues = existingIssueRowsById(database, issueIds);
  const existingComments = existingCommentRowsById(database, commentIds);
  const existingHistories = existingHistoryRowsById(database, historyIds);
  const existingActivity = existingActivityRowsById(database, activityIds);
  const dependenciesByIssueId = existingDependenciesByIssueId(database, issueIds);
  const savedFilterViewRows = existingSavedFilterViewRows(database);
  const savedFilterViewsById = rowsById(savedFilterViewRows);
  const savedFilterViewsByName = new Map(savedFilterViewRows.map((view) => [view.name.toLocaleLowerCase(), view]));
  const decisions: ImportDecision[] = [];

  exportData.issues.forEach((issue, issueIndex) => {
    const matchType = issueMatchType(issue, existingIssues, dependenciesByIssueId);
    const replaceIssue = conflictPolicy === 'replace-conflicts' && matchType === 'changed';
    const skipIssue = matchType !== 'new' && !replaceIssue;

    decisions.push({
      entity: 'issue',
      sourceId: issue.id,
      sourceIndex: issueIndex,
      issueId: issue.id,
      decision: matchType === 'new' ? 'import' : replaceIssue ? 'replace-existing' : 'skip-existing',
      matchType,
      policyDecision: matchType === 'new' ? 'import' : replaceIssue ? 'replace' : 'skip',
      reasons:
        matchType === 'new'
          ? []
          : replaceIssue
            ? ['changed issue id already exists and replace-conflicts is selected']
            : [
                matchType === 'exact'
                  ? 'issue id already exists with identical semantic data'
                  : 'changed issue id already exists'
              ]
    });

    issue.comments.forEach((comment, commentIndex) => {
      const childMatchType = commentMatchType(comment, existingComments);
      const skipForParent = skipIssue && conflictPolicy === 'skip-conflicts';
      const importComment = !skipForParent && childMatchType === 'new';

      decisions.push({
        entity: 'comment',
        sourceId: comment.id,
        sourceIndex: commentIndex,
        issueId: issue.id,
        commentId: comment.id,
        decision: importComment ? 'import' : 'skip-existing',
        matchType: childMatchType,
        policyDecision: importComment ? 'import' : 'skip',
        reasons: [
          ...(skipForParent ? ['parent issue skipped'] : []),
          ...(childMatchType === 'exact' ? ['comment id already exists with identical data'] : []),
          ...(childMatchType === 'changed' ? ['existing comment ids are immutable in this import policy'] : [])
        ]
      });

      comment.editHistory.forEach((history, historyIndex) => {
        const historyMatch = historyMatchType(history, existingHistories);
        const skipForComment = !importComment;
        const importHistory = !skipForComment && historyMatch === 'new';

        decisions.push({
          entity: 'commentEditHistory',
          sourceId: history.id,
          sourceIndex: historyIndex,
          issueId: issue.id,
          commentId: comment.id,
          decision: importHistory ? 'import' : 'skip-existing',
          matchType: historyMatch,
          policyDecision: importHistory ? 'import' : 'skip',
          reasons: [
            ...(skipForComment ? ['parent comment skipped'] : []),
            ...(historyMatch === 'exact' ? ['comment edit history id already exists with identical data'] : []),
            ...(historyMatch === 'changed'
              ? ['existing comment edit history ids are immutable in this import policy']
              : [])
          ]
        });
      });
    });

    issue.activityEvents.forEach((event, eventIndex) => {
      const eventMatch = activityMatchType(event, existingActivity);
      const skipForParent = skipIssue && conflictPolicy === 'skip-conflicts';
      const importEvent = !skipForParent && eventMatch === 'new';

      decisions.push({
        entity: 'activityEvent',
        sourceId: event.id,
        sourceIndex: eventIndex,
        issueId: issue.id,
        decision: importEvent ? 'import' : 'skip-existing',
        matchType: eventMatch,
        policyDecision: importEvent ? 'import' : 'skip',
        reasons: [
          ...(skipForParent ? ['parent issue skipped'] : []),
          ...(eventMatch === 'exact' ? ['activity event id already exists with identical data'] : []),
          ...(eventMatch === 'changed' ? ['existing activity event ids are immutable in this import policy'] : [])
        ]
      });
    });
  });

  exportData.savedFilterViews.forEach((view, viewIndex) => {
    const existingById = savedFilterViewsById.get(view.id);
    const existingByName = savedFilterViewsByName.get(view.name.toLocaleLowerCase());
    const nameCollision = existingByName && existingByName.id !== view.id;
    const matchType: ImportMatchType = existingById
      ? savedFilterViewMatchesRow(view, existingById)
        ? 'exact'
        : 'changed'
      : nameCollision
        ? 'changed'
        : 'new';
    const replaceView =
      conflictPolicy === 'replace-conflicts' && Boolean(existingById) && matchType === 'changed' && !nameCollision;
    const importView = matchType === 'new' && !nameCollision;

    decisions.push({
      entity: 'savedFilterView',
      sourceId: view.id,
      sourceIndex: viewIndex,
      decision: importView ? 'import' : replaceView ? 'replace-existing' : 'skip-existing',
      matchType,
      policyDecision: importView ? 'import' : replaceView ? 'replace' : 'skip',
      reasons: [
        ...(matchType === 'exact' ? ['saved view id already exists with identical data'] : []),
        ...(Boolean(existingById) && matchType === 'changed' && !replaceView
          ? ['changed saved view id already exists']
          : []),
        ...(replaceView ? ['changed saved view id already exists and replace-conflicts is selected'] : []),
        ...(nameCollision ? ['saved view name already exists with a different id'] : [])
      ]
    });
  });

  return decisions;
}

function buildImportPlan(database: Database.Database, input: unknown): ImportPlan {
  const validation = validateTrackerExport(input);

  if (!validation.exportData || validation.errors.length > 0) {
    return {
      valid: false,
      exportVersion: validation.exportVersion,
      policy: validation.conflictPolicy,
      summary: makeSummary(validation.input, validation.decisions, validation.errors),
      decisions: validation.decisions,
      errors: validation.errors,
      warnings: []
    };
  }

  const decisions = collectImportDecisions(database, validation.exportData, validation.conflictPolicy);

  return {
    valid: true,
    exportVersion: validation.exportVersion,
    policy: validation.conflictPolicy,
    summary: makeSummary(validation.input, decisions, validation.errors),
    decisions,
    errors: [],
    warnings: []
  };
}

export class ImportValidationError extends Error {
  constructor(readonly plan: ImportPlan) {
    super('Import validation failed');
  }
}

export function previewTrackerImport(database: Database.Database, input: unknown): ImportPlan {
  return buildImportPlan(database, input);
}

function decisionSet(plan: ImportPlan, entity: ImportEntity, decisionType: ImportDecisionType = 'import'): Set<string> {
  return new Set(
    plan.decisions
      .filter((decision) => decision.entity === entity && decision.decision === decisionType)
      .map((decision) => decision.sourceId)
      .filter((id): id is string => id !== null)
  );
}

function byCreatedAtThenId<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareActivityEventsForImport(left: ActivityEvent, right: ActivityEvent): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    ACTIVITY_IMPORT_TYPE_ORDER[left.type] - ACTIVITY_IMPORT_TYPE_ORDER[right.type]
  );
}

export function applyTrackerImport(database: Database.Database, input: unknown): ImportPlan {
  const validation = validateTrackerExport(input);
  const plan = buildImportPlan(database, input);

  if (!validation.exportData || !plan.valid) {
    throw new ImportValidationError(plan);
  }

  const issueIdsToImport = decisionSet(plan, 'issue');
  const issueIdsToReplace = decisionSet(plan, 'issue', 'replace-existing');
  const commentIdsToImport = decisionSet(plan, 'comment');
  const historyIdsToImport = decisionSet(plan, 'commentEditHistory');
  const activityIdsToImport = decisionSet(plan, 'activityEvent');
  const savedFilterViewIdsToImport = decisionSet(plan, 'savedFilterView');
  const savedFilterViewIdsToReplace = decisionSet(plan, 'savedFilterView', 'replace-existing');
  const issues = validation.exportData.issues.filter((issue) => issueIdsToImport.has(issue.id)).sort(byCreatedAtThenId);
  const issuesToReplace = validation.exportData.issues
    .filter((issue) => issueIdsToReplace.has(issue.id))
    .sort(byCreatedAtThenId);
  const dependencyIssues = [...issues, ...issuesToReplace];
  const dependencies = dependencyIssues.flatMap((issue) =>
    issue.dependsOnIssueIds.map((dependsOnIssueId) => ({
      issueId: issue.id,
      dependsOnIssueId,
      createdAt: issue.updatedAt,
      updatedAt: issue.updatedAt
    }))
  );
  const comments = validation.exportData.issues
    .flatMap((issue) => issue.comments)
    .filter((comment) => commentIdsToImport.has(comment.id));
  const histories = validation.exportData.issues
    .flatMap((issue) => issue.comments.flatMap((comment) => comment.editHistory))
    .filter((history) => historyIdsToImport.has(history.id));
  const activityEvents = validation.exportData.issues
    .flatMap((issue) => issue.activityEvents)
    .map((event, sourceIndex) => ({ event, sourceIndex }))
    .filter(({ event }) => activityIdsToImport.has(event.id))
    .sort(
      (left, right) => compareActivityEventsForImport(left.event, right.event) || left.sourceIndex - right.sourceIndex
    )
    .map(({ event }) => event);
  const savedFilterViews = validation.exportData.savedFilterViews.filter((view) =>
    savedFilterViewIdsToImport.has(view.id)
  );
  const savedFilterViewsToReplace = validation.exportData.savedFilterViews.filter((view) =>
    savedFilterViewIdsToReplace.has(view.id)
  );

  const transaction = database.transaction(() => {
    const insertIssue = database.prepare(`
      INSERT INTO issues (id, title, description, status, priority, labels, due_date, archived_at, created_at, updated_at)
      VALUES (@id, @title, @description, @status, @priority, @labels, @dueDate, @archivedAt, @createdAt, @updatedAt)
    `);
    const updateIssue = database.prepare(`
      UPDATE issues
      SET title = @title,
          description = @description,
          status = @status,
          priority = @priority,
          labels = @labels,
          due_date = @dueDate,
          archived_at = @archivedAt,
          created_at = @createdAt,
          updated_at = @updatedAt
      WHERE id = @id
    `);
    const insertComment = database.prepare(`
      INSERT INTO comments (id, issue_id, body, created_at, updated_at)
      VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
    `);
    const deleteDependencies = database.prepare(`
      DELETE FROM issue_dependencies
      WHERE issue_id = @issueId
    `);
    const insertDependency = database.prepare(`
      INSERT INTO issue_dependencies (issue_id, depends_on_issue_id, created_at, updated_at)
      VALUES (@issueId, @dependsOnIssueId, @createdAt, @updatedAt)
    `);
    const insertHistory = database.prepare(`
      INSERT INTO comment_edit_history (id, comment_id, previous_body, new_body, edited_at)
      VALUES (@id, @commentId, @previousBody, @newBody, @editedAt)
    `);
    const insertActivity = database.prepare(`
      INSERT INTO activity_events (id, issue_id, event_type, metadata, created_at)
      VALUES (@id, @issueId, @type, @metadata, @createdAt)
    `);
    const insertSavedFilterView = database.prepare(`
      INSERT INTO saved_filter_views (
        id, name, search, status, priority, label, include_archived, blocked_only, stale_only, page_size, created_at, updated_at
      )
      VALUES (
        @id, @name, @search, @status, @priority, @label, @includeArchived, @blockedOnly, @staleOnly, @pageSize, @createdAt, @updatedAt
      )
    `);
    const updateSavedFilterView = database.prepare(`
      UPDATE saved_filter_views
      SET name = @name,
          search = @search,
          status = @status,
          priority = @priority,
          label = @label,
          include_archived = @includeArchived,
          blocked_only = @blockedOnly,
          stale_only = @staleOnly,
          page_size = @pageSize,
          created_at = @createdAt,
          updated_at = @updatedAt
      WHERE id = @id
    `);

    for (const issue of issues) {
      insertIssue.run({
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
    }

    for (const issue of issuesToReplace) {
      updateIssue.run({
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
      deleteDependencies.run({ issueId: issue.id });
    }

    for (const dependency of dependencies) {
      insertDependency.run(dependency);
    }

    for (const comment of comments) {
      insertComment.run(comment);
    }

    for (const history of histories) {
      insertHistory.run(history);
    }

    for (const event of activityEvents) {
      insertActivity.run({
        id: event.id,
        issueId: event.issueId,
        type: event.type,
        metadata: JSON.stringify(event.metadata),
        createdAt: event.createdAt
      });
    }

    for (const view of savedFilterViews) {
      insertSavedFilterView.run({
        id: view.id,
        name: view.name,
        search: view.search,
        status: view.status,
        priority: view.priority,
        label: view.label,
        includeArchived: view.includeArchived ? 1 : 0,
        blockedOnly: view.blockedOnly ? 1 : 0,
        staleOnly: view.staleOnly ? 1 : 0,
        pageSize: view.pageSize,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt
      });
    }

    for (const view of savedFilterViewsToReplace) {
      updateSavedFilterView.run({
        id: view.id,
        name: view.name,
        search: view.search,
        status: view.status,
        priority: view.priority,
        label: view.label,
        includeArchived: view.includeArchived ? 1 : 0,
        blockedOnly: view.blockedOnly ? 1 : 0,
        staleOnly: view.staleOnly ? 1 : 0,
        pageSize: view.pageSize,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt
      });
    }
  });

  transaction();
  return plan;
}
