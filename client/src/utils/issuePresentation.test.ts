import { describe, expect, it } from 'vitest';
import { formatIssueDueDate, getIssueFreshnessPresentation } from './issuePresentation';

describe('issue presentation helpers', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('marks issues stale with shared label and description after the threshold', () => {
    expect(getIssueFreshnessPresentation('2026-05-16T12:00:00.000Z', now)).toEqual({
      isStale: true,
      label: 'Stale',
      description: 'No updates in 30+ days'
    });
  });

  it('marks recent or invalid timestamps as current without stale copy', () => {
    expect(getIssueFreshnessPresentation('2026-05-16T12:00:01.000Z', now)).toEqual({
      isStale: false,
      label: 'Current',
      description: null
    });

    expect(getIssueFreshnessPresentation('not-a-date', now)).toEqual({
      isStale: false,
      label: 'Current',
      description: null
    });
  });

  it('reuses the shared optional due-date fallback', () => {
    expect(formatIssueDueDate(null)).toBe('No due date');
  });
});
