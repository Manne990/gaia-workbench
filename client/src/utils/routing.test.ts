import { describe, expect, it } from 'vitest';
import {
  buildDashboardPath,
  buildIssuePath,
  buildStableIssueUrl,
  getIssueIdFromPath,
  parseDashboardFiltersFromSearch
} from './routing';

describe('client routing helpers', () => {
  it('extracts issue ids from canonical detail paths', () => {
    expect(getIssueIdFromPath('/issues/abc-123')).toBe('abc-123');
    expect(getIssueIdFromPath('/issues/abc-123/')).toBe('abc-123');
  });

  it('decodes encoded issue ids and tolerates malformed encoding', () => {
    expect(getIssueIdFromPath('/issues/hello%20world')).toBe('hello world');
    expect(getIssueIdFromPath('/issues/%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('ignores non-detail paths', () => {
    expect(getIssueIdFromPath('/')).toBeNull();
    expect(getIssueIdFromPath('/issues')).toBeNull();
    expect(getIssueIdFromPath('/issues/one/comments')).toBeNull();
  });

  it('builds encoded canonical detail paths', () => {
    expect(buildIssuePath('hello world')).toBe('/issues/hello%20world');
  });

  it('builds absolute stable issue URLs without dashboard filters', () => {
    expect(buildStableIssueUrl('issue id', 'https://tracker.example.test/app?status=review')).toBe(
      'https://tracker.example.test/issues/issue%20id'
    );
  });

  it('parses valid dashboard filters from query strings', () => {
    expect(parseDashboardFiltersFromSearch('?search=ready%20for%20review&status=review&priority=high')).toEqual({
      search: 'ready for review',
      status: 'review',
      priority: 'high',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    });
  });

  it('normalizes unknown and empty dashboard filter values', () => {
    expect(
      parseDashboardFiltersFromSearch('?search=%20%20&status=blocked&priority=urgent&includeArchived=yes')
    ).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    });
  });

  it('parses includeArchived when explicitly true', () => {
    expect(parseDashboardFiltersFromSearch('?includeArchived=true')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: true,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    });
  });

  it('parses blockedOnly when explicitly true', () => {
    expect(parseDashboardFiltersFromSearch('?blockedOnly=true')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: true,
      staleOnly: false,
      pageSize: 25
    });
  });

  it('parses staleOnly when explicitly true', () => {
    expect(parseDashboardFiltersFromSearch('?staleOnly=true')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: true,
      pageSize: 25
    });
  });

  it('parses valid page size and normalizes invalid values', () => {
    expect(parseDashboardFiltersFromSearch('?limit=50')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 50
    });
    expect(parseDashboardFiltersFromSearch('?limit=0')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    });
    expect(parseDashboardFiltersFromSearch('?limit=101')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    });
  });

  it('builds canonical dashboard paths with stable query order', () => {
    expect(
      buildDashboardPath({
        search: 'ready for review',
        status: 'review',
        priority: 'high',
        label: 'api',
        includeArchived: true,
        blockedOnly: true,
        staleOnly: true,
        pageSize: 50
      })
    ).toBe(
      '/?search=ready+for+review&status=review&priority=high&label=api&includeArchived=true&blockedOnly=true&staleOnly=true&limit=50'
    );
    expect(
      buildDashboardPath({
        search: '  ',
        status: 'all',
        priority: 'all',
        label: '  ',
        includeArchived: false,
        blockedOnly: false,
        staleOnly: false,
        pageSize: 25
      })
    ).toBe('/');
  });

  it('builds detail paths with composed dashboard filters', () => {
    expect(
      buildIssuePath('issue id', {
        search: 'api export',
        status: 'done',
        priority: 'low',
        label: 'docs',
        includeArchived: true,
        blockedOnly: true,
        staleOnly: true,
        pageSize: 100
      })
    ).toBe(
      '/issues/issue%20id?search=api+export&status=done&priority=low&label=docs&includeArchived=true&blockedOnly=true&staleOnly=true&limit=100'
    );
  });

  it('parses and builds dashboard label filters', () => {
    expect(parseDashboardFiltersFromSearch('?label=%20api%20')).toMatchObject({
      label: 'api'
    });

    expect(
      buildDashboardPath({
        search: '',
        status: 'all',
        priority: 'all',
        label: 'backend',
        includeArchived: false,
        blockedOnly: false,
        staleOnly: false,
        pageSize: 25
      })
    ).toBe('/?label=backend');
  });

  it('drops page from canonical dashboard paths after filter-driven pagination resets', () => {
    const filters = parseDashboardFiltersFromSearch('?page=3&limit=10&label=blocked&blockedOnly=true&staleOnly=true');

    expect(filters).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      label: 'blocked',
      includeArchived: false,
      blockedOnly: true,
      staleOnly: true,
      pageSize: 10
    });
    expect(buildDashboardPath(filters)).toBe('/?label=blocked&blockedOnly=true&staleOnly=true&limit=10');
  });
});
