import { useEffect, useMemo, useState } from 'react';
import { priorityLabels, statusLabels, statusOrder } from '../constants';
import type { ActiveFilterSummary, Issue, LoadState, PriorityFilter, StatusFilter } from '../types';

export function useIssueDirectory() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

  useEffect(() => {
    const controller = new AbortController();

    async function loadIssues() {
      try {
        const response = await fetch('/api/issues', { signal: controller.signal });

        if (!response.ok) {
          throw new Error('Issue request failed');
        }

        setIssues((await response.json()) as Issue[]);
        setLoadState('loaded');
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadState('error');
        }
      }
    }

    void loadIssues();

    return () => controller.abort();
  }, []);

  const normalizedSearchFilter = searchFilter.trim().toLowerCase();

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (statusFilter !== 'all' && issue.status !== statusFilter) {
        return false;
      }

      if (priorityFilter !== 'all' && issue.priority !== priorityFilter) {
        return false;
      }

      if (!normalizedSearchFilter) {
        return true;
      }

      return [issue.title, issue.description]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchFilter);
    });
  }, [issues, normalizedSearchFilter, priorityFilter, statusFilter]);

  const activeFilterSummaries = useMemo(() => {
    const filters: ActiveFilterSummary[] = [];
    const search = searchFilter.trim();

    if (search) {
      filters.push({ key: 'search', label: 'Search', value: search });
    }

    if (statusFilter !== 'all') {
      filters.push({ key: 'status', label: 'Status', value: statusLabels[statusFilter] });
    }

    if (priorityFilter !== 'all') {
      filters.push({ key: 'priority', label: 'Priority', value: priorityLabels[priorityFilter] });
    }

    return filters;
  }, [priorityFilter, searchFilter, statusFilter]);

  const hasActiveFilters = activeFilterSummaries.length > 0;

  const statusCounts = useMemo(() => {
    return statusOrder.map((status) => ({
      status,
      count: issues.filter((issue) => issue.status === status).length
    }));
  }, [issues]);

  const highPriorityCount = useMemo(() => {
    return issues.filter((issue) => issue.priority === 'high').length;
  }, [issues]);

  const issueListSummary = hasActiveFilters
    ? `${filteredIssues.length} of ${issues.length} shown`
    : `${highPriorityCount} high priority`;

  function clearFilters() {
    setSearchFilter('');
    setStatusFilter('all');
    setPriorityFilter('all');
  }

  return {
    issues,
    setIssues,
    loadState,
    setLoadState,
    searchFilter,
    setSearchFilter,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    filteredIssues,
    activeFilterSummaries,
    hasActiveFilters,
    statusCounts,
    issueListSummary,
    clearFilters
  };
}
