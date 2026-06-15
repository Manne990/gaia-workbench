import type { ActivityEvent, CommentEditHistory, Issue } from './types';

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
