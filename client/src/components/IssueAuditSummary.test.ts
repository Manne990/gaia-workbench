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
            blocked: 2
          }
        }
      })
    );

    expect(markup).toContain('Tracker audit summary');
    expect(markup).toContain('Board health');
    expect(markup).toContain('3 blocked');
    expect(markup).toContain('1 waiting');
    expect(markup).toContain('Open');
    expect(markup).toContain('6');
    expect(markup).toContain('Done');
    expect(markup).toContain('2');
    expect(markup).toContain('Blocked');
    expect(markup).toContain('3');
    expect(markup).toContain('Archived');
  });
});
