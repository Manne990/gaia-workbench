import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addIssueDependency,
  applyImport,
  archiveIssue,
  fetchCommentHistory,
  fetchIssueAuditSummary,
  fetchIssue,
  fetchIssueActivity,
  fetchIssues,
  fetchServiceHealth,
  previewImport,
  undoIssueStatus
} from './api';
import type { ImportPlan } from './types';

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
}

function invalidImportPlan(code = 'invalid_json'): ImportPlan {
  const emptyCounts = {
    issues: 0,
    comments: 0,
    editHistory: 0,
    activityEvents: 0,
    savedFilterViews: 0
  };
  const emptyCategories = {
    creates: emptyCounts,
    updates: emptyCounts,
    duplicates: emptyCounts,
    conflicts: emptyCounts
  };

  return {
    valid: false,
    exportVersion: null,
    policy: 'skip-conflicts',
    summary: {
      input: emptyCounts,
      toCreate: emptyCounts,
      toReplace: emptyCounts,
      skip: emptyCounts,
      exactMatches: emptyCounts,
      changed: emptyCounts,
      categories: emptyCategories,
      reject: 1
    },
    decisions: [],
    errors: [
      {
        code,
        path: '$',
        message: 'Request body must be valid JSON.'
      }
    ],
    warnings: []
  };
}

describe('client API errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the canonical service health endpoint', async () => {
    const controller = new AbortController();
    const health = { status: 'ok', service: 'TinyTracker' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(health, { status: 200 }));

    await expect(fetchServiceHealth(controller.signal)).resolves.toEqual(health);
    expect(fetch).toHaveBeenCalledWith('/api/health', { signal: controller.signal });
  });

  it('preserves server error messages for issue actions', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Issue not found' }, { status: 404 }));

    await expect(archiveIssue('missing-issue')).rejects.toThrow('Issue not found');
    expect(fetch).toHaveBeenCalledWith('/api/issues/missing-issue/archive', { method: 'POST' });
  });

  it('sends status undo audit cursors when provided', async () => {
    const issue = {
      id: 'issue-1',
      title: 'Undo cursor issue',
      description: '',
      status: 'todo',
      priority: 'medium',
      labels: [],
      dueDate: null,
      isOverdue: false,
      isBlocked: false,
      dependsOnIssueIds: [],
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(issue, { status: 200 }));

    await expect(undoIssueStatus('issue-1', { expectedStatusEventId: 'activity-1' })).resolves.toEqual(issue);
    expect(fetch).toHaveBeenCalledWith('/api/issues/issue-1/undo-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedStatusEventId: 'activity-1' })
    });
  });

  it('preserves server error messages for activity and comment history requests', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'Issue not found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Comment not found' }, { status: 404 }));

    await expect(fetchIssueActivity('missing-issue')).rejects.toThrow('Issue not found');
    await expect(fetchCommentHistory('missing-comment')).rejects.toThrow('Comment not found');
  });

  it('preserves dependency mutation server error messages', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'dependsOnIssueId is required' }, { status: 400 }));

    await expect(addIssueDependency('issue-1', '  ')).rejects.toThrow('dependsOnIssueId is required');
    expect(fetch).toHaveBeenCalledWith('/api/issues/issue-1/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dependsOnIssueId: '' })
    });
  });

  it('normalizes dependency ids before posting mutations', async () => {
    const dependencyState = {
      issueId: 'issue-1',
      dependencies: [],
      dependents: [],
      isBlocked: false
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(dependencyState, { status: 201 }));

    await expect(addIssueDependency('issue-1', '  issue-2  ')).resolves.toEqual(dependencyState);
    expect(fetch).toHaveBeenCalledWith('/api/issues/issue-1/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dependsOnIssueId: 'issue-2' })
    });
  });

  it('keeps issue detail 404 as null while preserving other API causes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'Issue not found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Database unavailable' }, { status: 503 }));

    await expect(fetchIssue('missing-issue')).resolves.toBeNull();
    await expect(fetchIssue('temporarily-unavailable')).rejects.toThrow('Database unavailable');
  });

  it('preserves issue list query server error messages', async () => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: '0', limit: '20' });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Invalid page parameter' }, { status: 400 }));

    await expect(fetchIssues(query, controller.signal)).rejects.toThrow('Invalid page parameter');
    expect(fetch).toHaveBeenCalledWith('/api/issues?page=0&limit=20', { signal: controller.signal });
  });

  it('requests the audit summary endpoint with matching filter query params', async () => {
    const controller = new AbortController();
    const query = new URLSearchParams({ blockedOnly: 'true', label: 'ops' });
    const summary = {
      totalIssues: 1,
      totalArchivedIssues: 0,
      totalBlockedIssues: 1,
      totalOverdueIssues: 1,
      totalStaleIssues: 0,
      byStatus: {
        todo: 0,
        in_progress: 1,
        review: 0,
        done: 0
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 1
      },
      dependencyEdges: {
        total: 1,
        blocked: 1
      }
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(summary, { status: 200 }));

    await expect(fetchIssueAuditSummary(query, controller.signal)).resolves.toEqual(summary);
    expect(fetch).toHaveBeenCalledWith('/api/issues/audit-summary?blockedOnly=true&label=ops', {
      signal: controller.signal
    });
  });

  it('rejects successful JSON endpoints when the response body cannot be parsed', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));

    await expect(fetchServiceHealth()).rejects.toThrow('Service health request failed');
  });

  it('resolves structured import validation plans returned on HTTP 400', async () => {
    const previewPlan = invalidImportPlan('invalid_json');
    const applyPlan = invalidImportPlan('unsupported_version');

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(previewPlan, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse(applyPlan, { status: 400 }));

    await expect(previewImport({ exportVersion: 2, issues: [] })).resolves.toEqual(previewPlan);
    await expect(applyImport({ exportVersion: 2, issues: [] })).resolves.toEqual(applyPlan);
  });

  it('preserves non-plan import server error messages', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'Import preview service unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Import apply service unavailable' }, { status: 500 }));

    await expect(previewImport({ exportVersion: 1, issues: [] })).rejects.toThrow('Import preview service unavailable');
    await expect(applyImport({ exportVersion: 1, issues: [] })).rejects.toThrow('Import apply service unavailable');
  });
});
