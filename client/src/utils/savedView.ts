import type { DashboardFilters, Issue } from '../types';
import { isIssueStale } from './stale';

export function issueMatchesDashboardFilters(issue: Issue, filters: DashboardFilters): boolean {
  if (!filters.includeArchived && issue.archivedAt !== null) {
    return false;
  }

  if (filters.status !== 'all' && issue.status !== filters.status) {
    return false;
  }

  if (filters.priority !== 'all' && issue.priority !== filters.priority) {
    return false;
  }

  const label = filters.label.trim();
  if (label && !issue.labels.includes(label)) {
    return false;
  }

  const search = filters.search.trim().toLowerCase();
  if (search) {
    const title = issue.title.toLowerCase();
    const description = issue.description.toLowerCase();

    if (!title.includes(search) && !description.includes(search)) {
      return false;
    }
  }

  if (filters.blockedOnly && !issue.isBlocked) {
    return false;
  }

  if (filters.staleOnly && !isIssueStale(issue.updatedAt)) {
    return false;
  }

  return true;
}
