import { describe, expect, it } from 'vitest';
import { formatAuditTimestamp } from './formatters';

describe('formatters', () => {
  it('formats audit timestamps in explicit UTC without depending on local timezone', () => {
    expect(formatAuditTimestamp('2026-01-02T03:04:05.000Z')).toBe('2026-01-02 03:04:05 UTC');
    expect(formatAuditTimestamp('2026-01-02T04:04:05.000+01:00')).toBe('2026-01-02 03:04:05 UTC');
  });

  it('keeps invalid audit timestamp fallback explicit about UTC', () => {
    expect(formatAuditTimestamp('not-a-timestamp')).toBe('Invalid timestamp (UTC)');
  });
});
