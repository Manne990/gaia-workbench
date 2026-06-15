export { createDatabase } from './database.js';
export { ActivityRepository } from './activityRepository.js';
export { CommentRepository } from './commentRepository.js';
export { IssueRepository } from './issueRepository.js';
export {
  ensureTinyTrackerSchema,
  getTinyTrackerSchemaVersion,
  SCHEMA_VERSION,
  TABLE_NAMES
} from './schema.js';
export type {
  ActivityEvent,
  ActivityEventType,
  ActivityMetadata,
  ActivityMetadataValue,
  Comment,
  CommentEditHistory,
  CommentUpdate,
  Issue,
  IssueListFilters,
  IssueListPagination,
  IssueListPaginationInput,
  IssueListResult,
  IssueListSort,
  IssueListSummary,
  IssuePriority,
  IssueStatus,
  IssueUpdate,
  NewActivityEvent,
  NewComment,
  NewIssue
} from './types.js';
