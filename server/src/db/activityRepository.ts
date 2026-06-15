import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ActivityEvent, ActivityMetadata, NewActivityEvent } from './types.js';

type ActivityEventRow = {
  id: string;
  issue_id: string;
  event_type: ActivityEvent['type'];
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

function placeholdersFor(values: string[]): string {
  return values.map(() => '?').join(', ');
}

export function recordActivityEvent(
  database: Database.Database,
  input: NewActivityEvent
): ActivityEvent {
  const event: ActivityEvent = {
    id: randomUUID(),
    issueId: input.issueId,
    type: input.type,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? nowIso()
  };

  database
    .prepare(`
      INSERT INTO activity_events (id, issue_id, event_type, metadata, created_at)
      VALUES (@id, @issueId, @type, @metadata, @createdAt)
    `)
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
      .prepare(`
        SELECT id, issue_id, event_type, metadata, created_at
        FROM activity_events
        WHERE issue_id = @issueId
        ORDER BY created_at ASC, rowid ASC
      `)
      .all({ issueId }) as ActivityEventRow[];

    return rows.map(mapActivityEventRow);
  }

  listByIssueIds(issueIds: string[]): ActivityEvent[] {
    if (issueIds.length === 0) {
      return [];
    }

    const rows = this.database
      .prepare(`
        SELECT id, issue_id, event_type, metadata, created_at
        FROM activity_events
        WHERE issue_id IN (${placeholdersFor(issueIds)})
        ORDER BY issue_id ASC, created_at ASC, rowid ASC
      `)
      .all(...issueIds) as ActivityEventRow[];

    return rows.map(mapActivityEventRow);
  }
}
