import { describe, expect, it } from 'vitest';
import {
  areDashboardFiltersEqual,
  buildCsvExportPath,
  buildDashboardPath,
  buildDashboardQuery,
  buildIssuePath,
  buildIssueListQuery,
  buildSavedViewPath,
  buildStableIssueUrl,
  dashboardFiltersFromSavedView,
  dashboardFiltersToSavedViewPayload,
  defaultDashboardFilters,
  getIssueIdFromPath,
  parseDashboardFiltersFromSearch,
  parseDashboardDensityFromSearch,
  parseSavedViewIdFromSearch
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

  it('parses saved view ids from route query strings', () => {
    expect(parseSavedViewIdFromSearch('?savedView=view-123')).toBe('view-123');
    expect(parseSavedViewIdFromSearch('?savedView=%20%20')).toBeNull();
    expect(parseSavedViewIdFromSearch('?search=review')).toBeNull();
  });

  it('parses dashboard density only when the route opts into a supported value', () => {
    expect(parseDashboardDensityFromSearch('?density=comfortable')).toBe('comfortable');
    expect(parseDashboardDensityFromSearch('?density=compact')).toBe('compact');
    expect(parseDashboardDensityFromSearch('?density=spacious')).toBeNull();
    expect(parseDashboardDensityFromSearch('?search=review')).toBeNull();
  });

  it('composes saved view ids with dashboard and detail filter routes', () => {
    const filters = {
      search: 'saved target',
      status: 'review' as const,
      priority: 'high' as const,
      label: 'archive',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: false,
      pageSize: 50
    };

    expect(buildDashboardPath(filters, { savedViewId: 'view-123', dashboardDensity: 'compact' })).toBe(
      '/?savedView=view-123&density=compact&search=saved+target&status=review&priority=high&label=archive&includeArchived=true&blockedOnly=true&limit=50'
    );
    expect(buildIssuePath('issue id', filters, { savedViewId: 'view-123', dashboardDensity: 'comfortable' })).toBe(
      '/issues/issue%20id?savedView=view-123&density=comfortable&search=saved+target&status=review&priority=high&label=archive&includeArchived=true&blockedOnly=true&limit=50'
    );
  });

  it('builds saved view share paths without default-valued dashboard params', () => {
    const defaultView = {
      id: 'view-default',
      ...defaultDashboardFilters
    };
    const reviewView = {
      ...defaultView,
      id: 'view-review',
      search: 'saved target',
      status: 'review' as const,
      priority: 'high' as const,
      label: 'archive',
      includeArchived: true,
      staleOnly: true,
      pageSize: 50
    };

    expect(buildSavedViewPath(defaultView, null, { dashboardDensity: 'comfortable' })).toBe(
      '/?savedView=view-default&density=comfortable'
    );
    expect(buildSavedViewPath(defaultView, 'issue id', { dashboardDensity: 'compact' })).toBe(
      '/issues/issue%20id?savedView=view-default&density=compact'
    );
    expect(buildSavedViewPath(reviewView, null, { dashboardDensity: 'comfortable' })).toBe(
      '/?savedView=view-review&density=comfortable&search=saved+target&status=review&priority=high&label=archive&includeArchived=true&staleOnly=true&limit=50'
    );
  });

  it('keeps inbound saved view URLs with explicit defaults loadable and canonicalizable', () => {
    const search =
      '?savedView=view-default&density=compact&search=%20&status=all&priority=all&includeArchived=false&blockedOnly=false&staleOnly=false&limit=25';
    const filters = parseDashboardFiltersFromSearch(search);

    expect(parseSavedViewIdFromSearch(search)).toBe('view-default');
    expect(parseDashboardDensityFromSearch(search)).toBe('compact');
    expect(filters).toEqual(defaultDashboardFilters);
    expect(buildSavedViewPath({ id: 'view-default', ...filters }, null, { dashboardDensity: 'compact' })).toBe(
      '/?savedView=view-default&density=compact'
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

  it('round-trips equivalent board query state through URL and saved-view paths', () => {
    const filters = {
      search: 'api export',
      status: 'review' as const,
      priority: 'high' as const,
      label: 'ops',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: true,
      pageSize: 50
    };
    const query = buildDashboardQuery(filters);
    const parsedFilters = parseDashboardFiltersFromSearch(query);
    const savedViewPayload = dashboardFiltersToSavedViewPayload('Ops board', parsedFilters);
    const savedView = {
      id: 'view-ops',
      createdAt: '2026-06-17T22:00:00.000Z',
      updatedAt: '2026-06-17T22:00:00.000Z',
      ...savedViewPayload
    };
    const savedViewFilters = dashboardFiltersFromSavedView(savedView);

    expect(parsedFilters).toEqual(filters);
    expect(savedViewPayload).toEqual({ name: 'Ops board', ...filters });
    expect(savedViewFilters).toEqual(filters);
    expect(areDashboardFiltersEqual(savedViewFilters, filters)).toBe(true);
    expect(buildDashboardPath(savedViewFilters, { savedViewId: savedView.id, dashboardDensity: 'compact' })).toBe(
      '/?savedView=view-ops&density=compact&search=api+export&status=review&priority=high&label=ops&includeArchived=true&blockedOnly=true&staleOnly=true&limit=50'
    );
  });

  it('uses the dashboard query model for list and export API paths', () => {
    const filters = parseDashboardFiltersFromSearch(
      '?search=roadmap&status=todo&priority=medium&label=team&includeArchived=true&blockedOnly=true&staleOnly=true&limit=50'
    );

    expect(buildIssueListQuery(filters, 3)).toBe(
      'search=roadmap&status=todo&priority=medium&label=team&includeArchived=true&blockedOnly=true&staleOnly=true&page=3&limit=50'
    );
    expect(buildCsvExportPath(filters)).toBe(
      '/api/export.csv?search=roadmap&status=todo&priority=medium&label=team&includeArchived=true&blockedOnly=true&staleOnly=true'
    );
  });
});
