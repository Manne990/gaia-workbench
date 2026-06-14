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

type LoadState = 'loading' | 'loaded' | 'error';
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

export function App() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [formValues, setFormValues] = useState<IssueFormValues>(emptyFormValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => startEdit(issue)}
                          aria-label={`Edit ${issue.title}`}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

export default App;
