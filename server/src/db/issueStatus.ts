import type { IssueStatus, SavedFilterStatus } from './types.js';

export const ISSUE_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const satisfies readonly IssueStatus[];
export const DEFAULT_ISSUE_STATUS: IssueStatus = 'todo';
export const CLOSED_ISSUE_STATUS: IssueStatus = 'done';
export const SAVED_FILTER_STATUSES = ['all', ...ISSUE_STATUSES] as const satisfies readonly SavedFilterStatus[];

export function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === 'string' && (ISSUE_STATUSES as readonly string[]).includes(value);
}

export function assertIssueStatus(value: unknown): asserts value is IssueStatus {
  if (!isIssueStatus(value)) {
    throw new Error('Invalid issue status');
  }
}

export function isSavedFilterStatus(value: unknown): value is SavedFilterStatus {
  return typeof value === 'string' && (SAVED_FILTER_STATUSES as readonly string[]).includes(value);
}

export function createEmptyIssueStatusCounts(): Record<IssueStatus, number> {
  return Object.fromEntries(ISSUE_STATUSES.map((status) => [status, 0])) as Record<IssueStatus, number>;
}
