import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const validationErrorBody = (error: string) => ({
  error,
  code: 'validation_error',
  errors: [{ message: error }]
});

describe('validation error responses', () => {
  it('uses one response shape across issue comment dependency and saved-view APIs', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Validation shape issue' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Valid comment' })
      .expect(201);

    await request(app).post('/api/issues').send({ title: '   ' }).expect(400, validationErrorBody('title is required'));

    await request(app)
      .put(`/api/issues/${issue.body.id}`)
      .send({ priority: 'urgent' })
      .expect(400, validationErrorBody('Invalid issue priority'));

    await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: '   ' })
      .expect(400, validationErrorBody('body is required'));

    await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: '' })
      .expect(400, validationErrorBody('body is required'));

    await request(app)
      .post(`/api/issues/${issue.body.id}/dependencies`)
      .send({})
      .expect(400, validationErrorBody('dependsOnIssueId is required'));

    await request(app)
      .post('/api/filter-views')
      .send({ name: '   ' })
      .expect(400, validationErrorBody('Saved view name is required'));

    await request(app)
      .post('/api/issues')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400, validationErrorBody('Request body must be valid JSON.'));
  });

  it('keeps import validation errors plan-shaped as the intentional exception', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const response = await request(app)
      .post('/api/import/preview')
      .send({ exportVersion: 999, issues: [] })
      .expect(400);

    expect(response.body).toMatchObject({
      valid: false,
      errors: expect.any(Array)
    });
    expect(response.body).not.toHaveProperty('code');
  });
});
