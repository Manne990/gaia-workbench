import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActivityEvent, Issue } from '../types';
import { IssueDetailPanel } from './IssueDetailPanel';

const nullRef = { current: null };
const noop = () => undefined;

function buildIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    title: 'Audit timestamp issue',
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function buildActivityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'activity-1',
    issueId: 'issue-1',
    type: 'issue_created',
    metadata: {
      title: 'Audit timestamp issue'
    },
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides
  };
}

describe('IssueDetailPanel', () => {
  it('renders activity audit timestamps as explicit UTC while preserving the ISO value', () => {
    const markup = renderToStaticMarkup(
      createElement(IssueDetailPanel, {
        isIssueDetailLoading: false,
        isIssueDetailError: false,
        isMissingSelectedIssue: false,
        selectedIssue: buildIssue(),
        comments: [],
        commentHistory: {},
        commentLoadState: 'loaded',
        activityEvents: [buildActivityEvent()],
        activityLoadState: 'loaded',
        issueDependencies: null,
        dependencyLoadState: 'loaded',
        dependencyIssueId: '',
        onDependencyIssueIdChange: noop,
        dependencyError: null,
        dependencyRollbackReason: null,
        isDependencySubmitting: false,
        commentBody: '',
        setCommentBody: noop,
        commentError: null,
        isCommentSubmitting: false,
        editingCommentId: null,
        editCommentBody: '',
        setEditCommentBody: noop,
        editCommentError: null,
        isCommentEditing: false,
        issueDetailHeadingRef: nullRef,
        missingIssueHeadingRef: nullRef,
        commentsHeadingRef: nullRef,
        editCommentTextareaRef: nullRef,
        dependencyIssueInputRef: nullRef,
        issueLinkCopyFeedback: null,
        statusUndoMessage: null,
        statusUndoError: null,
        isStatusUndoSubmitting: false,
        onCloseIssueDetail: noop,
        onCopyIssueLink: noop,
        onDuplicateIssue: noop,
        onUndoIssueStatus: noop,
        onArchiveIssue: noop,
        onUnarchiveIssue: noop,
        onSubmitIssueDependency: noop,
        onRemoveIssueDependency: noop,
        onSubmitComment: noop,
        onStartEditComment: noop,
        onCancelEditComment: noop,
        onSubmitCommentEdit: noop
      })
    );

    expect(markup).toContain('2026-01-02 03:04:05 UTC');
    expect(markup).toContain('dateTime="2026-01-02T03:04:05.000Z"');
    expect(markup).toContain('Persisted audit timestamp: 2026-01-02T03:04:05.000Z');
  });
});
