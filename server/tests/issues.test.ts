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
  });

  it('returns 404 for missing issues', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).get('/api/issues/not-found').expect(404, {
      error: 'Issue not found'
    });

    await request(app).put('/api/issues/not-found').send({ title: 'Nope' }).expect(404, {
      error: 'Issue not found'
    });
  });
});
