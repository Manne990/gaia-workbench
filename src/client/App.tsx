import { type FormEvent, useEffect, useMemo, useState } from "react";

type IssueStatus = "Todo" | "In Progress" | "Review" | "Done";
type IssuePriority = "Low" | "Medium" | "High";

const issueStatuses: IssueStatus[] = ["Todo", "In Progress", "Review", "Done"];
const issuePriorities: IssuePriority[] = ["Low", "Medium", "High"];

interface Issue {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  createdAt: string;
  updatedAt: string;
}

interface IssueForm {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
}

interface ApiErrorPayload {
  error?: string;
  details?: string;
}

type FetchState = "loading" | "success" | "error";
type SubmitState = "idle" | "submitting";

const emptyIssueForm: IssueForm = {
  title: "",
  description: "",
  status: "Todo",
  priority: "Medium"
};

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

function slugClass(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function issueOptions(values: string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

async function parseApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as ApiErrorPayload;

    if (payload?.details && payload.details.trim().length > 0) {
      return payload.details;
    }

    if (payload?.error && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function App() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const [createForm, setCreateForm] = useState<IssueForm>(emptyIssueForm);
  const [createSubmitState, setCreateSubmitState] = useState<SubmitState>("idle");
  const [createSubmitError, setCreateSubmitError] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<IssueForm>(emptyIssueForm);
  const [editSubmitState, setEditSubmitState] = useState<SubmitState>("idle");
  const [editSubmitError, setEditSubmitError] = useState("");

  const loadIssues = async (signal?: AbortSignal) => {
    setFetchState("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/issues", {
        signal
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

  useEffect(() => {
    const controller = new AbortController();
    void loadIssues(controller.signal);

    return () => {
      controller.abort();
    };
  }, []);

  const counts = useMemo(() => issueCounts(issues), [issues]);

  const startEditIssue = (issue: Issue) => {
    setEditingId(issue.id);
    setEditForm({
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority
    });
    setEditSubmitError("");
  };

  const cancelEditIssue = () => {
    setEditingId(null);
    setEditSubmitState("idle");
    setEditSubmitError("");
    setEditForm(emptyIssueForm);
  };

  const updateCreateForm = (field: keyof IssueForm, value: string) => {
    setCreateForm((previous) => ({
      ...previous,
      [field]: field === "status" ? (value as IssueStatus) : field === "priority" ? (value as IssuePriority) : value
    }));
  };

  const updateEditForm = (field: keyof IssueForm, value: string) => {
    setEditForm((previous) => ({
      ...previous,
      [field]: field === "status" ? (value as IssueStatus) : field === "priority" ? (value as IssuePriority) : value
    }));
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateSubmitState("submitting");
    setCreateSubmitError("");

    try {
      const response = await fetch("/api/issues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(createForm)
      });

      if (!response.ok) {
        const message = await parseApiError(response, "Unable to create issue.");
        setCreateSubmitError(message);
        return;
      }

      const createdIssue = (await response.json()) as Issue;
      setIssues((previous) => [...previous, createdIssue]);
      setCreateForm(emptyIssueForm);
      setFetchState("success");
    } finally {
      setCreateSubmitState("idle");
    }
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>, issueId: number) => {
    event.preventDefault();
    setEditSubmitState("submitting");
    setEditSubmitError("");

    try {
      const response = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(editForm)
      });

      if (!response.ok) {
        const message = await parseApiError(response, "Unable to update issue.");
        setEditSubmitError(message);
        return;
      }

      const updatedIssue = (await response.json()) as Issue;
      setIssues((previous) => previous.map((issue) => (issue.id === issueId ? updatedIssue : issue)));
      setEditingId(null);
      setEditForm(emptyIssueForm);
      setEditSubmitState("idle");
    } finally {
      setEditSubmitState("idle");
    }
  };

  const isCreating = createSubmitState === "submitting";
  const isUpdating = editSubmitState === "submitting";

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

      <section className="panel panel--compact" aria-labelledby="issue-create-title">
        <h2 id="issue-create-title">Create issue</h2>
        <form className="issue-form" onSubmit={handleCreateSubmit}>
          <div className="field">
            <label htmlFor="issue-title">Title</label>
            <input
              id="issue-title"
              name="title"
              value={createForm.title}
              onChange={(event) => updateCreateForm("title", event.target.value)}
              disabled={isCreating}
            />
          </div>
          <div className="field">
            <label htmlFor="issue-description">Description</label>
            <textarea
              id="issue-description"
              name="description"
              value={createForm.description}
              onChange={(event) => updateCreateForm("description", event.target.value)}
              rows={4}
              disabled={isCreating}
            />
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="issue-status">Status</label>
              <select
                id="issue-status"
                value={createForm.status}
                onChange={(event) => updateCreateForm("status", event.target.value)}
                disabled={isCreating}
              >
                {issueOptions(issueStatuses)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="issue-priority">Priority</label>
              <select
                id="issue-priority"
                value={createForm.priority}
                onChange={(event) => updateCreateForm("priority", event.target.value)}
                disabled={isCreating}
              >
                {issueOptions(issuePriorities)}
              </select>
            </div>
          </div>
          {createSubmitError ? (
            <p role="status" className="form-message form-message--error">
              {createSubmitError}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="button" disabled={isCreating}>
              {isCreating ? "Creating issue..." : "Create issue"}
            </button>
          </div>
        </form>
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
              <span>Action</span>
            </div>
            {issues.map((issue) => {
              if (editingId === issue.id) {
                return (
                  <form
                    key={issue.id}
                    className="issue-list-row issue-list-row--editing"
                    onSubmit={(event) => {
                      void handleEditSubmit(event, issue.id);
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`edit-title-${issue.id}`}>Title</label>
                      <input
                        id={`edit-title-${issue.id}`}
                        value={editForm.title}
                        onChange={(event) => updateEditForm("title", event.target.value)}
                        disabled={isUpdating}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`edit-description-${issue.id}`}>Description</label>
                      <textarea
                        id={`edit-description-${issue.id}`}
                        value={editForm.description}
                        onChange={(event) => updateEditForm("description", event.target.value)}
                        disabled={isUpdating}
                        rows={3}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`edit-status-${issue.id}`}>Status</label>
                      <select
                        id={`edit-status-${issue.id}`}
                        value={editForm.status}
                        onChange={(event) => updateEditForm("status", event.target.value)}
                        disabled={isUpdating}
                      >
                        {issueOptions(issueStatuses)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`edit-priority-${issue.id}`}>Priority</label>
                      <select
                        id={`edit-priority-${issue.id}`}
                        value={editForm.priority}
                        onChange={(event) => updateEditForm("priority", event.target.value)}
                        disabled={isUpdating}
                      >
                        {issueOptions(issuePriorities)}
                      </select>
                    </div>
                    <div className="field">
                      {editSubmitError ? (
                        <p role="status" className="form-message form-message--error form-message--compact">
                          {editSubmitError}
                        </p>
                      ) : (
                        <span />
                      )}
                      <div className="form-actions form-actions--inline">
                        <button type="submit" className="button" disabled={isUpdating}>
                          {isUpdating ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={cancelEditIssue}
                          disabled={isUpdating}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </form>
                );
              }

              return (
                <div className="issue-list-row" key={issue.id} role="row">
                  <div className="issue-title" role="cell">
                    <strong>{issue.title}</strong>
                    <small>ID {issue.id}</small>
                  </div>
                  <span className={`badge status-${slugClass(issue.status)}`} role="cell">
                    {issue.status}
                  </span>
                  <span className={`badge priority-${slugClass(issue.priority)}`} role="cell">
                    {issue.priority}
                  </span>
                  <div className="issue-metadata" role="cell">
                    <span>Created: {formatIssueDate(issue.createdAt)}</span>
                    <span>Updated: {formatIssueDate(issue.updatedAt)}</span>
                  </div>
                  <div role="cell">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => startEditIssue(issue)}
                      aria-label={`Edit issue ${issue.id}`}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
