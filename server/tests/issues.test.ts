import request from 'supertest';
import createApp from '../src/app.js';

describe('issues API', () => {
  it('creates an issue and reads it back', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Implement login page', description: 'Add OAuth button' })
      .expect(201);

    expect(created.body.title).toBe('Implement login page');
    expect(created.body.status).toBe('todo');
    expect(created.body.priority).toBe('medium');

    const fetched = await request(app)
      .get(`/api/issues/${created.body.id}`)
      .expect(200);

    expect(fetched.body.id).toBe(created.body.id);
    expect(fetched.body.description).toBe('Add OAuth button');
  });

  it('lists all issues', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: 'First issue' }).expect(201);
    await request(app).post('/api/issues').send({ title: 'Second issue' }).expect(201);

    const list = await request(app).get('/api/issues').expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0].title).toBe('Second issue');
    expect(list.body[1].title).toBe('First issue');
  });

  it('updates an issue and validates input', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Need fix', description: 'Old desc' })
      .expect(201);

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ status: 'in_progress', priority: 'high', description: 'New desc' })
      .expect(200);

    const updated = await request(app)
      .get(`/api/issues/${created.body.id}`)
      .expect(200);

    expect(updated.body.status).toBe('in_progress');
    expect(updated.body.priority).toBe('high');
    expect(updated.body.description).toBe('New desc');
  });

  it('supports close and reopen transitions', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Lifecycle issue' })
      .expect(201);

    const closed = await request(app)
      .post(`/api/issues/${created.body.id}/close`)
      .expect(200);

    expect(closed.body.status).toBe('done');

    const reopened = await request(app)
      .post(`/api/issues/${created.body.id}/reopen`)
      .expect(200);

    expect(reopened.body.status).toBe('todo');
  });

  it('returns 400 for invalid issue payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .post('/api/issues')
      .send({ title: '   ' })
      .expect(400);

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'valid' })
      .expect(201);

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ status: 'done', priority: 'urgent' })
      .expect(400);
  });

  it('returns 404 for missing issue', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).get('/api/issues/not-found').expect(404);
    await request(app).put('/api/issues/not-found').send({ title: 'Nope' }).expect(404);
  });
});
