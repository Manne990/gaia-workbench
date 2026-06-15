import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

type ImportCounts = {
  issues: number;
  comments: number;
  editHistory: number;
  activityEvents: number;
};

type ExportedComment = {
  id: string;
  issueId: string;
  body?: string;
  editHistory: Array<{ id: string; commentId: string }>;
};

type ExportedIssue = {
  id: string;
  title?: string;
  description?: string;
  status: string;
  archivedAt?: string | null;
  dependsOnIssueIds?: string[];
  comments: ExportedComment[];
  activityEvents: Array<{ id: string; issueId: string }>;
};

type TrackerExport = {
  exportVersion: number;
  issues: ExportedIssue[];
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
    activityEvents: payload.issues.reduce((total, issue) => total + issue.activityEvents.length, 0)
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
          activityEvents: 0
        },
        reject: 0
      },
      errors: [],
      warnings: []
    });
    expect(preview.body.decisions).toHaveLength(
      counts.issues + counts.comments + counts.editHistory + counts.activityEvents
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
          activityEvents: 0
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
          activityEvents: 0
        },
        skip: counts,
        reject: 0
      }
    });
    expect(afterReimport.body).toEqual(beforeReimport.body);
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

  it('rejects dangling dependency references and dependency cycles', async () => {
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
});
