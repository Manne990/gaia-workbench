import Database from 'better-sqlite3';
import {
  ActivityEvent,
  ActivityEventType,
  ActivityMetadata,
  Comment,
  CommentEditHistory,
  Issue,
  IssuePriority,
  IssueStatus
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
};

type ImportEntity = 'issue' | 'comment' | 'commentEditHistory' | 'activityEvent';
type ImportDecisionType = 'import' | 'skip-existing' | 'reject';

type ImportCounts = {
  issues: number;
  comments: number;
  editHistory: number;
  activityEvents: number;
};

export type ImportDecision = {
  entity: ImportEntity;
  sourceId: string | null;
  sourceIndex: number;
  issueId?: string;
  commentId?: string;
  decision: ImportDecisionType;
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
  skip: ImportCounts;
  reject: number;
};

export type ImportPlan = {
  valid: boolean;
  exportVersion: number | null;
  summary: ImportSummary;
  decisions: ImportDecision[];
  errors: ImportErrorDetail[];
  warnings: string[];
};

type ValidationResult = {
  exportVersion: number | null;
  exportData: TrackerExport | null;
  input: ImportCounts;
  decisions: ImportDecision[];
  errors: ImportErrorDetail[];
};

const VALID_STATUSES: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES: IssuePriority[] = ['low', 'medium', 'high'];
const VALID_ACTIVITY_TYPES: ActivityEventType[] = [
  'issue_created',
  'issue_title_changed',
  'issue_description_changed',
  'issue_status_changed',
  'issue_priority_changed',
  'issue_due_date_changed',
  'issue_labels_changed',
  'comment_added',
  'comment_edited'
];

const emptyCounts = (): ImportCounts => ({
  issues: 0,
  comments: 0,
  editHistory: 0,
  activityEvents: 0
});

function pushError(
  errors: ImportErrorDetail[],
  code: string,
  path: string,
  message: string,
  value?: unknown
) {
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
  errors: ImportErrorDetail[]
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    pushError(errors, 'invalid_type', path, 'Expected an object.', value);
    return null;
  }

  const allowed = new Set(allowedKeys);
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

function readBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ImportErrorDetail[]
): boolean {
  const field = value[key];

  if (typeof field !== 'boolean') {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be a boolean.`, field);
    return false;
  }

  return field;
}

function readArray(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: ImportErrorDetail[]
): unknown[] {
  const field = value[key];

  if (!Array.isArray(field)) {
    pushError(errors, 'invalid_type', `${path}.${key}`, `Field "${key}" must be an array.`, field);
    return [];
  }

  return field;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
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

function validateMetadata(
  value: unknown,
  path: string,
  errors: ImportErrorDetail[]
): ActivityMetadata {
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

function existingIds(
  database: Database.Database,
  tableName: 'issues' | 'comments' | 'comment_edit_history' | 'activity_events',
  ids: string[]
): Set<string> {
  if (ids.length === 0) {
    return new Set();
  }

  const rows = database
    .prepare(`SELECT id FROM ${tableName} WHERE id IN (${placeholdersFor(ids)})`)
    .all(...ids) as Array<{ id: string }>;

  return new Set(rows.map((row) => row.id));
}

function countInput(exportData: TrackerExport | null): ImportCounts {
  const counts = emptyCounts();

  if (!exportData) {
    return counts;
  }

  counts.issues = exportData.issues.length;

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
  const root = validateObject(input, '$', ['exportVersion', 'issues'], errors);

  if (!root) {
    return {
      exportVersion: null,
      exportData: null,
      input: emptyCounts(),
      decisions,
      errors
    };
  }

  const exportVersion = root.exportVersion;
  if (exportVersion !== 1) {
    pushError(
      errors,
      'unsupported_version',
      '$.exportVersion',
      'Unsupported export version.',
      exportVersion
    );
  }

  const issuesInput = readArray(root, 'issues', '$', errors);
  const issues: ExportedIssue[] = [];

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
      errors
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
    const createdAt = readString(issueObject, 'createdAt', issuePath, errors, { nonEmpty: true });
    const updatedAt = readString(issueObject, 'updatedAt', issuePath, errors, { nonEmpty: true });

    if (issueId) {
      validateUniqueId(issueId, 'issue', `${issuePath}.id`, seen, errors);
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
          pushError(
            errors,
            'invalid_timestamp',
            `${historyPath}.editedAt`,
            'Invalid editedAt timestamp.',
            editedAt
          );
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
      createdAt,
      updatedAt,
      comments,
      activityEvents
    });
  });

  const exportData: TrackerExport | null =
    exportVersion === 1
      ? {
          exportVersion: 1,
          issues
        }
      : null;

  return {
    exportVersion: typeof exportVersion === 'number' ? exportVersion : null,
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
  } else {
    counts.activityEvents += 1;
  }
}

function makeSummary(input: ImportCounts, decisions: ImportDecision[], errors: ImportErrorDetail[]): ImportSummary {
  const toCreate = emptyCounts();
  const skip = emptyCounts();

  for (const decision of decisions) {
    if (decision.decision === 'import') {
      incrementCount(toCreate, decision.entity);
    } else if (decision.decision === 'skip-existing') {
      incrementCount(skip, decision.entity);
    }
  }

  return {
    input,
    toCreate,
    skip,
    reject: errors.length
  };
}

function collectImportDecisions(database: Database.Database, exportData: TrackerExport): ImportDecision[] {
  const issueIds = exportData.issues.map((issue) => issue.id);
  const comments = exportData.issues.flatMap((issue) => issue.comments);
  const commentIds = comments.map((comment) => comment.id);
  const histories = comments.flatMap((comment) => comment.editHistory);
  const historyIds = histories.map((history) => history.id);
  const activityEvents = exportData.issues.flatMap((issue) => issue.activityEvents);
  const activityIds = activityEvents.map((event) => event.id);
  const existingIssueIds = existingIds(database, 'issues', issueIds);
  const existingCommentIds = existingIds(database, 'comments', commentIds);
  const existingHistoryIds = existingIds(database, 'comment_edit_history', historyIds);
  const existingActivityIds = existingIds(database, 'activity_events', activityIds);
  const decisions: ImportDecision[] = [];

  exportData.issues.forEach((issue, issueIndex) => {
    const issueExists = existingIssueIds.has(issue.id);

    decisions.push({
      entity: 'issue',
      sourceId: issue.id,
      sourceIndex: issueIndex,
      issueId: issue.id,
      decision: issueExists ? 'skip-existing' : 'import',
      reasons: issueExists ? ['issue id already exists'] : []
    });

    issue.comments.forEach((comment, commentIndex) => {
      const commentExists = existingCommentIds.has(comment.id);
      const skipForParent = issueExists;

      decisions.push({
        entity: 'comment',
        sourceId: comment.id,
        sourceIndex: commentIndex,
        issueId: issue.id,
        commentId: comment.id,
        decision: skipForParent || commentExists ? 'skip-existing' : 'import',
        reasons: [
          ...(skipForParent ? ['parent issue skipped'] : []),
          ...(commentExists ? ['comment id already exists'] : [])
        ]
      });

      comment.editHistory.forEach((history, historyIndex) => {
        const historyExists = existingHistoryIds.has(history.id);
        const skipForComment = skipForParent || commentExists;

        decisions.push({
          entity: 'commentEditHistory',
          sourceId: history.id,
          sourceIndex: historyIndex,
          issueId: issue.id,
          commentId: comment.id,
          decision: skipForComment || historyExists ? 'skip-existing' : 'import',
          reasons: [
            ...(skipForComment ? ['parent comment skipped'] : []),
            ...(historyExists ? ['comment edit history id already exists'] : [])
          ]
        });
      });
    });

    issue.activityEvents.forEach((event, eventIndex) => {
      const eventExists = existingActivityIds.has(event.id);
      const skipForParent = issueExists;

      decisions.push({
        entity: 'activityEvent',
        sourceId: event.id,
        sourceIndex: eventIndex,
        issueId: issue.id,
        decision: skipForParent || eventExists ? 'skip-existing' : 'import',
        reasons: [
          ...(skipForParent ? ['parent issue skipped'] : []),
          ...(eventExists ? ['activity event id already exists'] : [])
        ]
      });
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
      summary: makeSummary(validation.input, validation.decisions, validation.errors),
      decisions: validation.decisions,
      errors: validation.errors,
      warnings: []
    };
  }

  const decisions = collectImportDecisions(database, validation.exportData);

  return {
    valid: true,
    exportVersion: validation.exportVersion,
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

function decisionSet(plan: ImportPlan, entity: ImportEntity): Set<string> {
  return new Set(
    plan.decisions
      .filter((decision) => decision.entity === entity && decision.decision === 'import')
      .map((decision) => decision.sourceId)
      .filter((id): id is string => id !== null)
  );
}

function byCreatedAtThenId<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function applyTrackerImport(database: Database.Database, input: unknown): ImportPlan {
  const validation = validateTrackerExport(input);
  const plan = buildImportPlan(database, input);

  if (!validation.exportData || !plan.valid) {
    throw new ImportValidationError(plan);
  }

  const issueIdsToImport = decisionSet(plan, 'issue');
  const commentIdsToImport = decisionSet(plan, 'comment');
  const historyIdsToImport = decisionSet(plan, 'commentEditHistory');
  const activityIdsToImport = decisionSet(plan, 'activityEvent');
  const issues = validation.exportData.issues
    .filter((issue) => issueIdsToImport.has(issue.id))
    .sort(byCreatedAtThenId);
  const comments = validation.exportData.issues
    .flatMap((issue) => issue.comments)
    .filter((comment) => commentIdsToImport.has(comment.id));
  const histories = validation.exportData.issues
    .flatMap((issue) => issue.comments.flatMap((comment) => comment.editHistory))
    .filter((history) => historyIdsToImport.has(history.id));
  const activityEvents = validation.exportData.issues
    .flatMap((issue) => issue.activityEvents)
    .filter((event) => activityIdsToImport.has(event.id));

  const transaction = database.transaction(() => {
    const insertIssue = database.prepare(`
      INSERT INTO issues (id, title, description, status, priority, labels, due_date, created_at, updated_at)
      VALUES (@id, @title, @description, @status, @priority, @labels, @dueDate, @createdAt, @updatedAt)
    `);
    const insertComment = database.prepare(`
      INSERT INTO comments (id, issue_id, body, created_at, updated_at)
      VALUES (@id, @issueId, @body, @createdAt, @updatedAt)
    `);
    const insertHistory = database.prepare(`
      INSERT INTO comment_edit_history (id, comment_id, previous_body, new_body, edited_at)
      VALUES (@id, @commentId, @previousBody, @newBody, @editedAt)
    `);
    const insertActivity = database.prepare(`
      INSERT INTO activity_events (id, issue_id, event_type, metadata, created_at)
      VALUES (@id, @issueId, @type, @metadata, @createdAt)
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
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt
      });
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
  });

  transaction();
  return plan;
}
