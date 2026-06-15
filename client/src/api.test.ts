import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveIssue, fetchCommentHistory, fetchIssue, fetchIssueActivity, fetchServiceHealth } from './api';

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
}

describe('client API errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves server error messages for issue actions', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Issue not found' }, { status: 404 }));

    await expect(archiveIssue('missing-issue')).rejects.toThrow('Issue not found');
    expect(fetch).toHaveBeenCalledWith('/api/issues/missing-issue/archive', { method: 'POST' });
  });

  it('preserves server error messages for activity and comment history requests', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'Issue not found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Comment not found' }, { status: 404 }));

    await expect(fetchIssueActivity('missing-issue')).rejects.toThrow('Issue not found');
    await expect(fetchCommentHistory('missing-comment')).rejects.toThrow('Comment not found');
  });

  it('keeps issue detail 404 as null while preserving other API causes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'Issue not found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Database unavailable' }, { status: 503 }));

    await expect(fetchIssue('missing-issue')).resolves.toBeNull();
    await expect(fetchIssue('temporarily-unavailable')).rejects.toThrow('Database unavailable');
  });

  it('rejects successful JSON endpoints when the response body cannot be parsed', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));

    await expect(fetchServiceHealth()).rejects.toThrow('Service health request failed');
  });
});
