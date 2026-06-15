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
  editHistory: Array<{ id: string; commentId: string }>;
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

  it('returns a structured error for invalid JSON', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const response = await request(app)
      .post('/api/import/preview')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);

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
