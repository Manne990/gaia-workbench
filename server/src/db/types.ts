export type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';

export type IssuePriority = 'low' | 'medium' | 'high';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  createdAt: string;
  updatedAt: string;
}

export interface NewIssue {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
}

export interface IssueUpdate {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
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
