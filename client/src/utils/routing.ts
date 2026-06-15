import { priorityOrder, statusOrder } from '../constants';
import type { DashboardFilters, IssuePriority, IssueStatus, PriorityFilter, StatusFilter } from '../types';

export const defaultPageSize = 25;
export const maxPageSize = 100;

export const defaultDashboardFilters: DashboardFilters = {
  search: '',
  status: 'all',
  priority: 'all',
  includeArchived: false,
  blockedOnly: false,
  staleOnly: false,
  pageSize: defaultPageSize
};

export function getIssueIdFromPath(pathname: string): string | null {
  const match = /^\/issues\/([^/]+)\/?$/.exec(pathname);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function getIssueIdFromLocation(): string | null {
  return getIssueIdFromPath(window.location.pathname);
}

export function parseDashboardFiltersFromSearch(search: string | URLSearchParams): DashboardFilters {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const searchFilter = (params.get('search') ?? '').trim();
  const statusFilter = parseStatusFilter(params.get('status'));
  const priorityFilter = parsePriorityFilter(params.get('priority'));
  const includeArchived = params.get('includeArchived') === 'true';
  const blockedOnly = params.get('blockedOnly') === 'true';
  const staleOnly = params.get('staleOnly') === 'true';
  const pageSize = parsePageSize(params.get('limit'));

  return {
    search: searchFilter,
    status: statusFilter,
    priority: priorityFilter,
    includeArchived,
    blockedOnly,
    staleOnly,
    pageSize
  };
}

export function parseDashboardFiltersFromLocation(): DashboardFilters {
  return parseDashboardFiltersFromSearch(window.location.search);
}

export function getRouteStateFromLocation(): { issueId: string | null; filters: DashboardFilters } {
  return {
    issueId: getIssueIdFromLocation(),
    filters: parseDashboardFiltersFromLocation()
  };
}

export function buildDashboardPath(filters: DashboardFilters = defaultDashboardFilters): string {
  const query = buildDashboardQuery(filters);

  return query ? `/?${query}` : '/';
}

export function buildIssuePath(issueId: string, filters: DashboardFilters = defaultDashboardFilters): string {
  const query = buildDashboardQuery(filters);
  const path = `/issues/${encodeURIComponent(issueId)}`;

  return query ? `${path}?${query}` : path;
}

export function writeRoute(issueId: string | null, filters: DashboardFilters, mode: 'push' | 'replace'): void {
  const nextPath = issueId ? buildIssuePath(issueId, filters) : buildDashboardPath(filters);
  const currentPath = `${window.location.pathname}${window.location.search}`;

  if (currentPath !== nextPath || window.location.hash) {
    const method = mode === 'replace' ? 'replaceState' : 'pushState';
    window.history[method](null, '', nextPath);
  }
}

function parseStatusFilter(value: string | null): StatusFilter {
  return value && statusOrder.includes(value as IssueStatus) ? (value as IssueStatus) : 'all';
}

function parsePriorityFilter(value: string | null): PriorityFilter {
  return value && priorityOrder.includes(value as IssuePriority) ? (value as IssuePriority) : 'all';
}

function parsePageSize(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return defaultPageSize;
  }

  const pageSize = Number(value);

  return pageSize <= maxPageSize ? pageSize : defaultPageSize;
}

function buildDashboardQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  const search = filters.search.trim();

  if (search) {
    params.set('search', search);
  }

  if (filters.status !== 'all') {
    params.set('status', filters.status);
  }

  if (filters.priority !== 'all') {
    params.set('priority', filters.priority);
  }

  if (filters.includeArchived) {
    params.set('includeArchived', 'true');
  }
  if (filters.blockedOnly) {
    params.set('blockedOnly', 'true');
  }

  if (filters.staleOnly) {
    params.set('staleOnly', 'true');
  }

  if (filters.pageSize !== defaultPageSize) {
    params.set('limit', String(filters.pageSize));
  }

  return params.toString();
}
