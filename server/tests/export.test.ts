import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

type IssueSnapshot = {
  id: string;
  createdAt: string;
  [key: string]: unknown;
};

type ExportedComment = {
  id: string;
  editHistory: unknown[];
};

type ExportedIssue = IssueSnapshot & {
  comments: ExportedComment[];
  activityEvents: Array<{ type: string }>;
};

type TrackerExport = {
  exportVersion: number;
  issues: ExportedIssue[];
};

function compareExportIssueOrder(first: IssueSnapshot, second: IssueSnapshot): number {
  return first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id);
}

describe('tracker export API', () => {
  it('exports issues with comments, edit history, and activity in stable order without mutating state', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const createdFirst = await request(app)
      .post('/api/issues')
      .send({
        title: 'First export issue',
        description: 'Original export description',
        labels: ['api', 'backup'],
        dueDate: '2999-12-31'
      })
      .expect(201);

    const createdSecond = await request(app)
      .post('/api/issues')
      .send({
        title: 'Second export issue',
        description: 'Another issue with its own comments',
        priority: 'medium'
      })
      .expect(201);

    const createdEmpty = await request(app)
      .post('/api/issues')
      .send({
        title: 'Empty export issue',
        description: 'No comments but still has activity'
      })
      .expect(201);

    await request(app)
      .put(`/api/issues/${createdFirst.body.id}`)
      .send({
        title: 'Updated first export issue',
        description: 'Ready for export',
        status: 'review',
        priority: 'high',
        labels: ['api', 'export'],
        dueDate: '2000-01-01'
      })
      .expect(200);

    await request(app)
      .put(`/api/issues/${createdSecond.body.id}`)
      .send({
        status: 'in_progress',
        priority: 'low'
      })
      .expect(200);

    const firstComment = await request(app)
      .post(`/api/issues/${createdFirst.body.id}/comments`)
      .send({ body: 'Initial export comment' })
      .expect(201);

    const secondComment = await request(app)
      .post(`/api/issues/${createdFirst.body.id}/comments`)
      .send({ body: 'Second export comment' })
      .expect(201);

    const firstEdit = await request(app)
      .put(`/api/comments/${firstComment.body.id}`)
      .send({ body: 'Edited export comment once' })
      .expect(200);

    const secondEdit = await request(app)
      .put(`/api/comments/${firstComment.body.id}`)
      .send({ body: 'Edited export comment twice' })
      .expect(200);

    const secondIssueComment = await request(app)
      .post(`/api/issues/${createdSecond.body.id}/comments`)
      .send({ body: 'Second issue comment' })
      .expect(201);

    const issueBefore = await request(app).get(`/api/issues/${createdFirst.body.id}`).expect(200);
    const secondIssueBefore = await request(app).get(`/api/issues/${createdSecond.body.id}`).expect(200);
    const emptyIssueBefore = await request(app).get(`/api/issues/${createdEmpty.body.id}`).expect(200);
    const commentsBefore = await request(app).get(`/api/issues/${createdFirst.body.id}/comments`).expect(200);
    const secondIssueCommentsBefore = await request(app)
      .get(`/api/issues/${createdSecond.body.id}/comments`)
      .expect(200);
    const historyBefore = await request(app).get(`/api/comments/${firstComment.body.id}/history`).expect(200);
    const secondCommentHistoryBefore = await request(app)
      .get(`/api/comments/${secondComment.body.id}/history`)
      .expect(200);
    const activityBefore = await request(app).get(`/api/issues/${createdFirst.body.id}/activity`).expect(200);
    const secondIssueActivityBefore = await request(app)
      .get(`/api/issues/${createdSecond.body.id}/activity`)
      .expect(200);
    const emptyIssueActivityBefore = await request(app)
      .get(`/api/issues/${createdEmpty.body.id}/activity`)
      .expect(200);

    const firstExport = await request(app).get('/api/export').expect(200);
    const secondExport = await request(app).get('/api/export').expect(200);
    const exported = firstExport.body as TrackerExport;
    const sortedIssueSnapshots = [issueBefore.body, secondIssueBefore.body, emptyIssueBefore.body].sort(
      compareExportIssueOrder
    );
    const exportedById = new Map(exported.issues.map((issue) => [issue.id, issue]));
    const exportedFirstIssue = exportedById.get(issueBefore.body.id);
    const exportedSecondIssue = exportedById.get(secondIssueBefore.body.id);
    const exportedEmptyIssue = exportedById.get(emptyIssueBefore.body.id);

    expect(firstExport.headers['content-type']).toContain('application/json');
    expect(Object.keys(firstExport.body).sort()).toEqual(['exportVersion', 'issues']);
    expect(firstExport.body).not.toHaveProperty('generatedAt');
    expect(firstExport.body).not.toHaveProperty('items');
    expect(firstExport.body).not.toHaveProperty('pagination');
    expect(exported.exportVersion).toBe(1);
    expect(exported.issues.map((issue) => issue.id)).toEqual(
      sortedIssueSnapshots.map((issue) => issue.id)
    );
    expect(exportedFirstIssue).toBeDefined();
    expect(exportedSecondIssue).toBeDefined();
    expect(exportedEmptyIssue).toBeDefined();

    expect(exportedFirstIssue).toMatchObject({
      labels: ['api', 'export'],
      dueDate: '2000-01-01',
      isOverdue: true
    });
    expect(exportedFirstIssue?.comments.map((comment) => comment.id)).toEqual(
      commentsBefore.body.map((comment: { id: string }) => comment.id)
    );
    expect(exportedFirstIssue?.comments[0]).toMatchObject({
      ...secondEdit.body,
      editHistory: historyBefore.body
    });
    expect(exportedFirstIssue?.comments[1]).toMatchObject({
      ...secondComment.body,
      editHistory: secondCommentHistoryBefore.body
    });
    expect(exportedFirstIssue?.comments[0].editHistory).toHaveLength(2);
    expect(exportedFirstIssue?.comments[0].editHistory[0]).toMatchObject({
      commentId: firstComment.body.id,
      previousBody: 'Initial export comment',
      newBody: 'Edited export comment once'
    });
    expect(exportedFirstIssue?.comments[0].editHistory[1]).toMatchObject({
      commentId: firstComment.body.id,
      previousBody: firstEdit.body.body,
      newBody: secondEdit.body.body
    });
    expect(exportedFirstIssue?.activityEvents).toEqual(activityBefore.body);
    expect(exportedFirstIssue?.activityEvents.map((event) => event.type)).toEqual([
      'issue_created',
      'issue_title_changed',
      'issue_description_changed',
      'issue_status_changed',
      'issue_priority_changed',
      'issue_due_date_changed',
      'issue_labels_changed',
      'comment_added',
      'comment_added',
      'comment_edited',
      'comment_edited'
    ]);

    expect(exportedSecondIssue?.comments).toEqual([
      {
        ...secondIssueComment.body,
        editHistory: []
      }
    ]);
    expect(exportedSecondIssue?.comments.map((comment) => comment.id)).toEqual(
      secondIssueCommentsBefore.body.map((comment: { id: string }) => comment.id)
    );
    expect(exportedSecondIssue?.activityEvents).toEqual(secondIssueActivityBefore.body);
    expect(exportedEmptyIssue?.comments).toEqual([]);
    expect(exportedEmptyIssue?.activityEvents).toEqual(emptyIssueActivityBefore.body);
    expect(secondExport.body).toEqual(firstExport.body);

    await request(app).get(`/api/issues/${createdFirst.body.id}`).expect(200, issueBefore.body);
    await request(app).get(`/api/issues/${createdSecond.body.id}`).expect(200, secondIssueBefore.body);
    await request(app).get(`/api/issues/${createdEmpty.body.id}`).expect(200, emptyIssueBefore.body);
    await request(app).get(`/api/issues/${createdFirst.body.id}/comments`).expect(200, commentsBefore.body);
    await request(app)
      .get(`/api/issues/${createdSecond.body.id}/comments`)
      .expect(200, secondIssueCommentsBefore.body);
    await request(app).get(`/api/comments/${firstComment.body.id}/history`).expect(200, historyBefore.body);
    await request(app)
      .get(`/api/comments/${secondComment.body.id}/history`)
      .expect(200, secondCommentHistoryBefore.body);
    await request(app)
      .get(`/api/issues/${createdFirst.body.id}/activity`)
      .expect(200, activityBefore.body);
    await request(app)
      .get(`/api/issues/${createdSecond.body.id}/activity`)
      .expect(200, secondIssueActivityBefore.body);
    await request(app)
      .get(`/api/issues/${createdEmpty.body.id}/activity`)
      .expect(200, emptyIssueActivityBefore.body);
  });

  it('exports archived issues with archive state and activity', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived export issue', priority: 'high' })
      .expect(201);
    const archived = await request(app).post(`/api/issues/${created.body.id}/archive`).expect(200);
    const exported = await request(app).get('/api/export').expect(200);
    const exportedIssue = exported.body.issues.find((issue: { id: string }) => issue.id === created.body.id);

    expect(archived.body.archivedAt).toEqual(expect.any(String));
    expect(exportedIssue).toMatchObject({
      id: created.body.id,
      title: 'Archived export issue',
      archivedAt: archived.body.archivedAt
    });
    expect(exportedIssue.activityEvents.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_archived'
    ]);
  });
});
