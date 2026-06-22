export type IssueListEmptyStateAction =
  | { kind: 'includeArchived'; label: 'Include Archived' }
  | { kind: 'clearFilters'; label: 'Clear Filters' }
  | { kind: 'disableBlockedOnly'; label: 'Turn Off Blocked Only' }
  | { kind: 'previousPage'; label: 'Previous' };

export type IssueListEmptyState = {
  title: string;
  description?: string;
  action: IssueListEmptyStateAction;
};

type IssueListEmptyStateInput = {
  hasActiveFilters: boolean;
  includeArchived: boolean;
  blockedOnly: boolean;
  totalIssueCount: number;
  totalArchivedIssueCount: number;
  totalBlockedIssueCount: number;
  hasPreviousPage: boolean;
  isPageEmpty: boolean;
};

export function getIssueListEmptyState(input: IssueListEmptyStateInput): IssueListEmptyState | null {
  const {
    hasActiveFilters,
    includeArchived,
    blockedOnly,
    totalIssueCount,
    totalArchivedIssueCount,
    totalBlockedIssueCount,
    hasPreviousPage,
    isPageEmpty
  } = input;

  if (isPageEmpty) {
    return {
      title: 'No issues on this page.',
      description: hasPreviousPage
        ? 'Return to the previous page to keep working in the current result set.'
        : undefined,
      action: { kind: 'previousPage', label: 'Previous' }
    };
  }

  if (!includeArchived && totalArchivedIssueCount > 0) {
    if (blockedOnly) {
      return {
        title: 'Only archived blocked issues match right now.',
        description: 'Include archived issues to inspect blocked work that is hidden from the active board.',
        action: { kind: 'includeArchived', label: 'Include Archived' }
      };
    }

    return {
      title: hasActiveFilters ? 'Matching issues are archived.' : 'Archived issues are hidden.',
      description: hasActiveFilters
        ? 'Include archived issues to review results that are hidden from the active board.'
        : 'Include archived issues to review items that are no longer active.',
      action: { kind: 'includeArchived', label: 'Include Archived' }
    };
  }

  if (blockedOnly && totalBlockedIssueCount === 0) {
    return {
      title: hasActiveFilters ? 'No blocked issues match the current filters.' : 'No issues are currently blocked.',
      description: hasActiveFilters
        ? 'Turn off Blocked only to widen the list without losing the rest of your current filters.'
        : 'Turn off Blocked only to return to the full board.',
      action: { kind: 'disableBlockedOnly', label: 'Turn Off Blocked Only' }
    };
  }

  if (hasActiveFilters || totalIssueCount > 0) {
    return {
      title: 'No issues match the active filters.',
      description: 'Clear the current filters to return to the broader board.',
      action: { kind: 'clearFilters', label: 'Clear Filters' }
    };
  }

  return null;
}
