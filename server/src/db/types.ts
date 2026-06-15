export type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';

export type IssuePriority = 'low' | 'medium' | 'high';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string[];
  dueDate: string | null;
  isOverdue: boolean;
  isBlocked: boolean;
  dependsOnIssueIds: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueDependencyReference {
  id: string;
  title: string;
  status: IssueStatus;
  archivedAt: string | null;
}

export interface IssueDependencyState {
  issueId: string;
  dependencies: IssueDependencyReference[];
  dependents: IssueDependencyReference[];
  isBlocked: boolean;
}

export interface NewIssue {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  labels?: string[];
  dueDate?: string | null;
}

export interface IssueUpdate {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  labels?: string[];
  dueDate?: string | null;
}

export interface IssueListFilters {
  status?: IssueStatus;
  priority?: IssuePriority;
  search?: string;
  includeArchived?: boolean;
  blockedOnly?: boolean;
}

export interface IssueListPaginationInput {
  page: number;
  limit: number;
}

export interface IssueListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

export interface IssueListSummary {
  totalByStatus: Record<IssueStatus, number>;
  totalHighPriority: number;
}

export interface IssueAuditSummary {
  totalIssues: number;
  totalArchivedIssues: number;
  totalBlockedIssues: number;
  totalOverdueIssues: number;
  totalStaleIssues: number;
  byStatus: Record<IssueStatus, number>;
  byPriority: Record<IssuePriority, number>;
  dependencyEdges: {
    total: number;
    blocked: number;
  };
}

export interface IssueListSort {
  field: 'created_at,id';
  direction: 'desc,desc';
}

export interface IssueListResult {
  items: Issue[];
  pagination: IssueListPagination;
  summary: IssueListSummary;
  sort: IssueListSort;
}

export type SavedFilterStatus = 'all' | IssueStatus;

export type SavedFilterPriority = 'all' | IssuePriority;

export interface SavedFilterView {
  id: string;
  name: string;
  search: string;
  status: SavedFilterStatus;
  priority: SavedFilterPriority;
  includeArchived: boolean;
  blockedOnly: boolean;
  pageSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewSavedFilterView {
  name: string;
  search?: string;
  status?: SavedFilterStatus;
  priority?: SavedFilterPriority;
  includeArchived?: boolean;
  blockedOnly?: boolean;
  pageSize?: number;
}

export interface SavedFilterViewUpdate {
  name?: string;
  search?: string;
  status?: SavedFilterStatus;
  priority?: SavedFilterPriority;
  includeArchived?: boolean;
  blockedOnly?: boolean;
  pageSize?: number;
}

export interface Comment {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewComment {
  issueId: string;
  body: string;
}

export interface CommentUpdate {
  body: string;
}

export interface CommentEditHistory {
  id: string;
  commentId: string;
  previousBody: string;
  newBody: string;
  editedAt: string;
}

export type ActivityEventType =
  | 'issue_created'
  | 'issue_title_changed'
  | 'issue_description_changed'
  | 'issue_status_changed'
  | 'issue_priority_changed'
  | 'issue_due_date_changed'
  | 'issue_labels_changed'
  | 'issue_archived'
  | 'issue_unarchived'
  | 'issue_dependency_added'
  | 'issue_dependency_removed'
  | 'comment_added'
  | 'comment_edited';

export type ActivityMetadataValue = string | string[] | null;

export type ActivityMetadata = Record<string, ActivityMetadataValue>;

export interface ActivityEvent {
  id: string;
  issueId: string;
  type: ActivityEventType;
  metadata: ActivityMetadata;
  createdAt: string;
}

export interface NewActivityEvent {
  issueId: string;
  type: ActivityEventType;
  metadata?: ActivityMetadata;
  createdAt?: string;
}
