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
const dashboardPageSizeQueryParam = 'limit';
const dashboardSearchQueryParam = 'search';
const dashboardStatusQueryParam = 'status';
const dashboardPriorityQueryParam = 'priority';
const dashboardLabelQueryParam = 'label';
const dashboardIncludeArchivedQueryParam = 'includeArchived';
const dashboardBlockedOnlyQueryParam = 'blockedOnly';
const dashboardStaleOnlyQueryParam = 'staleOnly';

export type RouteState = {
  issueId: string | null;
  filters: DashboardFilters;
  savedViewId: string | null;
  dashboardDensity: DashboardDensity | null;
};

export type IssueAnchorTarget = {
  type: 'comment' | 'activity';
  id: string;
};

export type DashboardRouteQueryState = {
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

export function parseIssueAnchorTarget(hash: string): IssueAnchorTarget | null {
  const match = /^(?:#)(comment|activity)-(.+)$/.exec(hash.trim());

  if (!match) {
    return null;
  }

  const type = match[1] as IssueAnchorTarget['type'];
  const rawId = match[2].trim();

  if (!rawId) {
    return null;
  }

  try {
    const id = decodeURIComponent(rawId).trim();

    return id ? { type, id } : null;
  } catch {
    return { type, id: rawId };
  }
}

function parseSearchParams(search: string | URLSearchParams): URLSearchParams {
  return search instanceof URLSearchParams ? new URLSearchParams(search) : new URLSearchParams(search);
}

function parseDashboardFiltersFromParams(params: URLSearchParams): DashboardFilters {
  const searchFilter = (params.get(dashboardSearchQueryParam) ?? '').trim();
  const statusFilter = parseStatusFilter(params.get(dashboardStatusQueryParam));
  const priorityFilter = parsePriorityFilter(params.get(dashboardPriorityQueryParam));
  const label = (params.get(dashboardLabelQueryParam) ?? '').trim();
  const includeArchived = params.get(dashboardIncludeArchivedQueryParam) === 'true';
  const blockedOnly = params.get(dashboardBlockedOnlyQueryParam) === 'true';
  const staleOnly = params.get(dashboardStaleOnlyQueryParam) === 'true';
  const pageSize = parsePageSize(params.get(dashboardPageSizeQueryParam));

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

function parseSavedViewIdFromParams(params: URLSearchParams): string | null {
  const savedViewId = (params.get(savedViewQueryParam) ?? '').trim();

  return savedViewId || null;
}

function parseDashboardDensityFromParams(params: URLSearchParams): DashboardDensity | null {
  return normalizeDashboardDensity(params.get(dashboardDensityQueryParam));
}

export function parseDashboardRouteQueryState(search: string | URLSearchParams): DashboardRouteQueryState {
  const params = parseSearchParams(search);

  return {
    filters: parseDashboardFiltersFromParams(params),
    savedViewId: parseSavedViewIdFromParams(params),
    dashboardDensity: parseDashboardDensityFromParams(params)
  };
}

export function getDashboardReturnRouteState(
  search: string | URLSearchParams,
  fallbackOptions: RouteBuildOptions = {}
): DashboardRouteQueryState {
  const routeState = parseDashboardRouteQueryState(search);

  return {
    filters: routeState.filters,
    savedViewId: routeState.savedViewId ?? fallbackOptions.savedViewId ?? null,
    dashboardDensity: routeState.dashboardDensity ?? fallbackOptions.dashboardDensity ?? null
  };
}

export function parseDashboardFiltersFromSearch(search: string | URLSearchParams): DashboardFilters {
  return parseDashboardRouteQueryState(search).filters;
}

export function parseDashboardFiltersFromLocation(): DashboardFilters {
  return parseDashboardFiltersFromSearch(window.location.search);
}

export function parseSavedViewIdFromSearch(search: string | URLSearchParams): string | null {
  return parseSavedViewIdFromParams(parseSearchParams(search));
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
  return parseDashboardDensityFromParams(parseSearchParams(search));
}

function normalizeDashboardDensity(value: string | null | undefined): DashboardDensity | null {
  return isDashboardDensity(value) ? value : null;
}

function isDashboardDensity(value: string | null | undefined): value is DashboardDensity {
  return value === 'comfortable' || value === 'compact';
}
