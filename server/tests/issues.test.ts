import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('issues API', () => {
  it('creates an issue and reads it back', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Add API', description: 'Persist through repository' })
      .expect(201);

    expect(created.body).toMatchObject({
      title: 'Add API',
      description: 'Persist through repository',
      status: 'todo',
      priority: 'medium'
    });
    expect(created.body.id).toEqual(expect.any(String));

    const fetched = await request(app).get(`/api/issues/${created.body.id}`).expect(200);

    expect(fetched.body).toEqual(created.body);
  });

  it('lists created issues', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: 'First issue' }).expect(201);
    await request(app).post('/api/issues').send({ title: 'Second issue' }).expect(201);

    const response = await request(app).get('/api/issues').expect(200);
    const titles = response.body.map((issue: { title: string }) => issue.title);

    expect(response.body).toHaveLength(2);
    expect(titles).toEqual(expect.arrayContaining(['First issue', 'Second issue']));
  });

  it('filters and searches listed issues', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .post('/api/issues')
      .send({
        title: 'Fix export bug',
        description: 'CSV output drops unicode names',
        status: 'todo',
        priority: 'high'
      })
      .expect(201);
    await request(app)
      .post('/api/issues')
      .send({
        title: 'Review onboarding copy',
        description: 'Tighten first-run dashboard language',
        status: 'review',
        priority: 'medium'
      })
      .expect(201);
    await request(app)
      .post('/api/issues')
      .send({
        title: 'Archive completed cleanup',
        description: 'Finished backlog cleanup',
        status: 'done',
        priority: 'low'
      })
      .expect(201);

    const filtered = await request(app).get('/api/issues?status=review&priority=medium&search=dashboard').expect(200);

    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0]).toMatchObject({
      title: 'Review onboarding copy',
      status: 'review',
      priority: 'medium'
    });

    const search = await request(app).get('/api/issues?search=unicode').expect(200);

    expect(search.body).toHaveLength(1);
    expect(search.body[0]).toMatchObject({
      title: 'Fix export bug',
      priority: 'high'
    });

    await request(app).get('/api/issues?status=done&priority=high').expect(200, []);
  });

  it('updates issue fields', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Needs update', description: 'Old description' })
      .expect(201);

    const updated = await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({
        title: 'Updated issue',
        description: 'New description',
        status: 'in_progress',
        priority: 'high'
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      title: 'Updated issue',
      description: 'New description',
      status: 'in_progress',
      priority: 'high'
    });
  });

  it('closes and reopens issues through workflow endpoints', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Workflow issue', status: 'review', priority: 'high' })
      .expect(201);

    const closed = await request(app).post(`/api/issues/${created.body.id}/close`).expect(200);

    expect(closed.body).toMatchObject({
      id: created.body.id,
      title: 'Workflow issue',
      status: 'done',
      priority: 'high'
    });

    const reopened = await request(app).post(`/api/issues/${created.body.id}/reopen`).expect(200);

    expect(reopened.body).toMatchObject({
      id: created.body.id,
      title: 'Workflow issue',
      status: 'todo',
      priority: 'high'
    });
  });

  it('returns validation errors for invalid issue payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: '   ' }).expect(400, {
      error: 'title is required'
    });

    const created = await request(app).post('/api/issues').send({ title: 'Valid issue' }).expect(201);

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ status: 'done', priority: 'urgent' })
      .expect(400, {
        error: 'Invalid issue priority'
      });

    await request(app).get('/api/issues?status=archived').expect(400, {
      error: 'Invalid issue status'
    });

    await request(app).get('/api/issues?priority=urgent').expect(400, {
      error: 'Invalid issue priority'
    });
  });

  it('returns 404 for missing issues', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).get('/api/issues/not-found').expect(404, {
      error: 'Issue not found'
    });

    await request(app).put('/api/issues/not-found').send({ title: 'Nope' }).expect(404, {
      error: 'Issue not found'
    });

    await request(app).post('/api/issues/not-found/close').expect(404, {
      error: 'Issue not found'
    });

    await request(app).post('/api/issues/not-found/reopen').expect(404, {
      error: 'Issue not found'
    });
  });
});
