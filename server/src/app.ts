import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  type ActivityEvent,
  type ActivityMetadataValue,
  type ActivityEventType,
  ActivityRepository,
  type Comment,
  type CommentEditHistory,
  CommentRepository,
  CLOSED_ISSUE_STATUS,
  createDatabase,
  DuplicateSavedFilterViewNameError,
  type Issue,
  IssueDependencyConflictError,
  IssueDependencyNotFoundError,
  IssueDependencyRepository,
  type IssuePriority,
  type IssueStatus,
  IssueStatusUndoNotAvailableError,
  type IssueUpdate,
  IssueRepository,
  type SavedFilterView,
  SavedFilterViewRepository,
  createEmptyIssueStatusCounts
} from './db/index.js';
import { buildIssueListFilterModel, buildIssueListQueryModel } from './issueListQuery.js';
import { applyTrackerImport, ImportValidationError, previewTrackerImport, type ImportPlan } from './trackerImport.js';

type AppConfig = {
  clientDir?: string;
  databasePath?: string;
};

type ExportedComment = Comment & {
  editHistory: CommentEditHistory[];
};

type ExportedIssue = Issue & {
  comments: ExportedComment[];
  activityEvents: ActivityEvent[];
};

type ExportAuditSnapshot = Record<string, ActivityMetadataValue>;

type ExportAuditMeetingImpact =
  | 'scope'
  | 'workflow'
  | 'priority'
  | 'schedule'
  | 'blocking'
  | 'discussion'
  | 'visibility';

type ExportAuditTimelineEntry = {
  eventId: string;
  issueId: string;
  issueTitle: string;
  type: ActivityEventType;
  createdAt: string;
  meetingLabel: string;
  meetingImpact: ExportAuditMeetingImpact;
  before: ExportAuditSnapshot | null;
  after: ExportAuditSnapshot | null;
};

type ExportAuditTimestampPolicy = {
  createdAt: {
    valueFormat: 'ISO 8601 UTC';
    timeZone: 'UTC';
    uiDisplayTimeZone: 'UTC';
  };
};

type ExportAuditSummary = {
  timestampPolicy: ExportAuditTimestampPolicy;
  issues: {
    total: number;
    active: number;
    archived: number;
    blocked: number;
    overdue: number;
    byStatus: Record<IssueStatus, number>;
    byPriority: Record<IssuePriority, number>;
  };
  comments: {
    total: number;
    edited: number;
    editHistoryEntries: number;
  };
  dependencies: {
    total: number;
    blocking: number;
  };
  activity: {
    total: number;
    byType: Record<ActivityEventType, number>;
    recent: Array<{
      eventId: string;
      issueId: string;
      issueTitle: string;
      type: ActivityEventType;
      createdAt: string;
    }>;
    timeline: ExportAuditTimelineEntry[];
  };
  savedFilterViews: {
    total: number;
  };
};

type TrackerExport = {
  exportVersion: 1;
  issues: ExportedIssue[];
  savedFilterViews: SavedFilterView[];
  auditSummary?: ExportAuditSummary;
};

type TrackerExportBase = Omit<TrackerExport, 'auditSummary'>;

type ValidationErrorResponse = {
  error: string;
  code: 'validation_error';
  errors: Array<{ message: string }>;
};

const SPREADSHEET_FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r\n]/;
const activityEventTypes: ActivityEventType[] = [
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
const serviceHealth = {
  status: 'ok',
  service: 'TinyTracker'
} as const;
const exportAuditTimestampPolicy: ExportAuditTimestampPolicy = {
  createdAt: {
    valueFormat: 'ISO 8601 UTC',
    timeZone: 'UTC',
    uiDisplayTimeZone: 'UTC'
  }
};

const emptyImportPlan = (error: ImportPlan['errors'][number]): ImportPlan => ({
  valid: false,
  exportVersion: null,
  policy: 'skip-conflicts',
  summary: {
    input: {
      issues: 0,
      comments: 0,
      editHistory: 0,
      activityEvents: 0,
      savedFilterViews: 0
    },
    toCreate: {
      issues: 0,
      comments: 0,
      editHistory: 0,
      activityEvents: 0,
      savedFilterViews: 0
    },
    toReplace: {
      issues: 0,
      comments: 0,
      editHistory: 0,
      activityEvents: 0,
      savedFilterViews: 0
    },
    skip: {
      issues: 0,
      comments: 0,
      editHistory: 0,
      activityEvents: 0,
      savedFilterViews: 0
    },
    exactMatches: {
      issues: 0,
      comments: 0,
      editHistory: 0,
      activityEvents: 0,
      savedFilterViews: 0
    },
    changed: {
      issues: 0,
      comments: 0,
      editHistory: 0,
      activityEvents: 0,
      savedFilterViews: 0
    },
    categories: {
      creates: {
        issues: 0,
        comments: 0,
        editHistory: 0,
        activityEvents: 0,
        savedFilterViews: 0
      },
      updates: {
        issues: 0,
        comments: 0,
        editHistory: 0,
        activityEvents: 0,
        savedFilterViews: 0
      },
      duplicates: {
        issues: 0,
        comments: 0,
        editHistory: 0,
        activityEvents: 0,
        savedFilterViews: 0
      },
      conflicts: {
        issues: 0,
        comments: 0,
        editHistory: 0,
        activityEvents: 0,
        savedFilterViews: 0
      }
    },
    reject: 1
  },
  decisions: [],
  errors: [error],
  warnings: []
});

const validationErrorMessages = new Set([
  'title is required',
  'body is required',
  'Invalid issue status',
  'Invalid issue priority',
  'Invalid issue payload',
  'Invalid issue description',
  'Invalid issue labels',
  'Invalid issue due date',
  'Invalid page parameter',
  'Invalid limit parameter',
  'Invalid includeArchived parameter',
  'Invalid blockedOnly parameter',
  'Invalid staleOnly parameter',
  'Invalid includeAuditSummary parameter',
  'Invalid bulk issue ids',
  'Invalid bulk dependency ids',
  'dependsOnIssueId is required',
  'Saved view name is required',
  'Invalid saved view payload',
  'Invalid saved view name',
  'Invalid saved view search',
  'Invalid saved view status',
  'Invalid saved view priority',
  'Invalid saved view label',
  'Invalid saved view includeArchived',
  'Invalid saved view blockedOnly',
  'Invalid saved view staleOnly',
  'Invalid saved view pageSize'
]);

function isValidationError(error: unknown): error is Error {
  return error instanceof Error && validationErrorMessages.has(error.message);
}

function validationErrorResponse(message: string): ValidationErrorResponse {
  return {
    error: message,
    code: 'validation_error',
    errors: [{ message }]
  };
}

function sendValidationError(res: Response, message: string) {
  return res.status(400).json(validationErrorResponse(message));
}

function parseBulkDependencyIds(dependsOnIssueIds: unknown): string[] {
  if (!Array.isArray(dependsOnIssueIds)) {
    throw new Error('Invalid bulk dependency ids');
  }

  const normalizedIds: string[] = [];
  const seen = new Set<string>();

  for (const dependsOnIssueId of dependsOnIssueIds) {
    if (typeof dependsOnIssueId !== 'string' || dependsOnIssueId.trim().length === 0) {
      throw new Error('Invalid bulk dependency ids');
    }

    const normalizedIssueId = dependsOnIssueId.trim();

    if (seen.has(normalizedIssueId)) {
      throw new Error('Invalid bulk dependency ids');
    }

    normalizedIds.push(normalizedIssueId);
    seen.add(normalizedIssueId);
  }

  return normalizedIds;
}

function isJsonParseError(error: unknown): error is SyntaxError & { status?: number; type?: string } {
  return error instanceof SyntaxError && typeof (error as { status?: unknown }).status === 'number';
}

function jsonParseErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (!isJsonParseError(error)) {
    next(error);
    return;
  }

  if (req.path.startsWith('/api/import/')) {
    res.status(400).json(
      emptyImportPlan({
        code: 'invalid_json',
        path: '$',
        message: 'Request body must be valid JSON.'
      })
    );
    return;
  }

  sendValidationError(res, 'Request body must be valid JSON.');
}

function getOptionalRequestObject(value: unknown, errorMessage: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(errorMessage);
  }

  return value as Record<string, unknown>;
}

function neutralizeSpreadsheetFormulaCell(value: string): string {
  if (!SPREADSHEET_FORMULA_PREFIX_PATTERN.test(value)) {
    return value;
  }

  return `'${value}`;
}

function escapeCsvCell(value: string): string {
  const cellValue = neutralizeSpreadsheetFormulaCell(value);
  const needsEscaping = /[",\r\n]/.test(cellValue);

  if (!needsEscaping) {
    return cellValue;
  }

  return `"${cellValue.replaceAll('"', '""')}"`;
}

function getOptionalQueryString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}

function parseOptionalBooleanQuery(value: unknown, defaultValue: boolean, errorMessage: string): boolean {
  const queryValue = getOptionalQueryString(value);

  if (queryValue === undefined) {
    return defaultValue;
  }

  if (queryValue === 'true') {
    return true;
  }

  if (queryValue === 'false') {
    return false;
  }

  throw new Error(errorMessage);
}

function buildIssueListCsv(issues: Issue[]): string {
  const header = [
    'id',
    'title',
    'description',
    'status',
    'priority',
    'dueDate',
    'isOverdue',
    'isBlocked',
    'archivedAt',
    'dependsOnIssueIds',
    'labels',
    'createdAt',
    'updatedAt'
  ];
  const rows = issues.map((issue) => [
    issue.id,
    issue.title,
    issue.description,
    issue.status,
    issue.priority,
    issue.dueDate ?? '',
    String(issue.isOverdue),
    String(issue.isBlocked),
    issue.archivedAt ?? '',
    issue.dependsOnIssueIds.join('|'),
    issue.labels.join('|'),
    issue.createdAt,
    issue.updatedAt
  ]);

  const rowsCsv = rows.map((row) => row.map(escapeCsvCell).join(','));

  return [header.join(','), ...rowsCsv].join('\r\n');
}

function groupBy<T>(items: T[], keySelector: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keySelector(item);
    const group = groups.get(key);

    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function emptyStatusCounts(): Record<IssueStatus, number> {
  return createEmptyIssueStatusCounts();
}

function emptyPriorityCounts(): Record<IssuePriority, number> {
  return {
    low: 0,
    medium: 0,
    high: 0
  };
}

function emptyActivityTypeCounts(): Record<ActivityEventType, number> {
  return Object.fromEntries(activityEventTypes.map((type) => [type, 0])) as Record<ActivityEventType, number>;
}

function getActivityMetadataValue(event: ActivityEvent, key: string): ActivityMetadataValue {
  return event.metadata[key] ?? null;
}

function formatAuditMeetingValue(value: ActivityMetadataValue): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'none';
  }

  return value && value.length > 0 ? value : 'none';
}

function formatAuditMeetingChange(event: ActivityEvent, label: string): string {
  return `${label}: ${formatAuditMeetingValue(getActivityMetadataValue(event, 'from'))} -> ${formatAuditMeetingValue(
    getActivityMetadataValue(event, 'to')
  )}`;
}

function buildAuditMeetingLabel(event: ActivityEvent, issue: ExportedIssue): string {
  switch (event.type) {
    case 'issue_created':
      return `Issue created: ${formatAuditMeetingValue(getActivityMetadataValue(event, 'title') ?? issue.title)}`;
    case 'issue_title_changed':
      return formatAuditMeetingChange(event, 'Title changed');
    case 'issue_description_changed':
      return formatAuditMeetingChange(event, 'Description changed');
    case 'issue_status_changed':
      return formatAuditMeetingChange(event, 'Status changed');
    case 'issue_priority_changed':
      return formatAuditMeetingChange(event, 'Priority changed');
    case 'issue_due_date_changed':
      return formatAuditMeetingChange(event, 'Due date changed');
    case 'issue_labels_changed':
      return formatAuditMeetingChange(event, 'Labels changed');
    case 'issue_archived':
      return 'Issue archived';
    case 'issue_unarchived':
      return 'Issue restored';
    case 'issue_dependency_added':
      return `Dependency added: ${formatAuditMeetingValue(getActivityMetadataValue(event, 'title'))}`;
    case 'issue_dependency_removed':
      return `Dependency removed: ${formatAuditMeetingValue(getActivityMetadataValue(event, 'title'))}`;
    case 'comment_added':
      return `Comment added: ${formatAuditMeetingValue(getActivityMetadataValue(event, 'preview'))}`;
    case 'comment_edited':
      return `Comment edited: ${formatAuditMeetingValue(
        getActivityMetadataValue(event, 'previousPreview')
      )} -> ${formatAuditMeetingValue(getActivityMetadataValue(event, 'newPreview'))}`;
  }
}

function buildAuditMeetingImpact(event: ActivityEvent): ExportAuditMeetingImpact {
  switch (event.type) {
    case 'issue_status_changed':
      return 'workflow';
    case 'issue_priority_changed':
      return 'priority';
    case 'issue_due_date_changed':
      return 'schedule';
    case 'issue_dependency_added':
    case 'issue_dependency_removed':
      return 'blocking';
    case 'comment_added':
    case 'comment_edited':
      return 'discussion';
    case 'issue_archived':
    case 'issue_unarchived':
      return 'visibility';
    case 'issue_created':
    case 'issue_title_changed':
    case 'issue_description_changed':
    case 'issue_labels_changed':
      return 'scope';
  }
}

function buildFieldChangeSnapshot(
  event: ActivityEvent,
  field: string
): { before: ExportAuditSnapshot; after: ExportAuditSnapshot } {
  return {
    before: { [field]: getActivityMetadataValue(event, 'from') },
    after: { [field]: getActivityMetadataValue(event, 'to') }
  };
}

function buildActivityTimelineSnapshots(
  event: ActivityEvent,
  issue: ExportedIssue
): { before: ExportAuditSnapshot | null; after: ExportAuditSnapshot | null } {
  switch (event.type) {
    case 'issue_created':
      return {
        before: null,
        after: { title: getActivityMetadataValue(event, 'title') ?? issue.title }
      };
    case 'issue_title_changed':
      return buildFieldChangeSnapshot(event, 'title');
    case 'issue_description_changed':
      return buildFieldChangeSnapshot(event, 'description');
    case 'issue_status_changed':
      return buildFieldChangeSnapshot(event, 'status');
    case 'issue_priority_changed':
      return buildFieldChangeSnapshot(event, 'priority');
    case 'issue_due_date_changed':
      return buildFieldChangeSnapshot(event, 'dueDate');
    case 'issue_labels_changed':
      return buildFieldChangeSnapshot(event, 'labels');
    case 'issue_archived':
    case 'issue_unarchived':
      return buildFieldChangeSnapshot(event, 'archivedAt');
    case 'issue_dependency_added':
      return {
        before: { dependsOnIssueId: null, dependencyTitle: null },
        after: {
          dependsOnIssueId: getActivityMetadataValue(event, 'dependsOnIssueId'),
          dependencyTitle: getActivityMetadataValue(event, 'title')
        }
      };
    case 'issue_dependency_removed':
      return {
        before: {
          dependsOnIssueId: getActivityMetadataValue(event, 'dependsOnIssueId'),
          dependencyTitle: getActivityMetadataValue(event, 'title')
        },
        after: { dependsOnIssueId: null, dependencyTitle: null }
      };
    case 'comment_added':
      return {
        before: { commentId: null, commentPreview: null },
        after: {
          commentId: getActivityMetadataValue(event, 'commentId'),
          commentPreview: getActivityMetadataValue(event, 'preview')
        }
      };
    case 'comment_edited':
      return {
        before: {
          commentId: getActivityMetadataValue(event, 'commentId'),
          commentPreview: getActivityMetadataValue(event, 'previousPreview')
        },
        after: {
          commentId: getActivityMetadataValue(event, 'commentId'),
          commentPreview: getActivityMetadataValue(event, 'newPreview')
        }
      };
  }
}

function buildActivityTimelineEntry(issue: ExportedIssue, event: ActivityEvent): ExportAuditTimelineEntry {
  const snapshots = buildActivityTimelineSnapshots(event, issue);

  return {
    eventId: event.id,
    issueId: issue.id,
    issueTitle: issue.title,
    type: event.type,
    createdAt: event.createdAt,
    meetingLabel: buildAuditMeetingLabel(event, issue),
    meetingImpact: buildAuditMeetingImpact(event),
    ...snapshots
  };
}

function buildExportAuditSummary(exportPayload: TrackerExportBase): ExportAuditSummary {
  const byStatus = emptyStatusCounts();
  const byPriority = emptyPriorityCounts();
  const byActivityType = emptyActivityTypeCounts();
  const issueById = new Map(exportPayload.issues.map((issue) => [issue.id, issue]));
  const recentActivity: ExportAuditSummary['activity']['recent'] = [];
  const activityTimeline: ExportAuditTimelineEntry[] = [];
  let archivedIssues = 0;
  let blockedIssues = 0;
  let overdueIssues = 0;
  let comments = 0;
  let editedComments = 0;
  let editHistoryEntries = 0;
  let dependencies = 0;
  let blockingDependencies = 0;
  let activityEvents = 0;

  for (const issue of exportPayload.issues) {
    byStatus[issue.status] += 1;
    byPriority[issue.priority] += 1;
    archivedIssues += issue.archivedAt === null ? 0 : 1;
    blockedIssues += issue.isBlocked ? 1 : 0;
    overdueIssues += issue.isOverdue ? 1 : 0;
    dependencies += issue.dependsOnIssueIds.length;

    for (const dependsOnIssueId of issue.dependsOnIssueIds) {
      const dependency = issueById.get(dependsOnIssueId);

      if (dependency && dependency.archivedAt === null && dependency.status !== CLOSED_ISSUE_STATUS) {
        blockingDependencies += 1;
      }
    }

    comments += issue.comments.length;

    for (const comment of issue.comments) {
      if (comment.editHistory.length > 0) {
        editedComments += 1;
      }

      editHistoryEntries += comment.editHistory.length;
    }

    activityEvents += issue.activityEvents.length;

    for (const event of issue.activityEvents) {
      byActivityType[event.type] += 1;
      recentActivity.push({
        eventId: event.id,
        issueId: issue.id,
        issueTitle: issue.title,
        type: event.type,
        createdAt: event.createdAt
      });
      activityTimeline.push(buildActivityTimelineEntry(issue, event));
    }
  }

  recentActivity.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.issueId.localeCompare(right.issueId) ||
      left.eventId.localeCompare(right.eventId)
  );
  activityTimeline.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.issueId.localeCompare(right.issueId) ||
      left.eventId.localeCompare(right.eventId)
  );

  return {
    timestampPolicy: exportAuditTimestampPolicy,
    issues: {
      total: exportPayload.issues.length,
      active: exportPayload.issues.length - archivedIssues,
      archived: archivedIssues,
      blocked: blockedIssues,
      overdue: overdueIssues,
      byStatus,
      byPriority
    },
    comments: {
      total: comments,
      edited: editedComments,
      editHistoryEntries
    },
    dependencies: {
      total: dependencies,
      blocking: blockingDependencies
    },
    activity: {
      total: activityEvents,
      byType: byActivityType,
      recent: recentActivity.slice(0, 5),
      timeline: activityTimeline
    },
    savedFilterViews: {
      total: exportPayload.savedFilterViews.length
    }
  };
}

function buildTrackerExport(
  issueRepository: IssueRepository,
  commentRepository: CommentRepository,
  activityRepository: ActivityRepository,
  savedFilterViewRepository: SavedFilterViewRepository,
  options: { includeAuditSummary?: boolean } = {}
): TrackerExport {
  const issues = issueRepository.listForExport();
  const issueIds = issues.map((issue) => issue.id);
  const comments = commentRepository.listByIssueIds(issueIds);
  const commentsByIssueId = groupBy(comments, (comment) => comment.issueId);
  const historyByCommentId = groupBy(
    commentRepository.getHistoryByCommentIds(comments.map((comment) => comment.id)),
    (history) => history.commentId
  );
  const activityByIssueId = groupBy(activityRepository.listByIssueIds(issueIds), (event) => event.issueId);
  const exportPayload: TrackerExportBase = {
    exportVersion: 1,
    issues: issues.map((issue) => {
      const exportedComments = (commentsByIssueId.get(issue.id) ?? []).map((comment) => ({
        ...comment,
        editHistory: historyByCommentId.get(comment.id) ?? []
      }));

      return {
        ...issue,
        comments: exportedComments,
        activityEvents: activityByIssueId.get(issue.id) ?? []
      };
    }),
    savedFilterViews: savedFilterViewRepository.list()
  };

  if (!options.includeAuditSummary) {
    return exportPayload;
  }

  return {
    ...exportPayload,
    auditSummary: buildExportAuditSummary(exportPayload)
  };
}

export function createApp(config: AppConfig = {}) {
  const app = express();
  const clientDir = config.clientDir ? path.resolve(config.clientDir) : null;
  const database = createDatabase(config.databasePath ?? ':memory:');
  const issueRepository = new IssueRepository(database);
  const issueDependencyRepository = new IssueDependencyRepository(database);
  const commentRepository = new CommentRepository(database);
  const activityRepository = new ActivityRepository(database);
  const savedFilterViewRepository = new SavedFilterViewRepository(database);

  app.use(express.json({ limit: '2mb' }));
  app.use(jsonParseErrorHandler);

  app.get('/api/health', (_req, res) => {
    res.json(serviceHealth);
  });

  app.get('/health', (_req, res) => {
    res.json(serviceHealth);
  });

  app.get('/api/export', (req, res) => {
    try {
      const includeAuditSummary = parseOptionalBooleanQuery(
        req.query.includeAuditSummary,
        false,
        'Invalid includeAuditSummary parameter'
      );

      res.status(200).json(
        buildTrackerExport(issueRepository, commentRepository, activityRepository, savedFilterViewRepository, {
          includeAuditSummary
        })
      );
      return;
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      throw error;
    }
  });

  app.get('/api/export.csv', (req, res) => {
    try {
      const queryModel = buildIssueListFilterModel(req.query);
      const issues = issueRepository.listForExport(queryModel.filters);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="tinytracker-issues.csv"');
      res.status(200).send(buildIssueListCsv(issues));
      return;
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      throw error;
    }
  });

  app.get('/api/filter-views', (_req, res) => {
    res.status(200).json(savedFilterViewRepository.list());
  });

  app.post('/api/filter-views', (req, res) => {
    try {
      return res.status(201).json(savedFilterViewRepository.create(req.body ?? {}));
    } catch (error) {
      if (error instanceof DuplicateSavedFilterViewNameError) {
        return res.status(409).json({ error: error.message });
      }

      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      throw error;
    }
  });

  app.get('/api/filter-views/:id', (req, res) => {
    const view = savedFilterViewRepository.getById(req.params.id);

    if (!view) {
      return res.status(404).json({ error: 'Saved view not found' });
    }

    return res.status(200).json(view);
  });

  app.post('/api/filter-views/:id/duplicate', (req, res) => {
    const view = savedFilterViewRepository.duplicate(req.params.id);

    if (!view) {
      return res.status(404).json({ error: 'Saved view not found' });
    }

    return res.status(201).json(view);
  });

  app.patch('/api/filter-views/:id', (req, res) => {
    try {
      const view = savedFilterViewRepository.update(req.params.id, req.body ?? {});

      if (!view) {
        return res.status(404).json({ error: 'Saved view not found' });
      }

      return res.status(200).json(view);
    } catch (error) {
      if (error instanceof DuplicateSavedFilterViewNameError) {
        return res.status(409).json({ error: error.message });
      }

      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      throw error;
    }
  });

  app.delete('/api/filter-views/:id', (req, res) => {
    const deleted = savedFilterViewRepository.delete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Saved view not found' });
    }

    return res.status(204).send();
  });

  app.post('/api/import/preview', (req, res) => {
    const plan = previewTrackerImport(database, req.body);

    return res.status(plan.valid ? 200 : 400).json(plan);
  });

  app.post('/api/import/apply', (req, res) => {
    try {
      return res.status(200).json(applyTrackerImport(database, req.body));
    } catch (error) {
      if (error instanceof ImportValidationError) {
        return res.status(400).json(error.plan);
      }

      return res.status(500).json({ error: 'Import apply failed' });
    }
  });

  app.get('/api/issues', (req, res) => {
    try {
      const queryModel = buildIssueListQueryModel(req.query);

      return res.status(200).json(issueRepository.list(queryModel.filters, queryModel.pagination));
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  });

  app.get('/api/issues/audit-summary', (req, res) => {
    try {
      const queryModel = buildIssueListFilterModel(req.query);

      return res.status(200).json(issueRepository.getAuditSummary(queryModel.filters));
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  });

  app.post('/api/issues/bulk-status', (req, res) => {
    try {
      const body = (req.body ?? {}) as { status?: unknown; issueIds?: unknown };

      return res.status(200).json(
        issueRepository.bulkUpdateStatus({
          status: body.status as never,
          issueIds: body.issueIds as never
        })
      );
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      throw error;
    }
  });

  app.post('/api/issues/bulk-archive', (req, res) => {
    try {
      const body = (req.body ?? {}) as { issueIds?: unknown };

      return res.status(200).json(
        issueRepository.bulkArchive({
          issueIds: body.issueIds as never
        })
      );
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      throw error;
    }
  });

  app.get('/api/issues/:id', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.post('/api/issues', (req, res) => {
    try {
      const issue = issueRepository.create(req.body ?? {});
      return res.status(201).json(issue);
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  });

  app.put('/api/issues/:id', (req, res) => {
    try {
      const issue = issueRepository.update(
        req.params.id,
        getOptionalRequestObject(req.body, 'Invalid issue payload') as IssueUpdate
      );

      if (!issue) {
        return res.status(404).json({ error: 'Issue not found' });
      }

      return res.status(200).json(issue);
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  });

  app.post('/api/issues/:id/duplicate', (req, res) => {
    const issue = issueRepository.duplicate(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(201).json(issue);
  });

  app.post('/api/issues/:id/close', (req, res) => {
    const issue = issueRepository.close(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.post('/api/issues/:id/reopen', (req, res) => {
    const issue = issueRepository.reopen(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.post('/api/issues/:id/undo-status', (req, res) => {
    try {
      const issue = issueRepository.undoLastStatusTransition(req.params.id);

      if (!issue) {
        return res.status(404).json({ error: 'Issue not found' });
      }

      return res.status(200).json(issue);
    } catch (error) {
      if (error instanceof IssueStatusUndoNotAvailableError) {
        return res.status(409).json({ error: error.message });
      }

      throw error;
    }
  });

  app.post('/api/issues/:id/archive', (req, res) => {
    const issue = issueRepository.archive(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.post('/api/issues/:id/unarchive', (req, res) => {
    const issue = issueRepository.unarchive(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(issue);
  });

  app.get('/api/issues/:id/dependencies', (req, res) => {
    const dependencies = issueDependencyRepository.listByIssueId(req.params.id);

    if (!dependencies) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(dependencies);
  });

  app.post('/api/issues/:id/dependencies', (req, res) => {
    try {
      const dependsOnIssueId = req.body?.dependsOnIssueId;

      if (typeof dependsOnIssueId !== 'string' || dependsOnIssueId.trim().length === 0) {
        return sendValidationError(res, 'dependsOnIssueId is required');
      }

      return res.status(201).json(issueDependencyRepository.add(req.params.id, dependsOnIssueId.trim()));
    } catch (error) {
      if (error instanceof IssueDependencyNotFoundError) {
        return res.status(404).json({ error: error.message });
      }

      if (error instanceof IssueDependencyConflictError) {
        return res.status(409).json({ error: error.message });
      }

      throw error;
    }
  });

  app.put('/api/issues/:id/dependencies', (req, res) => {
    try {
      const dependsOnIssueIds = parseBulkDependencyIds(req.body?.dependsOnIssueIds);

      return res.status(200).json(issueDependencyRepository.replace(req.params.id, dependsOnIssueIds));
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }

      if (error instanceof IssueDependencyNotFoundError) {
        return res.status(404).json({ error: error.message });
      }

      if (error instanceof IssueDependencyConflictError) {
        return res.status(409).json({ error: error.message });
      }

      throw error;
    }
  });

  app.delete('/api/issues/:id/dependencies/:dependsOnIssueId', (req, res) => {
    try {
      return res.status(200).json(issueDependencyRepository.remove(req.params.id, req.params.dependsOnIssueId));
    } catch (error) {
      if (error instanceof IssueDependencyNotFoundError) {
        return res.status(404).json({ error: error.message });
      }

      throw error;
    }
  });

  app.get('/api/issues/:id/comments', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(commentRepository.listByIssueId(issue.id));
  });

  app.get('/api/issues/:id/activity', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    return res.status(200).json(activityRepository.listByIssueId(issue.id));
  });

  app.post('/api/issues/:id/comments', (req, res) => {
    const issue = issueRepository.getById(req.params.id);

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    try {
      const comment = commentRepository.create({
        issueId: issue.id,
        body: req.body?.body
      });

      return res.status(201).json(comment);
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  });

  app.put('/api/comments/:id', (req, res) => {
    try {
      const comment = commentRepository.update(req.params.id, req.body ?? {});

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      return res.status(200).json(comment);
    } catch (error) {
      if (isValidationError(error)) {
        return sendValidationError(res, error.message);
      }
      throw error;
    }
  });

  app.get('/api/comments/:id/history', (req, res) => {
    const comment = commentRepository.getById(req.params.id);

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    return res.status(200).json(commentRepository.getHistory(comment.id));
  });

  if (clientDir && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));

    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ status: 'ok', service: 'TinyTracker' });
    });
  }

  return app;
}

export default createApp;
