import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const validationErrorBody = (error: string) => ({
  error,
  code: 'validation_error',
  errors: [{ message: error }]
});

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

  it('preserves multi-edit history and rejects blank or no-op comment edits without noise', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Comment history issue' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Initial comment' })
      .expect(201);

    await request(app).put(`/api/comments/${comment.body.id}`).send({ body: 'First edit' }).expect(200);
    const secondEdit = await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: 'Second edit' })
      .expect(200);

    const trimStableEdit = await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: '   Second edit   ' })
      .expect(200);

    expect(trimStableEdit.body).toEqual(secondEdit.body);

    await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: '   ' })
      .expect(400, validationErrorBody('body is required'));

    const currentComment = await request(app).get(`/api/issues/${issue.body.id}/comments`).expect(200);
    expect(currentComment.body).toEqual([secondEdit.body]);

    const history = await request(app).get(`/api/comments/${comment.body.id}/history`).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body).toMatchObject([
      {
        commentId: comment.body.id,
        previousBody: 'Initial comment',
        newBody: 'First edit'
      },
      {
        commentId: comment.body.id,
        previousBody: 'First edit',
        newBody: 'Second edit'
      }
    ]);
    expect(history.body.map((entry: { editedAt: string }) => Date.parse(entry.editedAt))).toEqual(
      [...history.body.map((entry: { editedAt: string }) => Date.parse(entry.editedAt))].sort(
        (left, right) => left - right
      )
    );

    const activity = await request(app).get(`/api/issues/${issue.body.id}/activity`).expect(200);
    expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'comment_added',
      'comment_edited',
      'comment_edited'
    ]);
    expect(activity.body.filter((event: { type: string }) => event.type === 'comment_edited')).toHaveLength(2);
  });

  it('exposes issue activity for issue changes and comments', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app)
      .post('/api/issues')
      .send({ title: 'Activity issue', labels: ['ui'], dueDate: '2999-12-31' })
      .expect(201);

    await request(app)
      .put(`/api/issues/${issue.body.id}`)
      .send({
        status: 'review',
        priority: 'high',
        labels: ['api'],
        dueDate: '2000-01-01'
      })
      .expect(200);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Activity comment' })
      .expect(201);
    await request(app).put(`/api/comments/${comment.body.id}`).send({ body: 'Edited activity comment' }).expect(200);

    const activity = await request(app).get(`/api/issues/${issue.body.id}/activity`).expect(200);

    expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_status_changed',
      'issue_priority_changed',
      'issue_due_date_changed',
      'issue_labels_changed',
      'comment_added',
      'comment_edited'
    ]);
    expect(activity.body[0]).toMatchObject({
      issueId: issue.body.id,
      type: 'issue_created',
      metadata: { title: 'Activity issue' }
    });
    expect(activity.body.find((event: { type: string }) => event.type === 'issue_due_date_changed')).toMatchObject({
      metadata: { from: '2999-12-31', to: '2000-01-01' }
    });
    expect(activity.body.find((event: { type: string }) => event.type === 'comment_added')).toMatchObject({
      metadata: { commentId: comment.body.id }
    });
  });

  it('orders compound activity across issue changes dependencies and comment edits', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const blocker = await request(app).post('/api/issues').send({ title: 'Blocking chronology issue' }).expect(201);
    const target = await request(app)
      .post('/api/issues')
      .send({
        title: 'Chronology target',
        labels: ['timeline'],
        dueDate: '2999-12-31'
      })
      .expect(201);

    const editedIssue = await request(app)
      .put(`/api/issues/${target.body.id}`)
      .send({
        status: 'review',
        priority: 'high',
        labels: ['activity', 'chronology'],
        dueDate: '2000-01-01'
      })
      .expect(200);
    await request(app)
      .post(`/api/issues/${target.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);
    await request(app).put(`/api/issues/${blocker.body.id}`).send({ title: 'Renamed blocker for removal' }).expect(200);
    const comment = await request(app)
      .post(`/api/issues/${target.body.id}/comments`)
      .send({ body: 'First chronology comment' })
      .expect(201);
    const editedComment = await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: 'Edited chronology comment' })
      .expect(200);
    await request(app).delete(`/api/issues/${target.body.id}/dependencies/${blocker.body.id}`).expect(200);

    const activity = await request(app).get(`/api/issues/${target.body.id}/activity`).expect(200);
    const events = activity.body as Array<{
      issueId: string;
      type: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;

    expect(events.map((event) => event.type)).toEqual([
      'issue_created',
      'issue_status_changed',
      'issue_priority_changed',
      'issue_due_date_changed',
      'issue_labels_changed',
      'issue_dependency_added',
      'comment_added',
      'comment_edited',
      'issue_dependency_removed'
    ]);
    expect(events.every((event) => event.issueId === target.body.id)).toBe(true);
    expect(events.map((event) => Date.parse(event.createdAt))).toEqual(
      [...events].map((event) => Date.parse(event.createdAt)).sort((left, right) => left - right)
    );

    const compoundIssueEvents = events.slice(1, 5);
    expect(compoundIssueEvents.map((event) => event.createdAt)).toEqual(
      Array.from({ length: 4 }, () => editedIssue.body.updatedAt)
    );
    expect(compoundIssueEvents.map((event) => event.metadata)).toEqual([
      { from: 'todo', to: 'review' },
      { from: 'medium', to: 'high' },
      { from: '2999-12-31', to: '2000-01-01' },
      { from: ['timeline'], to: ['activity', 'chronology'] }
    ]);
    expect(events.find((event) => event.type === 'issue_dependency_added')).toMatchObject({
      metadata: { dependsOnIssueId: blocker.body.id, title: 'Blocking chronology issue' }
    });
    expect(events.find((event) => event.type === 'issue_dependency_removed')).toMatchObject({
      metadata: { dependsOnIssueId: blocker.body.id, title: 'Renamed blocker for removal' }
    });
    expect(events.find((event) => event.type === 'comment_added')).toMatchObject({
      createdAt: comment.body.createdAt,
      metadata: { commentId: comment.body.id, preview: 'First chronology comment' }
    });
    expect(events.find((event) => event.type === 'comment_edited')).toMatchObject({
      createdAt: editedComment.body.updatedAt,
      metadata: {
        commentId: comment.body.id,
        previousPreview: 'First chronology comment',
        newPreview: 'Edited chronology comment'
      }
    });

    const history = await request(app).get(`/api/comments/${comment.body.id}/history`).expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      commentId: comment.body.id,
      previousBody: 'First chronology comment',
      newBody: 'Edited chronology comment',
      editedAt: editedComment.body.updatedAt
    });
    expect(history.body[0].editedAt).toBe(events.find((event) => event.type === 'comment_edited')?.createdAt);
  });

  it('preserves insertion order for dense same-timestamp mixed activity writes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T15:20:00.000Z'));

    try {
      const app = createApp({ databasePath: ':memory:' });
      const blocker = await request(app).post('/api/issues').send({ title: 'Dense blocker' }).expect(201);
      const target = await request(app)
        .post('/api/issues')
        .send({
          title: 'Dense chronology target',
          labels: ['dense']
        })
        .expect(201);

      await request(app)
        .put(`/api/issues/${target.body.id}`)
        .send({
          title: 'Dense chronology target renamed',
          status: 'review',
          priority: 'high',
          labels: ['dense', 'timeline']
        })
        .expect(200);
      await request(app)
        .post(`/api/issues/${target.body.id}/dependencies`)
        .send({ dependsOnIssueId: blocker.body.id })
        .expect(201);
      const comment = await request(app)
        .post(`/api/issues/${target.body.id}/comments`)
        .send({ body: 'Dense comment body' })
        .expect(201);
      await request(app).put(`/api/comments/${comment.body.id}`).send({ body: 'Dense comment edited' }).expect(200);
      await request(app).delete(`/api/issues/${target.body.id}/dependencies/${blocker.body.id}`).expect(200);
      await request(app).put(`/api/issues/${target.body.id}`).send({ status: 'done' }).expect(200);

      const activity = await request(app).get(`/api/issues/${target.body.id}/activity`).expect(200);
      const events = activity.body as Array<{
        type: string;
        createdAt: string;
        metadata: Record<string, unknown>;
      }>;

      expect(events.map((event) => event.type)).toEqual([
        'issue_created',
        'issue_title_changed',
        'issue_status_changed',
        'issue_priority_changed',
        'issue_labels_changed',
        'issue_dependency_added',
        'comment_added',
        'comment_edited',
        'issue_dependency_removed',
        'issue_status_changed'
      ]);
      expect(events.map((event) => event.createdAt)).toEqual(
        Array.from({ length: events.length }, () => '2026-06-16T15:20:00.000Z')
      );
      expect(events.map((event) => event.metadata)).toEqual([
        { title: 'Dense chronology target' },
        { from: 'Dense chronology target', to: 'Dense chronology target renamed' },
        { from: 'todo', to: 'review' },
        { from: 'medium', to: 'high' },
        { from: ['dense'], to: ['dense', 'timeline'] },
        { dependsOnIssueId: blocker.body.id, title: 'Dense blocker' },
        { commentId: comment.body.id, preview: 'Dense comment body' },
        {
          commentId: comment.body.id,
          previousPreview: 'Dense comment body',
          newPreview: 'Dense comment edited'
        },
        { dependsOnIssueId: blocker.body.id, title: 'Dense blocker' },
        { from: 'review', to: 'done' }
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates comment payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Validation issue' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Valid comment' })
      .expect(201);

    await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: '   ' })
      .expect(400, validationErrorBody('body is required'));

    await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: '' })
      .expect(400, validationErrorBody('body is required'));

    await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: '   ' })
      .expect(400, validationErrorBody('body is required'));
  });

  it('returns standard JSON parse errors for comment mutations', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Malformed comment contract' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .send({ body: 'Valid comment' })
      .expect(201);

    await request(app)
      .post(`/api/issues/${issue.body.id}/comments`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });

    await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });
  });

  it('returns 404 for missing comment resources', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).get('/api/issues/not-found/comments').expect(404, {
      error: 'Issue not found'
    });

    await request(app).get('/api/issues/not-found/activity').expect(404, {
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
