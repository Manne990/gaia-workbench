import './styles.css';
import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { applyImport, fetchCommentHistory, fetchIssue, fetchIssueActivity, previewImport } from './api';
import { DashboardHeader } from './components/DashboardHeader';
import { ImportPanel } from './components/ImportPanel';
import { IssueDetailPanel } from './components/IssueDetailPanel';
import { IssueFormPanel } from './components/IssueFormPanel';
import { IssueListPanel } from './components/IssueListPanel';
import { IssueStatusSummary } from './components/IssueStatusSummary';
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
  DashboardFilters,
  Issue,
  IssueDetailLoadState,
  IssueFormValues,
  ImportPlan,
  PriorityFilter,
  StatusFilter,
} from './types';
import { restoreFocus } from './utils/focus';
import { parseDueDateInput, parseLabelsInput } from './utils/parse';
import { defaultDashboardFilters, getRouteStateFromLocation, writeRoute } from './utils/routing';

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
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImportPreviewing, setIsImportPreviewing] = useState(false);
  const [isImportApplying, setIsImportApplying] = useState(false);
  const newIssueButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const issueListHeadingRef = useRef<HTMLHeadingElement>(null);
  const issueTitleInputRef = useRef<HTMLInputElement>(null);
  const issueDetailHeadingRef = useRef<HTMLHeadingElement>(null);
  const missingIssueHeadingRef = useRef<HTMLHeadingElement>(null);
  const commentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const editCommentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const formReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const commentEditReturnFocusRef = useRef<HTMLElement | null>(null);
  const didCanonicalizeInitialRouteRef = useRef(false);

  const dashboardFilters: DashboardFilters = {
    search: searchFilter,
    status: statusFilter,
    priority: priorityFilter
  };

  const isIssueDetailLoading = Boolean(
    selectedIssueId && selectedIssueLoadState === 'loading' && !selectedIssue
  );
  const isIssueDetailError = Boolean(
    selectedIssueId && selectedIssueLoadState === 'error' && !selectedIssue
  );
  const isMissingSelectedIssue = selectedIssueLoadState === 'not_found';
  const isImportPanelVisible = Boolean(
    importFileName || importPlan || importError || isImportPreviewing || importMessage
  );
  const canApplyImport = Boolean(importPayload && importPlan?.valid && !isImportApplying);

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
    if (didCanonicalizeInitialRouteRef.current) {
      return;
    }

    didCanonicalizeInitialRouteRef.current = true;
    writeRoute(selectedIssueId, dashboardFilters, 'replace');
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

  function handleClearFilters() {
    clearFilters();
    writeRoute(null, defaultDashboardFilters, 'replace');
    setSelectedIssueId(null);
    setSelectedIssue(null);
    setSelectedIssueLoadState('idle');
    detailReturnFocusRef.current = null;
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
    setImportError(null);
    setImportMessage(null);
    setIsImportPreviewing(true);

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const plan = await previewImport(payload);

      setImportPayload(payload);
      setImportPlan(plan);
      setImportError(plan.valid ? null : 'Import preview found validation errors.');
      setImportMessage(
        plan.valid
          ? `Ready to create ${plan.summary.toCreate.issues} issues and skip ${plan.summary.skip.issues}.`
          : null
      );
    } catch (error) {
      setImportPayload(null);
      setImportPlan(null);
      setImportError(
        error instanceof SyntaxError ? 'File is not valid JSON.' : 'Import preview failed.'
      );
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
      const plan = await applyImport(importPayload);

      setImportPlan(plan);

      if (!plan.valid) {
        setImportError('Import apply found validation errors.');
        return;
      }

      setImportPayload(null);
      setImportMessage(
        `Import applied: ${plan.summary.toCreate.issues} issues created, ${plan.summary.skip.issues} skipped.`
      );
      returnToFirstPage();
    } catch {
      setImportError('Import apply failed.');
    } finally {
      setIsImportApplying(false);
      resetImportInput();
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
      } catch (error) {
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
      return;
    }

    const issueId = selectedIssue.id;
    const controller = new AbortController();

    async function loadIssueDetailData() {
      setCommentLoadState('loading');
      setActivityLoadState('loading');
      setCommentError(null);
      setEditingCommentId(null);
      setEditCommentError(null);

      try {
        const [commentsResponse, loadedActivityEvents] = await Promise.all([
          fetch(`/api/issues/${issueId}/comments`, {
            signal: controller.signal
          }),
          fetchIssueActivity(issueId, controller.signal)
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
        setCommentLoadState('loaded');
        setActivityLoadState('loaded');
      } catch (error) {
        if (!controller.signal.aborted) {
          setCommentLoadState('error');
          setActivityLoadState('error');
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
    const endpoint =
      activeForm.mode === 'create' ? '/api/issues' : `/api/issues/${activeForm.issueId}`;
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
        commentId
          ? getCommentEditButton(commentId) ?? commentsHeadingRef.current
          : commentsHeadingRef.current
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
      setComments((current) =>
        current.map((comment) => (comment.id === savedComment.id ? savedComment : comment))
      );
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
          newIssueButtonRef={newIssueButtonRef}
          importInputRef={importInputRef}
          onCreateIssue={startCreate}
          onChooseImportFile={handleChooseImportFile}
        />

        <IssueStatusSummary statusCounts={statusCounts} />

        {isImportPanelVisible ? (
          <ImportPanel
            fileName={importFileName}
            importPlan={importPlan}
            importError={importError}
            importMessage={importMessage}
            isPreviewing={isImportPreviewing}
            isApplying={isImportApplying}
            canApply={canApplyImport}
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
          issueListHeadingRef={issueListHeadingRef}
          onClearFilters={handleClearFilters}
          onPreviousPage={goToPreviousPage}
          onNextPage={goToNextPage}
          onOpenIssue={openIssue}
          onEditIssue={startEdit}
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
