import { describe, expect, it } from 'vitest';
import { buildDashboardPath, buildIssuePath, parseDashboardFiltersFromSearch, getIssueIdFromPath } from './routing';

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

  it('parses valid dashboard filters from query strings', () => {
    expect(parseDashboardFiltersFromSearch('?search=ready%20for%20review&status=review&priority=high')).toEqual({
      search: 'ready for review',
      status: 'review',
      priority: 'high',
      includeArchived: false
    });
  });

  it('normalizes unknown and empty dashboard filter values', () => {
    expect(
      parseDashboardFiltersFromSearch('?search=%20%20&status=blocked&priority=urgent&includeArchived=yes')
    ).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      includeArchived: false
    });
  });

  it('parses includeArchived when explicitly true', () => {
    expect(parseDashboardFiltersFromSearch('?includeArchived=true')).toEqual({
      search: '',
      status: 'all',
      priority: 'all',
      includeArchived: true
    });
  });

  it('builds canonical dashboard paths with stable query order', () => {
    expect(
      buildDashboardPath({ search: 'ready for review', status: 'review', priority: 'high', includeArchived: true })
    ).toBe('/?search=ready+for+review&status=review&priority=high&includeArchived=true');
    expect(buildDashboardPath({ search: '  ', status: 'all', priority: 'all', includeArchived: false })).toBe('/');
  });

  it('builds detail paths with composed dashboard filters', () => {
    expect(
      buildIssuePath('issue id', { search: 'api export', status: 'done', priority: 'low', includeArchived: true })
    ).toBe('/issues/issue%20id?search=api+export&status=done&priority=low&includeArchived=true');
  });
});
