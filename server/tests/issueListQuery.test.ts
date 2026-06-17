import { describe, expect, it } from 'vitest';
import { buildIssueListFilters, getIssueListPagination } from '../src/issueListQuery.js';

describe('issue list query helpers', () => {
  it('parses issue-list pagination with defaults and valid integers', () => {
    expect(getIssueListPagination({})).toEqual({ page: 1, limit: 25 });
    expect(getIssueListPagination({ page: '2', limit: '50' })).toEqual({ page: 2, limit: 50 });
    expect(getIssueListPagination({ page: ['3'], limit: ['10'] })).toEqual({ page: 3, limit: 10 });
  });

  it('rejects invalid issue-list pagination values', () => {
    expect(() => getIssueListPagination({ page: '0' })).toThrow('Invalid page parameter');
    expect(() => getIssueListPagination({ page: '1.5' })).toThrow('Invalid page parameter');
    expect(() => getIssueListPagination({ limit: '0' })).toThrow('Invalid limit parameter');
    expect(() => getIssueListPagination({ limit: '101' })).toThrow('Invalid limit parameter');
  });

  it('builds issue-list filters from valid query values', () => {
    expect(
      buildIssueListFilters({
        status: 'review',
        priority: 'high',
        search: ['dashboard'],
        label: ' api ',
        includeArchived: 'true',
        blockedOnly: 'false',
        staleOnly: ['true']
      })
    ).toEqual({
      status: 'review',
      priority: 'high',
      search: 'dashboard',
      label: ' api ',
      includeArchived: true,
      blockedOnly: false,
      staleOnly: true
    });
  });

  it('defaults optional boolean issue-list filters and rejects invalid values', () => {
    expect(
      buildIssueListFilters({
        status: undefined,
        priority: undefined,
        search: undefined,
        label: undefined
      })
    ).toEqual({
      status: undefined,
      priority: undefined,
      search: undefined,
      label: undefined,
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false
    });

    expect(() => buildIssueListFilters({ includeArchived: 'yes' })).toThrow('Invalid includeArchived parameter');
    expect(() => buildIssueListFilters({ blockedOnly: 'yes' })).toThrow('Invalid blockedOnly parameter');
    expect(() => buildIssueListFilters({ staleOnly: 'yes' })).toThrow('Invalid staleOnly parameter');
  });
});
