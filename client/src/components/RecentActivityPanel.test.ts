import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecentActivityItem } from '../types';
import { RecentActivityPanel } from './RecentActivityPanel';

const noop = () => undefined;

function buildRecentActivity(overrides: Partial<RecentActivityItem> = {}): RecentActivityItem {
  return {
    id: 'activity:activity-1',
    sourceId: 'activity-1',
    issueId: 'issue-1',
    issueTitle: 'Visible issue title',
    type: 'comment_added',
    metadata: {
      preview: 'A compact comment preview'
    },
    createdAt: '2026-06-25T18:45:00.000Z',
    ...overrides
  };
}

describe('RecentActivityPanel', () => {
  it('renders issue and saved-view activity in a compact list', () => {
    const markup = renderToStaticMarkup(
      createElement(RecentActivityPanel, {
        activity: [
          buildRecentActivity(),
          buildRecentActivity({
            id: 'saved-filter-view-created:view-1',
            sourceId: 'view-1',
            issueId: null,
            issueTitle: null,
            type: 'saved_filter_view_created',
            metadata: {
              name: 'Planning view'
            }
          })
        ],
        loadState: 'loaded',
        onOpenIssue: noop,
        onRetry: noop
      })
    );

    expect(markup).toContain('Recent activity');
    expect(markup).toContain('Comment added');
    expect(markup).toContain('Visible issue title');
    expect(markup).toContain('A compact comment preview');
    expect(markup).toContain('Saved view created');
    expect(markup).toContain('Created Planning view.');
    expect(markup).toContain('dateTime="2026-06-25T18:45:00.000Z"');
  });

  it('renders empty and error states', () => {
    const emptyMarkup = renderToStaticMarkup(
      createElement(RecentActivityPanel, {
        activity: [],
        loadState: 'loaded',
        onOpenIssue: noop,
        onRetry: noop
      })
    );
    const errorMarkup = renderToStaticMarkup(
      createElement(RecentActivityPanel, {
        activity: [],
        loadState: 'error',
        onOpenIssue: noop,
        onRetry: noop
      })
    );

    expect(emptyMarkup).toContain('No activity has been recorded yet.');
    expect(errorMarkup).toContain('Recent activity is unavailable.');
    expect(errorMarkup).toContain('Retry');
  });
});
