import type { ActivityEvent, CommentEditHistory, ImportPlan, Issue } from './types';

export async function fetchCommentHistory(
  commentId: string,
  signal?: AbortSignal
): Promise<CommentEditHistory[]> {
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
