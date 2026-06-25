import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  ActivityEvent,
  ActivityMetadata,
  NewActivityEvent,
  RecentActivityItem,
  RecentActivityItemType
} from './types.js';

type ActivityEventRow = {
  id: string;
  issue_id: string;
  event_type: ActivityEvent['type'];
  metadata: string;
  created_at: string;
};

type RecentActivityRow = {
  id: string;
  source_id: string;
  issue_id: string | null;
  issue_title: string | null;
  event_type: RecentActivityItemType;
  metadata: string;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseMetadata(value: string): ActivityMetadata {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ActivityMetadata;
    }
  } catch {
    return {};
  }

  return {};
}

function mapActivityEventRow(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    issueId: row.issue_id,
    type: row.event_type,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at
  };
}

function mapRecentActivityRow(row: RecentActivityRow): RecentActivityItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    issueId: row.issue_id,
    issueTitle: row.issue_title,
    type: row.event_type,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at
  };
}

function placeholdersFor(values: string[]): string {
  return values.map(() => '?').join(', ');
}

export function recordActivityEvent(database: Database.Database, input: NewActivityEvent): ActivityEvent {
  const event: ActivityEvent = {
    id: randomUUID(),
    issueId: input.issueId,
    type: input.type,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? nowIso()
  };

  database
    .prepare(
      `
      INSERT INTO activity_events (id, issue_id, event_type, metadata, created_at)
      VALUES (@id, @issueId, @type, @metadata, @createdAt)
    `
    )
    .run({
      id: event.id,
      issueId: event.issueId,
      type: event.type,
      metadata: JSON.stringify(event.metadata),
      createdAt: event.createdAt
    });

  return event;
}

export class ActivityRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: NewActivityEvent): ActivityEvent {
    return recordActivityEvent(this.database, input);
  }

  listByIssueId(issueId: string): ActivityEvent[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, issue_id, event_type, metadata, created_at
        FROM activity_events
        WHERE issue_id = @issueId
        ORDER BY created_at ASC, rowid ASC
      `
      )
      .all({ issueId }) as ActivityEventRow[];

    return rows.map(mapActivityEventRow);
  }

  listByIssueIds(issueIds: string[]): ActivityEvent[] {
    if (issueIds.length === 0) {
      return [];
    }

    const rows = this.database
      .prepare(
        `
        SELECT id, issue_id, event_type, metadata, created_at
        FROM activity_events
        WHERE issue_id IN (${placeholdersFor(issueIds)})
        ORDER BY issue_id ASC, created_at ASC, rowid ASC
      `
      )
      .all(...issueIds) as ActivityEventRow[];

    return rows.map(mapActivityEventRow);
  }

  listRecent(limit: number): RecentActivityItem[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, source_id, issue_id, issue_title, event_type, metadata, created_at
        FROM (
          SELECT
            'activity:' || activity_events.id AS id,
            activity_events.id AS source_id,
            activity_events.issue_id AS issue_id,
            issues.title AS issue_title,
            activity_events.event_type AS event_type,
            activity_events.metadata AS metadata,
            activity_events.created_at AS created_at,
            activity_events.rowid AS sort_sequence
          FROM activity_events
          INNER JOIN issues ON issues.id = activity_events.issue_id

          UNION ALL

          SELECT
            'saved-filter-view-created:' || saved_filter_views.id AS id,
            saved_filter_views.id AS source_id,
            NULL AS issue_id,
            NULL AS issue_title,
            'saved_filter_view_created' AS event_type,
            json_object('name', saved_filter_views.name) AS metadata,
            saved_filter_views.created_at AS created_at,
            saved_filter_views.rowid AS sort_sequence
          FROM saved_filter_views

          UNION ALL

          SELECT
            'saved-filter-view-updated:' || saved_filter_views.id AS id,
            saved_filter_views.id AS source_id,
            NULL AS issue_id,
            NULL AS issue_title,
            'saved_filter_view_updated' AS event_type,
            json_object('name', saved_filter_views.name) AS metadata,
            saved_filter_views.updated_at AS created_at,
            saved_filter_views.rowid AS sort_sequence
          FROM saved_filter_views
          WHERE saved_filter_views.updated_at != saved_filter_views.created_at
        )
        ORDER BY created_at DESC, sort_sequence DESC, id DESC
        LIMIT @limit
      `
      )
      .all({ limit }) as RecentActivityRow[];

    return rows.map(mapRecentActivityRow);
  }
}
