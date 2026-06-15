import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('issues API', () => {
  it('creates an issue and reads it back', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({
        title: 'Add API',
        description: 'Persist through repository',
        labels: ['api', 'backend', 'api'],
        dueDate: '2999-12-31'
      })
      .expect(201);

    expect(created.body).toMatchObject({
      title: 'Add API',
      description: 'Persist through repository',
      status: 'todo',
      priority: 'medium',
      labels: ['api', 'backend'],
      dueDate: '2999-12-31',
      archivedAt: null,
      isOverdue: false,
      isBlocked: false,
      dependsOnIssueIds: []
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
    const titles = response.body.items.map((issue: { title: string }) => issue.title);

    expect(response.body.items).toHaveLength(2);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 2,
      totalPages: 1,
      hasMore: false,
      hasPrevious: false
    });
    expect(response.body.summary).toMatchObject({
      totalByStatus: {
        todo: 2,
        in_progress: 0,
        review: 0,
        done: 0
      },
      totalHighPriority: 0
    });
    expect(response.body.sort).toEqual({ field: 'created_at,id', direction: 'desc,desc' });
    expect(titles).toEqual(expect.arrayContaining(['First issue', 'Second issue']));
  });

  it('paginates listed issues with deterministic metadata', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: 'Page issue 1' }).expect(201);
    await request(app).post('/api/issues').send({ title: 'Page issue 2' }).expect(201);
    await request(app).post('/api/issues').send({ title: 'Page issue 3' }).expect(201);

    const firstPage = await request(app).get('/api/issues?page=1&limit=2').expect(200);
    const secondPage = await request(app).get('/api/issues?page=2&limit=2').expect(200);

    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasMore: true,
      hasPrevious: false
    });
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.pagination).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasMore: false,
      hasPrevious: true
    });
    expect(new Set(firstPage.body.items.map((issue: { id: string }) => issue.id)).size).toBe(2);
    expect(firstPage.body.items.map((issue: { id: string }) => issue.id)).not.toContain(secondPage.body.items[0].id);
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

    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1
    });
    expect(filtered.body.items[0]).toMatchObject({
      title: 'Review onboarding copy',
      status: 'review',
      priority: 'medium'
    });

    const search = await request(app).get('/api/issues?search=unicode').expect(200);

    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0]).toMatchObject({
      title: 'Fix export bug',
      priority: 'high'
    });

    const noMatches = await request(app).get('/api/issues?status=done&priority=high').expect(200);

    expect(noMatches.body.items).toEqual([]);
    expect(noMatches.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
      hasMore: false,
      hasPrevious: false
    });
  });

  it('filters issues by blocked state derived from active dependencies', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Dependency blocker', status: 'todo' })
      .expect(201);
    const blockedIssue = await request(app)
      .post('/api/issues')
      .send({ title: 'Blocked issue', status: 'in_progress', priority: 'high' })
      .expect(201);
    const resolvedDependencyIssue = await request(app)
      .post('/api/issues')
      .send({ title: 'Issue with resolved dependency', status: 'todo' })
      .expect(201);
    const unblockedIssue = await request(app)
      .post('/api/issues')
      .send({ title: 'Unblocked issue', status: 'todo' })
      .expect(201);

    await request(app)
      .post(`/api/issues/${blockedIssue.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${resolvedDependencyIssue.body.id}/dependencies`)
      .send({ dependsOnIssueId: unblockedIssue.body.id })
      .expect(201);
    await request(app).put(`/api/issues/${unblockedIssue.body.id}`).send({ status: 'done' }).expect(200);

    const blockedOnly = await request(app).get('/api/issues?blockedOnly=true').expect(200);
    const blockedOnlyIds = blockedOnly.body.items.map((issue: { id: string }) => issue.id);

    expect(blockedOnlyIds).toEqual([blockedIssue.body.id]);
    expect(blockedOnly.body.pagination.total).toBe(1);
    expect(blockedOnly.body.items[0]).toMatchObject({
      title: 'Blocked issue',
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });

    const blockedWithFilter = await request(app).get('/api/issues?blockedOnly=true&status=in_progress').expect(200);

    expect(blockedWithFilter.body.items).toHaveLength(1);
    expect(blockedWithFilter.body.items[0].id).toBe(blockedIssue.body.id);
    expect(blockedWithFilter.body.pagination.total).toBe(1);
  });

  it('returns empty pages with stable metadata when requested page is out of range', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: 'Only issue' }).expect(201);

    const response = await request(app).get('/api/issues?page=4&limit=2').expect(200);

    expect(response.body.items).toEqual([]);
    expect(response.body.pagination).toMatchObject({
      page: 4,
      limit: 2,
      total: 1,
      totalPages: 1,
      hasMore: false,
      hasPrevious: true
    });
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
        priority: 'high',
        labels: ['docs', 'ui'],
        dueDate: '2000-01-01'
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      title: 'Updated issue',
      description: 'New description',
      status: 'in_progress',
      priority: 'high',
      labels: ['docs', 'ui'],
      dueDate: '2000-01-01',
      isOverdue: true
    });

    const relabeled = await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ labels: ['api'], dueDate: null })
      .expect(200);

    expect(relabeled.body).toMatchObject({
      id: created.body.id,
      labels: ['api'],
      dueDate: null,
      isOverdue: false
    });
  });

  it('returns derived overdue state for active issues only', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const overdue = await request(app)
      .post('/api/issues')
      .send({ title: 'Past due issue', dueDate: '2000-01-01' })
      .expect(201);
    const donePastDue = await request(app)
      .post('/api/issues')
      .send({ title: 'Done past due issue', status: 'done', dueDate: '2000-01-01' })
      .expect(201);
    const future = await request(app)
      .post('/api/issues')
      .send({ title: 'Future due issue', dueDate: '2999-12-31' })
      .expect(201);

    expect(overdue.body).toMatchObject({
      dueDate: '2000-01-01',
      isOverdue: true
    });
    expect(donePastDue.body).toMatchObject({
      dueDate: '2000-01-01',
      isOverdue: false
    });
    expect(future.body).toMatchObject({
      dueDate: '2999-12-31',
      isOverdue: false
    });

    const list = await request(app).get('/api/issues').expect(200);
    const byTitle = new Map(list.body.items.map((issue: { title: string }) => [issue.title, issue]));

    expect(byTitle.get('Past due issue')).toMatchObject({ isOverdue: true });
    expect(byTitle.get('Done past due issue')).toMatchObject({ isOverdue: false });
    expect(byTitle.get('Future due issue')).toMatchObject({ isOverdue: false });
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

  it('archives and unarchives issues without deleting detail comments or activity', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const archivedCandidate = await request(app)
      .post('/api/issues')
      .send({ title: 'Archive me', priority: 'high' })
      .expect(201);
    const activeIssue = await request(app)
      .post('/api/issues')
      .send({ title: 'Keep active', priority: 'medium' })
      .expect(201);
    const comment = await request(app)
      .post(`/api/issues/${archivedCandidate.body.id}/comments`)
      .send({ body: 'Comment stays visible after archive' })
      .expect(201);

    const archived = await request(app).post(`/api/issues/${archivedCandidate.body.id}/archive`).expect(200);

    expect(archived.body).toMatchObject({
      id: archivedCandidate.body.id,
      title: 'Archive me'
    });
    expect(archived.body.archivedAt).toEqual(expect.any(String));

    const defaultList = await request(app).get('/api/issues').expect(200);

    expect(defaultList.body.items.map((issue: { id: string }) => issue.id)).toEqual([activeIssue.body.id]);
    expect(defaultList.body.pagination.total).toBe(1);
    expect(defaultList.body.summary).toMatchObject({
      totalByStatus: {
        todo: 1,
        in_progress: 0,
        review: 0,
        done: 0
      },
      totalHighPriority: 0
    });

    const includeArchivedList = await request(app).get('/api/issues?includeArchived=true').expect(200);

    expect(includeArchivedList.body.items.map((issue: { id: string }) => issue.id)).toEqual(
      expect.arrayContaining([archivedCandidate.body.id, activeIssue.body.id])
    );
    expect(includeArchivedList.body.pagination.total).toBe(2);
    expect(includeArchivedList.body.summary.totalHighPriority).toBe(1);

    await request(app).get(`/api/issues/${archivedCandidate.body.id}`).expect(200, archived.body);
    await request(app).get(`/api/issues/${archivedCandidate.body.id}/comments`).expect(200, [comment.body]);

    const archivedActivity = await request(app).get(`/api/issues/${archivedCandidate.body.id}/activity`).expect(200);

    expect(archivedActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'comment_added',
      'issue_archived'
    ]);

    const archivedAgain = await request(app).post(`/api/issues/${archivedCandidate.body.id}/archive`).expect(200);

    expect(archivedAgain.body).toEqual(archived.body);
    await request(app).get(`/api/issues/${archivedCandidate.body.id}/activity`).expect(200, archivedActivity.body);

    const unarchived = await request(app).post(`/api/issues/${archivedCandidate.body.id}/unarchive`).expect(200);

    expect(unarchived.body).toMatchObject({
      id: archivedCandidate.body.id,
      archivedAt: null
    });

    const restoredList = await request(app).get('/api/issues').expect(200);
    expect(restoredList.body.pagination.total).toBe(2);

    const finalActivity = await request(app).get(`/api/issues/${archivedCandidate.body.id}/activity`).expect(200);

    expect(finalActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'comment_added',
      'issue_archived',
      'issue_unarchived'
    ]);
  });

  it('adds removes and derives issue dependencies without changing workflow status', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app).post('/api/issues').send({ title: 'Blocking issue' }).expect(201);
    const blocked = await request(app)
      .post('/api/issues')
      .send({ title: 'Blocked issue', status: 'in_progress' })
      .expect(201);

    const added = await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);

    expect(added.body).toMatchObject({
      issueId: blocked.body.id,
      isBlocked: true,
      dependencies: [
        {
          id: blocker.body.id,
          title: 'Blocking issue',
          status: 'todo',
          archivedAt: null
        }
      ]
    });

    const blockedDetail = await request(app).get(`/api/issues/${blocked.body.id}`).expect(200);
    const list = await request(app).get('/api/issues').expect(200);

    expect(blockedDetail.body).toMatchObject({
      id: blocked.body.id,
      status: 'in_progress',
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });
    expect(list.body.items.find((issue: { id: string }) => issue.id === blocked.body.id)).toMatchObject({
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });

    await request(app).post(`/api/issues/${blocker.body.id}/close`).expect(200);
    await request(app)
      .get(`/api/issues/${blocked.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          isBlocked: false,
          dependsOnIssueIds: [blocker.body.id]
        });
      });

    await request(app).post(`/api/issues/${blocker.body.id}/reopen`).expect(200);
    await request(app)
      .get(`/api/issues/${blocked.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.isBlocked).toBe(true);
      });

    const dependencyActivity = await request(app).get(`/api/issues/${blocked.body.id}/activity`).expect(200);
    expect(dependencyActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added'
    ]);

    const removed = await request(app)
      .delete(`/api/issues/${blocked.body.id}/dependencies/${blocker.body.id}`)
      .expect(200);

    expect(removed.body).toMatchObject({
      issueId: blocked.body.id,
      dependencies: [],
      isBlocked: false
    });
    await request(app)
      .get(`/api/issues/${blocked.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          isBlocked: false,
          dependsOnIssueIds: []
        });
      });
  });

  it('rejects invalid dependency mutations and obvious cycles', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const first = await request(app).post('/api/issues').send({ title: 'First dependency issue' }).expect(201);
    const second = await request(app).post('/api/issues').send({ title: 'Second dependency issue' }).expect(201);
    const third = await request(app).post('/api/issues').send({ title: 'Third dependency issue' }).expect(201);
    const archived = await request(app).post('/api/issues').send({ title: 'Archived dependency issue' }).expect(201);

    await request(app).post(`/api/issues/${archived.body.id}/archive`).expect(200);

    await request(app).post(`/api/issues/${first.body.id}/dependencies`).send({}).expect(400, {
      error: 'dependsOnIssueId is required'
    });
    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: 'missing-issue' })
      .expect(404, {
        error: 'Dependency issue not found'
      });
    await request(app)
      .post('/api/issues/missing-issue/dependencies')
      .send({ dependsOnIssueId: first.body.id })
      .expect(404, {
        error: 'Issue not found'
      });
    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: first.body.id })
      .expect(409, {
        error: 'Issue cannot depend on itself'
      });
    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: archived.body.id })
      .expect(409, {
        error: 'Cannot depend on archived issue'
      });

    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: second.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: second.body.id })
      .expect(409, {
        error: 'Issue dependency already exists'
      });
    await request(app)
      .post(`/api/issues/${second.body.id}/dependencies`)
      .send({ dependsOnIssueId: third.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${third.body.id}/dependencies`)
      .send({ dependsOnIssueId: first.body.id })
      .expect(409, {
        error: 'Issue dependency cycle detected'
      });
  });

  it('returns validation errors for invalid issue payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: '   ' }).expect(400, {
      error: 'title is required'
    });

    const created = await request(app).post('/api/issues').send({ title: 'Valid issue' }).expect(201);

    await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'done', priority: 'urgent' }).expect(400, {
      error: 'Invalid issue priority'
    });

    await request(app).get('/api/issues?status=archived').expect(400, {
      error: 'Invalid issue status'
    });

    await request(app).get('/api/issues?priority=urgent').expect(400, {
      error: 'Invalid issue priority'
    });

    await request(app).get('/api/issues?page=0').expect(400, {
      error: 'Invalid page parameter'
    });

    await request(app).get('/api/issues?page=1.5').expect(400, {
      error: 'Invalid page parameter'
    });

    await request(app).get('/api/issues?limit=0').expect(400, {
      error: 'Invalid limit parameter'
    });

    await request(app).get('/api/issues?limit=101').expect(400, {
      error: 'Invalid limit parameter'
    });

    await request(app).get('/api/issues?includeArchived=yes').expect(400, {
      error: 'Invalid includeArchived parameter'
    });

    await request(app).get('/api/issues?blockedOnly=yes').expect(400, {
      error: 'Invalid blockedOnly parameter'
    });

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ labels: [''] })
      .expect(400, {
        error: 'Invalid issue labels'
      });

    await request(app).post('/api/issues').send({ title: 'Bad due date', dueDate: '2026-02-30' }).expect(400, {
      error: 'Invalid issue due date'
    });

    await request(app).put(`/api/issues/${created.body.id}`).send({ dueDate: 'tomorrow' }).expect(400, {
      error: 'Invalid issue due date'
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

    await request(app).post('/api/issues/not-found/archive').expect(404, {
      error: 'Issue not found'
    });

    await request(app).post('/api/issues/not-found/unarchive').expect(404, {
      error: 'Issue not found'
    });
  });
});
