export type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type IssuePriority = 'low' | 'medium' | 'high';

export type Issue = {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string[];
  dueDate: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
};

export type IssueListPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
};

export type IssueListSummary = {
  totalByStatus: Record<IssueStatus, number>;
  totalHighPriority: number;
};

export type IssueListResponse = {
  items: Issue[];
  pagination: IssueListPagination;
  summary: IssueListSummary;
  sort: {
    field: 'created_at,id';
    direction: 'desc,desc';
  };
};

export type Comment = {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type CommentEditHistory = {
  id: string;
  commentId: string;
  previousBody: string;
  newBody: string;
  editedAt: string;
};

export type ActivityEventType =
  | 'issue_created'
  | 'issue_title_changed'
  | 'issue_description_changed'
  | 'issue_status_changed'
  | 'issue_priority_changed'
  | 'issue_due_date_changed'
  | 'issue_labels_changed'
  | 'comment_added'
  | 'comment_edited';

export type ActivityMetadataValue = string | string[] | null;

export type ActivityEvent = {
  id: string;
  issueId: string;
  type: ActivityEventType;
  metadata: Record<string, ActivityMetadataValue>;
  createdAt: string;
};

export type ImportEntity = 'issue' | 'comment' | 'commentEditHistory' | 'activityEvent';
export type ImportDecisionType = 'import' | 'skip-existing' | 'reject';

export type ImportCounts = {
  issues: number;
  comments: number;
  editHistory: number;
  activityEvents: number;
};

export type ImportSummary = {
  input: ImportCounts;
  toCreate: ImportCounts;
  skip: ImportCounts;
  reject: number;
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

export type ImportPlan = {
  valid: boolean;
  exportVersion: number | null;
  summary: ImportSummary;
  decisions: ImportDecision[];
  errors: ImportErrorDetail[];
  warnings: string[];
};

export type LoadState = 'loading' | 'loaded' | 'error';
export type CommentLoadState = LoadState | 'idle';
export type IssueDetailLoadState = CommentLoadState | 'not_found';
export type FormMode = 'create' | 'edit';

export type IssueFormValues = {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string;
  dueDate: string;
};

export type ActiveForm = {
  mode: FormMode;
  issueId?: string;
};

export type CancelOptions = {
  restoreFocus?: boolean;
};

export type CommentEditCancelOptions = CancelOptions & {
  commentId?: string;
};

export type StatusFilter = 'all' | IssueStatus;
export type PriorityFilter = 'all' | IssuePriority;

export type DashboardFilters = {
  search: string;
  status: StatusFilter;
  priority: PriorityFilter;
};

export type ActiveFilterSummary = {
  key: string;
  label: string;
  value: string;
};
