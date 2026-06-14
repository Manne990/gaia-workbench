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

interface IssueComment {
  id: number;
  issueId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface CommentEdit {
  id: number;
  commentId: number;
  previousBody: string;
  editedAt: string;
}

interface ApiErrorPayload {
  error?: string;
  details?: string;
}

type FetchState = "idle" | "loading" | "success" | "error";
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

  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [detailFetchState, setDetailFetchState] = useState<FetchState>("idle");
  const [detailErrorMessage, setDetailErrorMessage] = useState("");

  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentFetchState, setCommentFetchState] = useState<FetchState>("idle");
  const [commentFetchError, setCommentFetchError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitState, setCommentSubmitState] = useState<SubmitState>("idle");
  const [commentSubmitError, setCommentSubmitError] = useState("");

  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [editingCommentState, setEditingCommentState] = useState<SubmitState>("idle");
  const [editingCommentError, setEditingCommentError] = useState("");

  const [historyMap, setHistoryMap] = useState<Record<number, CommentEdit[]>>({});
  const [historyExpanded, setHistoryExpanded] = useState<Record<number, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<number, boolean>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<number, string>>({});

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

  useEffect(() => {
    if (selectedIssueId === null) {
      setSelectedIssue(null);
      setDetailFetchState("idle");
      setDetailErrorMessage("");
      setComments([]);
      setCommentFetchState("idle");
      setCommentFetchError("");
      setCommentBody("");
      setCommentSubmitError("");
      setEditingCommentId(null);
      setHistoryExpanded({});
      return;
    }

    const controller = new AbortController();

    const loadIssueDetails = async () => {
      setDetailFetchState("loading");
      setCommentFetchState("loading");
      setDetailErrorMessage("");
      setCommentFetchError("");

      setCommentBody("");
      setCommentSubmitError("");
      setEditingCommentId(null);
      setEditingCommentBody("");
      setEditingCommentError("");
      setEditingCommentState("idle");

      try {
        const issueResponse = await fetch(`/api/issues/${selectedIssueId}`, {
          signal: controller.signal
        });

        if (!issueResponse.ok) {
          throw new Error(`Unable to load issue details (HTTP ${issueResponse.status}).`);
        }

        const loadedIssue = (await issueResponse.json()) as Issue;
        setSelectedIssue(loadedIssue);
        setDetailFetchState("success");

        const commentsResponse = await fetch(`/api/issues/${selectedIssueId}/comments`, {
          signal: controller.signal
        });

        if (!commentsResponse.ok) {
          throw new Error(`Unable to load comments (HTTP ${commentsResponse.status}).`);
        }

        const loadedComments = (await commentsResponse.json()) as IssueComment[];
        setComments(Array.isArray(loadedComments) ? loadedComments : []);
        setCommentFetchState("success");
        setHistoryMap({});
        setHistoryExpanded({});
        setHistoryLoading({});
        setHistoryErrors({});
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unexpected error while loading issue details.";

        setDetailFetchState("error");
        setCommentFetchState("error");
        setDetailErrorMessage(message);
        setCommentFetchError(message);
        setSelectedIssue(null);
        setComments([]);
      }
    };

    void loadIssueDetails();

    return () => {
      controller.abort();
    };
  }, [selectedIssueId]);

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
      [field]:
        field === "status" ? (value as IssueStatus) : field === "priority" ? (value as IssuePriority) : value
    }));
  };

  const updateEditForm = (field: keyof IssueForm, value: string) => {
    setEditForm((previous) => ({
      ...previous,
      [field]:
        field === "status" ? (value as IssueStatus) : field === "priority" ? (value as IssuePriority) : value
    }));
  };

  const updateCommentBody = (value: string) => {
    setCommentBody(value);
  };

  const startEditComment = (comment: IssueComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
    setEditingCommentError("");
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentBody("");
    setEditingCommentError("");
    setEditingCommentState("idle");
  };

  const refreshCommentHistory = async (commentId: number) => {
    setHistoryLoading((previous) => ({ ...previous, [commentId]: true }));
    setHistoryErrors((previous) => ({ ...previous, [commentId]: "" }));

    try {
      const response = await fetch(`/api/comments/${commentId}/history`);
      if (!response.ok) {
        const message = await parseApiError(response, "Unable to load comment history.");
        setHistoryErrors((previous) => ({ ...previous, [commentId]: message }));
        return;
      }

      const payload = (await response.json()) as CommentEdit[];
      setHistoryMap((previous) => ({
        ...previous,
        [commentId]: Array.isArray(payload) ? payload : []
      }));
    } finally {
      setHistoryLoading((previous) => ({ ...previous, [commentId]: false }));
    }
  };

  const toggleCommentHistory = async (commentId: number) => {
    const isExpanded = historyExpanded[commentId] === true;
    const nextState = {
      ...historyExpanded,
      [commentId]: !isExpanded
    };
    setHistoryExpanded(nextState);

    if (!isExpanded && historyMap[commentId] === undefined) {
      await refreshCommentHistory(commentId);
    }
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
      if (selectedIssueId === issueId) {
        setSelectedIssue(updatedIssue);
      }
      setEditingId(null);
      setEditForm(emptyIssueForm);
      setEditSubmitState("idle");
    } finally {
      setEditSubmitState("idle");
    }
  };

  const handleCreateComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (selectedIssue === null) {
      return;
    }

    setCommentSubmitState("submitting");
    setCommentSubmitError("");

    try {
      const response = await fetch(`/api/issues/${selectedIssue.id}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: commentBody })
      });

      if (!response.ok) {
        const message = await parseApiError(response, "Unable to create comment.");
        setCommentSubmitError(message);
        return;
      }

      const created = (await response.json()) as IssueComment;
      setComments((previous) => [...previous, created]);
      setCommentBody("");
      setCommentSubmitState("idle");
      setCommentFetchState("success");
    } finally {
      setCommentSubmitState("idle");
    }
  };

  const handleUpdateComment = async (event: FormEvent<HTMLFormElement>, commentId: number) => {
    event.preventDefault();
    setEditingCommentState("submitting");
    setEditingCommentError("");

    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: editingCommentBody })
      });

      if (!response.ok) {
        const message = await parseApiError(response, "Unable to update comment.");
        setEditingCommentError(message);
        return;
      }

      const updatedComment = (await response.json()) as IssueComment;
      setComments((previous) =>
        previous.map((comment) => (comment.id === updatedComment.id ? updatedComment : comment))
      );

      if (historyMap[commentId] !== undefined) {
        const { [commentId]: _removed, ...rest } = historyMap;
        setHistoryMap(rest);
      }

      setEditingCommentId(null);
      setEditingCommentBody("");
      setEditingCommentState("idle");
    } finally {
      setEditingCommentState("idle");
    }
  };

  const selectIssue = (issue: Issue) => {
    setSelectedIssueId(issue.id);
    setSelectedIssue(issue);
    setDetailFetchState("loading");
    setCommentFetchState("loading");
  };

  const closeSelectedIssue = () => {
    setSelectedIssueId(null);
  };

  const isCreating = createSubmitState === "submitting";
  const isUpdating = editSubmitState === "submitting";
  const isSubmittingComment = commentSubmitState === "submitting";

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
                  <div className="issue-row-actions" role="cell">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => startEditIssue(issue)}
                      aria-label={`Edit issue ${issue.id}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => selectIssue(issue)}
                      aria-label={`Open issue ${issue.id}`}
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {selectedIssueId !== null ? (
        <section className="panel" aria-labelledby="issue-detail-title">
          <div className="panel-title-row">
            <h2 id="issue-detail-title">Issue details</h2>
            <button
              type="button"
              className="button button--ghost"
              onClick={closeSelectedIssue}
            >
              Back to issues
            </button>
          </div>

          {detailFetchState === "loading" ? (
            <p role="status" className="state-message state-message--loading">
              Loading issue details...
            </p>
          ) : null}

          {detailFetchState === "error" ? (
            <p role="status" className="state-message state-message--error">
              {detailErrorMessage}
            </p>
          ) : null}

          {detailFetchState === "success" && selectedIssue ? (
            <>
              <div className="issue-detail-grid">
                <div>
                  <div className="issue-detail-label">Title</div>
                  <div className="issue-detail-value">{selectedIssue.title}</div>
                </div>
                <div>
                  <div className="issue-detail-label">Description</div>
                  <p className="issue-detail-description">{selectedIssue.description}</p>
                </div>
                <div className="issue-detail-meta">
                  <span>
                    <strong>Status</strong>
                    <span className={`badge status-${slugClass(selectedIssue.status)}`}>
                      {selectedIssue.status}
                    </span>
                  </span>
                  <span>
                    <strong>Priority</strong>
                    <span className={`badge priority-${slugClass(selectedIssue.priority)}`}>
                      {selectedIssue.priority}
                    </span>
                  </span>
                </div>
                <div className="issue-detail-meta issue-detail-metadata">
                  <span>
                    <strong>Created</strong>
                    {formatIssueDate(selectedIssue.createdAt)}
                  </span>
                  <span>
                    <strong>Updated</strong>
                    {formatIssueDate(selectedIssue.updatedAt)}
                  </span>
                  <span>
                    <strong>ID</strong>
                    {selectedIssue.id}
                  </span>
                </div>
              </div>

              <h3 className="issue-detail-comments-title">Comments</h3>

              <form className="comment-form" onSubmit={handleCreateComment}>
                <div className="field">
                  <label htmlFor="comment-body">New comment</label>
                  <textarea
                    id="comment-body"
                    rows={3}
                    value={commentBody}
                    onChange={(event) => updateCommentBody(event.target.value)}
                    disabled={isSubmittingComment || selectedIssue === null}
                  />
                </div>
                {commentSubmitError ? (
                  <p role="status" className="form-message form-message--error form-message--compact">
                    {commentSubmitError}
                  </p>
                ) : null}
                <div className="form-actions">
                  <button
                    type="submit"
                    className="button"
                    disabled={isSubmittingComment || selectedIssue === null || commentBody.trim().length === 0}
                  >
                    {isSubmittingComment ? "Adding comment..." : "Add comment"}
                  </button>
                </div>
              </form>

              {commentFetchState === "loading" ? (
                <p role="status" className="state-message state-message--loading">
                  Loading comments...
                </p>
              ) : null}

              {commentFetchState === "error" ? (
                <p role="status" className="state-message state-message--error">
                  {commentFetchError}
                </p>
              ) : null}

              {commentFetchState === "success" && comments.length === 0 ? (
                <p role="status" className="state-message">
                  No comments yet. Add one to share context.
                </p>
              ) : null}

              {commentFetchState === "success" && comments.length > 0 ? (
                <div className="comment-list" aria-label="Issue comments">
                  {comments.map((comment) => (
                    <div key={comment.id} className="comment-row">
                      <div className="comment-meta">
                        <span>Comment {comment.id}</span>
                        <span>Created: {formatIssueDate(comment.createdAt)}</span>
                        <span>Updated: {formatIssueDate(comment.updatedAt)}</span>
                      </div>

                      {editingCommentId === comment.id ? (
                        <form
                          className="comment-edit-form"
                          onSubmit={(event) => {
                            void handleUpdateComment(event, comment.id);
                          }}
                        >
                          <label htmlFor={`edit-comment-${comment.id}`} className="sr-only">
                            Edit comment
                          </label>
                          <textarea
                            id={`edit-comment-${comment.id}`}
                            value={editingCommentBody}
                            onChange={(event) => {
                              setEditingCommentBody(event.target.value);
                            }}
                            disabled={editingCommentState === "submitting"}
                            rows={3}
                          />

                          {editingCommentError ? (
                            <p role="status" className="form-message form-message--error form-message--compact">
                              {editingCommentError}
                            </p>
                          ) : null}

                          <div className="form-actions form-actions--inline">
                            <button
                              type="submit"
                              className="button"
                              disabled={
                                editingCommentState === "submitting" || editingCommentBody.trim().length === 0
                              }
                            >
                              {editingCommentState === "submitting" ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              className="button button--ghost"
                              onClick={cancelEditComment}
                              disabled={editingCommentState === "submitting"}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="comment-body">{comment.body}</p>
                      )}

                      <div className="comment-row-actions">
                        {editingCommentId === comment.id ? null : (
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => startEditComment(comment)}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => {
                            void toggleCommentHistory(comment.id);
                          }}
                          aria-expanded={historyExpanded[comment.id] === true}
                        >
                          {historyExpanded[comment.id] ? "Hide history" : "Show history"}
                        </button>
                      </div>

                      {historyExpanded[comment.id] ? (
                        <div className="comment-history">
                          {historyLoading[comment.id] ? (
                            <p role="status">Loading comment history...</p>
                          ) : null}

                          {historyErrors[comment.id] ? (
                            <p role="status" className="form-message form-message--error">
                              {historyErrors[comment.id]}
                            </p>
                          ) : null}

                          {historyMap[comment.id] && historyMap[comment.id].length === 0 ? (
                            <p className="comment-history-empty">No edit history.</p>
                          ) : null}

                          {historyMap[comment.id] && historyMap[comment.id].length > 0 ? (
                            <ul className="comment-history-list">
                              {historyMap[comment.id].map((entry) => (
                                <li key={entry.id}>
                                  <strong>Edited at {formatIssueDate(entry.editedAt)}</strong>
                                  <p>Previous: {entry.previousBody}</p>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
