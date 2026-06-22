import { useEffect, useMemo, useState } from 'react';
import { fetchIssueAuditSummary, fetchIssues } from '../api';
import { priorityLabels, statusLabels, statusOrder } from '../constants';
import type {
  ActiveFilterSummary,
  DashboardFilters,
  IssueAuditSummary,
  Issue,
  IssueListPagination,
  IssueListSummary,
  LoadState,
  PriorityFilter,
  StatusFilter
} from '../types';
import { buildDashboardQuery, buildIssueListQuery, defaultDashboardFilters } from '../utils/routing';

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

const defaultAuditSummary: IssueAuditSummary = {
  totalIssues: 0,
  totalArchivedIssues: 0,
  totalBlockedIssues: 0,
  totalWaitingIssues: 0,
  totalOverdueIssues: 0,
  totalStaleIssues: 0,
  byStatus: {
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0
  },
  byPriority: {
    low: 0,
    medium: 0,
    high: 0
  },
  dependencyEdges: {
    total: 0,
    blocked: 0,
    archivedBlocked: 0
  }
};

export function useIssueDirectory(initialFilters: DashboardFilters = defaultDashboardFilters) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState(initialFilters.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilters.status);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(initialFilters.priority);
  const [labelFilter, setLabelFilter] = useState(initialFilters.label);
  const [includeArchived, setIncludeArchived] = useState(initialFilters.includeArchived);
  const [blockedOnly, setBlockedOnly] = useState(initialFilters.blockedOnly);
  const [staleOnly, setStaleOnly] = useState(initialFilters.staleOnly);
  const [pageSize, setPageSize] = useState(initialFilters.pageSize);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<IssueListPagination>(defaultPagination);
  const [summary, setSummary] = useState<IssueListSummary>(defaultSummary);
  const [auditSummary, setAuditSummary] = useState<IssueAuditSummary>(defaultAuditSummary);
  const [reloadToken, setReloadToken] = useState(0);

  const filterQuery = useMemo(
    () =>
      buildDashboardQuery(
        {
          search: searchFilter,
          status: statusFilter,
          priority: priorityFilter,
          label: labelFilter,
          includeArchived,
          blockedOnly,
          staleOnly,
          pageSize
        },
        { includePageSize: false }
      ),
    [blockedOnly, includeArchived, labelFilter, pageSize, priorityFilter, searchFilter, staleOnly, statusFilter]
  );
  const issueListQuery = useMemo(
    () =>
      buildIssueListQuery(
        {
          search: searchFilter,
          status: statusFilter,
          priority: priorityFilter,
          label: labelFilter,
          includeArchived,
          blockedOnly,
          staleOnly,
          pageSize
        },
        currentPage
      ),
    [
      blockedOnly,
      currentPage,
      includeArchived,
      labelFilter,
      pageSize,
      priorityFilter,
      searchFilter,
      staleOnly,
      statusFilter
    ]
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadIssues() {
      try {
        setLoadState('loading');
        setLoadError(null);
        const body = await fetchIssues(new URLSearchParams(issueListQuery), controller.signal);

        setIssues(body.items);
        setPagination(body.pagination);
        setSummary(body.summary);
        setLoadState('loaded');
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load issues.');
          setLoadState('error');
        }
      }
    }

    void loadIssues();

    return () => controller.abort();
  }, [issueListQuery, reloadToken]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAuditSummary() {
      try {
        setAuditSummary(await fetchIssueAuditSummary(new URLSearchParams(filterQuery), controller.signal));
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load issue audit summary.');
          setLoadState('error');
        }
      }
    }

    void loadAuditSummary();

    return () => controller.abort();
  }, [filterQuery, reloadToken]);

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

    const label = labelFilter.trim();
    if (label) {
      filters.push({ key: 'label', label: 'Label', value: label });
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
  }, [blockedOnly, includeArchived, labelFilter, pageSize, priorityFilter, searchFilter, staleOnly, statusFilter]);

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
    setLabelFilter('');
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
    setLabelFilter(filters.label);
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

  function setLabelFilterAndResetPage(value: string) {
    setLabelFilter(value);
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
    loadError,
    searchFilter,
    setSearchFilter: setSearchFilterAndResetPage,
    statusFilter,
    setStatusFilter: setStatusFilterAndResetPage,
    priorityFilter,
    setPriorityFilter: setPriorityFilterAndResetPage,
    labelFilter,
    setLabelFilter: setLabelFilterAndResetPage,
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
    auditSummary,
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
