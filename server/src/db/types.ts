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
  createdAt: string;
  updatedAt: string;
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
