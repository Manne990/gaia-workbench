import './styles.css';
import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addIssueDependency,
  applyImport,
  archiveIssue,
  createSavedFilterView,
  deleteSavedFilterView,
  fetchCommentHistory,
  fetchIssue,
  fetchIssueActivity,
  fetchIssueDependencies,
  fetchSavedFilterView,
  fetchSavedFilterViews,
  fetchServiceHealth,
  previewImport,
  removeIssueDependency,
  unarchiveIssue,
  updateSavedFilterView
} from './api';
import { DashboardHeader } from './components/DashboardHeader';
import { ImportPanel } from './components/ImportPanel';
import { IssueDetailPanel } from './components/IssueDetailPanel';
import { IssueFormPanel } from './components/IssueFormPanel';
import { IssueListPanel } from './components/IssueListPanel';
import { IssueStatusSummary } from './components/IssueStatusSummary';
import { CommandPalette } from './components/CommandPalette';
import { emptyFormValues } from './constants';
import { useIssueDirectory } from './hooks/useIssueDirectory';
import type {
  ActiveForm,
  ActivityEvent,
  CancelOptions,
  Comment,
  CommentEditCancelOptions,
  CommentEditHistory,
  CommentLoadState,
  DashboardDensity,
  DashboardFilters,
  ImportConflictPolicy,
  ImportPlan,
  Issue,
  IssueDependencyState,
  IssueDetailLoadState,
  IssueFormValues,
  PriorityFilter,
  SavedFilterView,
  ServiceHealthState,
  StatusFilter
} from './types';
import { restoreFocus } from './utils/focus';
import { parseDueDateInput, parseLabelsInput } from './utils/parse';
import { defaultDashboardFilters, getRouteStateFromLocation, writeRoute } from './utils/routing';

const DEFAULT_IMPORT_POLICY: ImportConflictPolicy = 'skip-conflicts';

function importReadyMessage(plan: ImportPlan): string {
  return `Ready to create ${plan.summary.toCreate.issues} issues, replace ${plan.summary.toReplace.issues} changed issues, and skip ${plan.summary.skip.issues}.`;
}

function importAppliedMessage(plan: ImportPlan): string {
  return `Import applied: ${plan.summary.toCreate.issues} issues created, ${plan.summary.toReplace.issues} changed issues replaced, ${plan.summary.skip.issues} skipped.`;
}

export function App() {
  const initialRouteStateRef = useRef<{
    issueId: string | null;
    filters: DashboardFilters;
  } | null>(null);

  if (!initialRouteStateRef.current) {
    initialRouteStateRef.current = getRouteStateFromLocation();
  }

  const {
    issues,
    loadState,
    searchFilter,
    setSearchFilter,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    includeArchived,
    setIncludeArchived,
    blockedOnly,
    setBlockedOnly,
    pageSize,
    setPageSize,
    filteredIssues,
    pagination,
    totalIssueCount,
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
  } = useIssueDirectory(initialRouteStateRef.current.filters);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    () => initialRouteStateRef.current?.issueId ?? null
  );
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [selectedIssueLoadState, setSelectedIssueLoadState] = useState<IssueDetailLoadState>('idle');
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [formValues, setFormValues] = useState<IssueFormValues>(emptyFormValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentHistory, setCommentHistory] = useState<Record<string, CommentEditHistory[]>>({});
  const [commentLoadState, setCommentLoadState] = useState<CommentLoadState>('idle');
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoadState, setActivityLoadState] = useState<CommentLoadState>('idle');
  const [issueDependencies, setIssueDependencies] = useState<IssueDependencyState | null>(null);
  const [dependencyLoadState, setDependencyLoadState] = useState<CommentLoadState>('idle');
  const [dependencyIssueId, setDependencyIssueId] = useState('');
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [isDependencySubmitting, setIsDependencySubmitting] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [editCommentError, setEditCommentError] = useState<string | null>(null);
  const [isCommentEditing, setIsCommentEditing] = useState(false);
  const [importPayload, setImportPayload] = useState<unknown | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importPolicy, setImportPolicy] = useState<ImportConflictPolicy>(DEFAULT_IMPORT_POLICY);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImportPreviewing, setIsImportPreviewing] = useState(false);
  const [isImportApplying, setIsImportApplying] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('');
  const [savedViewName, setSavedViewName] = useState('');
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const [isSavedViewBusy, setIsSavedViewBusy] = useState(false);
  const [dashboardDensity, setDashboardDensity] = useState<DashboardDensity>('comfortable');
  const [serviceHealthState, setServiceHealthState] = useState<ServiceHealthState>('checking');
  const newIssueButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const issueSearchInputRef = useRef<HTMLInputElement>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement>(null);
  const issueListHeadingRef = useRef<HTMLHeadingElement>(null);
  const issueTitleInputRef = useRef<HTMLInputElement>(null);
  const issueDetailHeadingRef = useRef<HTMLHeadingElement>(null);
  const missingIssueHeadingRef = useRef<HTMLHeadingElement>(null);
  const commentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const editCommentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const formReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const commentEditReturnFocusRef = useRef<HTMLElement | null>(null);
  const commandPaletteFocusReturnRef = useRef<HTMLElement | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const didCanonicalizeInitialRouteRef = useRef(false);

  const dashboardFilters: DashboardFilters = {
    search: searchFilter,
    status: statusFilter,
    priority: priorityFilter,
    includeArchived,
    blockedOnly,
    pageSize
  };
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
        id: 'open-first-visible-issue',
        label: 'Open first visible issue',
        description: 'Open the first issue in the current list',
        commandHint: 'Enter',
        disabled: filteredIssues.length === 0
      },
      {
        id: 'clear-active-filters',
        label: 'Clear active filters',
        description: 'Reset search and all dashboard filters',
        commandHint: 'C',
        disabled: !hasActiveFilters
      },
      {
        id: 'close-issue-detail',
        label: 'Close issue detail',
        description: 'Close issue detail panel',
        commandHint: 'Esc',
        disabled: !selectedIssueId
      }
    ],
    [filteredIssues.length, hasActiveFilters, selectedIssueId]
  );

  const isIssueDetailLoading = Boolean(selectedIssueId && selectedIssueLoadState === 'loading' && !selectedIssue);
  const isIssueDetailError = Boolean(selectedIssueId && selectedIssueLoadState === 'error' && !selectedIssue);
  const isMissingSelectedIssue = selectedIssueLoadState === 'not_found';
  const isImportPanelVisible = Boolean(
    importFileName || importPlan || importError || isImportPreviewing || importMessage
  );
  const canApplyImport = Boolean(importPayload && importPlan?.valid && !isImportApplying);

  function openCommandPalette(trigger?: HTMLElement | null) {
    if (isCommandPaletteOpen) {
      return;
    }

    setCommandPaletteQuery('');
    commandPaletteFocusReturnRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    setIsCommandPaletteOpen(true);
  }

  function closeCommandPalette(options: { restoreFocus?: boolean } = {}) {
    const { restoreFocus = true } = options;

    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery('');

    if (restoreFocus) {
      restoreFocusRef(commandPaletteFocusReturnRef.current);
    }

    commandPaletteFocusReturnRef.current = null;
  }

  function restoreFocusRef(element: HTMLElement | null) {
    restoreFocus(element, () => newIssueButtonRef.current ?? issueListHeadingRef.current);
  }

  function runCommandPaletteAction(commandId: string) {
    if (commandId === 'new-issue') {
      closeCommandPalette({ restoreFocus: false });
      startCreate();
      return;
    }

    if (commandId === 'focus-issue-search') {
      closeCommandPalette({ restoreFocus: false });
      issueSearchInputRef.current?.focus();
      return;
    }

    if (commandId === 'open-first-visible-issue') {
      const firstIssue = filteredIssues[0];

      if (!firstIssue) {
        closeCommandPalette();
        return;
      }

      closeCommandPalette({ restoreFocus: false });
      openIssue(firstIssue);
      return;
    }

    if (commandId === 'clear-active-filters') {
      closeCommandPalette({ restoreFocus: false });
      handleClearFilters();
      return;
    }

    if (commandId === 'close-issue-detail' && selectedIssueId) {
      closeCommandPalette({ restoreFocus: false });
      closeIssueDetail();
      return;
    }

    closeCommandPalette();
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

      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable ||
        target?.contentEditable === 'true';

      if (isEditableTarget) {
        return;
      }

      event.preventDefault();

      if (isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
        setCommandPaletteQuery('');
        restoreFocusRef(commandPaletteFocusReturnRef.current);
        commandPaletteFocusReturnRef.current = null;
        return;
      }

      setCommandPaletteQuery('');
      commandPaletteFocusReturnRef.current = target ?? (document.activeElement as HTMLElement | null);
      setIsCommandPaletteOpen(true);
    }

    window.addEventListener('keydown', handlePaletteShortcut);

    return () => {
      window.removeEventListener('keydown', handlePaletteShortcut);
    };
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (didCanonicalizeInitialRouteRef.current) {
      return;
    }

    didCanonicalizeInitialRouteRef.current = true;
    writeRoute(selectedIssueId, dashboardFilters, 'replace');
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

    async function loadSavedViews() {
      try {
        setSavedViews(await fetchSavedFilterViews(controller.signal));
      } catch {
        if (!controller.signal.aborted) {
          setSavedViewError('Unable to load saved views.');
        }
      }
    }

    void loadSavedViews();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    function syncSelectedIssueFromLocation() {
      const routeState = getRouteStateFromLocation();

      detailReturnFocusRef.current = null;
      setDashboardFilters(routeState.filters);
      setSelectedIssueId(routeState.issueId);
    }

    window.addEventListener('popstate', syncSelectedIssueFromLocation);

    return () => window.removeEventListener('popstate', syncSelectedIssueFromLocation);
  }, []);

  function writeDashboardRoute(filters: DashboardFilters, mode: 'push' | 'replace') {
    writeRoute(selectedIssueId, filters, mode);
  }

  function handleSearchFilterChange(value: string) {
    const nextFilters = { ...dashboardFilters, search: value };

    setSearchFilter(value);
    writeDashboardRoute(nextFilters, 'replace');
  }

  function handleStatusFilterChange(value: StatusFilter) {
    const nextFilters = { ...dashboardFilters, status: value };

    setStatusFilter(value);
    writeDashboardRoute(nextFilters, 'push');
  }

  function handlePriorityFilterChange(value: PriorityFilter) {
    const nextFilters = { ...dashboardFilters, priority: value };

    setPriorityFilter(value);
    writeDashboardRoute(nextFilters, 'push');
  }

  function handleIncludeArchivedChange(value: boolean) {
    const nextFilters = { ...dashboardFilters, includeArchived: value };

    setIncludeArchived(value);
    writeDashboardRoute(nextFilters, 'push');
  }

  function handleBlockedOnlyChange(value: boolean) {
    const nextFilters = { ...dashboardFilters, blockedOnly: value };

    setBlockedOnly(value);
    writeDashboardRoute(nextFilters, 'push');
  }

  function handlePageSizeChange(value: number) {
    const nextFilters = { ...dashboardFilters, pageSize: value };

    setPageSize(value);
    writeDashboardRoute(nextFilters, 'push');
  }

  function handleClearFilters() {
    clearFilters();
    writeRoute(null, defaultDashboardFilters, 'replace');
    setSelectedIssueId(null);
    setSelectedIssue(null);
    setSelectedIssueLoadState('idle');
    detailReturnFocusRef.current = null;
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

  async function handleSaveCurrentView() {
    const name = savedViewName.trim();

    if (!name) {
      setSavedViewError('Saved view name is required.');
      return;
    }

    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      upsertSavedView(
        await createSavedFilterView({
          name,
          ...dashboardFilters
        })
      );
    } catch (error) {
      setSavedViewError(error instanceof Error ? error.message : 'Saved view create failed.');
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  async function handleApplySavedView() {
    if (!selectedSavedViewId) {
      setSavedViewError('Choose a saved view to apply.');
      return;
    }

    setIsSavedViewBusy(true);
    setSavedViewError(null);

    try {
      const view = await fetchSavedFilterView(selectedSavedViewId);
      const nextFilters: DashboardFilters = {
        search: view.search,
        status: view.status,
        priority: view.priority,
        includeArchived: view.includeArchived,
        blockedOnly: view.blockedOnly,
        pageSize: view.pageSize
      };

      upsertSavedView(view);
      setDashboardFilters(nextFilters);
      writeRoute(selectedIssueId, nextFilters, 'push');
    } catch (error) {
      setSavedViewError(error instanceof Error ? error.message : 'Saved view apply failed.');
      setSavedViews((current) => current.filter((view) => view.id !== selectedSavedViewId));
      setSelectedSavedViewId('');
    } finally {
      setIsSavedViewBusy(false);
    }
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
      setSavedViewError(error instanceof Error ? error.message : 'Saved view rename failed.');
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
      setSelectedSavedViewId('');
      setSavedViewName('');
    } catch (error) {
      setSavedViewError(error instanceof Error ? error.message : 'Saved view delete failed.');
    } finally {
      setIsSavedViewBusy(false);
    }
  }

  function resetImportInput() {
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
  }

  function clearImportState() {
    setImportPayload(null);
    setImportFileName(null);
    setImportPlan(null);
    setImportPolicy(DEFAULT_IMPORT_POLICY);
    setImportError(null);
    setImportMessage(null);
    setIsImportPreviewing(false);
    setIsImportApplying(false);
    resetImportInput();
  }

  async function handleChooseImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setImportPayload(null);
    setImportFileName(file.name);
    setImportPlan(null);
    setImportPolicy(DEFAULT_IMPORT_POLICY);
    setImportError(null);
    setImportMessage(null);
    setIsImportPreviewing(true);

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const plan = await previewImport(payload, DEFAULT_IMPORT_POLICY);

      setImportPayload(payload);
      setImportPlan(plan);
      setImportError(plan.valid ? null : 'Import preview found validation errors.');
      setImportMessage(plan.valid ? importReadyMessage(plan) : null);
    } catch (error) {
      setImportPayload(null);
      setImportPlan(null);
      setImportError(error instanceof SyntaxError ? 'File is not valid JSON.' : 'Import preview failed.');
    } finally {
      setIsImportPreviewing(false);
      resetImportInput();
    }
  }

  async function submitImport() {
    if (!importPayload) {
      return;
    }

    setIsImportApplying(true);
    setImportError(null);

    try {
      const plan = await applyImport(importPayload, importPolicy);

      setImportPlan(plan);

      if (!plan.valid) {
        setImportError('Import apply found validation errors.');
        return;
      }

      setImportPayload(null);
      setImportMessage(importAppliedMessage(plan));
      returnToFirstPage();
    } catch {
      setImportError('Import apply failed.');
    } finally {
      setIsImportApplying(false);
      resetImportInput();
    }
  }

  async function changeImportPolicy(nextPolicy: ImportConflictPolicy) {
    setImportPolicy(nextPolicy);

    if (!importPayload) {
      return;
    }

    setIsImportPreviewing(true);
    setImportError(null);
    setImportMessage(null);

    try {
      const plan = await previewImport(importPayload, nextPolicy);

      setImportPlan(plan);
      setImportError(plan.valid ? null : 'Import preview found validation errors.');
      setImportMessage(plan.valid ? importReadyMessage(plan) : null);
    } catch {
      setImportError('Import preview failed.');
    } finally {
      setIsImportPreviewing(false);
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
      setComments([]);
      setCommentHistory({});
      setCommentLoadState('idle');
      setActivityEvents([]);
      setActivityLoadState('idle');
      setIssueDependencies(null);
      setDependencyLoadState('idle');
      setDependencyIssueId('');
      setDependencyError(null);
      return;
    }

    const issueId = selectedIssue.id;
    const controller = new AbortController();

    async function loadIssueDetailData() {
      setCommentLoadState('loading');
      setActivityLoadState('loading');
      setDependencyLoadState('loading');
      setCommentError(null);
      setDependencyError(null);
      setEditingCommentId(null);
      setEditCommentError(null);

      try {
        const [commentsResponse, loadedActivityEvents, loadedIssueDependencies] = await Promise.all([
          fetch(`/api/issues/${issueId}/comments`, {
            signal: controller.signal
          }),
          fetchIssueActivity(issueId, controller.signal),
          fetchIssueDependencies(issueId, controller.signal)
        ]);

        if (!commentsResponse.ok) {
          throw new Error('Comment request failed');
        }

        const loadedComments = (await commentsResponse.json()) as Comment[];
        const historyPairs = await Promise.all(
          loadedComments.map(async (comment) => {
            const history = await fetchCommentHistory(comment.id, controller.signal).catch(() => []);
            return [comment.id, history] as const;
          })
        );

        if (controller.signal.aborted) {
          return;
        }

        setComments(loadedComments);
        setCommentHistory(Object.fromEntries(historyPairs));
        setActivityEvents(loadedActivityEvents);
        setIssueDependencies(loadedIssueDependencies);
        setCommentLoadState('loaded');
        setActivityLoadState('loaded');
        setDependencyLoadState('loaded');
      } catch {
        if (!controller.signal.aborted) {
          setCommentLoadState('error');
          setActivityLoadState('error');
          setDependencyLoadState('error');
        }
      }
    }

    void loadIssueDetailData();

    return () => controller.abort();
  }, [selectedIssueId, selectedIssue?.id]);

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
    writeRoute(issue.id, dashboardFilters, 'push');
    setSelectedIssueId(issue.id);
    cancelForm({ restoreFocus: false });
  }

  function closeIssueDetail() {
    const returnFocusTarget = detailReturnFocusRef.current;

    setSelectedIssueId(null);
    setSelectedIssue(null);
    setSelectedIssueLoadState('idle');
    writeRoute(null, dashboardFilters, detailReturnFocusRef.current ? 'replace' : 'push');
    setCommentBody('');
    setCommentError(null);
    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);
    restoreFocus(returnFocusTarget, () => issueListHeadingRef.current);
    detailReturnFocusRef.current = null;
  }

  async function refreshActivity(issueId: string) {
    setActivityLoadState('loading');

    try {
      setActivityEvents(await fetchIssueActivity(issueId));
      setActivityLoadState('loaded');
    } catch {
      setActivityLoadState('error');
    }
  }

  async function refreshSelectedIssueAfterDependency(issueId: string, dependencies: IssueDependencyState) {
    setIssueDependencies(dependencies);
    setDependencyLoadState('loaded');

    const refreshedIssue = await fetchIssue(issueId);

    if (refreshedIssue) {
      setSelectedIssue(refreshedIssue);
      setSelectedIssueLoadState('loaded');
    }

    refreshIssues();
    await refreshActivity(issueId);
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

    setIsDependencySubmitting(true);
    setDependencyError(null);

    try {
      const dependencies = await addIssueDependency(selectedIssue.id, dependsOnIssueId);

      setDependencyIssueId('');
      await refreshSelectedIssueAfterDependency(selectedIssue.id, dependencies);
    } catch (error) {
      setDependencyError(error instanceof Error ? error.message : 'Dependency add failed.');
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
      setDependencyError(error instanceof Error ? error.message : 'Dependency remove failed.');
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

  async function handleUnarchiveIssue(issue: Issue, trigger: HTMLElement) {
    try {
      const restoredIssue = await unarchiveIssue(issue.id);

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

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = commentBody.trim();

    if (body.length === 0) {
      setCommentError('Comment is required.');
      return;
    }

    if (!selectedIssue) {
      return;
    }

    setIsCommentSubmitting(true);
    setCommentError(null);

    try {
      const response = await fetch(`/api/issues/${selectedIssue.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(responseBody?.error ?? 'Comment save failed');
      }

      const savedComment = (await response.json()) as Comment;
      setComments((current) => [...current, savedComment]);
      setCommentHistory((current) => ({ ...current, [savedComment.id]: [] }));
      await refreshActivity(savedComment.issueId);
      setCommentBody('');
      setCommentLoadState('loaded');
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Comment save failed');
    } finally {
      setIsCommentSubmitting(false);
    }
  }

  function getCommentEditButton(commentId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-comment-edit-button="${commentId}"]`);
  }

  function startEditComment(comment: Comment, trigger?: HTMLElement) {
    commentEditReturnFocusRef.current = trigger ?? null;
    setEditingCommentId(comment.id);
    setEditCommentBody(comment.body);
    setEditCommentError(null);
  }

  function cancelEditComment(options: CommentEditCancelOptions = {}) {
    const shouldRestoreFocus = options.restoreFocus ?? true;
    const commentId = options.commentId ?? editingCommentId;
    const returnFocusTarget = commentEditReturnFocusRef.current;

    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);

    if (shouldRestoreFocus) {
      restoreFocus(returnFocusTarget, () =>
        commentId ? (getCommentEditButton(commentId) ?? commentsHeadingRef.current) : commentsHeadingRef.current
      );
    }

    commentEditReturnFocusRef.current = null;
  }

  async function submitCommentEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = editCommentBody.trim();

    if (body.length === 0) {
      setEditCommentError('Comment is required.');
      return;
    }

    if (!editingCommentId) {
      return;
    }

    const commentId = editingCommentId;

    setIsCommentEditing(true);
    setEditCommentError(null);

    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(responseBody?.error ?? 'Comment update failed');
      }

      const savedComment = (await response.json()) as Comment;
      const history = await fetchCommentHistory(savedComment.id);
      setComments((current) => current.map((comment) => (comment.id === savedComment.id ? savedComment : comment)));
      setCommentHistory((current) => ({ ...current, [savedComment.id]: history }));
      await refreshActivity(savedComment.issueId);
      cancelEditComment({ commentId });
    } catch (error) {
      setEditCommentError(error instanceof Error ? error.message : 'Comment update failed');
    } finally {
      setIsCommentEditing(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <DashboardHeader
          totalIssues={totalIssueCount}
          serviceHealthState={serviceHealthState}
          newIssueButtonRef={newIssueButtonRef}
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
          includeArchived={includeArchived}
          onIncludeArchivedChange={handleIncludeArchivedChange}
          blockedOnly={blockedOnly}
          onBlockedOnlyChange={handleBlockedOnlyChange}
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
          onRenameSavedView={handleRenameSavedView}
          onDeleteSavedView={handleDeleteSavedView}
          issueSearchInputRef={issueSearchInputRef}
          issueListHeadingRef={issueListHeadingRef}
          onClearFilters={handleClearFilters}
          onPreviousPage={goToPreviousPage}
          onNextPage={goToNextPage}
          onOpenIssue={openIssue}
          onEditIssue={startEdit}
          onArchiveIssue={handleArchiveIssue}
          onUnarchiveIssue={handleUnarchiveIssue}
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
          onCloseIssueDetail={closeIssueDetail}
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
