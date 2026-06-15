import type { ActivityEvent } from '../types';
import {
  formatDueDateValue,
  formatLabelList,
  formatOptionalText,
  formatPriorityValue,
  formatStatusValue
} from './formatters';

export function metadataText(event: ActivityEvent, key: string): string | null {
  const value = event.metadata[key];
  return typeof value === 'string' ? value : null;
}

export function metadataList(event: ActivityEvent, key: string): string[] {
  const value = event.metadata[key];
  return Array.isArray(value) ? value : [];
}

export function activityTitle(event: ActivityEvent): string {
  switch (event.type) {
    case 'issue_created':
      return 'Issue created';
    case 'issue_title_changed':
      return 'Title changed';
    case 'issue_description_changed':
      return 'Description changed';
    case 'issue_status_changed':
      return 'Status changed';
    case 'issue_priority_changed':
      return 'Priority changed';
    case 'issue_due_date_changed':
      return 'Due date changed';
    case 'issue_labels_changed':
      return 'Labels changed';
    case 'issue_archived':
      return 'Issue archived';
    case 'issue_unarchived':
      return 'Issue restored';
    case 'issue_dependency_added':
      return 'Dependency added';
    case 'issue_dependency_removed':
      return 'Dependency removed';
    case 'comment_added':
      return 'Comment added';
    case 'comment_edited':
      return 'Comment edited';
    default:
      return 'Activity recorded';
  }
}

export function activityDetail(event: ActivityEvent): string {
  const from = metadataText(event, 'from');
  const to = metadataText(event, 'to');

  switch (event.type) {
    case 'issue_created':
      return `Created ${formatOptionalText(metadataText(event, 'title'))}.`;
    case 'issue_title_changed':
      return `${formatOptionalText(from)} -> ${formatOptionalText(to)}`;
    case 'issue_description_changed':
      return `${formatOptionalText(from)} -> ${formatOptionalText(to)}`;
    case 'issue_status_changed':
      return `${formatStatusValue(from)} -> ${formatStatusValue(to)}`;
    case 'issue_priority_changed':
      return `${formatPriorityValue(from)} -> ${formatPriorityValue(to)}`;
    case 'issue_due_date_changed':
      return `${formatDueDateValue(from)} -> ${formatDueDateValue(to)}`;
    case 'issue_labels_changed':
      return `${formatLabelList(metadataList(event, 'from'))} -> ${formatLabelList(metadataList(event, 'to'))}`;
    case 'issue_archived':
      return 'Removed from the active dashboard.';
    case 'issue_unarchived':
      return 'Restored to the active dashboard.';
    case 'issue_dependency_added':
      return `Blocked by ${formatOptionalText(metadataText(event, 'title'))}.`;
    case 'issue_dependency_removed':
      return `No longer blocked by ${formatOptionalText(metadataText(event, 'title'))}.`;
    case 'comment_added':
      return `Added "${formatOptionalText(metadataText(event, 'preview'))}".`;
    case 'comment_edited':
      return `${formatOptionalText(metadataText(event, 'previousPreview'))} -> ${formatOptionalText(
        metadataText(event, 'newPreview')
      )}`;
    default:
      return 'Activity details are not available.';
  }
}
