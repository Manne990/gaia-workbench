import { describe, expect, it } from 'vitest';
import type { BulkIssueArchiveResult, BulkIssueStatusResult } from '../types';
import {
  buildBulkArchiveChangeMessage,
  buildBulkStatusChangeMessage,
  toggleBulkSelectionIds
} from './useBulkIssueActions';

describe('useBulkIssueActions helpers', () => {
  it('preserves unique bulk selection ids while toggling items on and off', () => {
    const selected = toggleBulkSelectionIds(['issue-1'], 'issue-2', true);
    const duplicated = toggleBulkSelectionIds(selected, 'issue-2', true);
    const cleared = toggleBulkSelectionIds(duplicated, 'issue-1', false);

    expect(selected).toEqual(['issue-1', 'issue-2']);
    expect(duplicated).toEqual(['issue-1', 'issue-2']);
    expect(cleared).toEqual(['issue-2']);
  });

  it('builds the bulk status feedback message for mixed results', () => {
    const result: BulkIssueStatusResult = {
      status: 'review',
      updated: [
        {
          id: 'issue-1',
          title: 'Issue 1',
          description: '',
          status: 'review',
          priority: 'medium',
          labels: [],
          dueDate: null,
          isOverdue: false,
          isBlocked: false,
          dependsOnIssueIds: [],
          archivedAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        }
      ],
      unchangedIds: ['issue-2'],
      duplicateIds: ['issue-1'],
      notFoundIds: ['issue-missing']
    };

    expect(buildBulkStatusChangeMessage(result)).toBe(
      'Changed 1 issue to Review. 1 already was Review. 1 missing id was skipped. 1 duplicate id was ignored.'
    );
  });

  it('builds the bulk archive feedback message for mixed results', () => {
    const result: BulkIssueArchiveResult = {
      archived: [
        {
          id: 'issue-1',
          title: 'Issue 1',
          description: '',
          status: 'todo',
          priority: 'medium',
          labels: [],
          dueDate: null,
          isOverdue: false,
          isBlocked: false,
          dependsOnIssueIds: [],
          archivedAt: '2026-06-22T00:00:00.000Z',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-22T00:00:00.000Z'
        }
      ],
      unchangedIds: ['issue-2'],
      duplicateIds: ['issue-1'],
      notFoundIds: ['issue-missing']
    };

    expect(buildBulkArchiveChangeMessage(result)).toBe(
      'Archived 1 issue. 1 already was archived. 1 missing id was skipped. 1 duplicate id was ignored.'
    );
  });
});
