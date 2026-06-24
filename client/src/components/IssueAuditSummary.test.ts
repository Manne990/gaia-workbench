import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IssueAuditSummary } from './IssueAuditSummary';

describe('IssueAuditSummary', () => {
  it('renders compact audit metrics from the audit summary payload', () => {
    const markup = renderToStaticMarkup(
      createElement(IssueAuditSummary, {
        auditSummary: {
          totalIssues: 8,
          totalArchivedIssues: 2,
          totalBlockedIssues: 3,
          totalWaitingIssues: 1,
          totalOverdueIssues: 1,
          totalStaleIssues: 4,
          byStatus: {
            todo: 2,
            in_progress: 3,
            review: 1,
            done: 2
          },
          byPriority: {
            low: 1,
            medium: 4,
            high: 3
          },
          dependencyEdges: {
            total: 3,
            blocked: 2,
            archivedBlocked: 1
          }
        }
      })
    );

    expect(markup).toContain('Tracker audit summary');
    expect(markup).toContain('Board health');
    expect(markup).toContain('3 blocked');
    expect(markup).toContain('1 waiting');
    expect(markup).toContain('1 archived blocker');
    expect(markup).toContain('Open');
    expect(markup).toContain('6');
    expect(markup).toContain('Done');
    expect(markup).toContain('2');
    expect(markup).toContain('Blocked');
    expect(markup).toContain('3');
    expect(markup).toContain('Archived blockers');
    expect(markup).toContain('Archived');
  });

  it('explains when restrictive filters empty the audit summary', () => {
    const markup = renderToStaticMarkup(
      createElement(IssueAuditSummary, {
        auditSummary: {
          totalIssues: 0,
          totalArchivedIssues: 0,
          totalBlockedIssues: 0,
          totalWaitingIssues: 0,
          totalOverdueIssues: 0,
          totalStaleIssues: 0,
          byStatus: {
            todo: 0,
            in_progress: 0,
            review: 0,
            done: 0
          },
          byPriority: {
            low: 0,
            medium: 0,
            high: 0
          },
          dependencyEdges: {
            total: 0,
            blocked: 0,
            archivedBlocked: 0
          }
        },
        activeFilterSummaries: [
          { key: 'search', label: 'Search', value: 'missing issue' },
          { key: 'blockedOnly', label: 'Blocked', value: 'Only' }
        ]
      })
    );

    expect(markup).toContain('Audit summary empty reason');
    expect(markup).toContain('Active filters are hiding all audit results');
    expect(markup).toContain('Search: missing issue');
    expect(markup).toContain('Blocked: Only');
  });
});
