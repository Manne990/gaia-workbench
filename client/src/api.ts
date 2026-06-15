import type {
  ActivityEvent,
  CommentEditHistory,
  ImportPlan,
  Issue,
  SavedFilterView,
  SavedFilterViewPayload
} from './types';

export async function fetchCommentHistory(commentId: string, signal?: AbortSignal): Promise<CommentEditHistory[]> {
  const response = await fetch(`/api/comments/${commentId}/history`, { signal });

  if (!response.ok) {
    throw new Error('Comment history request failed');
  }

  return (await response.json()) as CommentEditHistory[];
}

export async function fetchIssue(issueId: string, signal?: AbortSignal): Promise<Issue | null> {
  const response = await fetch(`/api/issues/${issueId}`, { signal });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Issue detail request failed');
  }

  return (await response.json()) as Issue;
}

export async function fetchIssueActivity(issueId: string, signal?: AbortSignal): Promise<ActivityEvent[]> {
  const response = await fetch(`/api/issues/${issueId}/activity`, { signal });

  if (!response.ok) {
    throw new Error('Activity request failed');
  }

  return (await response.json()) as ActivityEvent[];
}

async function postIssueAction(issueId: string, action: 'archive' | 'unarchive'): Promise<Issue> {
  const response = await fetch(`/api/issues/${issueId}/${action}`, {
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`Issue ${action} request failed`);
  }

  return (await response.json()) as Issue;
}

export function archiveIssue(issueId: string): Promise<Issue> {
  return postIssueAction(issueId, 'archive');
}

export function unarchiveIssue(issueId: string): Promise<Issue> {
  return postIssueAction(issueId, 'unarchive');
}

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as { error?: string } | T | null;
  const errorMessage =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : fallbackMessage;

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  return body as T;
}

export async function fetchSavedFilterViews(signal?: AbortSignal): Promise<SavedFilterView[]> {
  const response = await fetch('/api/filter-views', { signal });

  return readJsonOrThrow<SavedFilterView[]>(response, 'Saved views request failed');
}

export async function fetchSavedFilterView(id: string): Promise<SavedFilterView> {
  const response = await fetch(`/api/filter-views/${id}`);

  return readJsonOrThrow<SavedFilterView>(response, 'Saved view request failed');
}

export async function createSavedFilterView(payload: SavedFilterViewPayload): Promise<SavedFilterView> {
  const response = await fetch('/api/filter-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return readJsonOrThrow<SavedFilterView>(response, 'Saved view create failed');
}

export async function updateSavedFilterView(
  id: string,
  payload: Partial<SavedFilterViewPayload>
): Promise<SavedFilterView> {
  const response = await fetch(`/api/filter-views/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return readJsonOrThrow<SavedFilterView>(response, 'Saved view update failed');
}

export async function deleteSavedFilterView(id: string): Promise<void> {
  const response = await fetch(`/api/filter-views/${id}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Saved view delete failed');
  }
}

async function readImportPlan(response: Response): Promise<ImportPlan> {
  const body = (await response.json().catch(() => null)) as ImportPlan | null;

  if (!body || typeof body.valid !== 'boolean') {
    throw new Error('Import request failed');
  }

  return body;
}

export async function previewImport(payload: unknown): Promise<ImportPlan> {
  const response = await fetch('/api/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return readImportPlan(response);
}

export async function applyImport(payload: unknown): Promise<ImportPlan> {
  const response = await fetch('/api/import/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return readImportPlan(response);
}
