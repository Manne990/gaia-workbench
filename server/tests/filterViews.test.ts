import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('saved filter views API', () => {
  it('creates lists fetches renames updates and deletes saved filter views', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/filter-views')
      .send({
        name: ' Review backlog ',
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
        name: 'Renamed backlog',
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

  it('rejects duplicate names and invalid saved view payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/filter-views').send({ name: 'Daily review' }).expect(201);
    await request(app).post('/api/filter-views').send({ name: 'daily REVIEW' }).expect(409, {
      error: 'Saved view name already exists'
    });

    await request(app).post('/api/filter-views').send({ name: '   ' }).expect(400, {
      error: 'Saved view name is required'
    });

    await request(app).post('/api/filter-views').send({ name: 'Bad status', status: 'blocked' }).expect(400, {
      error: 'Invalid saved view status'
    });

    await request(app).post('/api/filter-views').send({ name: 'Bad priority', priority: 'urgent' }).expect(400, {
      error: 'Invalid saved view priority'
    });

    await request(app).post('/api/filter-views').send({ name: 'Bad label', label: true }).expect(400, {
      error: 'Invalid saved view label'
    });

    await request(app)
      .post('/api/filter-views')
      .send({ name: 'Bad archive flag', includeArchived: 'true' })
      .expect(400, {
        error: 'Invalid saved view includeArchived'
      });

    await request(app).post('/api/filter-views').send({ name: 'Bad blocked flag', blockedOnly: 'true' }).expect(400, {
      error: 'Invalid saved view blockedOnly'
    });

    await request(app).post('/api/filter-views').send({ name: 'Bad stale flag', staleOnly: 'true' }).expect(400, {
      error: 'Invalid saved view staleOnly'
    });

    await request(app).post('/api/filter-views').send({ name: 'Bad page size', pageSize: 101 }).expect(400, {
      error: 'Invalid saved view pageSize'
    });
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
