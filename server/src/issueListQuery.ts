import type { IssueListFilters } from './db/index.js';

const DEFAULT_ISSUE_PAGE = 1;
const DEFAULT_ISSUE_LIMIT = 25;
const MAX_ISSUE_LIMIT = 100;

type IssueListQuery = {
  page?: unknown;
  limit?: unknown;
  status?: unknown;
  priority?: unknown;
  search?: unknown;
  label?: unknown;
  includeArchived?: unknown;
  blockedOnly?: unknown;
  staleOnly?: unknown;
};

function getOptionalQueryString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}

function parsePositiveIntegerQuery(value: unknown, defaultValue: number, errorMessage: string): number {
  const queryValue = getOptionalQueryString(value);

  if (queryValue === undefined) {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(queryValue)) {
    throw new Error(errorMessage);
  }

  return Number(queryValue);
}

function parseOptionalBooleanQuery(value: unknown, defaultValue: boolean, errorMessage: string): boolean {
  const queryValue = getOptionalQueryString(value);

  if (queryValue === undefined) {
    return defaultValue;
  }

  if (queryValue === 'true') {
    return true;
  }

  if (queryValue === 'false') {
    return false;
  }

  throw new Error(errorMessage);
}

export function getIssueListPagination(query: Pick<IssueListQuery, 'page' | 'limit'>) {
  const page = parsePositiveIntegerQuery(query.page, DEFAULT_ISSUE_PAGE, 'Invalid page parameter');
  const limit = parsePositiveIntegerQuery(query.limit, DEFAULT_ISSUE_LIMIT, 'Invalid limit parameter');

  if (limit > MAX_ISSUE_LIMIT) {
    throw new Error('Invalid limit parameter');
  }

  return { page, limit };
}

export function buildIssueListFilters(
  query: Pick<
    IssueListQuery,
    'status' | 'priority' | 'search' | 'label' | 'includeArchived' | 'blockedOnly' | 'staleOnly'
  >
): IssueListFilters {
  return {
    status: getOptionalQueryString(query.status) as IssueListFilters['status'],
    priority: getOptionalQueryString(query.priority) as IssueListFilters['priority'],
    search: getOptionalQueryString(query.search),
    label: getOptionalQueryString(query.label),
    includeArchived: parseOptionalBooleanQuery(query.includeArchived, false, 'Invalid includeArchived parameter'),
    blockedOnly: parseOptionalBooleanQuery(query.blockedOnly, false, 'Invalid blockedOnly parameter'),
    staleOnly: parseOptionalBooleanQuery(query.staleOnly, false, 'Invalid staleOnly parameter')
  };
}
