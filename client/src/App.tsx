import './styles.css';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';
type IssuePriority = 'low' | 'medium' | 'high';

type Issue = {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
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

type LoadState = 'loading' | 'loaded' | 'error';
type CommentLoadState = LoadState | 'idle';
type FormMode = 'create' | 'edit';

type IssueFormValues = {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
};

type ActiveForm = {
  mode: FormMode;
  issueId?: string;
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
  priority: 'medium'
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
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

export function App() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [formValues, setFormValues] = useState<IssueFormValues>(emptyFormValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentHistory, setCommentHistory] = useState<Record<string, CommentEditHistory[]>>({});
  const [commentLoadState, setCommentLoadState] = useState<CommentLoadState>('idle');
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [editCommentError, setEditCommentError] = useState<string | null>(null);
  const [isCommentEditing, setIsCommentEditing] = useState(false);

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
      return;
    }

    const controller = new AbortController();

    async function loadComments() {
      setCommentLoadState('loading');
      setCommentError(null);
      setEditingCommentId(null);
      setEditCommentError(null);

      try {
        const response = await fetch(`/api/issues/${selectedIssueId}/comments`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error('Comment request failed');
        }

        const loadedComments = (await response.json()) as Comment[];
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
        setCommentLoadState('loaded');
      } catch (error) {
        if (!controller.signal.aborted) {
          setCommentLoadState('error');
        }
      }
    }

    void loadComments();

    return () => controller.abort();
  }, [selectedIssueId]);

  const selectedIssue = useMemo(() => {
    return issues.find((issue) => issue.id === selectedIssueId) ?? null;
  }, [issues, selectedIssueId]);

  const statusCounts = useMemo(() => {
    return statusOrder.map((status) => ({
      status,
      count: issues.filter((issue) => issue.status === status).length
    }));
  }, [issues]);

  const highPriorityCount = useMemo(() => {
    return issues.filter((issue) => issue.priority === 'high').length;
  }, [issues]);

  function startCreate() {
    setActiveForm({ mode: 'create' });
    setFormValues(emptyFormValues);
    setFormError(null);
  }

  function startEdit(issue: Issue) {
    setActiveForm({ mode: 'edit', issueId: issue.id });
    setFormValues({
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority
    });
    setFormError(null);
  }

  function cancelForm() {
    setActiveForm(null);
    setFormValues(emptyFormValues);
    setFormError(null);
  }

  function openIssue(issue: Issue) {
    setSelectedIssueId(issue.id);
    cancelForm();
  }

  function closeIssueDetail() {
    setSelectedIssueId(null);
    setCommentBody('');
    setCommentError(null);
    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);
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

    setIsSubmitting(true);
    setFormError(null);

    const payload = {
      title: formValues.title.trim(),
      description: formValues.description.trim(),
      status: formValues.status,
      priority: formValues.priority
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
      setCommentBody('');
      setCommentLoadState('loaded');
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Comment save failed');
    } finally {
      setIsCommentSubmitting(false);
    }
  }

  function startEditComment(comment: Comment) {
    setEditingCommentId(comment.id);
    setEditCommentBody(comment.body);
    setEditCommentError(null);
  }

  function cancelEditComment() {
    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);
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

    setIsCommentEditing(true);
    setEditCommentError(null);

    try {
      const response = await fetch(`/api/comments/${editingCommentId}`, {
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
      cancelEditComment();
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
            <button type="button" className="primary-button" onClick={startCreate}>
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
                  value={formValues.title}
                  onChange={(event) => setFormValues({ ...formValues, title: event.target.value })}
                  disabled={isSubmitting}
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
                <div className="form-error full-span" role="alert">
                  {formError}
                </div>
              ) : null}

              <div className="form-actions full-span">
                <button type="submit" className="primary-button" disabled={isSubmitting}>
                  {activeForm.mode === 'create' ? 'Create Issue' : 'Save Changes'}
                </button>
                <button type="button" className="secondary-button" onClick={cancelForm} disabled={isSubmitting}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="issue-panel" aria-labelledby="issue-list-heading" aria-busy={loadState === 'loading'}>
          <div className="panel-header">
            <div>
              <h2 id="issue-list-heading">Issue List</h2>
              <p>{highPriorityCount} high priority</p>
            </div>
            <span className="panel-count">{issues.length}</span>
          </div>

          {loadState === 'loading' ? (
            <div className="state-message" role="status">Loading issues...</div>
          ) : null}

          {loadState === 'error' ? (
            <div className="state-message error" role="alert">Unable to load issues.</div>
          ) : null}

          {loadState === 'loaded' && issues.length === 0 ? (
            <div className="state-message">No issues yet.</div>
          ) : null}

          {loadState === 'loaded' && issues.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Issue</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.id}>
                      <td>
                        <strong>{issue.title}</strong>
                        {issue.description ? <span>{issue.description}</span> : null}
                      </td>
                      <td>
                        <span className={`pill status-${issue.status}`}>{statusLabels[issue.status]}</span>
                      </td>
                      <td>
                        <span className={`pill priority-${issue.priority}`}>{priorityLabels[issue.priority]}</span>
                      </td>
                      <td>{formatDate(issue.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openIssue(issue)}
                            aria-label={`Open ${issue.title}`}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => startEdit(issue)}
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
                <h2 id="issue-detail-heading">{selectedIssue.title}</h2>
                <p>Updated {formatDate(selectedIssue.updatedAt)}</p>
              </div>
              <button type="button" className="secondary-button" onClick={closeIssueDetail}>
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

              <section className="comments-section" aria-labelledby="comments-heading">
                <div className="comments-header">
                  <h3 id="comments-heading">Comments</h3>
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
                    />
                  </label>

                  {commentError ? (
                    <div className="form-error" role="alert">
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
                                  value={editCommentBody}
                                  onChange={(event) => setEditCommentBody(event.target.value)}
                                  disabled={isCommentEditing}
                                  rows={3}
                                />
                              </label>

                              {editCommentError ? (
                                <div className="form-error" role="alert">
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
                                  onClick={cancelEditComment}
                                  disabled={isCommentEditing}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <p>{comment.body}</p>
                              <div className="comment-actions">
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => startEditComment(comment)}
                                  aria-label={`Edit comment ${comment.body}`}
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
      </section>
    </main>
  );
}

export default App;
