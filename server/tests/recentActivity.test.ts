import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('recent activity API', () => {
  it('returns compact recent activity across issue, comment, and saved-view changes', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const firstIssue = await request(app).post('/api/issues').send({ title: 'First recent issue' }).expect(201);
    const secondIssue = await request(app).post('/api/issues').send({ title: 'Second recent issue' }).expect(201);

    await request(app)
      .post(`/api/issues/${firstIssue.body.id}/comments`)
      .send({ body: 'Recent comment body' })
      .expect(201);
    await request(app).post('/api/filter-views').send({ name: 'Recent saved view' }).expect(201);
    await request(app).put(`/api/issues/${secondIssue.body.id}`).send({ title: 'Second issue renamed' }).expect(200);

    const response = await request(app).get('/api/activity/recent?limit=5').expect(200);

    expect(response.body).toHaveLength(5);
    expect(response.body[0].type).toBe('issue_title_changed');
    expect(response.body.map((item: { type: string }) => item.type)).toEqual(
      expect.arrayContaining(['saved_filter_view_created', 'comment_added', 'issue_created'])
    );
    expect(response.body[0]).toMatchObject({
      issueId: secondIssue.body.id,
      issueTitle: 'Second issue renamed',
      metadata: {
        from: 'Second recent issue',
        to: 'Second issue renamed'
      }
    });
    expect(response.body).toContainEqual(
      expect.objectContaining({
        issueId: null,
        issueTitle: null,
        type: 'saved_filter_view_created',
        metadata: {
          name: 'Recent saved view'
        }
      })
    );
    expect(response.body).toContainEqual(
      expect.objectContaining({
        issueId: firstIssue.body.id,
        issueTitle: 'First recent issue',
        metadata: expect.objectContaining({
          preview: 'Recent comment body'
        })
      })
    );
  });

  it('validates recent activity limit bounds', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .get('/api/activity/recent?limit=0')
      .expect(400)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: 'Invalid recent activity limit parameter',
          code: 'validation_error'
        });
      });

    await request(app)
      .get('/api/activity/recent?limit=21')
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('Invalid recent activity limit parameter');
      });
  });
});
