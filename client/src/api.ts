import type {
  ActivityEvent,
  BulkIssueArchiveResult,
  BulkIssueStatusResult,
  CommentEditHistory,
  ImportPlan,
  ImportConflictPolicy,
  IssueAuditSummary,
  Issue,
  IssueListResponse,
  IssueStatus,
  IssueDependencyState,
  ServiceHealth,
  SavedFilterView,
  SavedFilterViewPayload
} from './types';

export async function fetchServiceHealth(signal?: AbortSignal): Promise<ServiceHealth> {
  const response = await fetch('/api/health', { signal });

  return readJsonOrThrow<ServiceHealth>(response, 'Service health request failed');
}

export async function fetchCommentHistory(commentId: string, signal?: AbortSignal): Promise<CommentEditHistory[]> {
  const response = await fetch(`/api/comments/${commentId}/history`, { signal });

  return readJsonOrThrow<CommentEditHistory[]>(response, 'Comment history request failed');
}

export async function fetchIssue(issueId: string, signal?: AbortSignal): Promise<Issue | null> {
  const response = await fetch(`/api/issues/${issueId}`, { signal });

  if (response.status === 404) {
    return null;
  }

  return readJsonOrThrow<Issue>(response, 'Issue detail request failed');
}

export async function fetchIssues(query: URLSearchParams, signal?: AbortSignal): Promise<IssueListResponse> {
  const queryString = query.toString();
  const response = await fetch(`/api/issues${queryString ? `?${queryString}` : ''}`, { signal });

  return readJsonOrThrow<IssueListResponse>(response, 'Unable to load issues.');
}

export async function fetchIssueAuditSummary(query: URLSearchParams, signal?: AbortSignal): Promise<IssueAuditSummary> {
  const queryString = query.toString();
  const response = await fetch(`/api/issues/audit-summary${queryString ? `?${queryString}` : ''}`, { signal });

  return readJsonOrThrow<IssueAuditSummary>(response, 'Unable to load issue audit summary.');
}

export async function fetchIssueActivity(issueId: string, signal?: AbortSignal): Promise<ActivityEvent[]> {
  const response = await fetch(`/api/issues/${issueId}/activity`, { signal });

  return readJsonOrThrow<ActivityEvent[]>(response, 'Activity request failed');
}

export async function fetchIssueDependencies(issueId: string, signal?: AbortSignal): Promise<IssueDependencyState> {
  const response = await fetch(`/api/issues/${issueId}/dependencies`, { signal });

  return readJsonOrThrow<IssueDependencyState>(response, 'Dependency request failed');
}

export async function addIssueDependency(issueId: string, dependsOnIssueId: string): Promise<IssueDependencyState> {
  const normalizedDependsOnIssueId = dependsOnIssueId.trim();
  const response = await fetch(`/api/issues/${issueId}/dependencies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dependsOnIssueId: normalizedDependsOnIssueId })
  });

  return readJsonOrThrow<IssueDependencyState>(response, 'Dependency add failed');
}

export async function removeIssueDependency(issueId: string, dependsOnIssueId: string): Promise<IssueDependencyState> {
  const response = await fetch(`/api/issues/${issueId}/dependencies/${dependsOnIssueId}`, {
    method: 'DELETE'
  });

  return readJsonOrThrow<IssueDependencyState>(response, 'Dependency remove failed');
}

async function postIssueAction(issueId: string, action: 'archive' | 'unarchive' | 'duplicate'): Promise<Issue> {
  const response = await fetch(`/api/issues/${issueId}/${action}`, {
    method: 'POST'
  });

  return readJsonOrThrow<Issue>(response, `Issue ${action} request failed`);
}

export function archiveIssue(issueId: string): Promise<Issue> {
  return postIssueAction(issueId, 'archive');
}

export function unarchiveIssue(issueId: string): Promise<Issue> {
  return postIssueAction(issueId, 'unarchive');
}

export function duplicateIssue(issueId: string): Promise<Issue> {
  return postIssueAction(issueId, 'duplicate');
}

export async function bulkUpdateIssueStatus(issueIds: string[], status: IssueStatus): Promise<BulkIssueStatusResult> {
  const response = await fetch('/api/issues/bulk-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueIds, status })
  });

  return readJsonOrThrow<BulkIssueStatusResult>(response, 'Bulk status update failed');
}

export async function bulkArchiveIssues(issueIds: string[]): Promise<BulkIssueArchiveResult> {
  const response = await fetch('/api/issues/bulk-archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueIds })
  });

  return readJsonOrThrow<BulkIssueArchiveResult>(response, 'Bulk archive failed');
}

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as { error?: string } | T | null;
  const errorMessage = readResponseErrorMessage(body, fallbackMessage);

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  if (body === null) {
    throw new Error(fallbackMessage);
  }

  return body as T;
}

function readResponseErrorMessage(body: unknown, fallbackMessage: string): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : fallbackMessage;
}

export async function fetchSavedFilterViews(signal?: AbortSignal): Promise<SavedFilterView[]> {
  const response = await fetch('/api/filter-views', { signal });

  return readJsonOrThrow<SavedFilterView[]>(response, 'Saved views request failed');
}

export async function fetchSavedFilterView(id: string, signal?: AbortSignal): Promise<SavedFilterView> {
  const response = await fetch(`/api/filter-views/${id}`, { signal });

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

export async function duplicateSavedFilterView(id: string): Promise<SavedFilterView> {
  const response = await fetch(`/api/filter-views/${id}/duplicate`, {
    method: 'POST'
  });

  return readJsonOrThrow<SavedFilterView>(response, 'Saved view duplicate failed');
}

function withImportPolicy(payload: unknown, conflictPolicy: ImportConflictPolicy): unknown {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), conflictPolicy }
    : payload;
}

async function readImportPlan(response: Response): Promise<ImportPlan> {
  const body = (await response.json().catch(() => null)) as ImportPlan | { error?: string } | null;

  if (body && typeof body === 'object' && 'valid' in body && typeof body.valid === 'boolean') {
    return body as ImportPlan;
  }

  if (!response.ok) {
    throw new Error(readResponseErrorMessage(body, 'Import request failed'));
  }

  throw new Error('Import request failed');
}

export async function previewImport(
  payload: unknown,
  conflictPolicy: ImportConflictPolicy = 'skip-conflicts'
): Promise<ImportPlan> {
  const response = await fetch('/api/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withImportPolicy(payload, conflictPolicy))
  });

  return readImportPlan(response);
}

export async function applyImport(
  payload: unknown,
  conflictPolicy: ImportConflictPolicy = 'skip-conflicts'
): Promise<ImportPlan> {
  const response = await fetch('/api/import/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withImportPolicy(payload, conflictPolicy))
  });

  return readImportPlan(response);
}
