import { describe, expect, it } from 'vitest';
import { getIssueListEmptyState } from './issueListEmptyState';

describe('getIssueListEmptyState', () => {
  it('prompts to include archived issues when matches are hidden by the active board', () => {
    expect(
      getIssueListEmptyState({
        hasActiveFilters: false,
        includeArchived: false,
        blockedOnly: false,
        totalIssueCount: 0,
        totalArchivedIssueCount: 2,
        totalBlockedIssueCount: 0,
        hasPreviousPage: false,
        isPageEmpty: false
      })
    ).toEqual({
      title: 'Archived issues are hidden.',
      description: 'Include archived issues to review items that are no longer active.',
      action: { kind: 'includeArchived', label: 'Include Archived' }
    });
  });

  it('prompts to include archived issues for blocked-only archived matches', () => {
    expect(
      getIssueListEmptyState({
        hasActiveFilters: true,
        includeArchived: false,
        blockedOnly: true,
        totalIssueCount: 0,
        totalArchivedIssueCount: 1,
        totalBlockedIssueCount: 0,
        hasPreviousPage: false,
        isPageEmpty: false
      })
    ).toEqual({
      title: 'Only archived blocked issues match right now.',
      description: 'Include archived issues to inspect blocked work that is hidden from the active board.',
      action: { kind: 'includeArchived', label: 'Include Archived' }
    });
  });

  it('offers to turn off blocked-only when no active blocked issues remain', () => {
    expect(
      getIssueListEmptyState({
        hasActiveFilters: true,
        includeArchived: true,
        blockedOnly: true,
        totalIssueCount: 0,
        totalArchivedIssueCount: 0,
        totalBlockedIssueCount: 0,
        hasPreviousPage: false,
        isPageEmpty: false
      })
    ).toEqual({
      title: 'No blocked issues match the current filters.',
      description: 'Turn off Blocked only to widen the list without losing the rest of your current filters.',
      action: { kind: 'disableBlockedOnly', label: 'Turn Off Blocked Only' }
    });
  });

  it('keeps generic filter recovery for normal filtered empties', () => {
    expect(
      getIssueListEmptyState({
        hasActiveFilters: true,
        includeArchived: true,
        blockedOnly: false,
        totalIssueCount: 0,
        totalArchivedIssueCount: 0,
        totalBlockedIssueCount: 0,
        hasPreviousPage: false,
        isPageEmpty: false
      })
    ).toEqual({
      title: 'No issues match the active filters.',
      description: 'Clear the current filters to return to the broader board.',
      action: { kind: 'clearFilters', label: 'Clear Filters' }
    });
  });

  it('keeps pagination recovery distinct from filtered empties', () => {
    expect(
      getIssueListEmptyState({
        hasActiveFilters: true,
        includeArchived: true,
        blockedOnly: false,
        totalIssueCount: 10,
        totalArchivedIssueCount: 0,
        totalBlockedIssueCount: 2,
        hasPreviousPage: true,
        isPageEmpty: true
      })
    ).toEqual({
      title: 'No issues on this page.',
      description: 'Return to the previous page to keep working in the current result set.',
      action: { kind: 'previousPage', label: 'Previous' }
    });
  });
});
