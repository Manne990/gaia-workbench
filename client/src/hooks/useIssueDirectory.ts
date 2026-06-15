import { useEffect, useMemo, useState } from 'react';
import { priorityLabels, statusLabels, statusOrder } from '../constants';
import type {
  ActiveFilterSummary,
  DashboardFilters,
  Issue,
  IssueListPagination,
  IssueListSummary,
  LoadState,
  PriorityFilter,
  StatusFilter
} from '../types';
import { defaultDashboardFilters } from '../utils/routing';

const defaultPagination: IssueListPagination = {
  page: 1,
  limit: defaultDashboardFilters.pageSize,
  total: 0,
  totalPages: 0,
  hasMore: false,
  hasPrevious: false
};

const defaultSummary: IssueListSummary = {
  totalByStatus: {
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0
  },
  totalHighPriority: 0
};

export function useIssueDirectory(initialFilters: DashboardFilters = defaultDashboardFilters) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [searchFilter, setSearchFilter] = useState(initialFilters.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilters.status);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(initialFilters.priority);
  const [includeArchived, setIncludeArchived] = useState(initialFilters.includeArchived);
  const [blockedOnly, setBlockedOnly] = useState(initialFilters.blockedOnly);
  const [staleOnly, setStaleOnly] = useState(initialFilters.staleOnly);
  const [pageSize, setPageSize] = useState(initialFilters.pageSize);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<IssueListPagination>(defaultPagination);
  const [summary, setSummary] = useState<IssueListSummary>(defaultSummary);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadIssues() {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(pageSize)
      });
      const search = searchFilter.trim();

      if (search) {
        params.set('search', search);
      }

      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }

      if (priorityFilter !== 'all') {
        params.set('priority', priorityFilter);
      }

      if (includeArchived) {
        params.set('includeArchived', 'true');
      }

      if (blockedOnly) {
        params.set('blockedOnly', 'true');
      }

      if (staleOnly) {
        params.set('staleOnly', 'true');
      }

      try {
        setLoadState('loading');
        const response = await fetch(`/api/issues?${params.toString()}`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error('Issue request failed');
        }

        const body = (await response.json()) as {
          items: Issue[];
          pagination: IssueListPagination;
          summary: IssueListSummary;
        };

        setIssues(body.items);
        setPagination(body.pagination);
        setSummary(body.summary);
        setLoadState('loaded');
      } catch {
        if (!controller.signal.aborted) {
          setLoadState('error');
        }
      }
    }

    void loadIssues();

    return () => controller.abort();
  }, [
    blockedOnly,
    currentPage,
    includeArchived,
    pageSize,
    priorityFilter,
    reloadToken,
    searchFilter,
    staleOnly,
    statusFilter
  ]);

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

    if (includeArchived) {
      filters.push({ key: 'includeArchived', label: 'Archived', value: 'Included' });
    }

    if (blockedOnly) {
      filters.push({ key: 'blockedOnly', label: 'Blocked', value: 'Only' });
    }

    if (staleOnly) {
      filters.push({ key: 'staleOnly', label: 'Stale', value: 'Only' });
    }

    if (pageSize !== defaultDashboardFilters.pageSize) {
      filters.push({ key: 'pageSize', label: 'Page size', value: String(pageSize) });
    }

    return filters;
  }, [blockedOnly, includeArchived, pageSize, priorityFilter, searchFilter, staleOnly, statusFilter]);

  const hasActiveFilters = activeFilterSummaries.length > 0;

  const statusCounts = useMemo(() => {
    return statusOrder.map((status) => ({
      status,
      count: summary.totalByStatus[status]
    }));
  }, [summary]);

  const totalIssueCount = useMemo(() => statusCounts.reduce((total, item) => total + item.count, 0), [statusCounts]);
  const pageStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const pageEnd = Math.min(pagination.page * pagination.limit, pagination.total);

  const issueListSummary = hasActiveFilters
    ? pagination.total === 0
      ? '0 matching issues'
      : `Showing ${pageStart}-${pageEnd} of ${pagination.total} matches`
    : `${summary.totalHighPriority} high priority`;

  function clearFilters() {
    setSearchFilter('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setIncludeArchived(false);
    setBlockedOnly(false);
    setStaleOnly(false);
    setPageSize(defaultDashboardFilters.pageSize);
    setCurrentPage(1);
  }

  function setDashboardFilters(filters: DashboardFilters) {
    setSearchFilter(filters.search);
    setStatusFilter(filters.status);
    setPriorityFilter(filters.priority);
    setIncludeArchived(filters.includeArchived);
    setBlockedOnly(filters.blockedOnly);
    setStaleOnly(filters.staleOnly);
    setPageSize(filters.pageSize);
    setCurrentPage(1);
  }

  function setSearchFilterAndResetPage(value: string) {
    setSearchFilter(value);
    setCurrentPage(1);
  }

  function setStatusFilterAndResetPage(value: StatusFilter) {
    setStatusFilter(value);
    setCurrentPage(1);
  }

  function setPriorityFilterAndResetPage(value: PriorityFilter) {
    setPriorityFilter(value);
    setCurrentPage(1);
  }

  function setIncludeArchivedAndResetPage(value: boolean) {
    setIncludeArchived(value);
    setCurrentPage(1);
  }

  function setBlockedOnlyAndResetPage(value: boolean) {
    setBlockedOnly(value);
    setCurrentPage(1);
  }

  function setStaleOnlyAndResetPage(value: boolean) {
    setStaleOnly(value);
    setCurrentPage(1);
  }

  function setPageSizeAndResetPage(value: number) {
    setPageSize(value);
    setCurrentPage(1);
  }

  function goToPreviousPage() {
    setCurrentPage((page) => Math.max(1, page - 1));
  }

  function goToNextPage() {
    setCurrentPage((page) => page + 1);
  }

  function refreshIssues() {
    setReloadToken((value) => value + 1);
  }

  function returnToFirstPage() {
    setCurrentPage(1);
    refreshIssues();
  }

  return {
    issues,
    loadState,
    searchFilter,
    setSearchFilter: setSearchFilterAndResetPage,
    statusFilter,
    setStatusFilter: setStatusFilterAndResetPage,
    priorityFilter,
    setPriorityFilter: setPriorityFilterAndResetPage,
    includeArchived,
    setIncludeArchived: setIncludeArchivedAndResetPage,
    blockedOnly,
    setBlockedOnly: setBlockedOnlyAndResetPage,
    staleOnly,
    setStaleOnly: setStaleOnlyAndResetPage,
    pageSize,
    setPageSize: setPageSizeAndResetPage,
    currentPage,
    pagination,
    summary,
    totalIssueCount,
    filteredIssues: issues,
    activeFilterSummaries,
    hasActiveFilters,
    statusCounts,
    issueListSummary,
    clearFilters,
    setDashboardFilters,
    goToPreviousPage,
    goToNextPage,
    refreshIssues,
    returnToFirstPage
  };
}
