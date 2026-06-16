import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

type ImportCounts = {
  issues: number;
  comments: number;
  editHistory: number;
  activityEvents: number;
  savedFilterViews: number;
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

type ExportedComment = {
  id: string;
  issueId: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  editHistory: Array<{
    id: string;
    commentId: string;
    previousBody?: string;
    newBody?: string;
    editedAt?: string;
  }>;
};

type ExportedIssue = {
  id: string;
  title?: string;
  description?: string;
  status: string;
  priority?: string;
  labels?: string[];
  dueDate?: string | null;
  isOverdue?: boolean;
  isBlocked?: boolean;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
  dependsOnIssueIds?: string[];
  comments: ExportedComment[];
  activityEvents: Array<{
    id: string;
    issueId: string;
    type?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }>;
};

type TrackerExport = {
  exportVersion: number;
  issues: ExportedIssue[];
  savedFilterViews: SavedFilterView[];
};

const cloneExport = (payload: TrackerExport): TrackerExport => JSON.parse(JSON.stringify(payload));

function countExport(payload: TrackerExport): ImportCounts {
  return {
    issues: payload.issues.length,
    comments: payload.issues.reduce((total, issue) => total + issue.comments.length, 0),
    editHistory: payload.issues.reduce(
      (total, issue) =>
        total + issue.comments.reduce((commentTotal, comment) => commentTotal + comment.editHistory.length, 0),
      0
    ),
    activityEvents: payload.issues.reduce((total, issue) => total + issue.activityEvents.length, 0),
    savedFilterViews: payload.savedFilterViews.length
  };
}

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

async function createExportFixture(): Promise<TrackerExport> {
  const app = createApp({ databasePath: ':memory:' });

  const firstIssue = await request(app)
    .post('/api/issues')
    .send({
      title: 'Import source issue',
      description: 'Original issue body',
      labels: ['import', 'backup'],
      dueDate: '2000-01-01'
    })
    .expect(201);

  const secondIssue = await request(app)
    .post('/api/issues')
    .send({
      title: 'Second import source',
      description: 'No comments on this issue',
      priority: 'low'
    })
    .expect(201);

  await request(app)
    .put(`/api/issues/${firstIssue.body.id}`)
    .send({
      title: 'Import source issue updated',
      status: 'review',
      priority: 'high',
      labels: ['import', 'verified'],
      dueDate: '2999-12-31'
    })
    .expect(200);

  await request(app)
    .put(`/api/issues/${secondIssue.body.id}`)
    .send({
      status: 'in_progress',
      priority: 'medium'
    })
    .expect(200);

  const firstComment = await request(app)
    .post(`/api/issues/${firstIssue.body.id}/comments`)
    .send({ body: 'Import comment before edit' })
    .expect(201);

  await request(app)
    .post(`/api/issues/${firstIssue.body.id}/comments`)
    .send({ body: 'Second import comment' })
    .expect(201);

  await request(app)
    .put(`/api/comments/${firstComment.body.id}`)
    .send({ body: 'Import comment after first edit' })
    .expect(200);

  await request(app)
    .put(`/api/comments/${firstComment.body.id}`)
    .send({ body: 'Import comment after second edit' })
    .expect(200);
  await request(app)
    .post('/api/filter-views')
    .send({
      name: 'Import roundtrip view',
      search: 'import',
      status: 'review',
      priority: 'high',
      label: 'verified',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: true,
      pageSize: 50
    })
    .expect(201);

  const exported = await request(app).get('/api/export').expect(200);

  return exported.body as TrackerExport;
}

async function createArchivedExportFixture(): Promise<TrackerExport> {
  const app = createApp({ databasePath: ':memory:' });

  const created = await request(app)
    .post('/api/issues')
    .send({
      title: 'Archived import source',
      description: 'Hidden by default after import',
      priority: 'high'
    })
    .expect(201);

  await request(app)
    .post(`/api/issues/${created.body.id}/comments`)
    .send({ body: 'Archived issue comment remains available' })
    .expect(201);

  await request(app).post(`/api/issues/${created.body.id}/archive`).expect(200);

  const exported = await request(app).get('/api/export').expect(200);

  return exported.body as TrackerExport;
}

describe('tracker import API', () => {
  it('previews a valid export without mutating the target database', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const counts = countExport(payload);

    const preview = await request(targetApp).post('/api/import/preview').send(payload).expect(200);
    const issuesAfterPreview = await request(targetApp).get('/api/issues').expect(200);

    expect(preview.body).toMatchObject({
      valid: true,
      exportVersion: 1,
      summary: {
        input: counts,
        toCreate: counts,
        skip: {
          issues: 0,
          comments: 0,
          editHistory: 0,
          activityEvents: 0,
          savedFilterViews: 0
        },
        reject: 0
      },
      errors: [],
      warnings: []
    });
    expect(preview.body.decisions).toHaveLength(
      counts.issues + counts.comments + counts.editHistory + counts.activityEvents + counts.savedFilterViews
    );
    expect(issuesAfterPreview.body.pagination.total).toBe(0);
  });

  it('applies a valid export and preserves exported records', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const counts = countExport(payload);

    const applied = await request(targetApp).post('/api/import/apply').send(payload).expect(200);
    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);

    expect(applied.body).toMatchObject({
      valid: true,
      summary: {
        input: counts,
        toCreate: counts,
        skip: {
          issues: 0,
          comments: 0,
          editHistory: 0,
          activityEvents: 0,
          savedFilterViews: 0
        },
        reject: 0
      }
    });
    expect(exportedAfterImport.body).toEqual(payload);
  });

  it('preserves markdown-like and unsafe-looking body text as raw import data', async () => {
    const sourceApp = createApp({ databasePath: ':memory:' });
    const targetApp = createApp({ databasePath: ':memory:' });
    const rawDescription = [
      '**bold** _italic_ `code`',
      '[safe](https://example.com) [bad](javascript:alert(1))',
      '<script>alert(1)</script>'
    ].join('\n');
    const rawComment = 'Comment with ```code``` and <img src=x onerror=alert(1)> [bad](data:text/html,alert)';

    const created = await request(sourceApp)
      .post('/api/issues')
      .send({
        title: 'Raw markdown import source',
        description: rawDescription
      })
      .expect(201);

    await request(sourceApp).post(`/api/issues/${created.body.id}/comments`).send({ body: rawComment }).expect(201);

    const payload = await request(sourceApp).get('/api/export').expect(200);

    await request(targetApp).post('/api/import/preview').send(payload.body).expect(200);
    await request(targetApp).post('/api/import/apply').send(payload.body).expect(200);

    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);
    const importedIssue = exportedAfterImport.body.issues.find(
      (issue: ExportedIssue) => issue.title === 'Raw markdown import source'
    ) as ExportedIssue | undefined;

    expect(exportedAfterImport.body).toEqual(payload.body);
    expect(importedIssue?.description).toBe(rawDescription);
    expect(importedIssue?.comments[0].body).toBe(rawComment);
  });

  it('keeps imported raw text unchanged in JSON while neutralizing spreadsheet CSV cells', async () => {
    const sourceApp = createApp({ databasePath: ':memory:' });
    const targetApp = createApp({ databasePath: ':memory:' });
    const rawTitle = '=HYPERLINK("https://example.test","open")';
    const rawDescription = [
      '+SUM(1,2)',
      '**bold** [safe](https://example.com) [bad](javascript:alert(1))',
      '<script>alert(1)</script>'
    ].join('\n');
    const rawComment = '@comment formula marker stays raw with <img src=x onerror=alert(1)> and `code`';

    const created = await request(sourceApp)
      .post('/api/issues')
      .send({
        title: rawTitle,
        description: rawDescription,
        labels: ['-risk', 'safe']
      })
      .expect(201);

    await request(sourceApp).post(`/api/issues/${created.body.id}/comments`).send({ body: rawComment }).expect(201);

    const payload = await request(sourceApp).get('/api/export').expect(200);

    await request(targetApp).post('/api/import/preview').send(payload.body).expect(200);
    await request(targetApp).post('/api/import/apply').send(payload.body).expect(200);

    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);
    const importedIssue = (exportedAfterImport.body as TrackerExport).issues.find(
      (issue) => issue.id === created.body.id
    );

    expect(exportedAfterImport.body).toEqual(payload.body);
    expect(importedIssue?.title).toBe(rawTitle);
    expect(importedIssue?.description).toBe(rawDescription);
    expect(importedIssue?.labels).toEqual(['-risk', 'safe']);
    expect(importedIssue?.comments[0].body).toBe(rawComment);

    const csvResponse = await request(targetApp)
      .get('/api/export.csv?includeArchived=true')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const csvRowsById = new Map(
      parseCsvRows(csvResponse.text)
        .slice(1)
        .map((row) => [row[0], row])
    );

    expect(csvRowsById.get(created.body.id)?.[1]).toBe(`'=HYPERLINK("https://example.test","open")`);
    expect(csvRowsById.get(created.body.id)?.[2]).toBe(`'${rawDescription}`);
    expect(csvRowsById.get(created.body.id)?.[10]).toBe("'-risk|safe");
  });

  it('roundtrips saved filter views with preserved ids timestamps and filters', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const [sourceView] = payload.savedFilterViews;

    expect(sourceView).toMatchObject({
      name: 'Import roundtrip view',
      search: 'import',
      status: 'review',
      priority: 'high',
      label: 'verified',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: true,
      pageSize: 50
    });

    const preview = await request(targetApp).post('/api/import/preview').send(payload).expect(200);

    expect(preview.body.summary.toCreate.savedFilterViews).toBe(1);
    expect(preview.body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'savedFilterView',
          sourceId: sourceView.id,
          decision: 'import',
          matchType: 'new'
        })
      ])
    );

    await request(targetApp).post('/api/import/apply').send(payload).expect(200);

    const importedViews = await request(targetApp).get('/api/filter-views').expect(200);
    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);

    expect(importedViews.body).toEqual(payload.savedFilterViews);
    expect(exportedAfterImport.body).toEqual(payload);
  });

  it('rejects duplicate saved filter view names before import writes', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const duplicated = cloneExport(payload);

    duplicated.savedFilterViews.push({
      ...duplicated.savedFilterViews[0],
      id: 'duplicate-saved-filter-view-id',
      name: duplicated.savedFilterViews[0].name.toLocaleUpperCase()
    });

    const preview = await request(targetApp).post('/api/import/preview').send(duplicated).expect(400);
    const afterPreview = await request(targetApp).get('/api/filter-views').expect(200);
    const applied = await request(targetApp).post('/api/import/apply').send(duplicated).expect(400);
    const afterApply = await request(targetApp).get('/api/filter-views').expect(200);

    expect(preview.body.valid).toBe(false);
    expect(preview.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicate_name',
          path: '$.savedFilterViews[1].name'
        })
      ])
    );
    expect(applied.body.errors).toEqual(preview.body.errors);
    expect(afterPreview.body).toEqual([]);
    expect(afterApply.body).toEqual([]);
  });

  it('skips saved filter view replace when the new name belongs to a different view', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const [sourceView] = payload.savedFilterViews;

    await request(targetApp).post('/api/import/apply').send(payload).expect(200);
    const collision = await request(targetApp).post('/api/filter-views').send({ name: 'Collision view' }).expect(201);

    const changed = cloneExport(payload);
    changed.savedFilterViews[0] = {
      ...sourceView,
      name: collision.body.name,
      updatedAt: '2999-12-31T00:00:00.000Z'
    };

    const preview = await request(targetApp)
      .post('/api/import/preview')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);
    const decision = preview.body.decisions.find(
      (item: { entity: string; sourceId?: string }) =>
        item.entity === 'savedFilterView' && item.sourceId === sourceView.id
    );

    expect(preview.body.summary.changed.savedFilterViews).toBe(1);
    expect(preview.body.summary.toReplace.savedFilterViews).toBe(0);
    expect(preview.body.summary.skip.savedFilterViews).toBe(1);
    expect(decision).toMatchObject({
      decision: 'skip-existing',
      matchType: 'changed',
      policyDecision: 'skip',
      reasons: expect.arrayContaining(['saved view name already exists with a different id'])
    });

    await request(targetApp)
      .post('/api/import/apply')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);

    const viewsAfterApply = await request(targetApp).get('/api/filter-views').expect(200);
    const viewsById = new Map(viewsAfterApply.body.map((view: SavedFilterView) => [view.id, view]));

    expect(viewsById.get(sourceView.id)).toMatchObject({ name: sourceView.name, updatedAt: sourceView.updatedAt });
    expect(viewsById.get(collision.body.id)).toMatchObject({ name: collision.body.name });
  });

  it('applies archived issues and keeps them hidden from the default list', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createArchivedExportFixture();
    const [sourceIssue] = payload.issues;

    expect(sourceIssue.archivedAt).toEqual(expect.any(String));

    await request(targetApp).post('/api/import/apply').send(payload).expect(200);

    const defaultList = await request(targetApp).get('/api/issues').expect(200);
    const includeArchivedList = await request(targetApp).get('/api/issues?includeArchived=true').expect(200);
    const importedDetail = await request(targetApp).get(`/api/issues/${sourceIssue.id}`).expect(200);
    const importedComments = await request(targetApp).get(`/api/issues/${sourceIssue.id}/comments`).expect(200);
    const importedActivity = await request(targetApp).get(`/api/issues/${sourceIssue.id}/activity`).expect(200);
    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);

    expect(defaultList.body.pagination.total).toBe(0);
    expect(includeArchivedList.body.pagination.total).toBe(1);
    expect(includeArchivedList.body.items[0]).toMatchObject({
      id: sourceIssue.id,
      archivedAt: sourceIssue.archivedAt
    });
    expect(importedDetail.body).toMatchObject({
      id: sourceIssue.id,
      archivedAt: sourceIssue.archivedAt
    });
    expect(importedComments.body).toHaveLength(1);
    expect(importedActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'comment_added',
      'issue_archived'
    ]);
    expect(exportedAfterImport.body).toEqual(payload);
  });

  it('treats missing archivedAt in legacy exports as active issues', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const legacyPayload = cloneExport(payload);

    legacyPayload.issues.forEach((issue) => {
      delete issue.archivedAt;
    });

    await request(targetApp).post('/api/import/apply').send(legacyPayload).expect(200);

    const defaultList = await request(targetApp).get('/api/issues').expect(200);
    const exportedAfterImport = await request(targetApp).get('/api/export').expect(200);

    expect(defaultList.body.pagination.total).toBe(payload.issues.length);
    expect(exportedAfterImport.body.issues.map((issue: ExportedIssue) => issue.archivedAt)).toEqual(
      payload.issues.map(() => null)
    );
  });

  it('re-imports the same export as a deterministic no-op', async () => {
    const targetApp = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const counts = countExport(payload);

    await request(targetApp).post('/api/import/apply').send(payload).expect(200);
    const beforeReimport = await request(targetApp).get('/api/export').expect(200);
    const reapplied = await request(targetApp).post('/api/import/apply').send(payload).expect(200);
    const afterReimport = await request(targetApp).get('/api/export').expect(200);

    expect(reapplied.body).toMatchObject({
      valid: true,
      summary: {
        input: counts,
        toCreate: {
          issues: 0,
          comments: 0,
          editHistory: 0,
          activityEvents: 0,
          savedFilterViews: 0
        },
        skip: counts,
        reject: 0
      }
    });
    expect(afterReimport.body).toEqual(beforeReimport.body);
  });

  it('classifies exact duplicate and changed issue conflicts in preview', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const counts = countExport(payload);

    await request(app).post('/api/import/apply').send(payload).expect(200);

    const exactPreview = await request(app).post('/api/import/preview').send(payload).expect(200);

    expect(exactPreview.body).toMatchObject({
      policy: 'skip-conflicts',
      summary: {
        exactMatches: counts,
        changed: {
          issues: 0,
          comments: 0,
          editHistory: 0,
          activityEvents: 0,
          savedFilterViews: 0
        },
        toCreate: {
          issues: 0,
          comments: 0,
          editHistory: 0,
          activityEvents: 0,
          savedFilterViews: 0
        },
        skip: counts
      }
    });

    const derivedOnly = cloneExport(payload);
    derivedOnly.issues[0].isOverdue = !derivedOnly.issues[0].isOverdue;

    const derivedOnlyPreview = await request(app).post('/api/import/preview').send(derivedOnly).expect(200);

    expect(derivedOnlyPreview.body.summary.changed.issues).toBe(0);
    expect(derivedOnlyPreview.body.summary.exactMatches.issues).toBe(counts.issues);

    const changed = cloneExport(payload);
    changed.issues[0].title = 'Changed conflict title';
    changed.issues[0].isOverdue = !changed.issues[0].isOverdue;

    const changedPreview = await request(app).post('/api/import/preview').send(changed).expect(200);
    const changedIssueDecision = changedPreview.body.decisions.find(
      (decision: { entity: string; issueId?: string }) =>
        decision.entity === 'issue' && decision.issueId === changed.issues[0].id
    );

    expect(changedPreview.body.summary.changed.issues).toBe(1);
    expect(changedPreview.body.summary.toReplace.issues).toBe(0);
    expect(changedIssueDecision).toMatchObject({
      decision: 'skip-existing',
      matchType: 'changed',
      policyDecision: 'skip'
    });
  });

  it('replaces changed issue fields and dependencies while importing new descendants under replace policy', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const changed = cloneExport(payload);
    const changedIssue = changed.issues[0];
    const dependencyTarget = changed.issues[1];

    await request(app).post('/api/import/apply').send(payload).expect(200);

    changedIssue.title = 'Replaced import issue';
    changedIssue.description = 'Changed through replace-conflicts import.';
    changedIssue.status = 'in_progress';
    changedIssue.priority = 'low';
    changedIssue.labels = ['replace', 'conflict'];
    changedIssue.dueDate = null;
    changedIssue.updatedAt = '2999-12-30T00:00:00.000Z';
    changedIssue.dependsOnIssueIds = [dependencyTarget.id];
    changedIssue.isBlocked = dependencyTarget.status !== 'done';
    changedIssue.comments.push({
      id: 'replace-policy-new-comment',
      issueId: changedIssue.id,
      body: 'New comment imported with replaced issue',
      createdAt: '2999-12-30T00:01:00.000Z',
      updatedAt: '2999-12-30T00:01:00.000Z',
      editHistory: []
    });

    const preview = await request(app)
      .post('/api/import/preview')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);

    expect(preview.body).toMatchObject({
      policy: 'replace-conflicts',
      summary: {
        changed: expect.objectContaining({ issues: 1 }),
        toReplace: expect.objectContaining({ issues: 1 }),
        toCreate: expect.objectContaining({ comments: 1 })
      }
    });

    const applied = await request(app)
      .post('/api/import/apply')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);
    const detail = await request(app).get(`/api/issues/${changedIssue.id}`).expect(200);
    const comments = await request(app).get(`/api/issues/${changedIssue.id}/comments`).expect(200);
    const reapplied = await request(app)
      .post('/api/import/apply')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);

    expect(applied.body.summary.toReplace.issues).toBe(1);
    expect(detail.body).toMatchObject({
      id: changedIssue.id,
      title: 'Replaced import issue',
      description: 'Changed through replace-conflicts import.',
      status: 'in_progress',
      priority: 'low',
      labels: ['replace', 'conflict'],
      dueDate: null,
      dependsOnIssueIds: [dependencyTarget.id],
      isBlocked: true
    });
    expect(comments.body.some((comment: { id: string }) => comment.id === 'replace-policy-new-comment')).toBe(true);
    expect(reapplied.body.summary.toReplace.issues).toBe(0);
    expect(reapplied.body.summary.changed.issues).toBe(0);
  });

  it('preserves conflict policy invariants across mutable and immutable import surfaces', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const changed = cloneExport(payload);
    const changedIssue = changed.issues.find((issue) =>
      issue.comments.some((comment) => comment.editHistory.length > 0)
    );
    const dependencyTarget = changed.issues.find((issue) => issue.id !== changedIssue?.id);

    if (!changedIssue || !dependencyTarget) {
      throw new Error('Expected fixture to include a commented issue and a dependency target');
    }

    const changedComment = changedIssue.comments[0];
    const changedHistory = changedComment.editHistory[0];
    const changedActivity = changedIssue.activityEvents[0];
    const changedView = changed.savedFilterViews[0];
    const newCommentId = 'replace-policy-cross-surface-comment';
    const newHistoryId = 'replace-policy-cross-surface-history';
    const newActivityId = 'replace-policy-cross-surface-activity';

    expect(changedHistory).toBeDefined();
    expect(changedActivity).toBeDefined();
    await request(app).post('/api/import/apply').send(payload).expect(200);

    const beforeConflictImport = await request(app).get('/api/export').expect(200);

    changedIssue.title = 'Conflict policy replaced issue';
    changedIssue.description = 'Changed through a mixed conflict-policy import.';
    changedIssue.status = 'in_progress';
    changedIssue.priority = 'low';
    changedIssue.labels = ['replace', 'policy'];
    changedIssue.dueDate = null;
    changedIssue.archivedAt = '2999-12-30T00:00:00.000Z';
    changedIssue.updatedAt = '2999-12-30T00:00:00.000Z';
    changedIssue.dependsOnIssueIds = [dependencyTarget.id];
    changedIssue.isBlocked = dependencyTarget.status !== 'done';
    changedComment.body = 'Changed existing comment body should remain local';
    changedComment.updatedAt = '2999-12-30T00:01:00.000Z';
    changedHistory.newBody = 'Changed existing history should remain local';
    changedHistory.editedAt = '2999-12-30T00:01:30.000Z';
    changedActivity.metadata = { title: 'Changed existing activity should remain local' };
    changedActivity.createdAt = '2999-12-30T00:02:00.000Z';
    changedIssue.comments.push({
      id: newCommentId,
      issueId: changedIssue.id,
      body: 'New comment imported during replace',
      createdAt: '2999-12-30T00:03:00.000Z',
      updatedAt: '2999-12-30T00:04:00.000Z',
      editHistory: [
        {
          id: newHistoryId,
          commentId: newCommentId,
          previousBody: 'New comment draft',
          newBody: 'New comment imported during replace',
          editedAt: '2999-12-30T00:04:00.000Z'
        }
      ]
    });
    changedIssue.activityEvents.push({
      id: newActivityId,
      issueId: changedIssue.id,
      type: 'comment_added',
      metadata: { commentId: newCommentId, preview: 'New comment imported during replace' },
      createdAt: '2999-12-30T00:05:00.000Z'
    });
    changedView.name = 'Import roundtrip view replaced';
    changedView.search = 'replace policy';
    changedView.status = 'in_progress';
    changedView.priority = 'low';
    changedView.label = 'policy';
    changedView.includeArchived = true;
    changedView.blockedOnly = false;
    changedView.staleOnly = false;
    changedView.pageSize = 10;
    changedView.updatedAt = '2999-12-30T00:06:00.000Z';

    const skipPreview = await request(app).post('/api/import/preview').send(changed).expect(200);

    expect(skipPreview.body.summary).toMatchObject({
      changed: {
        issues: 1,
        comments: 1,
        editHistory: 1,
        activityEvents: 1,
        savedFilterViews: 1
      },
      toReplace: {
        issues: 0,
        comments: 0,
        editHistory: 0,
        activityEvents: 0,
        savedFilterViews: 0
      },
      toCreate: {
        issues: 0,
        comments: 0,
        editHistory: 0,
        activityEvents: 0,
        savedFilterViews: 0
      }
    });
    expect(skipPreview.body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'issue',
          sourceId: changedIssue.id,
          decision: 'skip-existing',
          policyDecision: 'skip'
        }),
        expect.objectContaining({
          entity: 'comment',
          sourceId: newCommentId,
          decision: 'skip-existing',
          matchType: 'new',
          reasons: expect.arrayContaining(['parent issue skipped'])
        }),
        expect.objectContaining({
          entity: 'savedFilterView',
          sourceId: changedView.id,
          decision: 'skip-existing',
          policyDecision: 'skip'
        })
      ])
    );

    await request(app).post('/api/import/apply').send(changed).expect(200);
    const afterSkipImport = await request(app).get('/api/export').expect(200);

    expect(afterSkipImport.body).toEqual(beforeConflictImport.body);

    const replacePreview = await request(app)
      .post('/api/import/preview')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);

    expect(replacePreview.body.summary).toMatchObject({
      changed: {
        issues: 1,
        comments: 1,
        editHistory: 1,
        activityEvents: 1,
        savedFilterViews: 1
      },
      toReplace: {
        issues: 1,
        savedFilterViews: 1
      },
      toCreate: {
        comments: 1,
        editHistory: 1,
        activityEvents: 1
      }
    });
    expect(replacePreview.body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'issue',
          sourceId: changedIssue.id,
          decision: 'replace-existing',
          policyDecision: 'replace'
        }),
        expect.objectContaining({
          entity: 'comment',
          sourceId: changedComment.id,
          decision: 'skip-existing',
          matchType: 'changed',
          reasons: expect.arrayContaining(['existing comment ids are immutable in this import policy'])
        }),
        expect.objectContaining({
          entity: 'comment',
          sourceId: newCommentId,
          decision: 'import',
          matchType: 'new'
        }),
        expect.objectContaining({
          entity: 'commentEditHistory',
          sourceId: changedHistory.id,
          decision: 'skip-existing',
          matchType: 'changed'
        }),
        expect.objectContaining({
          entity: 'commentEditHistory',
          sourceId: newHistoryId,
          decision: 'import',
          matchType: 'new'
        }),
        expect.objectContaining({
          entity: 'activityEvent',
          sourceId: changedActivity.id,
          decision: 'skip-existing',
          matchType: 'changed'
        }),
        expect.objectContaining({
          entity: 'activityEvent',
          sourceId: newActivityId,
          decision: 'import',
          matchType: 'new'
        }),
        expect.objectContaining({
          entity: 'savedFilterView',
          sourceId: changedView.id,
          decision: 'replace-existing',
          policyDecision: 'replace'
        })
      ])
    );

    const applied = await request(app)
      .post('/api/import/apply')
      .send({ ...changed, conflictPolicy: 'replace-conflicts' })
      .expect(200);
    const detail = await request(app).get(`/api/issues/${changedIssue.id}`).expect(200);
    const defaultList = await request(app).get('/api/issues').expect(200);
    const includeArchivedList = await request(app).get('/api/issues?includeArchived=true').expect(200);
    const dependencies = await request(app).get(`/api/issues/${changedIssue.id}/dependencies`).expect(200);
    const exportedAfterReplace = await request(app).get('/api/export').expect(200);
    const exportedImportedActivity = exportedAfterReplace.body.issues
      .find((issue: { id: string }) => issue.id === changedIssue.id)
      ?.activityEvents.find((event: { id: string }) => event.id === newActivityId);
    const expectedAfterReplace = cloneExport(changed);

    expectedAfterReplace.issues[0].comments[0] = payload.issues[0].comments[0];
    expectedAfterReplace.issues[0].activityEvents[0] = payload.issues[0].activityEvents[0];

    expect(applied.body.summary.toReplace).toMatchObject({ issues: 1, savedFilterViews: 1 });
    expect(applied.body.summary.toCreate).toMatchObject({
      comments: 1,
      editHistory: 1,
      activityEvents: 1
    });
    expect(detail.body).toMatchObject({
      id: changedIssue.id,
      title: 'Conflict policy replaced issue',
      archivedAt: changedIssue.archivedAt,
      dependsOnIssueIds: [dependencyTarget.id],
      isBlocked: true
    });
    expect(defaultList.body.items.map((issue: { id: string }) => issue.id)).not.toContain(changedIssue.id);
    expect(includeArchivedList.body.items.map((issue: { id: string }) => issue.id)).toContain(changedIssue.id);
    expect(dependencies.body).toMatchObject({
      issueId: changedIssue.id,
      isBlocked: true,
      dependencies: [expect.objectContaining({ id: dependencyTarget.id })]
    });
    expect(exportedImportedActivity).toMatchObject({
      type: 'comment_added',
      metadata: { commentId: newCommentId, preview: 'New comment imported during replace' }
    });
    expect(exportedAfterReplace.body).toEqual(expectedAfterReplace);
  });

  it('rejects unsupported import conflict policies without mutating existing data', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const beforeImport = await request(app).get('/api/export').expect(200);

    const response = await request(app)
      .post('/api/import/apply')
      .send({ ...payload, conflictPolicy: 'overwrite-everything' })
      .expect(400);
    const afterImport = await request(app).get('/api/export').expect(200);

    expect(response.body).toMatchObject({
      valid: false,
      policy: 'skip-conflicts',
      errors: [
        expect.objectContaining({
          code: 'invalid_import_policy',
          path: '$.conflictPolicy'
        })
      ]
    });
    expect(afterImport.body).toEqual(beforeImport.body);
  });

  it('returns a structured import plan error for invalid JSON on preview and apply', async () => {
    const app = createApp({ databasePath: ':memory:' });

    for (const route of ['/api/import/preview', '/api/import/apply']) {
      const response = await request(app).post(route).set('Content-Type', 'application/json').send('{').expect(400);

      expect(response.body).toMatchObject({
        valid: false,
        exportVersion: null,
        summary: {
          reject: 1
        },
        errors: [
          {
            code: 'invalid_json',
            path: '$',
            message: 'Request body must be valid JSON.'
          }
        ]
      });
      expect(response.body).not.toHaveProperty('error');
    }
  });

  it('rejects unsupported export versions', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const response = await request(app)
      .post('/api/import/preview')
      .send({
        exportVersion: 2,
        issues: []
      })
      .expect(400);

    expect(response.body).toMatchObject({
      valid: false,
      exportVersion: 2,
      errors: [
        {
          code: 'unsupported_version',
          path: '$.exportVersion'
        }
      ]
    });
  });

  it('rejects malformed payloads without mutating existing data', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();

    await request(app).post('/api/issues').send({ title: 'Keep me intact' }).expect(201);
    const beforeImport = await request(app).get('/api/export').expect(200);

    const malformed = cloneExport(payload);
    malformed.issues[0].status = 'blocked';

    const response = await request(app).post('/api/import/apply').send(malformed).expect(400);
    const afterImport = await request(app).get('/api/export').expect(200);

    expect(response.body.valid).toBe(false);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_status',
          path: '$.issues[0].status'
        })
      ])
    );
    expect(afterImport.body).toEqual(beforeImport.body);
  });

  it('rejects mixed-valid multi-error payloads without partial writes or activity drift', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();

    const baseline = await request(app).post('/api/issues').send({ title: 'Keep import rollback intact' }).expect(201);
    await request(app)
      .post(`/api/issues/${baseline.body.id}/comments`)
      .send({ body: 'Existing activity must remain unchanged' })
      .expect(201);
    const beforeImport = await request(app).get('/api/export').expect(200);
    const beforeActivity = await request(app).get(`/api/issues/${baseline.body.id}/activity`).expect(200);

    const malformed = cloneExport(payload);
    const issueWithCommentsIndex = malformed.issues.findIndex((issue) => issue.comments.length > 0);
    const issueWithActivityIndex = malformed.issues.findIndex((issue) => issue.activityEvents.length > 0);

    expect(issueWithCommentsIndex).toBeGreaterThanOrEqual(0);
    expect(issueWithActivityIndex).toBeGreaterThanOrEqual(0);

    malformed.issues[0].status = 'blocked';
    malformed.issues[issueWithCommentsIndex].comments[0].issueId = 'missing-parent';
    malformed.issues[issueWithActivityIndex].activityEvents[0].createdAt = '2024-02-31T00:00:00.000Z';

    const response = await request(app).post('/api/import/apply').send(malformed).expect(400);
    const afterImport = await request(app).get('/api/export').expect(200);
    const afterActivity = await request(app).get(`/api/issues/${baseline.body.id}/activity`).expect(200);

    expect(response.body.valid).toBe(false);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_status',
          path: '$.issues[0].status'
        }),
        expect.objectContaining({
          code: 'dangling_reference',
          path: `$.issues[${issueWithCommentsIndex}].comments[0].issueId`
        }),
        expect.objectContaining({
          code: 'invalid_timestamp',
          path: `$.issues[${issueWithActivityIndex}].activityEvents[0].createdAt`
        })
      ])
    );
    expect(afterImport.body).toEqual(beforeImport.body);
    expect(afterActivity.body).toEqual(beforeActivity.body);

    await request(app).get(`/api/issues/${payload.issues[0].id}`).expect(404);
  });

  it('rejects invalid archivedAt values without mutating existing data', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const invalidArchivePayload = cloneExport(payload);

    invalidArchivePayload.issues[0].archivedAt = 'not-a-timestamp';

    const response = await request(app).post('/api/import/apply').send(invalidArchivePayload).expect(400);
    const afterImport = await request(app).get('/api/export').expect(200);

    expect(response.body.valid).toBe(false);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_timestamp',
          path: '$.issues[0].archivedAt'
        })
      ])
    );
    expect(afterImport.body.issues).toEqual([]);
  });

  it('rejects calendar-impossible timestamps without mutating existing data', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const invalidTimestampPayload = cloneExport(payload);

    await request(app).post('/api/issues').send({ title: 'Keep timestamp validation intact' }).expect(201);
    const beforeImport = await request(app).get('/api/export').expect(200);

    invalidTimestampPayload.issues[0].createdAt = '2024-02-31T00:00:00.000Z';

    const response = await request(app).post('/api/import/apply').send(invalidTimestampPayload).expect(400);
    const afterImport = await request(app).get('/api/export').expect(200);

    expect(response.body.valid).toBe(false);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_timestamp',
          path: '$.issues[0].createdAt'
        })
      ])
    );
    expect(afterImport.body).toEqual(beforeImport.body);
  });

  it('rejects duplicate IDs inside the import payload', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const duplicated = cloneExport(payload);
    duplicated.issues[1].id = duplicated.issues[0].id;

    const response = await request(app).post('/api/import/preview').send(duplicated).expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicate_id',
          path: '$.issues[1].id'
        })
      ])
    );
  });

  it('rejects dangling nested references', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const dangling = cloneExport(payload);
    const issueIndex = dangling.issues.findIndex((issue) => issue.comments.length > 0);

    expect(issueIndex).toBeGreaterThanOrEqual(0);
    dangling.issues[issueIndex].comments[0].issueId = 'missing-issue';

    const response = await request(app).post('/api/import/preview').send(dangling).expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dangling_reference',
          path: `$.issues[${issueIndex}].comments[0].issueId`
        })
      ])
    );
  });

  it('rejects invalid dependency IDs and self-dependencies in import preview', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const invalid = cloneExport(payload);

    invalid.issues[0].dependsOnIssueIds = ['', invalid.issues[0].id, invalid.issues[1].id, invalid.issues[1].id];

    const response = await request(app).post('/api/import/preview').send(invalid).expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_dependency',
          path: '$.issues[0].dependsOnIssueIds[0]'
        }),
        expect.objectContaining({
          code: 'invalid_dependency',
          path: '$.issues[0].dependsOnIssueIds[1]',
          message: 'An issue cannot depend on itself.'
        }),
        expect.objectContaining({
          code: 'duplicate_dependency',
          path: '$.issues[0].dependsOnIssueIds[3]'
        })
      ])
    );
  });

  it('rejects dependency references to issues absent from the import payload and dependency cycles', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();
    const dangling = cloneExport(payload);

    dangling.issues[0].dependsOnIssueIds = ['missing-issue'];

    const danglingResponse = await request(app).post('/api/import/preview').send(dangling).expect(400);

    expect(danglingResponse.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dangling_reference',
          path: '$.issues[0].dependsOnIssueIds[0]'
        })
      ])
    );

    const cyclic = cloneExport(payload);

    cyclic.issues[0].dependsOnIssueIds = [cyclic.issues[1].id];
    cyclic.issues[1].dependsOnIssueIds = [cyclic.issues[0].id];

    const cycleResponse = await request(app).post('/api/import/preview').send(cyclic).expect(400);

    expect(cycleResponse.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dependency_cycle'
        })
      ])
    );
  });

  it('rejects dependency validation errors on apply without mutating existing tracker state', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const payload = await createExportFixture();

    await request(app).post('/api/issues').send({ title: 'Keep dependency validation intact' }).expect(201);
    const beforeImport = await request(app).get('/api/export').expect(200);

    const dangling = cloneExport(payload);
    dangling.issues[0].dependsOnIssueIds = ['missing-issue'];

    const danglingResponse = await request(app).post('/api/import/apply').send(dangling).expect(400);
    const afterDanglingImport = await request(app).get('/api/export').expect(200);

    expect(danglingResponse.body.valid).toBe(false);
    expect(danglingResponse.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dangling_reference',
          path: '$.issues[0].dependsOnIssueIds[0]'
        })
      ])
    );
    expect(afterDanglingImport.body).toEqual(beforeImport.body);

    const selfDependency = cloneExport(payload);
    selfDependency.issues[0].dependsOnIssueIds = [selfDependency.issues[0].id];

    const selfDependencyResponse = await request(app).post('/api/import/apply').send(selfDependency).expect(400);
    const afterSelfDependencyImport = await request(app).get('/api/export').expect(200);

    expect(selfDependencyResponse.body.valid).toBe(false);
    expect(selfDependencyResponse.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_dependency',
          path: '$.issues[0].dependsOnIssueIds[0]',
          message: 'An issue cannot depend on itself.'
        })
      ])
    );
    expect(afterSelfDependencyImport.body).toEqual(beforeImport.body);

    const cyclic = cloneExport(payload);
    cyclic.issues[0].dependsOnIssueIds = [cyclic.issues[1].id];
    cyclic.issues[1].dependsOnIssueIds = [cyclic.issues[0].id];

    const cycleResponse = await request(app).post('/api/import/apply').send(cyclic).expect(400);
    const afterCycleImport = await request(app).get('/api/export').expect(200);

    expect(cycleResponse.body.valid).toBe(false);
    expect(cycleResponse.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dependency_cycle'
        })
      ])
    );
    expect(afterCycleImport.body).toEqual(beforeImport.body);
  });
});
