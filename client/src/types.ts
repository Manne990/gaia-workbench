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

export type ActiveFilterSummary = {
  key: string;
  label: string;
  value: string;
};
