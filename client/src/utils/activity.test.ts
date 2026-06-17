import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../types';
import { activityCategoryForEvent, activityFilteredEmptyState, filterActivityEvents } from './activity';

function buildEvent(type: ActivityEvent['type'], id: string): ActivityEvent {
  return {
    id,
    issueId: 'issue-1',
    type,
    metadata: {},
    createdAt: '2026-06-17T09:00:00Z'
  };
}

describe('activity helpers', () => {
  it('maps events into their visible activity categories', () => {
    expect(activityCategoryForEvent(buildEvent('comment_added', 'comment-added'))).toBe('comments');
    expect(activityCategoryForEvent(buildEvent('comment_edited', 'comment-edited'))).toBe('comments');
    expect(activityCategoryForEvent(buildEvent('issue_dependency_added', 'dependency-added'))).toBe('dependencies');
    expect(activityCategoryForEvent(buildEvent('issue_dependency_removed', 'dependency-removed'))).toBe('dependencies');
    expect(activityCategoryForEvent(buildEvent('issue_archived', 'archived'))).toBe('archive');
    expect(activityCategoryForEvent(buildEvent('issue_unarchived', 'restored'))).toBe('archive');
    expect(activityCategoryForEvent(buildEvent('issue_status_changed', 'status-changed'))).toBe('issue_changes');
    expect(activityCategoryForEvent(buildEvent('issue_labels_changed', 'labels-changed'))).toBe('issue_changes');
  });

  it('filters activity events by category while preserving order', () => {
    const events = [
      buildEvent('issue_created', 'created'),
      buildEvent('comment_added', 'comment-added'),
      buildEvent('issue_status_changed', 'status-changed'),
      buildEvent('issue_dependency_added', 'dependency-added'),
      buildEvent('issue_archived', 'archived'),
      buildEvent('comment_edited', 'comment-edited')
    ];

    expect(filterActivityEvents(events, 'all').map((event) => event.id)).toEqual([
      'created',
      'comment-added',
      'status-changed',
      'dependency-added',
      'archived',
      'comment-edited'
    ]);
    expect(filterActivityEvents(events, 'comments').map((event) => event.id)).toEqual([
      'comment-added',
      'comment-edited'
    ]);
    expect(filterActivityEvents(events, 'issue_changes').map((event) => event.id)).toEqual([
      'created',
      'status-changed'
    ]);
    expect(filterActivityEvents(events, 'dependencies').map((event) => event.id)).toEqual(['dependency-added']);
    expect(filterActivityEvents(events, 'archive').map((event) => event.id)).toEqual(['archived']);
  });

  it('returns specific filtered empty-state copy', () => {
    expect(activityFilteredEmptyState('comments')).toBe('No comment activity for this issue yet.');
    expect(activityFilteredEmptyState('issue_changes')).toBe('No issue change activity for this issue yet.');
    expect(activityFilteredEmptyState('dependencies')).toBe('No dependency activity for this issue yet.');
    expect(activityFilteredEmptyState('archive')).toBe('No archive activity for this issue yet.');
    expect(activityFilteredEmptyState('all')).toBe('No activity yet.');
  });
});
