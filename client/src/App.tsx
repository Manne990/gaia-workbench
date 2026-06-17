import './styles.css';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addIssueDependency,
  archiveIssue,
  bulkArchiveIssues,
  bulkUpdateIssueStatus,
  createSavedFilterView,
  deleteSavedFilterView,
  duplicateSavedFilterView,
  duplicateIssue,
  fetchIssue,
  fetchIssueDependencies,
  fetchSavedFilterView,
  fetchSavedFilterViews,
  fetchServiceHealth,
  removeIssueDependency,
  unarchiveIssue,
  updateSavedFilterView
} from './api';
import { DashboardHeader } from './components/DashboardHeader';
import { ImportPanel } from './components/ImportPanel';
import { IssueAuditSummary } from './components/IssueAuditSummary';
import { IssueDetailPanel } from './components/IssueDetailPanel';
import { IssueFormPanel } from './components/IssueFormPanel';
import { IssueListPanel } from './components/IssueListPanel';
import { IssueStatusSummary } from './components/IssueStatusSummary';
import { CommandPalette } from './components/CommandPalette';
import { emptyFormValues, statusLabels, statusOrder } from './constants';
import { useImportWorkflow } from './hooks/useImportWorkflow';
import { useIssueDirectory } from './hooks/useIssueDirectory';
import { useSelectedIssueDiscussion } from './hooks/useSelectedIssueDiscussion';
import type {
  ActiveFilterSummary,
  ActiveForm,
  ArchivedIssueRecovery,
  CancelOptions,
  CommentLoadState,
  DashboardDensity,
  DashboardFilters,
  Issue,
  IssueDependencyState,
  IssueDetailLoadState,
  IssueLinkCopyFeedback,
  IssueFormValues,
  IssueStatus,
  PriorityFilter,
  SavedFilterView,
  ServiceHealthState,
  StatusFilter
} from './types';
import { restoreFocus } from './utils/focus';
import { parseDueDateInput, parseLabelsInput } from './utils/parse';
import {
  buildDashboardQuery,
  buildStableIssueUrl,
  defaultDashboardFilters,
  getRouteStateFromLocation,
  type RouteState,
  writeRoute
} from './utils/routing';

const DASHBOARD_DENSITY_STORAGE_KEY = 'tinytracker.dashboardDensity';
const SELECTED_ISSUE_STATUS_COMMAND_PREFIX = 'set-selected-issue-status:';
const APPLY_SAVED_VIEW_COMMAND_PREFIX = 'apply-saved-view:';
type IssueAnchorTarget = {
  type: 'comment' | 'activity';
  id: string;
};

function isDashboardDensity(value: string | null): value is DashboardDensity {
  return value === 'comfortable' || value === 'compact';
}

function readStoredDashboardDensity(): DashboardDensity {
  try {
    if (typeof window === 'undefined') {
      return 'comfortable';
    }

    const storedDensity = window.localStorage.getItem(DASHBOARD_DENSITY_STORAGE_KEY);

    return isDashboardDensity(storedDensity) ? storedDensity : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeStoredDashboardDensity(value: DashboardDensity): void {
  try {
    window.localStorage.setItem(DASHBOARD_DENSITY_STORAGE_KEY, value);
  } catch {
    // Density is a local preference; storage failures should not block UI changes.
  }
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyDependencyStateToIssue(issue: Issue, dependencies: IssueDependencyState): Issue {
  const dependsOnIssueIds = dependencies.dependencies.map((dependency) => dependency.id);

  if (issue.isBlocked === dependencies.isBlocked && areStringArraysEqual(issue.dependsOnIssueIds, dependsOnIssueIds)) {
    return issue;
  }

  return {
    ...issue,
    dependsOnIssueIds,
    isBlocked: dependencies.isBlocked
  };
}

function parseIssueAnchorTarget(hash: string): IssueAnchorTarget | null {
  const match = /^(?:#)(comment|activity)-(.+)$/.exec(hash.trim());

  if (!match) {
    return null;
  }

  const type = match[1] as IssueAnchorTarget['type'];
  const id = match[2].trim();

  if (!id) {
    return null;
  }

  try {
    return { type, id: decodeURIComponent(id) };
  } catch {
    return { type, id };
  }
}

function selectedIssueStatusCommandId(status: IssueStatus): string {
  return `${SELECTED_ISSUE_STATUS_COMMAND_PREFIX}${status}`;
}

function applySavedViewCommandId(viewId: string): string {
  return `${APPLY_SAVED_VIEW_COMMAND_PREFIX}${encodeURIComponent(viewId)}`;
}

function readSelectedIssueStatusCommand(commandId: string): IssueStatus | null {
  if (!commandId.startsWith(SELECTED_ISSUE_STATUS_COMMAND_PREFIX)) {
    return null;
  }

  const status = commandId.slice(SELECTED_ISSUE_STATUS_COMMAND_PREFIX.length);

  return statusOrder.includes(status as IssueStatus) ? (status as IssueStatus) : null;
}

function readApplySavedViewCommand(commandId: string): string | null {
  if (!commandId.startsWith(APPLY_SAVED_VIEW_COMMAND_PREFIX)) {
    return null;
  }

  const viewId = commandId.slice(APPLY_SAVED_VIEW_COMMAND_PREFIX.length);

  try {
    return decodeURIComponent(viewId);
  } catch {
    return viewId;
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.contentEditable === 'true' ||
    Boolean(target.closest('form'))
  );
}

export function App() {
  const initialRouteStateRef = useRef<RouteState | null>(null);

  if (!initialRouteStateRef.current) {
    initialRouteStateRef.current = getRouteStateFromLocation();
  }

  const {
    issues,
    loadState,
    loadError,
    searchFilter,
    setSearchFilter,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    labelFilter,
    setLabelFilter,
    includeArchived,
    setIncludeArchived,
    blockedOnly,
    setBlockedOnly,
    staleOnly,
    setStaleOnly,
    pageSize,
    setPageSize,
    filteredIssues,
    pagination,
    totalIssueCount,
    activeFilterSummaries: dashboardActiveFilterSummaries,
    auditSummary,
    statusCounts,
    issueListSummary,
    clearFilters,
    setDashboardFilters,
    goToPreviousPage,
    goToNextPage,
    refreshIssues,
    returnToFirstPage
  } = useIssueDirectory(initialRouteStateRef.current.filters);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    () => initialRouteStateRef.current?.issueId ?? null
  );
  const [issueAnchorHash, setIssueAnchorHash] = useState(() => window.location.hash);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [selectedIssueLoadState, setSelectedIssueLoadState] = useState<IssueDetailLoadState>('idle');
  const [selectedIssueDetailReloadToken, setSelectedIssueDetailReloadToken] = useState(0);
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [formValues, setFormValues] = useState<IssueFormValues>(emptyFormValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issueDependencies, setIssueDependencies] = useState<IssueDependencyState | null>(null);
  const [dependencyLoadState, setDependencyLoadState] = useState<CommentLoadState>('idle');
  const [dependencyIssueId, setDependencyIssueId] = useState('');
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [isDependencySubmitting, setIsDependencySubmitting] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState(() => initialRouteStateRef.current?.savedViewId ?? '');
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(
    () => initialRouteStateRef.current?.savedViewId ?? null
  );
  const [savedViewName, setSavedViewName] = useState('');
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const [isSavedViewBusy, setIsSavedViewBusy] = useState(false);
  const [dashboardDensity, setDashboardDensity] = useState<DashboardDensity>(() => readStoredDashboardDensity());
  const [serviceHealthState, setServiceHealthState] = useState<ServiceHealthState>('checking');
  const [selectedBulkIssueIds, setSelectedBulkIssueIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<IssueStatus>('in_progress');
  const [bulkStatusMessage, setBulkStatusMessage] = useState<string | null>(null);
  const [bulkStatusError, setBulkStatusError] = useState<string | null>(null);
  const [issueLinkCopyFeedback, setIssueLinkCopyFeedback] = useState<IssueLinkCopyFeedback | null>(null);
  const [isBulkStatusSubmitting, setIsBulkStatusSubmitting] = useState(false);
  const newIssueButtonRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const issueSearchInputRef = useRef<HTMLInputElement>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement>(null);
  const savedViewsDetailsRef = useRef<HTMLDetailsElement>(null);
  const savedViewSelectRef = useRef<HTMLSelectElement>(null);
  const dependencyIssueInputRef = useRef<HTMLInputElement>(null);
  const issueListHeadingRef = useRef<HTMLHeadingElement>(null);
  const issueTitleInputRef = useRef<HTMLInputElement>(null);
  const issueDetailHeadingRef = useRef<HTMLHeadingElement>(null);
  const missingIssueHeadingRef = useRef<HTMLHeadingElement>(null);
  const commentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const editCommentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const formReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const commandPaletteFocusReturnRef = useRef<HTMLElement | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [recentlyArchivedIssue, setRecentlyArchivedIssue] = useState<ArchivedIssueRecovery | null>(null);
  const didCanonicalizeInitialRouteRef = useRef(false);
  const dashboardFiltersRef = useRef<DashboardFilters>(initialRouteStateRef.current.filters);
  const selectedIssueIdRef = useRef<string | null>(initialRouteStateRef.current.issueId);
  const activeSavedViewIdRef = useRef<string | null>(initialRouteStateRef.current.savedViewId);
  const savedViewRouteAbortRef = useRef<AbortController | null>(null);

  const dashboardFilters: DashboardFilters = useMemo(
    () => ({
      search: searchFilter,
      status: statusFilter,
      priority: priorityFilter,
      label: labelFilter,
      includeArchived,
      blockedOnly,
      staleOnly,
      pageSize
    }),
    [blockedOnly, includeArchived, labelFilter, pageSize, priorityFilter, searchFilter, staleOnly, statusFilter]
  );
  const csvExportHref = useMemo(() => {
    const query = buildDashboardQuery(dashboardFilters, { includePageSize: false });

    return query ? `/api/export.csv?${query}` : '/api/export.csv';
  }, [dashboardFilters]);
  const activeFilterSummaries: ActiveFilterSummary[] = useMemo(() => {
    const activeSavedView = activeSavedViewId ? savedViews.find((view) => view.id === activeSavedViewId) : null;

    return activeSavedView
      ? [{ key: 'savedView', label: 'Saved view', value: activeSavedView.name }, ...dashboardActiveFilterSummaries]
      : dashboardActiveFilterSummaries;
  }, [activeSavedViewId, dashboardActiveFilterSummaries, savedViews]);
  const hasActiveFilters = activeFilterSummaries.length > 0;
  const loadSavedViews = useCallback(async (signal?: AbortSignal) => {
    try {
      setSavedViews(await fetchSavedFilterViews(signal));
    } catch {
      if (!signal?.aborted) {
        setSavedViewError('Unable to load saved views.');
      }
    }
  }, []);
  const selectedIssueStatusCommands = useMemo(
    () =>
      statusOrder.map((status) => {
        const statusLabel = statusLabels[status];
        const selectedTitle = selectedIssue?.title ?? 'the selected issue';
        const disabled = !selectedIssue || selectedIssue.status === status || selectedIssue.archivedAt !== null;
        const description = !selectedIssue
          ? `Select an issue to change its status to ${statusLabel}`
          : selectedIssue.archivedAt
            ? 'Restore the archived issue before changing status'
            : selectedIssue.status === status
              ? `${selectedTitle} is already ${statusLabel}`
              : `Set ${selectedTitle} to ${statusLabel}`;

        return {
          id: selectedIssueStatusCommandId(status),
          label: `Move selected issue to ${statusLabel}`,
          description,
          commandHint: statusLabel,
          disabled
        };
      }),
    [selectedIssue]
  );
  const savedViewCommands = useMemo(
    () =>
      savedViews.map((view) => ({
        id: applySavedViewCommandId(view.id),
        label: `Apply saved view: ${view.name}`,
        description: `Load filters from ${view.name}`,
        commandHint: 'View',
        disabled: isSavedViewBusy
      })),
    [isSavedViewBusy, savedViews]
  );
  const commandPaletteCommands = useMemo(
    () => [
      {
        id: 'new-issue',
        label: 'New issue',
        description: 'Create a new issue',
        commandHint: 'N',
        disabled: false
      },
      {
        id: 'focus-issue-search',
        label: 'Focus issue search',
        description: 'Jump to the issue list search box',
        commandHint: 'S',
        disabled: false
      },
      {
        id: 'focus-saved-views',
        label: 'Focus saved views',
        description: 'Jump to saved view controls',
        commandHint: 'Views',
        disabled: false
      },
      ...savedViewCommands,
      {
        id: 'open-first-visible-issue',
        label: 'Open first visible issue',
        description: 'Open the first issue in the current list',
        commandHint: 'Enter',
        disabled: filteredIssues.length === 0
      },
      ...selectedIssueStatusCommands,
      {
        id: 'clear-active-filters',
        label: 'Clear active filters',
        description: 'Reset search and all dashboard filters',
        commandHint: 'C',
        disabled: !hasActiveFilters
      },
      {
        id: 'toggle-dashboard-density',
        label: dashboardDensity === 'comfortable' ? 'Use compact density' : 'Use comfortable density',
        description:
          dashboardDensity === 'comfortable'
            ? 'Switch dashboard rows to compact density'
            : 'Switch dashboard rows to comfortable density',
        commandHint: 'D',
        disabled: false
      },
      {
        id: 'focus-dependency-actions',
        label: 'Focus dependency actions',
        description: !selectedIssue
          ? 'Select an issue to manage dependencies'
          : dependencyLoadState === 'loading'
            ? 'Wait for dependencies to finish loading'
            : `Add blocker dependency to ${selectedIssue.title}`,
        commandHint: 'Deps',
        disabled: !selectedIssue || dependencyLoadState === 'loading' || isDependencySubmitting
      },
      {
        id: 'close-issue-detail',
        label: 'Close issue detail',
        description: 'Close issue detail panel',
        commandHint: 'Esc',
        disabled: !selectedIssueId
      }
    ],
    [
      dashboardDensity,
      dependencyLoadState,
      filteredIssues.length,
      hasActiveFilters,
      isDependencySubmitting,
      savedViewCommands,
      selectedIssue,
      selectedIssueId,
      selectedIssueStatusCommands
    ]
  );

  const isIssueDetailLoading = Boolean(selectedIssueId && selectedIssueLoadState === 'loading' && !selectedIssue);
  const isIssueDetailError = Boolean(selectedIssueId && selectedIssueLoadState === 'error' && !selectedIssue);
  const isMissingSelectedIssue = selectedIssueLoadState === 'not_found';
  const {
    comments,
    commentHistory,
    commentLoadState,
    activityEvents,
    activityLoadState,
    commentBody,
    setCommentBody,
    commentError,
    isCommentSubmitting,
    editingCommentId,
    editCommentBody,
    setEditCommentBody,
    editCommentError,
    isCommentEditing,
    refreshActivity,
    submitComment,
    startEditComment,
    cancelEditComment,
    submitCommentEdit
  } = useSelectedIssueDiscussion({
    selectedIssueId,
    selectedIssue,
    selectedIssueDetailReloadToken,
    commentsHeadingRef
  });
  useEffect(() => {
    selectedIssueIdRef.current = selectedIssueId;
  }, [selectedIssueId]);

  useEffect(() => {
    const visibleIds = new Set(filteredIssues.map((issue) => issue.id));

    setSelectedBulkIssueIds((current) => {
      const next = current.filter((issueId) => visibleIds.has(issueId));

      return next.length === current.length ? current : next;
    });
  }, [filteredIssues]);

  useEffect(() => {
    dashboardFiltersRef.current = dashboardFilters;
  }, [dashboardFilters]);

  useEffect(() => {
    writeStoredDashboardDensity(dashboardDensity);
  }, [dashboardDensity]);

  const {
    importFileName,
    importPlan,
    importPolicy,
    importError,
    importMessage,
    isImportPreviewing,
    isImportApplying,
    isImportPanelVisible,
    canApplyImport,
    handleChooseImportFile,
    changeImportPolicy,
    downloadImportReport,
    submitImport,
    clearImportState
  } = useImportWorkflow({
    importInputRef,
    importButtonRef,
    newIssueButtonRef,
    issueListHeadingRef,
    getSelectedIssueId: () => selectedIssueIdRef.current,
    refreshSelectedIssueDetail,
    loadSavedViews: () => loadSavedViews(),
    returnToFirstPage
  });

  function openCommandPalette(trigger?: HTMLElement | null) {
    if (isCommandPaletteOpen) {
      return;
    }

    commandPaletteFocusReturnRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    setIsCommandPaletteOpen(true);
  }

  function closeCommandPalette(options: { restoreFocus?: boolean; clearQuery?: boolean } = {}) {
    const { restoreFocus = true, clearQuery = false } = options;

    setIsCommandPaletteOpen(false);

    if (clearQuery) {
      setCommandPaletteQuery('');
    }

    if (restoreFocus) {
      restoreFocusRef(commandPaletteFocusReturnRef.current);
    }

    commandPaletteFocusReturnRef.current = null;
  }

  function restoreFocusRef(element: HTMLElement | null) {
    restoreFocus(element, () => newIssueButtonRef.current ?? issueListHeadingRef.current);
  }

  function focusSavedViewControls() {
    if (savedViewsDetailsRef.current && !savedViewsDetailsRef.current.open) {
      savedViewsDetailsRef.current.open = true;
    }

    window.setTimeout(() => {
      savedViewSelectRef.current?.focus();
    }, 0);
  }

  function focusDependencyActions() {
    dependencyIssueInputRef.current?.scrollIntoView({ block: 'center' });
    dependencyIssueInputRef.current?.focus();
  }

  async function runCommandPaletteAction(commandId: string) {
    if (commandId === 'new-issue') {
      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      startCreate();
      return;
    }

    if (commandId === 'focus-issue-search') {
      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      issueSearchInputRef.current?.focus();
      return;
    }

    if (commandId === 'focus-saved-views') {
      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      focusSavedViewControls();
      return;
    }

    const savedViewCommandId = readApplySavedViewCommand(commandId);

    if (savedViewCommandId) {
      await applySavedViewFromCommand(savedViewCommandId);
      return;
    }

    if (commandId === 'open-first-visible-issue') {
      const firstIssue = filteredIssues[0];

      if (!firstIssue) {
        closeCommandPalette();
        return;
      }

      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      openIssue(firstIssue);
      return;
    }

    const selectedIssueStatus = readSelectedIssueStatusCommand(commandId);

    if (selectedIssueStatus) {
      await changeSelectedIssueStatus(selectedIssueStatus);
      return;
    }

    if (commandId === 'clear-active-filters') {
      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      handleClearFilters({ restoreFocus: true });
      return;
    }

    if (commandId === 'toggle-dashboard-density') {
      setDashboardDensity((current) => (current === 'comfortable' ? 'compact' : 'comfortable'));
      closeCommandPalette({ clearQuery: true });
      return;
    }

    if (commandId === 'focus-dependency-actions') {
      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      focusDependencyActions();
      return;
    }

    if (commandId === 'close-issue-detail' && selectedIssueId) {
      closeIssueDetail();
      closeCommandPalette({ restoreFocus: false, clearQuery: true });
      return;
    }

    closeCommandPalette({ clearQuery: true });
  }

  async function changeSelectedIssueStatus(status: IssueStatus) {
    if (!selectedIssue || selectedIssue.status === status || selectedIssue.archivedAt !== null) {
      closeCommandPalette({ clearQuery: true });
      return;
    }

    closeCommandPalette({ clearQuery: true });
    setBulkStatusError(null);
    setBulkStatusMessage(null);

    try {
      const result = await bulkUpdateIssueStatus([selectedIssue.id], status);
      const updatedIssue = result.updated.find((issue) => issue.id === selectedIssue.id) ?? null;

      refreshIssues();

      if (updatedIssue) {
        setSelectedIssue(updatedIssue);
        setSelectedIssueLoadState('loaded');
        await refreshSelectedIssueDetail(updatedIssue.id);
        setBulkStatusMessage(`Changed selected issue to ${statusLabels[result.status]}.`);
      } else if (result.unchangedIds.includes(selectedIssue.id)) {
        setBulkStatusMessage(`Selected issue already was ${statusLabels[result.status]}.`);
      } else {
        setBulkStatusError('Selected issue was not found.');
      }
    } catch (error) {
      setBulkStatusError(error instanceof Error ? error.message : 'Selected issue status update failed.');
    }
  }

  useEffect(() => {
    if (activeForm) {
      issueTitleInputRef.current?.focus();
    }
  }, [activeForm]);

  useEffect(() => {
    if (selectedIssue) {
      issueDetailHeadingRef.current?.focus();
    }
  }, [selectedIssue]);

  useEffect(() => {
    if (isMissingSelectedIssue) {
      missingIssueHeadingRef.current?.focus();
    }
  }, [isMissingSelectedIssue]);

  useEffect(() => {
    if (editingCommentId) {
      editCommentTextareaRef.current?.focus();
    }
  }, [editingCommentId]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      commandPaletteInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    function handlePaletteShortcut(event: globalThis.KeyboardEvent) {
      if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        return;
      }

      const focusReturnTarget =
        event.target instanceof HTMLElement ? event.target : (document.activeElement as HTMLElement | null);

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();

      if (isCommandPaletteOpen) {
        closeCommandPalette();
        return;
      }

      commandPaletteFocusReturnRef.current = focusReturnTarget;
      setIsCommandPaletteOpen(true);
    }

    window.addEventListener('keydown', handlePaletteShortcut);

    return () => {
      window.removeEventListener('keydown', handlePaletteShortcut);
    };
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    function handleVisibleIssueShortcut(event: globalThis.KeyboardEvent) {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
      ) {
        return;
      }

      if (isCommandPaletteOpen || isEditableKeyboardTarget(event.target) || filteredIssues.length === 0) {
        return;
      }

      const selectedIssueIndex = selectedIssueIdRef.current
        ? filteredIssues.findIndex((issue) => issue.id === selectedIssueIdRef.current)
        : -1;
      const fallbackIndex = event.key === 'ArrowDown' ? 0 : filteredIssues.length - 1;
      const nextIssueIndex =
        selectedIssueIndex === -1
          ? fallbackIndex
          : event.key === 'ArrowDown'
            ? Math.min(selectedIssueIndex + 1, filteredIssues.length - 1)
            : Math.max(selectedIssueIndex - 1, 0);

      event.preventDefault();
      openIssue(filteredIssues[nextIssueIndex]);
    }

    window.addEventListener('keydown', handleVisibleIssueShortcut);

    return () => {
      window.removeEventListener('keydown', handleVisibleIssueShortcut);
    };
  }, [filteredIssues, isCommandPaletteOpen]);

  useEffect(() => {
    if (didCanonicalizeInitialRouteRef.current) {
      return;
    }

    didCanonicalizeInitialRouteRef.current = true;
    if (!window.location.hash) {
      writeRoute(selectedIssueId, dashboardFilters, 'replace', { savedViewId: activeSavedViewIdRef.current });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadServiceHealth() {
      try {
        const health = await fetchServiceHealth(controller.signal);

        setServiceHealthState(health.status === 'ok' ? 'online' : 'unavailable');
      } catch {
        if (!controller.signal.aborted) {
          setServiceHealthState('unavailable');
        }
      }
    }

    void loadServiceHealth();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void loadSavedViews(controller.signal);

    return () => controller.abort();
  }, [loadSavedViews]);

  useEffect(() => {
    const routeState = initialRouteStateRef.current;

    if (!routeState || !routeState.savedViewId) {
      return;
    }

    void restoreSavedViewFromRoute(routeState.savedViewId, routeState);

    return () => {
      savedViewRouteAbortRef.current?.abort();
      savedViewRouteAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    function syncSelectedIssueFromLocation() {
      const routeState = getRouteStateFromLocation();

      detailReturnFocusRef.current = null;
      dashboardFiltersRef.current = routeState.filters;
      selectedIssueIdRef.current = routeState.issueId;
      setDashboardFilters(routeState.filters);
      setSelectedIssueId(routeState.issueId);
      setIssueAnchorHash(window.location.hash);

      if (routeState.savedViewId) {
        void restoreSavedViewFromRoute(routeState.savedViewId, routeState);
      } else {
        setActiveSavedViewState(null);
        savedViewRouteAbortRef.current?.abort();
        savedViewRouteAbortRef.current = null;
      }
    }

    window.addEventListener('popstate', syncSelectedIssueFromLocation);

    return () => window.removeEventListener('popstate', syncSelectedIssueFromLocation);
  }, []);

  useEffect(() => {
    function syncIssueAnchorHash() {
      setIssueAnchorHash(window.location.hash);
    }

    window.addEventListener('hashchange', syncIssueAnchorHash);

    return () => window.removeEventListener('hashchange', syncIssueAnchorHash);
  }, []);

  function writeRouteState(
    issueId: string | null,
    filters: DashboardFilters,
    mode: 'push' | 'replace',
    savedViewId: string | null = activeSavedViewIdRef.current
  ) {
    writeRoute(issueId, filters, mode, { savedViewId });
    setIssueAnchorHash(window.location.hash);
  }

  function writeDashboardRoute(
    filters: DashboardFilters,
    mode: 'push' | 'replace',
    savedViewId: string | null = activeSavedViewIdRef.current
  ) {
    writeRouteState(selectedIssueId, filters, mode, savedViewId);
  }

  function setActiveSavedViewState(viewId: string | null) {
    activeSavedViewIdRef.current = viewId;
    setActiveSavedViewId(viewId);
  }

  function commitDashboardFilterRoute(filters: DashboardFilters, mode: 'push' | 'replace') {
    setActiveSavedViewState(null);
    savedViewRouteAbortRef.current?.abort();
    savedViewRouteAbortRef.current = null;
    dashboardFiltersRef.current = filters;
    writeDashboardRoute(filters, mode, null);
  }

  function handleSearchFilterChange(value: string) {
    const nextFilters = { ...dashboardFiltersRef.current, search: value };

    setSearchFilter(value);
    commitDashboardFilterRoute(nextFilters, 'replace');
  }

  function handleStatusFilterChange(value: StatusFilter) {
    const nextFilters = { ...dashboardFiltersRef.current, status: value };

    setStatusFilter(value);
    commitDashboardFilterRoute(nextFilters, 'push');
  }

  function handlePriorityFilterChange(value: PriorityFilter) {
    const nextFilters = { ...dashboardFiltersRef.current, priority: value };

    setPriorityFilter(value);
    commitDashboardFilterRoute(nextFilters, 'push');
  }

  function handleLabelFilterChange(value: string) {
    const nextFilters = { ...dashboardFiltersRef.current, label: value };

    setLabelFilter(value);
    commitDashboardFilterRoute(nextFilters, 'replace');
  }

  function handleIncludeArchivedChange(value: boolean) {
    const nextFilters = { ...dashboardFiltersRef.current, includeArchived: value };

    setIncludeArchived(value);
    commitDashboardFilterRoute(nextFilters, 'push');
  }

  function handleBlockedOnlyChange(value: boolean) {
    const nextFilters = { ...dashboardFiltersRef.current, blockedOnly: value };

    setBlockedOnly(value);
    commitDashboardFilterRoute(nextFilters, 'push');
  }

  function handleStaleOnlyChange(value: boolean) {
    const nextFilters = { ...dashboardFiltersRef.current, staleOnly: value };

    setStaleOnly(value);
    commitDashboardFilterRoute(nextFilters, 'push');
  }

  function handlePageSizeChange(value: number) {
    const nextFilters = { ...dashboardFiltersRef.current, pageSize: value };

    setPageSize(value);
    commitDashboardFilterRoute(nextFilters, 'push');
  }

  function handleClearFilters(options: { restoreFocus?: boolean } = {}) {
    const currentSelectedIssueId = selectedIssueIdRef.current;

    dashboardFiltersRef.current = defaultDashboardFilters;
    setActiveSavedViewState(null);
    savedViewRouteAbortRef.current?.abort();
    savedViewRouteAbortRef.current = null;
    clearFilters();
    writeRouteState(currentSelectedIssueId, defaultDashboardFilters, 'replace', null);

    if (options.restoreFocus) {
      restoreFocus(null, () => issueListHeadingRef.current);
    }
  }

  function upsertSavedView(view: SavedFilterView) {
    setSavedViews((current) => {
      const next = current.some((item) => item.id === view.id)
        ? current.map((item) => (item.id === view.id ? view : item))
        : [view, ...current];

      return [...next].sort((left, right) => {
        const updatedAtSort = right.updatedAt.localeCompare(left.updatedAt);

        return updatedAtSort || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
      });
    });
    setSelectedSavedViewId(view.id);
    setSavedViewName(view.name);
  }

  function removeMissingSavedView(viewId: string) {
    setSavedViews((current) => current.filter((view) => view.id !== viewId));
    setSelectedSavedViewId('');
    setSavedViewName('');
  }

  function getFiltersForSavedView(view: SavedFilterView): DashboardFilters {
    return {
      search: view.search,
      status: view.status,
      priority: view.priority,
      label: view.label,
      includeArchived: view.includeArchived,
      blockedOnly: view.blockedOnly,
      staleOnly: view.staleOnly,
      pageSize: view.pageSize
    };
  }

  function getSelectedIssueIdForSavedView(): string | null {
    return selectedIssueIdRef.current;
  }

  function applySavedViewState(view: SavedFilterView, mode: 'push' | 'replace') {
    const nextFilters = getFiltersForSavedView(view);
    const nextSelectedIssueId = getSelectedIssueIdForSavedView();

    setActiveSavedViewState(view.id);
    upsertSavedView(view);
    dashboardFiltersRef.current = nextFilters;
    selectedIssueIdRef.current = nextSelectedIssueId;
    setDashboardFilters(nextFilters);
    setSelectedIssueId(nextSelectedIssueId);

    if (!nextSelectedIssueId) {
      setSelectedIssue(null);
      setSelectedIssueLoadState('idle');
      detailReturnFocusRef.current = null;
    }

    writeRouteState(nextSelectedIssueId, nextFilters, mode, view.id);
  }

  async function restoreSavedViewFromRoute(savedViewId: string, fallbackRouteState: RouteState) {
    savedViewRouteAbortRef.current?.abort();

    const controller = new AbortController();
    savedViewRouteAbortRef.current = controller;
    setActiveSavedViewState(savedViewId);
    setSelectedSavedViewId(savedViewId);
    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      const view = await fetchSavedFilterView(savedViewId, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      applySavedViewState(view, 'replace');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Saved view restore failed.';

      if (message === 'Saved view not found') {
        setActiveSavedViewState(null);
        dashboardFiltersRef.current = fallbackRouteState.filters;
        selectedIssueIdRef.current = fallbackRouteState.issueId;
        setDashboardFilters(fallbackRouteState.filters);
        setSelectedIssueId(fallbackRouteState.issueId);
        removeMissingSavedView(savedViewId);
        setSavedViewError('Saved view not found. Showing filters from the URL instead.');
        writeRouteState(fallbackRouteState.issueId, fallbackRouteState.filters, 'replace', null);
      } else {
        setActiveSavedViewState(null);
        setSavedViewError(message);
      }
    } finally {
      if (savedViewRouteAbortRef.current === controller) {
        savedViewRouteAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsSavedViewBusy(false);
      }
    }
  }

  async function handleSaveCurrentView() {
    const name = savedViewName.trim();

    if (!name) {
      setSavedViewError('Saved view name is required.');
      return;
    }

    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      const view = await createSavedFilterView({
        name,
        ...dashboardFiltersRef.current
      });

      setActiveSavedViewState(view.id);
      upsertSavedView(view);
      writeRouteState(selectedIssueIdRef.current, dashboardFiltersRef.current, 'replace', view.id);
    } catch (error) {
      setSavedViewError(error instanceof Error ? error.message : 'Saved view create failed.');
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  async function applySavedViewById(viewId: string) {
    setIsSavedViewBusy(true);
    setSavedViewError(null);
    savedViewRouteAbortRef.current?.abort();
    savedViewRouteAbortRef.current = null;

    try {
      const view = await fetchSavedFilterView(viewId);

      applySavedViewState(view, 'push');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saved view apply failed.';

      setSavedViewError(message);

      if (message === 'Saved view not found') {
        removeMissingSavedView(viewId);
      }
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  async function handleApplySavedView() {
    if (!selectedSavedViewId) {
      setSavedViewError('Choose a saved view to apply.');
      return;
    }

    await applySavedViewById(selectedSavedViewId);
  }

  async function applySavedViewFromCommand(viewId: string) {
    const cachedView = savedViews.find((view) => view.id === viewId);

    setSelectedSavedViewId(viewId);
    setSavedViewName(cachedView?.name ?? '');
    closeCommandPalette({ restoreFocus: false, clearQuery: true });

    await applySavedViewById(viewId);
    restoreFocus(null, () => issueListHeadingRef.current);
  }

  async function handleRenameSavedView() {
    const name = savedViewName.trim();

    if (!selectedSavedViewId) {
      setSavedViewError('Choose a saved view to rename.');
      return;
    }

    if (!name) {
      setSavedViewError('Saved view name is required.');
      return;
    }

    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      upsertSavedView(await updateSavedFilterView(selectedSavedViewId, { name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saved view rename failed.';

      setSavedViewError(message);

      if (message === 'Saved view not found') {
        removeMissingSavedView(selectedSavedViewId);
      }
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  async function handleDuplicateSavedView() {
    if (!selectedSavedViewId) {
      setSavedViewError('Choose a saved view to duplicate.');
      return;
    }

    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      upsertSavedView(await duplicateSavedFilterView(selectedSavedViewId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saved view duplicate failed.';

      setSavedViewError(message);

      if (message === 'Saved view not found') {
        removeMissingSavedView(selectedSavedViewId);
      }
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  async function handleDeleteSavedView() {
    if (!selectedSavedViewId) {
      setSavedViewError('Choose a saved view to delete.');
      return;
    }

    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      await deleteSavedFilterView(selectedSavedViewId);
      setSavedViews((current) => current.filter((view) => view.id !== selectedSavedViewId));

      if (activeSavedViewIdRef.current === selectedSavedViewId) {
        setActiveSavedViewState(null);
        writeRouteState(selectedIssueIdRef.current, dashboardFiltersRef.current, 'replace', null);
      }

      setSelectedSavedViewId('');
      setSavedViewName('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saved view delete failed.';

      setSavedViewError(message);

      if (message === 'Saved view not found') {
        removeMissingSavedView(selectedSavedViewId);
      }
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedIssueId) {
      setSelectedIssue(null);
      setSelectedIssueLoadState('idle');
      return;
    }

    const issueId = selectedIssueId;
    const issueWasAlreadyDisplayed = selectedIssue?.id === issueId;
    const controller = new AbortController();

    if (!issueWasAlreadyDisplayed) {
      setSelectedIssue(null);
      setSelectedIssueLoadState('loading');
    }

    async function loadSelectedIssue() {
      try {
        const loadedIssue = await fetchIssue(issueId, controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        if (!loadedIssue) {
          setSelectedIssue(null);
          setSelectedIssueLoadState('not_found');
          return;
        }

        setSelectedIssue(loadedIssue);
        setSelectedIssueLoadState('loaded');
      } catch {
        if (!controller.signal.aborted) {
          setSelectedIssueLoadState(issueWasAlreadyDisplayed ? 'loaded' : 'error');

          if (!issueWasAlreadyDisplayed) {
            setSelectedIssue(null);
          }
        }
      }
    }

    void loadSelectedIssue();

    return () => controller.abort();
  }, [selectedIssueId]);

  useEffect(() => {
    if (!selectedIssueId || !selectedIssue || selectedIssue.id !== selectedIssueId) {
      setIssueDependencies(null);
      setDependencyLoadState('idle');
      setDependencyIssueId('');
      setDependencyError(null);
      return;
    }

    const issueId = selectedIssue.id;
    const controller = new AbortController();

    async function loadIssueDependencies() {
      setDependencyLoadState('loading');

      try {
        const loadedIssueDependencies = await fetchIssueDependencies(issueId, controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        setIssueDependencies(loadedIssueDependencies);
        setDependencyLoadState('loaded');
      } catch {
        if (!controller.signal.aborted) {
          setDependencyLoadState('error');
        }
      }
    }

    void loadIssueDependencies();

    return () => controller.abort();
  }, [selectedIssueId, selectedIssue, selectedIssueDetailReloadToken]);

  function scrollToAnchorTarget() {
    const anchorTarget = parseIssueAnchorTarget(issueAnchorHash);
    if (!anchorTarget || !selectedIssue || selectedIssue.id !== selectedIssueId) {
      return;
    }

    if (anchorTarget.type === 'comment' && commentLoadState !== 'loaded') {
      return;
    }

    if (anchorTarget.type === 'activity' && activityLoadState !== 'loaded') {
      return;
    }

    const anchorElement = document.getElementById(`${anchorTarget.type}-${anchorTarget.id}`);

    if (!anchorElement) {
      return;
    }

    anchorElement.scrollIntoView({ behavior: 'auto', block: 'start' });

    if (anchorElement.tabIndex < 0) {
      anchorElement.setAttribute('tabindex', '0');
    }

    anchorElement.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!selectedIssueId || !selectedIssue || selectedIssue.id !== selectedIssueId) {
      return;
    }

    const timer = window.setTimeout(() => {
      scrollToAnchorTarget();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    issueAnchorHash,
    selectedIssueId,
    selectedIssue?.id,
    commentLoadState,
    activityLoadState,
    comments.length,
    activityEvents.length
  ]);

  function startCreate(trigger?: HTMLElement) {
    formReturnFocusRef.current = trigger ?? null;
    setActiveForm({ mode: 'create' });
    setFormValues(emptyFormValues);
    setFormError(null);
  }

  function startEdit(issue: Issue, trigger?: HTMLElement) {
    formReturnFocusRef.current = trigger ?? null;
    setActiveForm({ mode: 'edit', issueId: issue.id });
    setFormValues({
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      labels: issue.labels.join(', '),
      dueDate: issue.dueDate ?? ''
    });
    setFormError(null);
  }

  function cancelForm(options: CancelOptions = {}) {
    const shouldRestoreFocus = options.restoreFocus ?? true;
    const returnFocusTarget = formReturnFocusRef.current;

    setActiveForm(null);
    setFormValues(emptyFormValues);
    setFormError(null);

    if (shouldRestoreFocus) {
      restoreFocus(returnFocusTarget, () => newIssueButtonRef.current ?? issueListHeadingRef.current);
    }

    formReturnFocusRef.current = null;
  }

  function openIssue(issue: Issue, trigger?: HTMLElement) {
    detailReturnFocusRef.current = trigger ?? null;
    setSelectedIssue(issue);
    setSelectedIssueLoadState('loaded');
    writeRouteState(issue.id, dashboardFiltersRef.current, 'push');
    setSelectedIssueId(issue.id);
    cancelForm({ restoreFocus: false });
  }

  async function copyIssueLink(issue: Issue, source: IssueLinkCopyFeedback['source']) {
    const stableIssueUrl = buildStableIssueUrl(issue.id, window.location.origin);

    try {
      await navigator.clipboard.writeText(stableIssueUrl);
      setIssueLinkCopyFeedback({
        issueId: issue.id,
        source,
        status: 'success',
        message: `Copied link for "${issue.title}".`
      });
    } catch {
      setIssueLinkCopyFeedback({
        issueId: issue.id,
        source,
        status: 'error',
        message: `Unable to copy link for "${issue.title}".`
      });
    }
  }

  function closeIssueDetail() {
    const returnFocusTarget = detailReturnFocusRef.current;

    setSelectedIssueId(null);
    setSelectedIssue(null);
    setSelectedIssueLoadState('idle');
    writeRouteState(null, dashboardFiltersRef.current, detailReturnFocusRef.current ? 'replace' : 'push');
    restoreFocus(returnFocusTarget, () => issueListHeadingRef.current);
    detailReturnFocusRef.current = null;
  }

  async function refreshSelectedIssueDetail(issueId: string) {
    try {
      const refreshedIssue = await fetchIssue(issueId);

      if (selectedIssueIdRef.current !== issueId) {
        return;
      }

      if (!refreshedIssue) {
        setSelectedIssue(null);
        setSelectedIssueLoadState('not_found');
        return;
      }

      setSelectedIssue(refreshedIssue);
      setSelectedIssueLoadState('loaded');
      setSelectedIssueDetailReloadToken((value) => value + 1);
    } catch {
      if (selectedIssueIdRef.current === issueId) {
        setSelectedIssue(null);
        setSelectedIssueLoadState('error');
      }
    }
  }

  async function refreshSelectedIssueAfterDependency(issueId: string, dependencies: IssueDependencyState) {
    setIssueDependencies(dependencies);
    setDependencyLoadState('loaded');
    setSelectedIssue((current) =>
      current && current.id === issueId ? applyDependencyStateToIssue(current, dependencies) : current
    );
    refreshIssues();

    try {
      const refreshedIssue = await fetchIssue(issueId);

      if (selectedIssueIdRef.current === issueId) {
        if (refreshedIssue) {
          setSelectedIssue(refreshedIssue);
          setSelectedIssueLoadState('loaded');
        } else {
          setSelectedIssue(null);
          setSelectedIssueLoadState('not_found');
        }
      }
    } catch {
      if (selectedIssueIdRef.current === issueId) {
        setSelectedIssueLoadState('loaded');
      }
    }

    await refreshActivity(issueId);
  }

  async function reconcileSelectedIssueAfterDependencyFailure(issueId: string) {
    try {
      const dependencies = await fetchIssueDependencies(issueId);

      if (selectedIssueIdRef.current !== issueId) {
        return;
      }

      setIssueDependencies(dependencies);
      setDependencyLoadState('loaded');
      setSelectedIssue((current) =>
        current && current.id === issueId ? applyDependencyStateToIssue(current, dependencies) : current
      );
      refreshIssues();
      await refreshActivity(issueId);
    } catch {
      // Keep the original mutation error visible; the next dependency load can retry reconciliation.
    }
  }

  async function submitIssueDependency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedIssue) {
      return;
    }

    const dependsOnIssueId = dependencyIssueId.trim();

    if (!dependsOnIssueId) {
      setDependencyError('Dependency issue id is required.');
      return;
    }

    if (dependsOnIssueId !== dependencyIssueId) {
      setDependencyIssueId(dependsOnIssueId);
    }

    if (dependsOnIssueId === selectedIssue.id) {
      setDependencyError('Issue cannot depend on itself');
      return;
    }

    setIsDependencySubmitting(true);
    setDependencyError(null);

    try {
      const dependencies = await addIssueDependency(selectedIssue.id, dependsOnIssueId);

      setDependencyIssueId('');
      await refreshSelectedIssueAfterDependency(selectedIssue.id, dependencies);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Dependency add failed.';

      await reconcileSelectedIssueAfterDependencyFailure(selectedIssue.id);

      if (selectedIssueIdRef.current === selectedIssue.id) {
        setDependencyError(errorMessage);
      }
    } finally {
      setIsDependencySubmitting(false);
    }
  }

  async function handleRemoveIssueDependency(dependsOnIssueId: string) {
    if (!selectedIssue) {
      return;
    }

    setIsDependencySubmitting(true);
    setDependencyError(null);

    try {
      const dependencies = await removeIssueDependency(selectedIssue.id, dependsOnIssueId);

      await refreshSelectedIssueAfterDependency(selectedIssue.id, dependencies);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Dependency remove failed.';

      await reconcileSelectedIssueAfterDependencyFailure(selectedIssue.id);

      if (selectedIssueIdRef.current === selectedIssue.id) {
        setDependencyError(errorMessage);
      }
    } finally {
      setIsDependencySubmitting(false);
    }
  }

  async function handleArchiveIssue(issue: Issue, trigger: HTMLElement) {
    const confirmed = window.confirm(`Archive "${issue.title}"? It will be hidden from the active dashboard.`);

    if (!confirmed) {
      return;
    }

    try {
      const archivedIssue = await archiveIssue(issue.id);
      setRecentlyArchivedIssue({ issues: [{ id: archivedIssue.id, title: archivedIssue.title }] });

      if (selectedIssueId === archivedIssue.id) {
        setSelectedIssue(archivedIssue);
        setSelectedIssueLoadState('loaded');
        await refreshActivity(archivedIssue.id);
      }

      returnToFirstPage();
      restoreFocus(trigger, () => issueListHeadingRef.current);
    } catch {
      restoreFocus(trigger, () => issueListHeadingRef.current);
    }
  }

  async function handleUndoArchiveIssue(_trigger: HTMLElement) {
    if (!recentlyArchivedIssue || recentlyArchivedIssue.issues.length === 0) {
      return;
    }

    try {
      const restoredIssues = await Promise.all(recentlyArchivedIssue.issues.map((issue) => unarchiveIssue(issue.id)));
      const selectedIssueIdAfterMutation = selectedIssueIdRef.current;
      const restoredSelectedIssue = selectedIssueIdAfterMutation
        ? restoredIssues.find((issue) => issue.id === selectedIssueIdAfterMutation)
        : null;

      if (restoredSelectedIssue) {
        setSelectedIssue(restoredSelectedIssue);
        setSelectedIssueLoadState('loaded');
        await refreshActivity(restoredSelectedIssue.id);
      }

      refreshIssues();
      setRecentlyArchivedIssue(null);
      restoreFocus(null, () => issueListHeadingRef.current);
    } catch {
      restoreFocus(null, () => issueListHeadingRef.current);
    }
  }

  async function handleUnarchiveIssue(issue: Issue, trigger: HTMLElement) {
    try {
      const restoredIssue = await unarchiveIssue(issue.id);

      setRecentlyArchivedIssue((current) => {
        if (!current || !current.issues.some((archivedIssue) => archivedIssue.id === restoredIssue.id)) {
          return current;
        }

        const remainingIssues = current.issues.filter((archivedIssue) => archivedIssue.id !== restoredIssue.id);

        return remainingIssues.length > 0 ? { issues: remainingIssues } : null;
      });

      if (selectedIssueId === restoredIssue.id) {
        setSelectedIssue(restoredIssue);
        setSelectedIssueLoadState('loaded');
        await refreshActivity(restoredIssue.id);
      }

      refreshIssues();
      restoreFocus(trigger, () => issueListHeadingRef.current);
    } catch {
      restoreFocus(trigger, () => issueListHeadingRef.current);
    }
  }

  async function handleDuplicateIssue(issue: Issue, trigger: HTMLElement) {
    try {
      const duplicatedIssue = await duplicateIssue(issue.id);

      openIssue(duplicatedIssue, trigger);
      returnToFirstPage();
      restoreFocus(trigger, () => issueDetailHeadingRef.current);
    } catch {
      restoreFocus(trigger, () => issueDetailHeadingRef.current);
    }
  }

  function clearArchiveRecovery(_trigger: HTMLElement) {
    setRecentlyArchivedIssue(null);
    restoreFocus(null, () => issueListHeadingRef.current);
  }

  function clearBulkSelection() {
    setSelectedBulkIssueIds([]);
    setBulkStatusError(null);
  }

  function selectAllVisibleBulkIssues() {
    setSelectedBulkIssueIds(filteredIssues.map((issue) => issue.id));
    setBulkStatusError(null);
  }

  function toggleBulkIssueSelection(issueId: string, selected: boolean) {
    setBulkStatusError(null);
    setBulkStatusMessage(null);
    setSelectedBulkIssueIds((current) => {
      if (selected) {
        return current.includes(issueId) ? current : [...current, issueId];
      }

      return current.filter((id) => id !== issueId);
    });
  }

  async function submitBulkStatusChange() {
    if (selectedBulkIssueIds.length === 0) {
      setBulkStatusError('Select at least one visible issue.');
      return;
    }

    const issueCount = selectedBulkIssueIds.length;
    const confirmed = window.confirm(
      `Change ${issueCount} selected issue${issueCount === 1 ? '' : 's'} to ${statusLabels[bulkStatus]}?`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkStatusSubmitting(true);
    setBulkStatusError(null);
    setBulkStatusMessage(null);

    try {
      const result = await bulkUpdateIssueStatus(selectedBulkIssueIds, bulkStatus);
      const changedCount = result.updated.length;
      const unchangedCount = result.unchangedIds.length;
      const duplicateCount = result.duplicateIds.length;
      const notFoundCount = result.notFoundIds.length;
      const selectedIssueIdAfterMutation = selectedIssueIdRef.current;

      setSelectedBulkIssueIds([]);
      refreshIssues();

      if (selectedIssueIdAfterMutation) {
        await refreshSelectedIssueDetail(selectedIssueIdAfterMutation);
      }

      setBulkStatusMessage(
        [
          `Changed ${changedCount} issue${changedCount === 1 ? '' : 's'} to ${statusLabels[result.status]}.`,
          unchangedCount > 0
            ? `${unchangedCount} already ${unchangedCount === 1 ? 'was' : 'were'} ${statusLabels[result.status]}.`
            : null,
          notFoundCount > 0 ? `${notFoundCount} missing ${notFoundCount === 1 ? 'id was' : 'ids were'} skipped.` : null,
          duplicateCount > 0
            ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'id was' : 'ids were'} ignored.`
            : null
        ]
          .filter(Boolean)
          .join(' ')
      );
    } catch (error) {
      setBulkStatusError(error instanceof Error ? error.message : 'Bulk status update failed.');
    } finally {
      setIsBulkStatusSubmitting(false);
    }
  }

  async function submitBulkArchiveChange() {
    if (selectedBulkIssueIds.length === 0) {
      setBulkStatusError('Select at least one visible issue.');
      return;
    }

    const issueCount = selectedBulkIssueIds.length;
    const confirmed = window.confirm(`Archive ${issueCount} selected issue${issueCount === 1 ? '' : 's'}?`);

    if (!confirmed) {
      return;
    }

    setIsBulkStatusSubmitting(true);
    setBulkStatusError(null);
    setBulkStatusMessage(null);

    try {
      const result = await bulkArchiveIssues(selectedBulkIssueIds);
      const archivedCount = result.archived.length;
      const unchangedCount = result.unchangedIds.length;
      const duplicateCount = result.duplicateIds.length;
      const notFoundCount = result.notFoundIds.length;
      const archivedIds = new Set(result.archived.map((issue) => issue.id));
      const selectedIssueIdAfterMutation = selectedIssueIdRef.current;

      setSelectedBulkIssueIds([]);
      refreshIssues();

      if (archivedCount > 0) {
        setRecentlyArchivedIssue({
          issues: result.archived.map((issue) => ({ id: issue.id, title: issue.title }))
        });
      }

      if (selectedIssueIdAfterMutation && archivedIds.has(selectedIssueIdAfterMutation)) {
        selectedIssueIdRef.current = null;
        detailReturnFocusRef.current = null;
        setSelectedIssueId(null);
        setSelectedIssue(null);
        setSelectedIssueLoadState('idle');
        writeRouteState(null, dashboardFiltersRef.current, 'replace');
        restoreFocus(null, () => issueListHeadingRef.current);
      } else if (selectedIssueIdAfterMutation) {
        await refreshSelectedIssueDetail(selectedIssueIdAfterMutation);
      }

      setBulkStatusMessage(
        [
          `Archived ${archivedCount} issue${archivedCount === 1 ? '' : 's'}.`,
          unchangedCount > 0 ? `${unchangedCount} already ${unchangedCount === 1 ? 'was' : 'were'} archived.` : null,
          notFoundCount > 0 ? `${notFoundCount} missing ${notFoundCount === 1 ? 'id was' : 'ids were'} skipped.` : null,
          duplicateCount > 0
            ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'id was' : 'ids were'} ignored.`
            : null
        ]
          .filter(Boolean)
          .join(' ')
      );
    } catch (error) {
      setBulkStatusError(error instanceof Error ? error.message : 'Bulk archive failed.');
    } finally {
      setIsBulkStatusSubmitting(false);
    }
  }

  async function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (formValues.title.trim().length === 0) {
      setFormError('Title is required.');
      return;
    }

    if (!activeForm) {
      return;
    }

    let labels: string[];
    let dueDate: string | null;

    try {
      labels = parseLabelsInput(formValues.labels);
      dueDate = parseDueDateInput(formValues.dueDate);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid issue form values');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const payload = {
      title: formValues.title.trim(),
      description: formValues.description.trim(),
      status: formValues.status,
      priority: formValues.priority,
      labels,
      dueDate
    };
    const endpoint = activeForm.mode === 'create' ? '/api/issues' : `/api/issues/${activeForm.issueId}`;
    const method = activeForm.mode === 'create' ? 'POST' : 'PUT';

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Issue save failed');
      }

      const savedIssue = (await response.json()) as Issue;

      if (activeForm.mode === 'create') {
        returnToFirstPage();
      } else {
        refreshIssues();
      }

      if (selectedIssueId === savedIssue.id) {
        setSelectedIssue(savedIssue);
        setSelectedIssueLoadState('loaded');
        await refreshActivity(savedIssue.id);
      }
      cancelForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Issue save failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <DashboardHeader
          totalIssues={totalIssueCount}
          csvExportHref={csvExportHref}
          serviceHealthState={serviceHealthState}
          newIssueButtonRef={newIssueButtonRef}
          importButtonRef={importButtonRef}
          importInputRef={importInputRef}
          onCreateIssue={startCreate}
          onChooseImportFile={handleChooseImportFile}
          onOpenCommandPalette={(trigger) => openCommandPalette(trigger)}
        />

        <CommandPalette
          isOpen={isCommandPaletteOpen}
          searchQuery={commandPaletteQuery}
          onSearchQueryChange={setCommandPaletteQuery}
          searchInputRef={commandPaletteInputRef}
          onRunCommand={runCommandPaletteAction}
          onClose={() => closeCommandPalette()}
          commands={commandPaletteCommands}
        />

        <IssueAuditSummary auditSummary={auditSummary} />

        <IssueStatusSummary statusCounts={statusCounts} />

        {isImportPanelVisible ? (
          <ImportPanel
            fileName={importFileName}
            importPlan={importPlan}
            importPolicy={importPolicy}
            importError={importError}
            importMessage={importMessage}
            isPreviewing={isImportPreviewing}
            isApplying={isImportApplying}
            canApply={canApplyImport}
            onPolicyChange={changeImportPolicy}
            onDownloadReport={downloadImportReport}
            onApply={submitImport}
            onCancel={clearImportState}
          />
        ) : null}

        {activeForm ? (
          <IssueFormPanel
            activeForm={activeForm}
            formValues={formValues}
            setFormValues={setFormValues}
            formError={formError}
            isSubmitting={isSubmitting}
            issueTitleInputRef={issueTitleInputRef}
            onSubmit={submitIssue}
            onCancel={cancelForm}
          />
        ) : null}

        <IssueListPanel
          loadState={loadState}
          loadError={loadError}
          issues={issues}
          filteredIssues={filteredIssues}
          pagination={pagination}
          totalIssueCount={totalIssueCount}
          issueListSummary={issueListSummary}
          hasActiveFilters={hasActiveFilters}
          activeFilterSummaries={activeFilterSummaries}
          searchFilter={searchFilter}
          onSearchFilterChange={handleSearchFilterChange}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={handlePriorityFilterChange}
          labelFilter={labelFilter}
          onLabelFilterChange={handleLabelFilterChange}
          includeArchived={includeArchived}
          onIncludeArchivedChange={handleIncludeArchivedChange}
          blockedOnly={blockedOnly}
          onBlockedOnlyChange={handleBlockedOnlyChange}
          staleOnly={staleOnly}
          onStaleOnlyChange={handleStaleOnlyChange}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
          dashboardDensity={dashboardDensity}
          onDashboardDensityChange={setDashboardDensity}
          savedViews={savedViews}
          selectedSavedViewId={selectedSavedViewId}
          savedViewName={savedViewName}
          savedViewError={savedViewError}
          isSavedViewBusy={isSavedViewBusy}
          onSavedViewSelect={(viewId) => {
            const view = savedViews.find((item) => item.id === viewId);

            setSelectedSavedViewId(viewId);
            setSavedViewName(view?.name ?? '');
            setSavedViewError(null);
          }}
          onSavedViewNameChange={(name) => {
            setSavedViewName(name);
            setSavedViewError(null);
          }}
          onSaveCurrentView={handleSaveCurrentView}
          onApplySavedView={handleApplySavedView}
          onDuplicateSavedView={handleDuplicateSavedView}
          onRenameSavedView={handleRenameSavedView}
          onDeleteSavedView={handleDeleteSavedView}
          issueSearchInputRef={issueSearchInputRef}
          savedViewsDetailsRef={savedViewsDetailsRef}
          savedViewSelectRef={savedViewSelectRef}
          issueListHeadingRef={issueListHeadingRef}
          onClearFilters={handleClearFilters}
          onRetryLoad={refreshIssues}
          onPreviousPage={goToPreviousPage}
          onNextPage={goToNextPage}
          onOpenIssue={openIssue}
          onCopyIssueLink={(issue) => void copyIssueLink(issue, 'list')}
          onEditIssue={startEdit}
          onArchiveIssue={handleArchiveIssue}
          onUnarchiveIssue={handleUnarchiveIssue}
          recentlyArchivedIssue={recentlyArchivedIssue}
          onUndoArchiveIssue={(trigger) => handleUndoArchiveIssue(trigger)}
          onDismissArchiveRecovery={(trigger) => clearArchiveRecovery(trigger)}
          selectedBulkIssueIds={selectedBulkIssueIds}
          bulkStatus={bulkStatus}
          bulkStatusMessage={bulkStatusMessage}
          bulkStatusError={bulkStatusError}
          issueLinkCopyFeedback={issueLinkCopyFeedback}
          isBulkStatusSubmitting={isBulkStatusSubmitting}
          onBulkStatusChange={(status) => {
            setBulkStatus(status);
            setBulkStatusError(null);
          }}
          onToggleIssueSelection={toggleBulkIssueSelection}
          onSelectAllVisibleIssues={selectAllVisibleBulkIssues}
          onClearBulkSelection={clearBulkSelection}
          onApplyBulkStatus={submitBulkStatusChange}
          onApplyBulkArchive={submitBulkArchiveChange}
        />

        <IssueDetailPanel
          isIssueDetailLoading={isIssueDetailLoading}
          isIssueDetailError={isIssueDetailError}
          isMissingSelectedIssue={isMissingSelectedIssue}
          selectedIssue={selectedIssue}
          comments={comments}
          commentHistory={commentHistory}
          commentLoadState={commentLoadState}
          activityEvents={activityEvents}
          activityLoadState={activityLoadState}
          issueDependencies={issueDependencies}
          dependencyLoadState={dependencyLoadState}
          dependencyIssueId={dependencyIssueId}
          setDependencyIssueId={setDependencyIssueId}
          dependencyError={dependencyError}
          isDependencySubmitting={isDependencySubmitting}
          commentBody={commentBody}
          setCommentBody={setCommentBody}
          commentError={commentError}
          isCommentSubmitting={isCommentSubmitting}
          editingCommentId={editingCommentId}
          editCommentBody={editCommentBody}
          setEditCommentBody={setEditCommentBody}
          editCommentError={editCommentError}
          isCommentEditing={isCommentEditing}
          issueDetailHeadingRef={issueDetailHeadingRef}
          missingIssueHeadingRef={missingIssueHeadingRef}
          commentsHeadingRef={commentsHeadingRef}
          editCommentTextareaRef={editCommentTextareaRef}
          dependencyIssueInputRef={dependencyIssueInputRef}
          issueLinkCopyFeedback={issueLinkCopyFeedback}
          onCloseIssueDetail={closeIssueDetail}
          onCopyIssueLink={(issue) => void copyIssueLink(issue, 'detail')}
          onDuplicateIssue={handleDuplicateIssue}
          onArchiveIssue={handleArchiveIssue}
          onUnarchiveIssue={handleUnarchiveIssue}
          onSubmitIssueDependency={submitIssueDependency}
          onRemoveIssueDependency={handleRemoveIssueDependency}
          onSubmitComment={submitComment}
          onStartEditComment={startEditComment}
          onCancelEditComment={(commentId) => cancelEditComment({ commentId })}
          onSubmitCommentEdit={submitCommentEdit}
        />
      </section>
    </main>
  );
}

export default App;
