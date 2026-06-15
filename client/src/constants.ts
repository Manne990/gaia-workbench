import type { IssueFormValues, IssuePriority, IssueStatus } from './types';

export const statusLabels: Record<IssueStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done'
};

export const priorityLabels: Record<IssuePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

export const statusOrder: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];
export const priorityOrder: IssuePriority[] = ['low', 'medium', 'high'];

export const emptyFormValues: IssueFormValues = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  labels: '',
  dueDate: ''
};
