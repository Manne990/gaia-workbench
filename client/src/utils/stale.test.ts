import { describe, expect, it } from 'vitest';
import { isIssueStale, staleIssueDescription, staleIssueThresholdDays } from './stale';

describe('stale issue helpers', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('marks issues stale only after the configured threshold', () => {
    expect(isIssueStale('2026-05-16T12:00:00.000Z', now)).toBe(true);
    expect(isIssueStale('2026-05-16T12:00:01.000Z', now)).toBe(false);
  });

  it('treats invalid timestamps as not stale', () => {
    expect(isIssueStale('not-a-date', now)).toBe(false);
  });

  it('uses the documented threshold in display text', () => {
    expect(staleIssueThresholdDays).toBe(30);
    expect(staleIssueDescription()).toBe('No updates in 30+ days');
  });
});
