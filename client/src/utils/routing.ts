import { priorityOrder, statusOrder } from '../constants';
import type {
  DashboardDensity,
  DashboardFilters,
  IssuePriority,
  IssueStatus,
  PriorityFilter,
  SavedFilterView,
  SavedFilterViewPayload,
  StatusFilter
} from '../types';

export const defaultPageSize = 25;
export const maxPageSize = 100;
export const savedViewQueryParam = 'savedView';
export const dashboardDensityQueryParam = 'density';

export type RouteState = {
  issueId: string | null;
  filters: DashboardFilters;
  savedViewId: string | null;
  dashboardDensity: DashboardDensity | null;
};

type RouteBuildOptions = {
  savedViewId?: string | null;
  dashboardDensity?: DashboardDensity | null;
};

type SavedViewRouteState = Pick<SavedFilterView, 'id'> & DashboardFilters;

export const defaultDashboardFilters: DashboardFilters = {
  search: '',
  status: 'all',
  priority: 'all',
  label: '',
  includeArchived: false,
  blockedOnly: false,
  staleOnly: false,
  pageSize: defaultPageSize
};

const dashboardFilterKeys = [
  'search',
  'status',
  'priority',
  'label',
  'includeArchived',
  'blockedOnly',
  'staleOnly',
  'pageSize'
] as const satisfies ReadonlyArray<keyof DashboardFilters>;

export function copyDashboardFilters(filters: DashboardFilters): DashboardFilters {
  return {
    search: filters.search,
    status: filters.status,
    priority: filters.priority,
    label: filters.label,
    includeArchived: filters.includeArchived,
    blockedOnly: filters.blockedOnly,
    staleOnly: filters.staleOnly,
    pageSize: filters.pageSize
  };
}

export function areDashboardFiltersEqual(left: DashboardFilters, right: DashboardFilters): boolean {
  return dashboardFilterKeys.every((key) => left[key] === right[key]);
}

export function dashboardFiltersFromSavedView(view: SavedFilterView): DashboardFilters {
  return copyDashboardFilters(view);
}

export function dashboardFiltersToSavedViewPayload(name: string, filters: DashboardFilters): SavedFilterViewPayload {
  return {
    name,
    ...copyDashboardFilters(filters)
  };
}

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
  const label = (params.get('label') ?? '').trim();
  const includeArchived = params.get('includeArchived') === 'true';
  const blockedOnly = params.get('blockedOnly') === 'true';
  const staleOnly = params.get('staleOnly') === 'true';
  const pageSize = parsePageSize(params.get('limit'));

  return {
    search: searchFilter,
    status: statusFilter,
    priority: priorityFilter,
    label,
    includeArchived,
    blockedOnly,
    staleOnly,
    pageSize
  };
}

export function parseDashboardFiltersFromLocation(): DashboardFilters {
  return parseDashboardFiltersFromSearch(window.location.search);
}

export function parseSavedViewIdFromSearch(search: string | URLSearchParams): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const savedViewId = (params.get(savedViewQueryParam) ?? '').trim();

  return savedViewId || null;
}

export function getRouteStateFromLocation(): RouteState {
  return {
    issueId: getIssueIdFromLocation(),
    filters: parseDashboardFiltersFromLocation(),
    savedViewId: parseSavedViewIdFromSearch(window.location.search),
    dashboardDensity: parseDashboardDensityFromSearch(window.location.search)
  };
}

export function buildDashboardPath(
  filters: DashboardFilters = defaultDashboardFilters,
  options: RouteBuildOptions = {}
): string {
  const query = buildDashboardQuery(filters, options);

  return query ? `/?${query}` : '/';
}

export function buildIssuePath(
  issueId: string,
  filters: DashboardFilters = defaultDashboardFilters,
  options: RouteBuildOptions = {}
): string {
  const query = buildDashboardQuery(filters, options);
  const path = `/issues/${encodeURIComponent(issueId)}`;

  return query ? `${path}?${query}` : path;
}

export function buildSavedViewPath(
  view: SavedViewRouteState,
  issueId: string | null = null,
  options: RouteBuildOptions = {}
): string {
  const filters = copyDashboardFilters(view);

  return issueId
    ? buildIssuePath(issueId, filters, { savedViewId: view.id, dashboardDensity: options.dashboardDensity })
    : buildDashboardPath(filters, { savedViewId: view.id, dashboardDensity: options.dashboardDensity });
}

export function buildStableIssueUrl(issueId: string, origin: string): string {
  return new URL(buildIssuePath(issueId), origin).toString();
}

function writePath(nextPath: string, mode: 'push' | 'replace'): void {
  const currentPath = `${window.location.pathname}${window.location.search}`;

  if (currentPath !== nextPath || window.location.hash) {
    const method = mode === 'replace' ? 'replaceState' : 'pushState';
    window.history[method](null, '', nextPath);
  }
}

export function writeRoute(
  issueId: string | null,
  filters: DashboardFilters,
  mode: 'push' | 'replace',
  options: RouteBuildOptions = {}
): void {
  const nextPath = issueId ? buildIssuePath(issueId, filters, options) : buildDashboardPath(filters, options);

  writePath(nextPath, mode);
}

export function writeSavedViewRoute(
  issueId: string | null,
  view: SavedViewRouteState,
  mode: 'push' | 'replace',
  options: RouteBuildOptions = {}
): void {
  writePath(buildSavedViewPath(view, issueId, options), mode);
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

export function buildDashboardQuery(
  filters: DashboardFilters = defaultDashboardFilters,
  options: { includePageSize?: boolean; savedViewId?: string | null; dashboardDensity?: DashboardDensity | null } = {}
): string {
  const params = new URLSearchParams();
  const savedViewId = options.savedViewId?.trim();

  if (savedViewId) {
    params.set(savedViewQueryParam, savedViewId);
  }

  if (options.dashboardDensity === 'compact') {
    params.set(dashboardDensityQueryParam, options.dashboardDensity);
  }

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

  const label = filters.label.trim();
  if (label) {
    params.set('label', label);
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

  if (options.includePageSize !== false && filters.pageSize !== defaultPageSize) {
    params.set('limit', String(filters.pageSize));
  }

  return params.toString();
}

export function buildIssueListQuery(filters: DashboardFilters, page: number): string {
  const params = new URLSearchParams(buildDashboardQuery(filters, { includePageSize: false }));

  params.set('page', String(page));
  params.set('limit', String(filters.pageSize));

  return params.toString();
}

export function buildCsvExportPath(filters: DashboardFilters = defaultDashboardFilters): string {
  const query = buildDashboardQuery(filters, { includePageSize: false });

  return query ? `/api/export.csv?${query}` : '/api/export.csv';
}

export function parseDashboardDensityFromSearch(search: string | URLSearchParams): DashboardDensity | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;

  return normalizeDashboardDensity(params.get(dashboardDensityQueryParam));
}

function normalizeDashboardDensity(value: string | null | undefined): DashboardDensity | null {
  return isDashboardDensity(value) ? value : null;
}

function isDashboardDensity(value: string | null | undefined): value is DashboardDensity {
  return value === 'comfortable' || value === 'compact';
}
