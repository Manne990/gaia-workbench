import { useEffect, useMemo, useState } from "react";

type IssueStatus = "Todo" | "In Progress" | "Review" | "Done";
type IssuePriority = "Low" | "Medium" | "High";

interface Issue {
  id: number;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  createdAt: string;
  updatedAt: string;
}

type FetchState = "loading" | "success" | "error";

function formatIssueDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function issueCounts(issues: Issue[]) {
  return {
    total: issues.length,
    inProgress: issues.filter((issue) => issue.status === "In Progress").length,
    done: issues.filter((issue) => issue.status === "Done").length
  };
}

export function App() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadIssues = async () => {
      setFetchState("loading");
      setErrorMessage("");

      try {
        const response = await fetch("/api/issues", {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Unable to load issues (HTTP ${response.status}).`);
        }

        const payload = await response.json();
        setIssues(Array.isArray(payload) ? payload : []);
        setFetchState("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setFetchState("error");
        setErrorMessage(error instanceof Error ? error.message : "Unexpected error while loading issues.");
      }
    };

    void loadIssues();

    return () => {
      controller.abort();
    };
  }, []);

  const counts = useMemo(() => issueCounts(issues), [issues]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Gaia Workbench</p>
          <h1>Dashboard</h1>
        </div>
        <span className="status-pill">Workspace</span>
      </header>

      <section className="summary-grid" aria-label="Workspace summary">
        <article>
          <span>Total issues</span>
          <strong>{counts.total}</strong>
        </article>
        <article>
          <span>In progress</span>
          <strong>{counts.inProgress}</strong>
        </article>
        <article>
          <span>Completed</span>
          <strong>{counts.done}</strong>
        </article>
      </section>

      <section className="panel" aria-labelledby="issue-list-title">
        <h2 id="issue-list-title">Issues</h2>

        {fetchState === "loading" ? (
          <p role="status" className="state-message state-message--loading">
            Loading issues...
          </p>
        ) : null}

        {fetchState === "error" ? (
          <p role="status" className="state-message state-message--error">
            {errorMessage}
          </p>
        ) : null}

        {fetchState === "success" && issues.length === 0 ? (
          <p role="status" className="state-message state-message--empty">
            No issues yet. Create one to get started.
          </p>
        ) : null}

        {fetchState === "success" && issues.length > 0 ? (
          <div className="issue-list-wrapper" role="table" aria-label="Issue list">
            <div className="issue-list-row issue-list-head">
              <span>Title</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Updated</span>
            </div>
            {issues.map((issue) => (
              <div className="issue-list-row" key={issue.id} role="row">
                <div className="issue-title" role="cell">
                  <strong>{issue.title}</strong>
                  <small>ID {issue.id}</small>
                </div>
                <span className={`badge status-${issue.status.replace(/\s+/g, "-").toLowerCase()}`} role="cell">
                  {issue.status}
                </span>
                <span className={`badge priority-${issue.priority.toLowerCase()}`} role="cell">
                  {issue.priority}
                </span>
                <div className="issue-metadata" role="cell">
                  <span>Created: {formatIssueDate(issue.createdAt)}</span>
                  <span>Updated: {formatIssueDate(issue.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
