import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const validationErrorBody = (error: string) => ({
  error,
  code: 'validation_error',
  errors: [{ message: error }]
});

type IssueSnapshot = {
  id: string;
  createdAt: string;
  [key: string]: unknown;
};

type ExportedComment = {
  id: string;
  editHistory: unknown[];
};

type ExportedIssue = IssueSnapshot & {
  dependsOnIssueIds: string[];
  comments: ExportedComment[];
  activityEvents: Array<{ type: string }>;
};

type SavedFilterView = {
  id: string;
  name: string;
  search: string;
  status: string;
  priority: string;
  label: string;
  includeArchived: boolean;
  blockedOnly: boolean;
  staleOnly: boolean;
  pageSize: number;
  createdAt: string;
  updatedAt: string;
};

type ExportAuditSummary = {
  timestampPolicy: {
    createdAt: {
      valueFormat: string;
      timeZone: string;
      uiDisplayTimeZone: string;
    };
  };
  issues: {
    total: number;
    active: number;
    archived: number;
    blocked: number;
    overdue: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  comments: {
    total: number;
    edited: number;
    editHistoryEntries: number;
  };
  dependencies: {
    total: number;
    blocking: number;
  };
  activity: {
    total: number;
    byType: Record<string, number>;
    recent: Array<{
      eventId: string;
      issueId: string;
      issueTitle: string;
      type: string;
      createdAt: string;
    }>;
    timeline: Array<{
      eventId: string;
      issueId: string;
      issueTitle: string;
      type: string;
      createdAt: string;
      meetingLabel: string;
      meetingImpact: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>;
  };
  savedFilterViews: {
    total: number;
  };
};

type TrackerExport = {
  exportVersion: number;
  issues: ExportedIssue[];
  savedFilterViews: SavedFilterView[];
  auditSummary?: ExportAuditSummary;
};

function getCsvLines(csv: string): string[] {
  return csv.trim().split('\r\n');
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsvRows(csv: string): string[][] {
  return getCsvLines(csv).map(parseCsvLine);
}

function compareExportIssueOrder(first: IssueSnapshot, second: IssueSnapshot): number {
  return first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id);
}

describe('tracker export API', () => {
  it('exports issues with comments, edit history, and activity in stable order without mutating state', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const createdFirst = await request(app)
      .post('/api/issues')
      .send({
        title: 'First export issue',
        description: 'Original export description',
        labels: ['api', 'backup'],
        dueDate: '2999-12-31'
      })
      .expect(201);

    const createdSecond = await request(app)
      .post('/api/issues')
      .send({
        title: 'Second export issue',
        description: 'Another issue with its own comments',
        priority: 'medium'
      })
      .expect(201);

    const createdEmpty = await request(app)
      .post('/api/issues')
      .send({
        title: 'Empty export issue',
        description: 'No comments but still has activity'
      })
      .expect(201);

    await request(app)
      .put(`/api/issues/${createdFirst.body.id}`)
      .send({
        title: 'Updated first export issue',
        description: 'Ready for export',
        status: 'review',
        priority: 'high',
        labels: ['api', 'export'],
        dueDate: '2000-01-01'
      })
      .expect(200);

    await request(app)
      .put(`/api/issues/${createdSecond.body.id}`)
      .send({
        status: 'in_progress',
        priority: 'low'
      })
      .expect(200);

    const firstComment = await request(app)
      .post(`/api/issues/${createdFirst.body.id}/comments`)
      .send({ body: 'Initial export comment' })
      .expect(201);

    const secondComment = await request(app)
      .post(`/api/issues/${createdFirst.body.id}/comments`)
      .send({ body: 'Second export comment' })
      .expect(201);

    const firstEdit = await request(app)
      .put(`/api/comments/${firstComment.body.id}`)
      .send({ body: 'Edited export comment once' })
      .expect(200);

    const secondEdit = await request(app)
      .put(`/api/comments/${firstComment.body.id}`)
      .send({ body: 'Edited export comment twice' })
      .expect(200);

    const secondIssueComment = await request(app)
      .post(`/api/issues/${createdSecond.body.id}/comments`)
      .send({ body: 'Second issue comment' })
      .expect(201);

    await request(app)
      .post('/api/filter-views')
      .send({
        name: 'Export review view',
        search: 'export',
        status: 'review',
        priority: 'high',
        label: 'api',
        includeArchived: true,
        blockedOnly: true,
        staleOnly: true,
        pageSize: 50
      })
      .expect(201);

    const issueBefore = await request(app).get(`/api/issues/${createdFirst.body.id}`).expect(200);
    const secondIssueBefore = await request(app).get(`/api/issues/${createdSecond.body.id}`).expect(200);
    const emptyIssueBefore = await request(app).get(`/api/issues/${createdEmpty.body.id}`).expect(200);
    const commentsBefore = await request(app).get(`/api/issues/${createdFirst.body.id}/comments`).expect(200);
    const secondIssueCommentsBefore = await request(app)
      .get(`/api/issues/${createdSecond.body.id}/comments`)
      .expect(200);
    const historyBefore = await request(app).get(`/api/comments/${firstComment.body.id}/history`).expect(200);
    const secondCommentHistoryBefore = await request(app)
      .get(`/api/comments/${secondComment.body.id}/history`)
      .expect(200);
    const activityBefore = await request(app).get(`/api/issues/${createdFirst.body.id}/activity`).expect(200);
    const secondIssueActivityBefore = await request(app)
      .get(`/api/issues/${createdSecond.body.id}/activity`)
      .expect(200);
    const emptyIssueActivityBefore = await request(app).get(`/api/issues/${createdEmpty.body.id}/activity`).expect(200);
    const savedFilterViewsBefore = await request(app).get('/api/filter-views').expect(200);

    const firstExport = await request(app).get('/api/export').expect(200);
    const secondExport = await request(app).get('/api/export').expect(200);
    const exported = firstExport.body as TrackerExport;
    const sortedIssueSnapshots = [issueBefore.body, secondIssueBefore.body, emptyIssueBefore.body].sort(
      compareExportIssueOrder
    );
    const exportedById = new Map(exported.issues.map((issue) => [issue.id, issue]));
    const exportedFirstIssue = exportedById.get(issueBefore.body.id);
    const exportedSecondIssue = exportedById.get(secondIssueBefore.body.id);
    const exportedEmptyIssue = exportedById.get(emptyIssueBefore.body.id);

    expect(firstExport.headers['content-type']).toContain('application/json');
    expect(Object.keys(firstExport.body).sort()).toEqual(['exportVersion', 'issues', 'savedFilterViews']);
    expect(firstExport.body).not.toHaveProperty('generatedAt');
    expect(firstExport.body).not.toHaveProperty('items');
    expect(firstExport.body).not.toHaveProperty('pagination');
    expect(exported.exportVersion).toBe(1);
    expect(exported.issues.map((issue) => issue.id)).toEqual(sortedIssueSnapshots.map((issue) => issue.id));
    expect(exportedFirstIssue).toBeDefined();
    expect(exportedSecondIssue).toBeDefined();
    expect(exportedEmptyIssue).toBeDefined();

    expect(exportedFirstIssue).toMatchObject({
      labels: ['api', 'export'],
      dueDate: '2000-01-01',
      isOverdue: true
    });
    expect(exportedFirstIssue?.comments.map((comment) => comment.id)).toEqual(
      commentsBefore.body.map((comment: { id: string }) => comment.id)
    );
    expect(exportedFirstIssue?.comments[0]).toMatchObject({
      ...secondEdit.body,
      editHistory: historyBefore.body
    });
    expect(exportedFirstIssue?.comments[1]).toMatchObject({
      ...secondComment.body,
      editHistory: secondCommentHistoryBefore.body
    });
    expect(exportedFirstIssue?.comments[0].editHistory).toHaveLength(2);
    expect(exportedFirstIssue?.comments[0].editHistory[0]).toMatchObject({
      commentId: firstComment.body.id,
      previousBody: 'Initial export comment',
      newBody: 'Edited export comment once'
    });
    expect(exportedFirstIssue?.comments[0].editHistory[1]).toMatchObject({
      commentId: firstComment.body.id,
      previousBody: firstEdit.body.body,
      newBody: secondEdit.body.body
    });
    expect(exportedFirstIssue?.activityEvents).toEqual(activityBefore.body);
    expect(exportedFirstIssue?.activityEvents.map((event) => event.type)).toEqual([
      'issue_created',
      'issue_title_changed',
      'issue_description_changed',
      'issue_status_changed',
      'issue_priority_changed',
      'issue_due_date_changed',
      'issue_labels_changed',
      'comment_added',
      'comment_added',
      'comment_edited',
      'comment_edited'
    ]);

    expect(exportedSecondIssue?.comments).toEqual([
      {
        ...secondIssueComment.body,
        editHistory: []
      }
    ]);
    expect(exportedSecondIssue?.comments.map((comment) => comment.id)).toEqual(
      secondIssueCommentsBefore.body.map((comment: { id: string }) => comment.id)
    );
    expect(exportedSecondIssue?.activityEvents).toEqual(secondIssueActivityBefore.body);
    expect(exportedEmptyIssue?.comments).toEqual([]);
    expect(exportedEmptyIssue?.activityEvents).toEqual(emptyIssueActivityBefore.body);
    expect(exported.savedFilterViews).toEqual(savedFilterViewsBefore.body);
    expect(exported.savedFilterViews[0]).toMatchObject({
      name: 'Export review view',
      search: 'export',
      status: 'review',
      priority: 'high',
      label: 'api',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: true,
      pageSize: 50
    });
    expect(secondExport.body).toEqual(firstExport.body);

    await request(app).get(`/api/issues/${createdFirst.body.id}`).expect(200, issueBefore.body);
    await request(app).get(`/api/issues/${createdSecond.body.id}`).expect(200, secondIssueBefore.body);
    await request(app).get(`/api/issues/${createdEmpty.body.id}`).expect(200, emptyIssueBefore.body);
    await request(app).get(`/api/issues/${createdFirst.body.id}/comments`).expect(200, commentsBefore.body);
    await request(app).get(`/api/issues/${createdSecond.body.id}/comments`).expect(200, secondIssueCommentsBefore.body);
    await request(app).get(`/api/comments/${firstComment.body.id}/history`).expect(200, historyBefore.body);
    await request(app)
      .get(`/api/comments/${secondComment.body.id}/history`)
      .expect(200, secondCommentHistoryBefore.body);
    await request(app).get(`/api/issues/${createdFirst.body.id}/activity`).expect(200, activityBefore.body);
    await request(app).get(`/api/issues/${createdSecond.body.id}/activity`).expect(200, secondIssueActivityBefore.body);
    await request(app).get(`/api/issues/${createdEmpty.body.id}/activity`).expect(200, emptyIssueActivityBefore.body);
    await request(app).get('/api/filter-views').expect(200, savedFilterViewsBefore.body);
  });

  it('can include a compact audit summary without replacing the full JSON export', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app)
      .post('/api/issues')
      .send({
        title: 'Blocking audit issue',
        status: 'todo',
        priority: 'high'
      })
      .expect(201);
    const blocked = await request(app)
      .post('/api/issues')
      .send({
        title: 'Blocked audit issue',
        status: 'in_progress',
        priority: 'medium'
      })
      .expect(201);
    const archived = await request(app)
      .post('/api/issues')
      .send({
        title: 'Archived audit issue',
        status: 'done',
        priority: 'low'
      })
      .expect(201);

    await request(app).post(`/api/issues/${archived.body.id}/archive`).expect(200);
    await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);
    const comment = await request(app)
      .post(`/api/issues/${blocked.body.id}/comments`)
      .send({ body: 'Audit summary should count this comment.' })
      .expect(201);
    await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: 'Audit summary should count this edited comment.' })
      .expect(200);
    await request(app)
      .post('/api/filter-views')
      .send({
        name: 'Audit export view',
        status: 'all',
        priority: 'all',
        pageSize: 25
      })
      .expect(201);

    const defaultExport = await request(app).get('/api/export').expect(200);
    const summarizedExport = await request(app).get('/api/export?includeAuditSummary=true').expect(200);
    const exported = summarizedExport.body as TrackerExport;

    expect(defaultExport.body).not.toHaveProperty('auditSummary');
    expect(Object.keys(defaultExport.body).sort()).toEqual(['exportVersion', 'issues', 'savedFilterViews']);
    expect(Object.keys(summarizedExport.body).sort()).toEqual([
      'auditSummary',
      'exportVersion',
      'issues',
      'savedFilterViews'
    ]);
    expect(exported.issues).toHaveLength(3);
    expect(exported.savedFilterViews).toHaveLength(1);
    expect(exported.auditSummary).toEqual({
      timestampPolicy: {
        createdAt: {
          valueFormat: 'ISO 8601 UTC',
          timeZone: 'UTC',
          uiDisplayTimeZone: 'UTC'
        }
      },
      issues: {
        total: 3,
        active: 2,
        archived: 1,
        blocked: 1,
        overdue: 0,
        byStatus: {
          todo: 1,
          in_progress: 1,
          review: 0,
          done: 1
        },
        byPriority: {
          low: 1,
          medium: 1,
          high: 1
        }
      },
      comments: {
        total: 1,
        edited: 1,
        editHistoryEntries: 1
      },
      dependencies: {
        total: 1,
        blocking: 1
      },
      activity: {
        total: 7,
        byType: {
          issue_created: 3,
          issue_title_changed: 0,
          issue_description_changed: 0,
          issue_status_changed: 0,
          issue_priority_changed: 0,
          issue_due_date_changed: 0,
          issue_labels_changed: 0,
          issue_archived: 1,
          issue_unarchived: 0,
          issue_dependency_added: 1,
          issue_dependency_removed: 0,
          comment_added: 1,
          comment_edited: 1
        },
        recent: expect.any(Array),
        timeline: expect.any(Array)
      },
      savedFilterViews: {
        total: 1
      }
    });
    expect(exported.auditSummary?.activity.recent).toHaveLength(5);
    expect(exported.auditSummary?.activity.recent[0]).toEqual(
      expect.objectContaining({
        eventId: expect.any(String),
        issueId: expect.any(String),
        issueTitle: expect.any(String),
        type: expect.any(String),
        createdAt: expect.any(String)
      })
    );
    expect(exported.auditSummary?.activity.recent[0].createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it('adds before and after snapshots to audit timeline entries', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Timeline blocker issue', status: 'todo', priority: 'high' })
      .expect(201);
    const target = await request(app)
      .post('/api/issues')
      .send({ title: 'Timeline target issue', status: 'todo', priority: 'medium' })
      .expect(201);

    await request(app).put(`/api/issues/${target.body.id}`).send({ status: 'review' }).expect(200);
    await request(app)
      .post(`/api/issues/${target.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);
    const comment = await request(app)
      .post(`/api/issues/${target.body.id}/comments`)
      .send({ body: 'Timeline comment creation' })
      .expect(201);
    const archived = await request(app).post(`/api/issues/${target.body.id}/archive`).expect(200);
    await request(app).post(`/api/issues/${target.body.id}/unarchive`).expect(200);

    const summarizedExport = await request(app).get('/api/export?includeAuditSummary=true').expect(200);
    const timeline = (summarizedExport.body as TrackerExport).auditSummary?.activity.timeline ?? [];
    const targetTimelineEntry = (type: string) => {
      const entry = timeline.find((candidate) => candidate.issueId === target.body.id && candidate.type === type);

      expect(entry).toBeDefined();

      return entry;
    };

    expect(targetTimelineEntry('issue_status_changed')).toMatchObject({
      issueTitle: 'Timeline target issue',
      meetingLabel: 'Status changed: todo -> review',
      meetingImpact: 'workflow',
      before: { status: 'todo' },
      after: { status: 'review' }
    });
    expect(targetTimelineEntry('issue_dependency_added')).toMatchObject({
      meetingLabel: 'Dependency added: Timeline blocker issue',
      meetingImpact: 'blocking',
      before: { dependsOnIssueId: null, dependencyTitle: null },
      after: {
        dependsOnIssueId: blocker.body.id,
        dependencyTitle: 'Timeline blocker issue'
      }
    });
    expect(targetTimelineEntry('comment_added')).toMatchObject({
      meetingLabel: 'Comment added: Timeline comment creation',
      meetingImpact: 'discussion',
      before: { commentId: null, commentPreview: null },
      after: {
        commentId: comment.body.id,
        commentPreview: 'Timeline comment creation'
      }
    });
    expect(targetTimelineEntry('issue_archived')).toMatchObject({
      meetingLabel: 'Issue archived',
      meetingImpact: 'visibility',
      before: { archivedAt: null },
      after: { archivedAt: archived.body.archivedAt }
    });
    expect(targetTimelineEntry('issue_unarchived')).toMatchObject({
      meetingLabel: 'Issue restored',
      meetingImpact: 'visibility',
      before: { archivedAt: archived.body.archivedAt },
      after: { archivedAt: null }
    });
    expect(timeline.map((entry) => entry.createdAt)).toEqual(
      [...timeline.map((entry) => entry.createdAt)].sort((left, right) => left.localeCompare(right))
    );
  });

  it('rejects invalid audit summary export options', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .get('/api/export?includeAuditSummary=yes')
      .expect(400, validationErrorBody('Invalid includeAuditSummary parameter'));
  });

  it('exports filtered issues to CSV with deterministic headers', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const activeCsvIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'CSV filtered issue',
        description: 'First match with comma, in description',
        status: 'todo',
        priority: 'high'
      })
      .expect(201);
    const secondActiveCsvIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Second list issue',
        description: 'No match for filter query',
        status: 'done',
        priority: 'low'
      })
      .expect(201);
    const archivedIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Archived filtered issue',
        description: 'Done issue',
        status: 'in_progress',
        priority: 'low'
      })
      .expect(201);
    const archivedCsv = await request(app).post(`/api/issues/${archivedIssue.body.id}/archive`).expect(200);
    const blocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Blocking base', status: 'todo', priority: 'high' })
      .expect(201);
    const blockedIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Filtered blocker child',
        description: 'No match for filter query',
        status: 'in_progress',
        priority: 'medium'
      })
      .expect(201);

    await request(app)
      .post(`/api/issues/${blockedIssue.body.id}/comments`)
      .send({ body: 'Should not appear in CSV export row body columns' })
      .expect(201);
    await request(app)
      .post(`/api/issues/${blockedIssue.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);

    const todoFilteredCsv = await request(app)
      .get(`/api/export.csv?status=todo&search=${encodeURIComponent('csv')}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const todoLines = parseCsvRows(todoFilteredCsv.text);

    expect(todoLines[0]).toEqual([
      'id',
      'title',
      'description',
      'status',
      'priority',
      'dueDate',
      'isOverdue',
      'isBlocked',
      'archivedAt',
      'dependsOnIssueIds',
      'labels',
      'createdAt',
      'updatedAt'
    ]);

    const todoRowsById = new Map(todoLines.slice(1).map((row) => [row[0], row]));

    expect(todoRowsById.get(activeCsvIssue.body.id)).toEqual([
      activeCsvIssue.body.id,
      'CSV filtered issue',
      'First match with comma, in description',
      'todo',
      'high',
      '',
      'false',
      'false',
      '',
      '',
      '',
      activeCsvIssue.body.createdAt,
      activeCsvIssue.body.updatedAt
    ]);
    expect(todoRowsById.size).toBe(1);
    expect(todoRowsById.has(secondActiveCsvIssue.body.id)).toBe(false);
    expect(todoRowsById.has(archivedCsv.body.id)).toBe(false);

    const blockedCsv = await request(app)
      .get('/api/export.csv?blockedOnly=true')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const blockedRowsById = new Map(
      parseCsvRows(blockedCsv.text)
        .slice(1)
        .map((row) => [row[0], row])
    );

    const blockedCsvRow = blockedRowsById.get(blockedIssue.body.id);

    expect(blockedCsvRow).toBeDefined();
    expect(blockedCsvRow?.[0]).toBe(blockedIssue.body.id);
    expect(blockedCsvRow?.[1]).toBe('Filtered blocker child');
    expect(blockedCsvRow?.[2]).toBe('No match for filter query');
    expect(blockedCsvRow?.[3]).toBe('in_progress');
    expect(blockedCsvRow?.[4]).toBe('medium');
    expect(blockedCsvRow?.[5]).toBe('');
    expect(blockedCsvRow?.[6]).toBe('false');
    expect(blockedCsvRow?.[7]).toBe('true');
    expect(blockedCsvRow?.[8]).toBe('');
    expect(blockedCsvRow?.[9]).toBe(blocker.body.id);
    expect(blockedCsvRow?.[10]).toBe('');
    expect(blockedRowsById.size).toBe(1);

    const archivedCsvResponse = await request(app)
      .get('/api/export.csv?includeArchived=true&status=in_progress')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const archivedRowsById = new Map(
      parseCsvRows(archivedCsvResponse.text)
        .slice(1)
        .map((row) => [row[0], row])
    );

    expect(archivedRowsById.has(archivedCsv.body.id)).toBe(true);
    expect(archivedRowsById.has(blockedIssue.body.id)).toBe(true);
  });

  it('escapes CSV special characters in issue fields', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const escapedIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Issue title with "quotes", commas',
        description: 'A description, with punctuation and "quotes"',
        status: 'review',
        priority: 'high'
      })
      .expect(201);

    const response = await request(app)
      .get('/api/export.csv?status=review')
      .expect(200)
      .expect('Content-Type', /text\/csv/);

    const lines = parseCsvRows(response.text);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual([
      escapedIssue.body.id,
      'Issue title with "quotes", commas',
      'A description, with punctuation and "quotes"',
      'review',
      'high',
      '',
      'false',
      'false',
      '',
      '',
      '',
      escapedIssue.body.createdAt,
      escapedIssue.body.updatedAt
    ]);
  });

  it('uses stale-only filter semantics for CSV exports', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .post('/api/import/apply')
      .send({
        exportVersion: 1,
        issues: [
          {
            id: '00000000-0000-4000-8000-000000000338',
            title: 'Stale CSV issue',
            description: 'Old enough to appear in stale exports.',
            status: 'todo',
            priority: 'medium',
            labels: ['csv'],
            dueDate: null,
            isOverdue: false,
            isBlocked: false,
            dependsOnIssueIds: [],
            archivedAt: null,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
            comments: [],
            activityEvents: []
          }
        ]
      })
      .expect(200);

    const freshIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Fresh CSV issue',
        description: 'Recently updated issue should stay out of stale exports.',
        status: 'todo',
        priority: 'medium',
        labels: ['csv']
      })
      .expect(201);

    const response = await request(app)
      .get('/api/export.csv?staleOnly=true&status=todo&label=csv')
      .expect(200)
      .expect('Content-Type', /text\/csv/);

    const rowsById = new Map(
      parseCsvRows(response.text)
        .slice(1)
        .map((row) => [row[0], row])
    );

    expect(rowsById.size).toBe(1);
    expect(rowsById.get('00000000-0000-4000-8000-000000000338')).toEqual([
      '00000000-0000-4000-8000-000000000338',
      'Stale CSV issue',
      'Old enough to appear in stale exports.',
      'todo',
      'medium',
      '',
      'false',
      'false',
      '',
      '',
      'csv',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z'
    ]);
    expect(rowsById.has(freshIssue.body.id)).toBe(false);
  });

  it('neutralizes spreadsheet formula-leading CSV cells without changing JSON export', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const formulaIssue = await request(app)
      .post('/api/issues')
      .send({
        title: '=HYPERLINK("https://example.test","open")',
        description: '+SUM(1,2)',
        labels: ['-risk', 'safe']
      })
      .expect(201);
    const atIssue = await request(app)
      .post('/api/issues')
      .send({
        title: '@external-reference',
        description: '-10'
      })
      .expect(201);

    const csvResponse = await request(app)
      .get('/api/export.csv?includeArchived=true')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const csvRowsById = new Map(
      parseCsvRows(csvResponse.text)
        .slice(1)
        .map((row) => [row[0], row])
    );

    expect(csvRowsById.get(formulaIssue.body.id)?.[1]).toBe(`'=HYPERLINK("https://example.test","open")`);
    expect(csvRowsById.get(formulaIssue.body.id)?.[2]).toBe("'+SUM(1,2)");
    expect(csvRowsById.get(formulaIssue.body.id)?.[10]).toBe("'-risk|safe");
    expect(csvRowsById.get(atIssue.body.id)?.[1]).toBe("'@external-reference");
    expect(csvRowsById.get(atIssue.body.id)?.[2]).toBe("'-10");

    const filteredCsvResponse = await request(app)
      .get(`/api/export.csv?search=${encodeURIComponent('HYPERLINK')}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const filteredRows = parseCsvRows(filteredCsvResponse.text);

    expect(filteredRows).toHaveLength(2);
    expect(filteredRows[1][0]).toBe(formulaIssue.body.id);
    expect(filteredRows[1][1]).toBe(`'=HYPERLINK("https://example.test","open")`);
    expect(filteredRows[1][2]).toBe("'+SUM(1,2)");
    expect(filteredRows[1][10]).toBe("'-risk|safe");

    const jsonExport = await request(app).get('/api/export').expect(200);
    const exportedFormulaIssue = (jsonExport.body as TrackerExport).issues.find(
      (issue) => issue.id === formulaIssue.body.id
    );
    const exportedAtIssue = (jsonExport.body as TrackerExport).issues.find((issue) => issue.id === atIssue.body.id);

    expect(exportedFormulaIssue?.title).toBe(formulaIssue.body.title);
    expect(exportedFormulaIssue?.description).toBe(formulaIssue.body.description);
    expect(exportedFormulaIssue?.labels).toEqual(['-risk', 'safe']);
    expect(exportedAtIssue?.title).toBe(atIssue.body.title);
    expect(exportedAtIssue?.description).toBe(atIssue.body.description);
  });

  it('exports archived issues with archive state and activity', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived export issue', priority: 'high' })
      .expect(201);
    const archived = await request(app).post(`/api/issues/${created.body.id}/archive`).expect(200);
    const exported = await request(app).get('/api/export').expect(200);
    const exportedIssue = exported.body.issues.find((issue: { id: string }) => issue.id === created.body.id);

    expect(archived.body.archivedAt).toEqual(expect.any(String));
    expect(exportedIssue).toMatchObject({
      id: created.body.id,
      title: 'Archived export issue',
      archivedAt: archived.body.archivedAt
    });
    expect(exportedIssue.activityEvents.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_archived'
    ]);
  });

  it('exports dependencies and preserves them through import', async () => {
    const sourceApp = createApp({ databasePath: ':memory:' });
    const targetApp = createApp({ databasePath: ':memory:' });

    const blocker = await request(sourceApp)
      .post('/api/issues')
      .send({ title: 'Export blocker issue', status: 'todo', labels: ['dependency'] })
      .expect(201);
    const blocked = await request(sourceApp)
      .post('/api/issues')
      .send({
        title: 'Export blocked issue',
        status: 'in_progress',
        priority: 'high',
        labels: ['dependency', 'blocked-export']
      })
      .expect(201);

    await request(sourceApp)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);

    const savedView = await request(sourceApp)
      .post('/api/filter-views')
      .send({
        name: 'Blocked dependency export view',
        search: 'Export blocked',
        status: 'in_progress',
        priority: 'high',
        label: 'blocked-export',
        includeArchived: true,
        blockedOnly: true,
        staleOnly: false,
        pageSize: 25
      })
      .expect(201);

    const exported = await request(sourceApp).get('/api/export').expect(200);
    const exportedBlocked = (exported.body as TrackerExport).issues.find((issue) => issue.id === blocked.body.id);
    const exportedSavedView = (exported.body as TrackerExport).savedFilterViews.find(
      (view) => view.id === savedView.body.id
    );

    expect(exportedBlocked).toMatchObject({
      id: blocked.body.id,
      priority: 'high',
      labels: ['dependency', 'blocked-export'],
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });
    expect(exportedBlocked?.activityEvents.map((event) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added'
    ]);
    expect(exportedSavedView).toMatchObject({
      id: savedView.body.id,
      name: 'Blocked dependency export view',
      search: 'Export blocked',
      status: 'in_progress',
      priority: 'high',
      label: 'blocked-export',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: false,
      pageSize: 25
    });

    const preview = await request(targetApp).post('/api/import/preview').send(exported.body).expect(200);
    await request(targetApp).post('/api/import/apply').send(exported.body).expect(200);

    const importedBlocked = await request(targetApp).get(`/api/issues/${blocked.body.id}`).expect(200);
    const importedDependencies = await request(targetApp)
      .get(`/api/issues/${blocked.body.id}/dependencies`)
      .expect(200);
    const importedSavedViews = await request(targetApp).get('/api/filter-views').expect(200);
    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);

    expect(preview.body.summary.toCreate.savedFilterViews).toBe(1);
    expect(importedBlocked.body).toMatchObject({
      priority: 'high',
      labels: ['dependency', 'blocked-export'],
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });
    expect(importedDependencies.body).toMatchObject({
      issueId: blocked.body.id,
      isBlocked: true,
      dependencies: [
        {
          id: blocker.body.id,
          title: 'Export blocker issue',
          status: 'todo',
          archivedAt: null
        }
      ]
    });
    expect(importedSavedViews.body).toEqual((exported.body as TrackerExport).savedFilterViews);
    expect(importedSavedViews.body[0]).toMatchObject({
      id: savedView.body.id,
      search: 'Export blocked',
      status: 'in_progress',
      priority: 'high',
      label: 'blocked-export',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: false,
      pageSize: 25
    });
    expect(exportedAfterImport.body).toEqual(exported.body);
  });
});
