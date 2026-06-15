import { priorityLabels, statusLabels } from '../constants';
import type { IssuePriority, IssueStatus } from '../types';

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export function formatDueDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(year, month - 1, day));
}

export function formatOptionalText(value: string | null): string {
  return value && value.trim().length > 0 ? value : 'empty';
}

export function formatStatusValue(value: string | null): string {
  return value && value in statusLabels ? statusLabels[value as IssueStatus] : formatOptionalText(value);
}

export function formatPriorityValue(value: string | null): string {
  return value && value in priorityLabels ? priorityLabels[value as IssuePriority] : formatOptionalText(value);
}

export function formatDueDateValue(value: string | null): string {
  return value ? formatDueDate(value) : 'No due date';
}

export function formatLabelList(labels: string[]): string {
  return labels.length > 0 ? labels.join(', ') : 'No labels';
}
