import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const validationErrorBody = (error: string) => ({
  error,
  code: 'validation_error',
  errors: [{ message: error }]
});

describe('saved filter views API', () => {
  it('creates lists fetches renames updates and deletes saved filter views', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/filter-views')
      .send({
        name: ' Review   backlog ',
        search: 'api',
        status: 'review',
        priority: 'high',
        label: 'api',
        includeArchived: true,
        blockedOnly: true,
        staleOnly: true,
        pageSize: 50
      })
      .expect(201);

    expect(created.body).toMatchObject({
      id: expect.any(String),
      name: 'Review backlog',
      search: 'api',
      status: 'review',
      priority: 'high',
      label: 'api',
      includeArchived: true,
      blockedOnly: true,
      staleOnly: true,
      pageSize: 50,
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });

    const list = await request(app).get('/api/filter-views').expect(200);

    expect(list.body).toEqual([created.body]);

    await request(app).get(`/api/filter-views/${created.body.id}`).expect(200, created.body);

    const updated = await request(app)
      .patch(`/api/filter-views/${created.body.id}`)
      .send({
        name: '  Renamed   backlog  ',
        search: 'ops',
        status: 'all',
        priority: 'medium',
        label: 'ops',
        includeArchived: false,
        blockedOnly: true,
        staleOnly: false,
        pageSize: 10
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      name: 'Renamed backlog',
      search: 'ops',
      status: 'all',
      priority: 'medium',
      label: 'ops',
      includeArchived: false,
      blockedOnly: true,
      staleOnly: false,
      pageSize: 10,
      createdAt: created.body.createdAt,
      updatedAt: expect.any(String)
    });

    await request(app).delete(`/api/filter-views/${created.body.id}`).expect(204);
    await request(app).get(`/api/filter-views/${created.body.id}`).expect(404, {
      error: 'Saved view not found'
    });
  });

  it('deletes only the saved view while preserving matching open issues', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const openIssue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Open issue in saved view',
        description: 'Should survive saved view deletion.',
        status: 'todo',
        priority: 'high',
        labels: ['saved-view-delete-guard']
      })
      .expect(201);
    const savedView = await request(app)
      .post('/api/filter-views')
      .send({
        name: 'Delete guard view',
        status: 'todo',
        priority: 'high',
        label: 'saved-view-delete-guard'
      })
      .expect(201);

    await request(app).delete(`/api/filter-views/${savedView.body.id}`).expect(204);
    await request(app).get(`/api/filter-views/${savedView.body.id}`).expect(404, {
      error: 'Saved view not found'
    });

    const matchingIssues = await request(app)
      .get('/api/issues?status=todo&priority=high&label=saved-view-delete-guard')
      .expect(200);

    expect(matchingIssues.body.items).toEqual([
      expect.objectContaining({
        id: openIssue.body.id,
        title: 'Open issue in saved view',
        status: 'todo',
        archivedAt: null
      })
    ]);

    await request(app)
      .get(`/api/issues/${openIssue.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject(openIssue.body);
      });
  });

  it('applies defaults and orders saved views deterministically', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const first = await request(app).post('/api/filter-views').send({ name: 'First view' }).expect(201);
    await request(app).post('/api/filter-views').send({ name: 'Second view' }).expect(201);

    expect(first.body).toMatchObject({
      name: 'First view',
      search: '',
      status: 'all',
      priority: 'all',
      label: '',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    });

    const list = await request(app).get('/api/filter-views').expect(200);

    expect(list.body.map((view: { name: string }) => view.name)).toEqual(
      expect.arrayContaining(['First view', 'Second view'])
    );
  });

  it('lists repeatedly updated saved views deterministically across update and rename ties', async () => {
    vi.useFakeTimers();

    try {
      const app = createApp({ databasePath: ':memory:' });

      vi.setSystemTime(new Date('2026-06-17T00:10:00.000Z'));
      const gamma = await request(app).post('/api/filter-views').send({ name: 'Gamma view' }).expect(201);

      vi.setSystemTime(new Date('2026-06-17T00:10:01.000Z'));
      const alpha = await request(app).post('/api/filter-views').send({ name: 'Alpha view' }).expect(201);

      vi.setSystemTime(new Date('2026-06-17T00:10:02.000Z'));
      const beta = await request(app).post('/api/filter-views').send({ name: 'Beta view' }).expect(201);

      vi.setSystemTime(new Date('2026-06-17T00:10:03.000Z'));
      const gammaUpdated = await request(app)
        .patch(`/api/filter-views/${gamma.body.id}`)
        .send({ search: 'archived' })
        .expect(200);

      vi.setSystemTime(new Date('2026-06-17T00:10:04.000Z'));
      const alphaUpdated = await request(app)
        .patch(`/api/filter-views/${alpha.body.id}`)
        .send({ search: 'release' })
        .expect(200);

      vi.setSystemTime(new Date('2026-06-17T00:10:05.000Z'));
      const alphaUpdatedAgain = await request(app)
        .patch(`/api/filter-views/${alpha.body.id}`)
        .send({ label: 'ops' })
        .expect(200);
      const betaRenamed = await request(app)
        .patch(`/api/filter-views/${beta.body.id}`)
        .send({ name: 'Aardvark view', blockedOnly: true })
        .expect(200);

      expect(alphaUpdated.body.createdAt).toBe(alpha.body.createdAt);
      expect(alphaUpdatedAgain.body.createdAt).toBe(alpha.body.createdAt);
      expect(betaRenamed.body.createdAt).toBe(beta.body.createdAt);
      expect(gammaUpdated.body.createdAt).toBe(gamma.body.createdAt);

      expect(alphaUpdated.body.updatedAt).toBe('2026-06-17T00:10:04.000Z');
      expect(alphaUpdatedAgain.body.updatedAt).toBe('2026-06-17T00:10:05.000Z');
      expect(betaRenamed.body.updatedAt).toBe('2026-06-17T00:10:05.000Z');
      expect(gammaUpdated.body.updatedAt).toBe('2026-06-17T00:10:03.000Z');

      const list = await request(app).get('/api/filter-views').expect(200);

      expect(list.body.map((view: { id: string }) => view.id)).toEqual([beta.body.id, alpha.body.id, gamma.body.id]);
      expect(
        list.body.map((view: { name: string; updatedAt: string }) => ({
          name: view.name,
          updatedAt: view.updatedAt
        }))
      ).toEqual([
        { name: 'Aardvark view', updatedAt: '2026-06-17T00:10:05.000Z' },
        { name: 'Alpha view', updatedAt: '2026-06-17T00:10:05.000Z' },
        { name: 'Gamma view', updatedAt: '2026-06-17T00:10:03.000Z' }
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects duplicate names and invalid saved view payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/filter-views').send({ name: 'Daily review' }).expect(201);
    const otherView = await request(app).post('/api/filter-views').send({ name: 'Ops backlog' }).expect(201);

    await request(app).post('/api/filter-views').send({ name: '  daily   REVIEW  ' }).expect(409, {
      error: 'Saved view name already exists'
    });

    await request(app).patch(`/api/filter-views/${otherView.body.id}`).send({ name: ' Daily   review ' }).expect(409, {
      error: 'Saved view name already exists'
    });

    await request(app)
      .post('/api/filter-views')
      .send({ name: '   ' })
      .expect(400, validationErrorBody('Saved view name is required'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad status', status: 'blocked' })
      .expect(400, validationErrorBody('Invalid saved view status'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad priority', priority: 'urgent' })
      .expect(400, validationErrorBody('Invalid saved view priority'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad label', label: true })
      .expect(400, validationErrorBody('Invalid saved view label'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad archive flag', includeArchived: 'true' })
      .expect(400, validationErrorBody('Invalid saved view includeArchived'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad blocked flag', blockedOnly: 'true' })
      .expect(400, validationErrorBody('Invalid saved view blockedOnly'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad stale flag', staleOnly: 'true' })
      .expect(400, validationErrorBody('Invalid saved view staleOnly'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad page size', pageSize: 101 })
      .expect(400, validationErrorBody('Invalid saved view pageSize'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Unknown key view', unexpectedField: 'survives?' })
      .expect(400, validationErrorBody('Invalid saved view payload'));
  });

  it('duplicates saved views with deterministic safe copy naming and copied filters', async () => {
    vi.useFakeTimers();

    try {
      const app = createApp({ databasePath: ':memory:' });

      vi.setSystemTime(new Date('2026-06-17T00:12:00.000Z'));
      const original = await request(app)
        .post('/api/filter-views')
        .send({
          name: 'Release review',
          search: 'release',
          status: 'review',
          priority: 'high',
          label: 'ops',
          includeArchived: true,
          blockedOnly: true,
          staleOnly: false,
          pageSize: 50
        })
        .expect(201);

      vi.setSystemTime(new Date('2026-06-17T00:12:01.000Z'));
      const firstCopy = await request(app).post(`/api/filter-views/${original.body.id}/duplicate`).expect(201);

      vi.setSystemTime(new Date('2026-06-17T00:12:02.000Z'));
      const secondCopy = await request(app).post(`/api/filter-views/${original.body.id}/duplicate`).expect(201);

      vi.setSystemTime(new Date('2026-06-17T00:12:03.000Z'));
      const thirdCopy = await request(app).post(`/api/filter-views/${firstCopy.body.id}/duplicate`).expect(201);

      expect(firstCopy.body).toMatchObject({
        name: 'Release review (copy)',
        search: original.body.search,
        status: original.body.status,
        priority: original.body.priority,
        label: original.body.label,
        includeArchived: original.body.includeArchived,
        blockedOnly: original.body.blockedOnly,
        staleOnly: original.body.staleOnly,
        pageSize: original.body.pageSize,
        createdAt: '2026-06-17T00:12:01.000Z',
        updatedAt: '2026-06-17T00:12:01.000Z'
      });
      expect(firstCopy.body.id).not.toBe(original.body.id);

      expect(secondCopy.body).toMatchObject({
        name: 'Release review (copy 2)',
        search: original.body.search,
        pageSize: original.body.pageSize,
        createdAt: '2026-06-17T00:12:02.000Z',
        updatedAt: '2026-06-17T00:12:02.000Z'
      });

      expect(thirdCopy.body).toMatchObject({
        name: 'Release review (copy 3)',
        search: firstCopy.body.search,
        pageSize: firstCopy.body.pageSize,
        createdAt: '2026-06-17T00:12:03.000Z',
        updatedAt: '2026-06-17T00:12:03.000Z'
      });

      const list = await request(app).get('/api/filter-views').expect(200);

      expect(list.body.map((view: { name: string }) => view.name)).toEqual([
        'Release review (copy 3)',
        'Release review (copy 2)',
        'Release review (copy)',
        'Release review'
      ]);

      await request(app).post('/api/filter-views/not-found/duplicate').expect(404, {
        error: 'Saved view not found'
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid saved view PATCH filters without mutating the saved view', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const created = await request(app)
      .post('/api/filter-views')
      .send({
        name: 'Patch validation target',
        search: 'release',
        status: 'review',
        priority: 'high',
        label: 'api',
        includeArchived: true,
        blockedOnly: false,
        staleOnly: true,
        pageSize: 50
      })
      .expect(201);

    const invalidPatches = [
      {
        body: { unexpectedPatchField: true },
        error: 'Invalid saved view payload'
      },
      {
        body: { search: 'ship', unexpectedPatchField: true },
        error: 'Invalid saved view payload'
      },
      {
        body: { pageSize: 0 },
        error: 'Invalid saved view pageSize'
      },
      {
        body: { pageSize: 101 },
        error: 'Invalid saved view pageSize'
      },
      {
        body: { pageSize: '50' },
        error: 'Invalid saved view pageSize'
      },
      {
        body: { includeArchived: 'true' },
        error: 'Invalid saved view includeArchived'
      },
      {
        body: { blockedOnly: 'false' },
        error: 'Invalid saved view blockedOnly'
      },
      {
        body: { staleOnly: 1 },
        error: 'Invalid saved view staleOnly'
      }
    ];

    for (const invalidPatch of invalidPatches) {
      await request(app)
        .patch(`/api/filter-views/${created.body.id}`)
        .send(invalidPatch.body)
        .expect(400, validationErrorBody(invalidPatch.error));

      await request(app).get(`/api/filter-views/${created.body.id}`).expect(200, created.body);
    }
  });

  it('returns standard JSON parse errors for saved view mutations', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .post('/api/filter-views')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });

    const created = await request(app).post('/api/filter-views').send({ name: 'Malformed body target' }).expect(201);

    await request(app)
      .patch(`/api/filter-views/${created.body.id}`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });

    await request(app).get(`/api/filter-views/${created.body.id}`).expect(200, created.body);

    await request(app)
      .delete(`/api/filter-views/${created.body.id}`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });

    await request(app).get(`/api/filter-views/${created.body.id}`).expect(200, created.body);
  });

  it('returns 404 for missing saved filter views', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).get('/api/filter-views/not-found').expect(404, {
      error: 'Saved view not found'
    });
    await request(app).patch('/api/filter-views/not-found').send({ name: 'Missing' }).expect(404, {
      error: 'Saved view not found'
    });
    await request(app).delete('/api/filter-views/not-found').expect(404, {
      error: 'Saved view not found'
    });
  });
});
