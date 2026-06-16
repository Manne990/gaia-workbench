import { describe, expect, it, vi } from 'vitest';
import type { DashboardFilters, Issue } from '../types';
import { defaultDashboardFilters } from './routing';
import { issueMatchesDashboardFilters } from './savedView';

function buildIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    title: 'Saved view target',
    description: 'Matches dashboard filters.',
    status: 'review',
    priority: 'high',
    labels: ['ops', 'api'],
    dueDate: null,
    isOverdue: false,
    isBlocked: true,
    dependsOnIssueIds: [],
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
  };
}

function buildFilters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    ...defaultDashboardFilters,
    ...overrides
  };
}

describe('issueMatchesDashboardFilters', () => {
  it('matches when the issue satisfies every active filter', () => {
    const issue = buildIssue();
    const filters = buildFilters({
      search: 'target',
      status: 'review',
      priority: 'high',
      label: 'api',
      blockedOnly: true,
      staleOnly: true
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));

    expect(issueMatchesDashboardFilters(issue, filters)).toBe(true);

    vi.useRealTimers();
  });

  it('rejects archived issues when the saved view is active-only', () => {
    expect(
      issueMatchesDashboardFilters(
        buildIssue({ archivedAt: '2026-06-01T12:00:00.000Z' }),
        buildFilters({ includeArchived: false })
      )
    ).toBe(false);
  });

  it('rejects issues that do not match search status priority label blocked or stale filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));

    expect(issueMatchesDashboardFilters(buildIssue(), buildFilters({ search: 'missing' }))).toBe(false);
    expect(issueMatchesDashboardFilters(buildIssue(), buildFilters({ status: 'todo' }))).toBe(false);
    expect(issueMatchesDashboardFilters(buildIssue(), buildFilters({ priority: 'low' }))).toBe(false);
    expect(issueMatchesDashboardFilters(buildIssue(), buildFilters({ label: 'docs' }))).toBe(false);
    expect(issueMatchesDashboardFilters(buildIssue({ isBlocked: false }), buildFilters({ blockedOnly: true }))).toBe(
      false
    );
    expect(
      issueMatchesDashboardFilters(
        buildIssue({ updatedAt: '2026-06-10T00:00:00.000Z' }),
        buildFilters({ staleOnly: true })
      )
    ).toBe(false);

    vi.useRealTimers();
  });
});
