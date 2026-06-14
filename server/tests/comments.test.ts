import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('comments API', () => {
  it('adds and lists comments for an issue', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Commented issue' }).expect(201);

    const first = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: '  First comment  ' })
      .expect(201);
    const second = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Second comment' })
      .expect(201);

    expect(first.body).toMatchObject({
      issueId: issue.body.id,
      body: 'First comment'
    });
    expect(first.body.id).toEqual(expect.any(String));

    const response = await request(app).get(`/api/issues/${issue.body.id}/comments`).expect(200);

    expect(response.body).toEqual([first.body, second.body]);
  });

  it('edits comments and exposes edit history', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Editable comment issue' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Initial comment' })
      .expect(201);

    const edited = await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: 'Edited comment' })
      .expect(200);

    expect(edited.body).toMatchObject({
      id: comment.body.id,
      issueId: issue.body.id,
      body: 'Edited comment'
    });

    const history = await request(app).get(`/api/comments/${comment.body.id}/history`).expect(200);

    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      commentId: comment.body.id,
      previousBody: 'Initial comment',
      newBody: 'Edited comment'
    });
  });

  it('validates comment payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Validation issue' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Valid comment' })
      .expect(201);

    await request(app).post(`/api/issues/${issue.body.id}/comments`).send({ body: '   ' }).expect(400, {
      error: 'body is required'
    });

    await request(app).put(`/api/comments/${comment.body.id}`).send({ body: '' }).expect(400, {
      error: 'body is required'
    });
  });

  it('returns 404 for missing comment resources', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).get('/api/issues/not-found/comments').expect(404, {
      error: 'Issue not found'
    });

    await request(app).post('/api/issues/not-found/comments').send({ body: 'No issue' }).expect(404, {
      error: 'Issue not found'
    });

    await request(app).put('/api/comments/not-found').send({ body: 'No comment' }).expect(404, {
      error: 'Comment not found'
    });

    await request(app).get('/api/comments/not-found/history').expect(404, {
      error: 'Comment not found'
    });
  });
});
