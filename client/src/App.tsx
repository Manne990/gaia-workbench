import './styles.css';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';
type IssuePriority = 'low' | 'medium' | 'high';

type Issue = {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string[];
  dueDate: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
};

type Comment = {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type CommentEditHistory = {
  id: string;
  commentId: string;
  previousBody: string;
  newBody: string;
  editedAt: string;
};

type ActivityEventType =
  | 'issue_created'
  | 'issue_title_changed'
  | 'issue_description_changed'
  | 'issue_status_changed'
  | 'issue_priority_changed'
  | 'issue_due_date_changed'
  | 'issue_labels_changed'
  | 'comment_added'
  | 'comment_edited';

type ActivityMetadataValue = string | string[] | null;

type ActivityEvent = {
  id: string;
  issueId: string;
  type: ActivityEventType;
  metadata: Record<string, ActivityMetadataValue>;
  createdAt: string;
};

type LoadState = 'loading' | 'loaded' | 'error';
type CommentLoadState = LoadState | 'idle';
type FormMode = 'create' | 'edit';

type IssueFormValues = {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string;
  dueDate: string;
};

type ActiveForm = {
  mode: FormMode;
  issueId?: string;
};

type CancelOptions = {
  restoreFocus?: boolean;
};

type CommentEditCancelOptions = CancelOptions & {
  commentId?: string;
};

type StatusFilter = 'all' | IssueStatus;
type PriorityFilter = 'all' | IssuePriority;

type ActiveFilterSummary = {
  key: string;
  label: string;
  value: string;
};

const statusLabels: Record<IssueStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done'
};

const priorityLabels: Record<IssuePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

const statusOrder: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];
const priorityOrder: IssuePriority[] = ['low', 'medium', 'high'];

const emptyFormValues: IssueFormValues = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  labels: '',
  dueDate: ''
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatDueDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(year, month - 1, day));
}

async function fetchCommentHistory(
  commentId: string,
  signal?: AbortSignal
): Promise<CommentEditHistory[]> {
  const response = await fetch(`/api/comments/${commentId}/history`, { signal });

  if (!response.ok) {
    throw new Error('Comment history request failed');
  }

  return (await response.json()) as CommentEditHistory[];
}

async function fetchIssueActivity(issueId: string, signal?: AbortSignal): Promise<ActivityEvent[]> {
  const response = await fetch(`/api/issues/${issueId}/activity`, { signal });

  if (!response.ok) {
    throw new Error('Activity request failed');
  }

  return (await response.json()) as ActivityEvent[];
}

function parseLabelsInput(value: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const rawLabel of value.split(',')) {
    const label = rawLabel.trim();

    if (!label) {
      continue;
    }

    if (label.length > 32) {
      throw new Error('Labels must be 32 characters or fewer.');
    }

    const key = label.toLowerCase();

    if (!seen.has(key)) {
      labels.push(label);
      seen.add(key);
    }
  }

  return labels;
}

function parseDueDateInput(value: string): string | null {
  const dueDate = value.trim();

  if (!dueDate) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('Due date must be a valid date.');
  }

  const [year, month, day] = dueDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isRealDate) {
    throw new Error('Due date must be a valid date.');
  }

  return dueDate;
}

function metadataText(event: ActivityEvent, key: string): string | null {
  const value = event.metadata[key];
  return typeof value === 'string' ? value : null;
}

function metadataList(event: ActivityEvent, key: string): string[] {
  const value = event.metadata[key];
  return Array.isArray(value) ? value : [];
}

function formatOptionalText(value: string | null): string {
  return value && value.trim().length > 0 ? value : 'empty';
}

function formatStatusValue(value: string | null): string {
  return value && value in statusLabels ? statusLabels[value as IssueStatus] : formatOptionalText(value);
}

function formatPriorityValue(value: string | null): string {
  return value && value in priorityLabels ? priorityLabels[value as IssuePriority] : formatOptionalText(value);
}

function formatDueDateValue(value: string | null): string {
  return value ? formatDueDate(value) : 'No due date';
}

function formatLabelList(labels: string[]): string {
  return labels.length > 0 ? labels.join(', ') : 'No labels';
}

function restoreFocus(element: HTMLElement | null, fallback?: () => HTMLElement | null): void {
  window.setTimeout(() => {
    const target = element?.isConnected ? element : fallback?.();
    target?.focus();
  }, 0);
}

function getIssueIdFromPath(pathname: string): string | null {
  const match = /^\/issues\/([^/]+)\/?$/.exec(pathname);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function getIssueIdFromLocation(): string | null {
  return getIssueIdFromPath(window.location.pathname);
}

function buildIssuePath(issueId: string): string {
  return `/issues/${encodeURIComponent(issueId)}`;
}

function pushIssuePath(issueId: string | null) {
  const nextPath = issueId ? buildIssuePath(issueId) : '/';

  if (window.location.pathname !== nextPath || window.location.search || window.location.hash) {
    window.history.pushState(null, '', nextPath);
  }
}

function activityTitle(event: ActivityEvent): string {
  switch (event.type) {
    case 'issue_created':
      return 'Issue created';
    case 'issue_title_changed':
      return 'Title changed';
    case 'issue_description_changed':
      return 'Description changed';
    case 'issue_status_changed':
      return 'Status changed';
    case 'issue_priority_changed':
      return 'Priority changed';
    case 'issue_due_date_changed':
      return 'Due date changed';
    case 'issue_labels_changed':
      return 'Labels changed';
    case 'comment_added':
      return 'Comment added';
    case 'comment_edited':
      return 'Comment edited';
    default:
      return 'Activity recorded';
  }
}

function activityDetail(event: ActivityEvent): string {
  const from = metadataText(event, 'from');
  const to = metadataText(event, 'to');

  switch (event.type) {
    case 'issue_created':
      return `Created ${formatOptionalText(metadataText(event, 'title'))}.`;
    case 'issue_title_changed':
      return `${formatOptionalText(from)} -> ${formatOptionalText(to)}`;
    case 'issue_description_changed':
      return `${formatOptionalText(from)} -> ${formatOptionalText(to)}`;
    case 'issue_status_changed':
      return `${formatStatusValue(from)} -> ${formatStatusValue(to)}`;
    case 'issue_priority_changed':
      return `${formatPriorityValue(from)} -> ${formatPriorityValue(to)}`;
    case 'issue_due_date_changed':
      return `${formatDueDateValue(from)} -> ${formatDueDateValue(to)}`;
    case 'issue_labels_changed':
      return `${formatLabelList(metadataList(event, 'from'))} -> ${formatLabelList(metadataList(event, 'to'))}`;
    case 'comment_added':
      return `Added "${formatOptionalText(metadataText(event, 'preview'))}".`;
    case 'comment_edited':
      return `${formatOptionalText(metadataText(event, 'previousPreview'))} -> ${formatOptionalText(
        metadataText(event, 'newPreview')
      )}`;
    default:
      return 'Activity details are not available.';
  }
}

export function App() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(() => getIssueIdFromLocation());
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
  const newIssueButtonRef = useRef<HTMLButtonElement>(null);
  const issueListHeadingRef = useRef<HTMLHeadingElement>(null);
  const issueTitleInputRef = useRef<HTMLInputElement>(null);
  const issueDetailHeadingRef = useRef<HTMLHeadingElement>(null);
  const missingIssueHeadingRef = useRef<HTMLHeadingElement>(null);
  const commentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const editCommentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const formReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const commentEditReturnFocusRef = useRef<HTMLElement | null>(null);

  const selectedIssue = useMemo(() => {
    return issues.find((issue) => issue.id === selectedIssueId) ?? null;
  }, [issues, selectedIssueId]);
  const isMissingSelectedIssue = Boolean(selectedIssueId && loadState === 'loaded' && !selectedIssue);

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
    function syncSelectedIssueFromLocation() {
      detailReturnFocusRef.current = null;
      setSelectedIssueId(getIssueIdFromLocation());
    }

    window.addEventListener('popstate', syncSelectedIssueFromLocation);

    return () => window.removeEventListener('popstate', syncSelectedIssueFromLocation);
  }, []);

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

  useEffect(() => {
    if (!selectedIssueId) {
      setComments([]);
      setCommentHistory({});
      setCommentLoadState('idle');
      setActivityEvents([]);
      setActivityLoadState('idle');
      return;
    }

    const issueId = selectedIssueId;
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
  }, [selectedIssueId]);

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
    pushIssuePath(issue.id);
    setSelectedIssueId(issue.id);
    cancelForm({ restoreFocus: false });
  }

  function closeIssueDetail() {
    const returnFocusTarget = detailReturnFocusRef.current;

    setSelectedIssueId(null);
    pushIssuePath(null);
    setCommentBody('');
    setCommentError(null);
    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);
    restoreFocus(returnFocusTarget, () => issueListHeadingRef.current);
    detailReturnFocusRef.current = null;
  }

  function clearFilters() {
    setSearchFilter('');
    setStatusFilter('all');
    setPriorityFilter('all');
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
      setIssues((current) =>
        activeForm.mode === 'create'
          ? [savedIssue, ...current]
          : current.map((issue) => (issue.id === savedIssue.id ? savedIssue : issue))
      );
      setLoadState('loaded');
      if (selectedIssueId === savedIssue.id) {
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
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">TinyTracker</p>
            <h1>Dashboard</h1>
          </div>
          <div className="header-actions">
            <a className="button-link secondary-button" href="/api/export" download="tinytracker-export.json">
              Download JSON
            </a>
            <button
              type="button"
              className="primary-button"
              ref={newIssueButtonRef}
              onClick={(event) => startCreate(event.currentTarget)}
            >
              New Issue
            </button>
            <div className="total-summary" aria-label="Issue totals">
              <span>Total Issues</span>
              <strong>{issues.length}</strong>
            </div>
          </div>
        </header>

        <div className="status-grid" aria-label="Issue status summary">
          {statusCounts.map(({ status, count }) => (
            <article key={status}>
              <span>{statusLabels[status]}</span>
              <strong>{count}</strong>
            </article>
          ))}
        </div>

        {activeForm ? (
          <section className="form-panel" aria-labelledby="issue-form-heading">
            <div className="panel-header">
              <div>
                <h2 id="issue-form-heading">
                  {activeForm.mode === 'create' ? 'Create Issue' : 'Edit Issue'}
                </h2>
                <p>{activeForm.mode === 'create' ? 'New tracker item' : 'Update tracker item'}</p>
              </div>
            </div>

            <form className="issue-form" aria-label="Issue form" onSubmit={submitIssue}>
              <label htmlFor="issue-title">
                <span>Title</span>
                <input
                  id="issue-title"
                  ref={issueTitleInputRef}
                  value={formValues.title}
                  onChange={(event) => setFormValues({ ...formValues, title: event.target.value })}
                  disabled={isSubmitting}
                  aria-invalid={formError === 'Title is required.' ? true : undefined}
                  aria-describedby={formError ? 'issue-form-error' : undefined}
                />
              </label>

              <label className="full-span" htmlFor="issue-description">
                <span>Description</span>
                <textarea
                  id="issue-description"
                  value={formValues.description}
                  onChange={(event) =>
                    setFormValues({ ...formValues, description: event.target.value })
                  }
                  disabled={isSubmitting}
                  rows={4}
                />
              </label>

              <label className="full-span" htmlFor="issue-labels">
                <span>Labels</span>
                <input
                  id="issue-labels"
                  value={formValues.labels}
                  onChange={(event) => setFormValues({ ...formValues, labels: event.target.value })}
                  disabled={isSubmitting}
                  placeholder="bug, docs, ui"
                />
              </label>

              <label htmlFor="issue-due-date">
                <span>Due Date</span>
                <input
                  id="issue-due-date"
                  type="date"
                  value={formValues.dueDate}
                  onChange={(event) =>
                    setFormValues({ ...formValues, dueDate: event.target.value })
                  }
                  disabled={isSubmitting}
                />
              </label>

              <label htmlFor="issue-status">
                <span>Status</span>
                <select
                  id="issue-status"
                  value={formValues.status}
                  onChange={(event) =>
                    setFormValues({ ...formValues, status: event.target.value as IssueStatus })
                  }
                  disabled={isSubmitting}
                >
                  {statusOrder.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="issue-priority">
                <span>Priority</span>
                <select
                  id="issue-priority"
                  value={formValues.priority}
                  onChange={(event) =>
                    setFormValues({ ...formValues, priority: event.target.value as IssuePriority })
                  }
                  disabled={isSubmitting}
                >
                  {priorityOrder.map((priority) => (
                    <option key={priority} value={priority}>
                      {priorityLabels[priority]}
                    </option>
                  ))}
                </select>
              </label>

              {formError ? (
                <div className="form-error full-span" id="issue-form-error" role="alert">
                  {formError}
                </div>
              ) : null}

              <div className="form-actions full-span">
                <button type="submit" className="primary-button" disabled={isSubmitting}>
                  {activeForm.mode === 'create' ? 'Create Issue' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => cancelForm()}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="issue-panel" aria-labelledby="issue-list-heading" aria-busy={loadState === 'loading'}>
          <div className="panel-header">
            <div>
              <h2 id="issue-list-heading" ref={issueListHeadingRef} tabIndex={-1}>
                Issue List
              </h2>
              <p>{issueListSummary}</p>
            </div>
            <span className="panel-count" aria-label={`${filteredIssues.length} issues shown`}>
              {filteredIssues.length}
            </span>
          </div>

          <div className="filter-panel" role="search" aria-label="Issue filters">
            <label className="filter-field" htmlFor="issue-search-filter">
              <span>Search</span>
              <input
                id="issue-search-filter"
                value={searchFilter}
                onChange={(event) => setSearchFilter(event.target.value)}
              />
            </label>

            <label className="filter-field" htmlFor="issue-status-filter">
              <span>Status</span>
              <select
                id="issue-status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                {statusOrder.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field" htmlFor="issue-priority-filter">
              <span>Priority</span>
              <select
                id="issue-priority-filter"
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
              >
                <option value="all">All priorities</option>
                {priorityOrder.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabels[priority]}
                  </option>
                ))}
              </select>
            </label>

            <div className="filter-actions">
              <button type="button" className="secondary-button" onClick={clearFilters} disabled={!hasActiveFilters}>
                Clear Filters
              </button>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="active-filter-summary" aria-label="Active filters">
              <span>{filteredIssues.length} shown</span>
              <div className="active-filter-list">
                {activeFilterSummaries.map((filter) => (
                  <span key={filter.key} className="active-filter-chip">
                    {filter.label}: {filter.value}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {loadState === 'loading' ? (
            <div className="state-message" role="status">Loading issues...</div>
          ) : null}

          {loadState === 'error' ? (
            <div className="state-message error" role="alert">Unable to load issues.</div>
          ) : null}

          {loadState === 'loaded' && issues.length === 0 ? (
            <div className="state-message">No issues yet.</div>
          ) : null}

          {loadState === 'loaded' && issues.length > 0 && filteredIssues.length === 0 ? (
            <div className="state-message filtered-empty">
              <strong>No issues match the active filters.</strong>
              <button type="button" className="secondary-button" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          ) : null}

          {loadState === 'loaded' && filteredIssues.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Issue</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Due</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIssues.map((issue) => (
                    <tr key={issue.id} className={issue.isOverdue ? 'overdue-row' : undefined}>
                      <td>
                        <strong>{issue.title}</strong>
                        {issue.description ? <span>{issue.description}</span> : null}
                        {issue.labels.length > 0 ? (
                          <div className="label-row" aria-label={`Labels for ${issue.title}`}>
                            {issue.labels.map((label) => (
                              <span key={label} className="label-pill">
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`pill status-${issue.status}`}>{statusLabels[issue.status]}</span>
                      </td>
                      <td>
                        <span className={`pill priority-${issue.priority}`}>{priorityLabels[issue.priority]}</span>
                      </td>
                      <td>
                        <div className="due-date-cell">
                          <span className={issue.isOverdue ? 'due-date-text overdue' : 'due-date-text'}>
                            {issue.dueDate ? formatDueDate(issue.dueDate) : 'No due date'}
                          </span>
                          {issue.isOverdue ? <span className="overdue-pill">Overdue</span> : null}
                        </div>
                      </td>
                      <td>{formatDate(issue.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={(event) => openIssue(issue, event.currentTarget)}
                            aria-label={`Open ${issue.title}`}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={(event) => startEdit(issue, event.currentTarget)}
                            aria-label={`Edit ${issue.title}`}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {selectedIssue ? (
          <section className="detail-panel" aria-labelledby="issue-detail-heading">
            <div className="panel-header">
              <div>
                <h2 id="issue-detail-heading" ref={issueDetailHeadingRef} tabIndex={-1}>
                  {selectedIssue.title}
                </h2>
                <p>Updated {formatDate(selectedIssue.updatedAt)}</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={closeIssueDetail}
                aria-label={`Close issue detail for ${selectedIssue.title}`}
              >
                Close
              </button>
            </div>

            <div className="detail-content">
              <div className="issue-detail-grid" aria-label="Issue details">
                <div>
                  <span>Status</span>
                  <strong>{statusLabels[selectedIssue.status]}</strong>
                </div>
                <div>
                  <span>Priority</span>
                  <strong>{priorityLabels[selectedIssue.priority]}</strong>
                </div>
                <div className={selectedIssue.isOverdue ? 'detail-overdue' : undefined}>
                  <span>Due</span>
                  <strong>
                    {selectedIssue.dueDate ? formatDueDate(selectedIssue.dueDate) : 'No due date'}
                  </strong>
                  {selectedIssue.isOverdue ? <em>Overdue</em> : null}
                </div>
                <div>
                  <span>Created</span>
                  <strong>{formatDate(selectedIssue.createdAt)}</strong>
                </div>
                <div>
                  <span>Comments</span>
                  <strong>{comments.length}</strong>
                </div>
              </div>

              <p
                className={selectedIssue.description ? 'detail-description' : 'detail-description muted'}
              >
                {selectedIssue.description || 'No description.'}
              </p>

              {selectedIssue.labels.length > 0 ? (
                <div className="label-row detail-labels" aria-label="Issue labels">
                  {selectedIssue.labels.map((label) => (
                    <span key={label} className="label-pill">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}

              <section className="activity-section" aria-labelledby="activity-heading">
                <div className="activity-header">
                  <h3 id="activity-heading">Activity</h3>
                  <span>{activityEvents.length}</span>
                </div>

                {activityLoadState === 'loading' ? (
                  <div className="state-message compact" role="status">
                    Loading activity...
                  </div>
                ) : null}

                {activityLoadState === 'error' ? (
                  <div className="state-message compact error" role="alert">
                    Unable to load activity.
                  </div>
                ) : null}

                {activityLoadState === 'loaded' && activityEvents.length === 0 ? (
                  <div className="state-message compact">No activity yet.</div>
                ) : null}

                {activityEvents.length > 0 ? (
                  <ol className="activity-list" aria-label="Issue activity">
                    {activityEvents.map((event) => (
                      <li key={event.id} className="activity-item">
                        <div>
                          <strong>{activityTitle(event)}</strong>
                          <p>{activityDetail(event)}</p>
                        </div>
                        <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>

              <section className="comments-section" aria-labelledby="comments-heading">
                <div className="comments-header">
                  <h3 id="comments-heading" ref={commentsHeadingRef} tabIndex={-1}>
                    Comments
                  </h3>
                  <span>{comments.length}</span>
                </div>

                {commentLoadState === 'loading' ? (
                  <div className="state-message compact" role="status">
                    Loading comments...
                  </div>
                ) : null}

                {commentLoadState === 'error' ? (
                  <div className="state-message compact error" role="alert">
                    Unable to load comments.
                  </div>
                ) : null}

                {commentLoadState === 'loaded' && comments.length === 0 ? (
                  <div className="state-message compact">No comments yet.</div>
                ) : null}

                <form className="comment-form" aria-label="Comment form" onSubmit={submitComment}>
                  <label htmlFor="comment-body">
                    <span>New comment</span>
                    <textarea
                      id="comment-body"
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      disabled={isCommentSubmitting || commentLoadState === 'loading'}
                      rows={3}
                      aria-invalid={commentError ? true : undefined}
                      aria-describedby={commentError ? 'comment-form-error' : undefined}
                    />
                  </label>

                  {commentError ? (
                    <div className="form-error" id="comment-form-error" role="alert">
                      {commentError}
                    </div>
                  ) : null}

                  <div className="form-actions">
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={isCommentSubmitting || commentLoadState === 'loading'}
                    >
                      Add Comment
                    </button>
                  </div>
                </form>

                {comments.length > 0 ? (
                  <ul className="comment-list" aria-label="Issue comments">
                    {comments.map((comment) => {
                      const history = commentHistory[comment.id] ?? [];
                      const isEditingComment = editingCommentId === comment.id;

                      return (
                        <li key={comment.id} className="comment-item">
                          <div className="comment-meta">
                            <strong>{formatDate(comment.updatedAt)}</strong>
                            {comment.updatedAt !== comment.createdAt ? <span>Edited</span> : null}
                          </div>

                          {isEditingComment ? (
                            <form
                              className="comment-edit-form"
                              aria-label="Edit comment form"
                              onSubmit={submitCommentEdit}
                            >
                              <label htmlFor={`comment-edit-${comment.id}`}>
                                <span>Comment</span>
                                <textarea
                                  id={`comment-edit-${comment.id}`}
                                  ref={editCommentTextareaRef}
                                  value={editCommentBody}
                                  onChange={(event) => setEditCommentBody(event.target.value)}
                                  disabled={isCommentEditing}
                                  rows={3}
                                  aria-invalid={editCommentError ? true : undefined}
                                  aria-describedby={
                                    editCommentError ? `comment-edit-error-${comment.id}` : undefined
                                  }
                                />
                              </label>

                              {editCommentError ? (
                                <div
                                  className="form-error"
                                  id={`comment-edit-error-${comment.id}`}
                                  role="alert"
                                >
                                  {editCommentError}
                                </div>
                              ) : null}

                              <div className="form-actions">
                                <button
                                  type="submit"
                                  className="primary-button"
                                  disabled={isCommentEditing}
                                >
                                  Save Comment
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => cancelEditComment({ commentId: comment.id })}
                                  disabled={isCommentEditing}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <p id={`comment-body-${comment.id}`}>{comment.body}</p>
                              <div className="comment-actions">
                                <button
                                  type="button"
                                  className="ghost-button"
                                  data-comment-edit-button={comment.id}
                                  onClick={(event) => startEditComment(comment, event.currentTarget)}
                                  aria-label="Edit comment"
                                  aria-describedby={`comment-body-${comment.id}`}
                                  disabled={isCommentEditing}
                                >
                                  Edit
                                </button>
                              </div>
                            </>
                          )}

                          {history.length > 0 ? (
                            <div className="comment-history" aria-label="Comment edit history">
                              <strong>
                                {history.length} {history.length === 1 ? 'edit' : 'edits'}
                              </strong>
                              <ul>
                                {history.map((entry) => (
                                  <li key={entry.id}>
                                    <span>{formatDate(entry.editedAt)}</span>
                                    <p>Previous: {entry.previousBody}</p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            </div>
          </section>
        ) : null}

        {isMissingSelectedIssue ? (
          <section className="detail-panel" aria-labelledby="missing-issue-heading">
            <div className="panel-header">
              <div>
                <h2 id="missing-issue-heading" ref={missingIssueHeadingRef} tabIndex={-1}>
                  Issue not found
                </h2>
                <p>No issue matches this link.</p>
              </div>
              <button type="button" className="secondary-button" onClick={closeIssueDetail}>
                Back to issue list
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export default App;
