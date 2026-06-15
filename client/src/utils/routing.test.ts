import { describe, expect, it } from 'vitest';
import { buildIssuePath, getIssueIdFromPath } from './routing';

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
});
