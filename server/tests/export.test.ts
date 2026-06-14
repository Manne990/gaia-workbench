import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('tracker export API', () => {
  it('exports issues with comments, edit history, and activity without mutating state', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({
        title: 'Export issue',
        description: 'Original export description',
        labels: ['api', 'backup'],
        dueDate: '2999-12-31'
      })
      .expect(201);

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({
        title: 'Updated export issue',
        description: 'Ready for export',
        status: 'review',
        priority: 'high',
        labels: ['api', 'export'],
        dueDate: '2000-01-01'
      })
      .expect(200);

    const comment = await request(app)
      .post(`/api/issues/${created.body.id}/comments`)
      .send({ body: 'Initial export comment' })
      .expect(201);

    const editedComment = await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: 'Edited export comment' })
      .expect(200);

    const issueBefore = await request(app).get(`/api/issues/${created.body.id}`).expect(200);
    const commentsBefore = await request(app).get(`/api/issues/${created.body.id}/comments`).expect(200);
    const historyBefore = await request(app).get(`/api/comments/${comment.body.id}/history`).expect(200);
    const activityBefore = await request(app).get(`/api/issues/${created.body.id}/activity`).expect(200);

    const firstExport = await request(app).get('/api/export').expect(200);
    const secondExport = await request(app).get('/api/export').expect(200);

    expect(firstExport.headers['content-type']).toContain('application/json');
    expect(firstExport.body).toEqual({
      exportVersion: 1,
      issues: [
        {
          ...issueBefore.body,
          comments: [
            {
              ...editedComment.body,
              editHistory: historyBefore.body
            }
          ],
          activityEvents: activityBefore.body
        }
      ]
    });
    expect(firstExport.body).not.toHaveProperty('generatedAt');
    expect(firstExport.body.issues[0]).toMatchObject({
      labels: ['api', 'export'],
      dueDate: '2000-01-01',
      isOverdue: true
    });
    expect(firstExport.body.issues[0].comments[0].editHistory[0]).toMatchObject({
      commentId: comment.body.id,
      previousBody: 'Initial export comment',
      newBody: 'Edited export comment'
    });
    expect(firstExport.body.issues[0].activityEvents.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_title_changed',
      'issue_description_changed',
      'issue_status_changed',
      'issue_priority_changed',
      'issue_due_date_changed',
      'issue_labels_changed',
      'comment_added',
      'comment_edited'
    ]);
    expect(secondExport.body).toEqual(firstExport.body);

    await request(app).get(`/api/issues/${created.body.id}`).expect(200, issueBefore.body);
    await request(app).get(`/api/issues/${created.body.id}/comments`).expect(200, commentsBefore.body);
    await request(app).get(`/api/comments/${comment.body.id}/history`).expect(200, historyBefore.body);
    await request(app).get(`/api/issues/${created.body.id}/activity`).expect(200, activityBefore.body);
  });
});
