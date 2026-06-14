import './styles.css';
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

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">TinyTracker</p>
            <h1>Dashboard</h1>
          </div>
          <div className="total-summary" aria-label="Issue totals">
            <span>Total Issues</span>
            <strong>{issues.length}</strong>
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
