import { formatAuditTimestamp, formatDate, formatDueDateValue } from './formatters';
import { isIssueStale, staleIssueDescription } from './stale';

export type IssueFreshnessPresentation = {
  isStale: boolean;
  label: 'Stale' | 'Current';
  description: string | null;
};

export function getIssueFreshnessPresentation(updatedAt: string, now = new Date()): IssueFreshnessPresentation {
  const isStale = isIssueStale(updatedAt, now);

  return {
    isStale,
    label: isStale ? 'Stale' : 'Current',
    description: isStale ? staleIssueDescription() : null
  };
}

export function formatIssueDate(value: string): string {
  return formatDate(value);
}

export function formatIssueAuditDate(value: string): string {
  return formatAuditTimestamp(value);
}

export function formatIssueDueDate(value: string | null): string {
  return formatDueDateValue(value);
}
