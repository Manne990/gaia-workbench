import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ISSUE_STATUSES } from '../src/db/index.js';

const validationErrorBody = (error: string) => ({
  error,
  code: 'validation_error',
  errors: [{ message: error }]
});

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
        priority: 'high',
        labels: ['api', 'bug']
      })
      .expect(201);
    await request(app)
      .post('/api/issues')
      .send({
        title: 'Review onboarding copy',
        description: 'Tighten first-run dashboard language',
        status: 'review',
        priority: 'medium',
        labels: ['docs']
      })
      .expect(201);
    await request(app)
      .post('/api/issues')
      .send({
        title: 'Archive completed cleanup',
        description: 'Finished backlog cleanup',
        status: 'done',
        priority: 'low',
        labels: ['cleanup']
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

    const label = await request(app).get('/api/issues?label=%20api%20&status=todo&priority=high').expect(200);

    expect(label.body.items).toHaveLength(1);
    expect(label.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1
    });
    expect(label.body.items[0]).toMatchObject({
      title: 'Fix export bug',
      labels: ['api', 'bug']
    });

    const missingLabel = await request(app).get('/api/issues?label=missing').expect(200);

    expect(missingLabel.body.items).toEqual([]);
    expect(missingLabel.body.pagination.total).toBe(0);

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

  it('treats search as case-insensitive while keeping archived matches opt-in', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const active = await request(app)
      .post('/api/issues')
      .send({
        title: 'Mixed Case Active Search',
        description: 'Visible without archived inclusion',
        status: 'review',
        priority: 'medium'
      })
      .expect(201);

    const archived = await request(app)
      .post('/api/issues')
      .send({
        title: 'archived fallback item',
        description: 'Contains MiXeD CaSe search text only in the archived issue body',
        status: 'done',
        priority: 'low'
      })
      .expect(201);

    await request(app).post(`/api/issues/${archived.body.id}/archive`).expect(200);

    const activeOnly = await request(app).get('/api/issues?search=mIxEd%20cAsE').expect(200);

    expect(activeOnly.body.items.map((issue: { id: string }) => issue.id)).toEqual([active.body.id]);
    expect(activeOnly.body.pagination.total).toBe(1);

    const includeArchived = await request(app).get('/api/issues?search=MIXED%20CASE&includeArchived=true').expect(200);

    expect(includeArchived.body.items.map((issue: { id: string }) => issue.id)).toEqual(
      expect.arrayContaining([active.body.id, archived.body.id])
    );
    expect(includeArchived.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: archived.body.id,
          archivedAt: expect.any(String)
        })
      ])
    );
    expect(includeArchived.body.pagination.total).toBe(2);
  });

  it('keeps large filtered lists paginated consistently after status changes', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const priorities = ['low', 'medium', 'high'] as const;
    type ListedIssue = { id: string; title: string; status: string; priority: string; labels: string[] };
    const assertLargeFilteredIssues = (issues: ListedIssue[]) => {
      for (const issue of issues) {
        expect(issue.title).toMatch(/^Large API guard \d{3}$/);
        expect(issue.status).toBe('review');
        expect(issue.priority).toBe('high');
        expect(issue.labels).toEqual(expect.arrayContaining(['large-api', 'group-2']));
      }
    };

    for (let index = 0; index < 120; index += 1) {
      await request(app)
        .post('/api/issues')
        .send({
          title: `Large API guard ${String(index).padStart(3, '0')}`,
          description: `Deterministic large-list fixture ${index}`,
          status: ISSUE_STATUSES[index % ISSUE_STATUSES.length],
          priority: priorities[index % priorities.length],
          labels: ['large-api', `group-${index % 6}`]
        })
        .expect(201);
    }

    const filteredQuery = '/api/issues?search=Large%20API%20guard&status=review&priority=high&label=group-2';
    const firstPage = await request(app).get(`${filteredQuery}&limit=4&page=1`).expect(200);
    const secondPage = await request(app).get(`${filteredQuery}&limit=4&page=2`).expect(200);
    const thirdPage = await request(app).get(`${filteredQuery}&limit=4&page=3`).expect(200);
    const firstPageIds = firstPage.body.items.map((issue: ListedIssue) => issue.id);
    const secondPageIds = secondPage.body.items.map((issue: ListedIssue) => issue.id);
    const thirdPageIds = thirdPage.body.items.map((issue: ListedIssue) => issue.id);
    const allFilteredPageIds = [...firstPageIds, ...secondPageIds, ...thirdPageIds];

    expect(firstPage.body.items).toHaveLength(4);
    expect(secondPage.body.items).toHaveLength(4);
    expect(thirdPage.body.items).toHaveLength(2);
    expect(new Set(allFilteredPageIds).size).toBe(10);
    assertLargeFilteredIssues(firstPage.body.items);
    assertLargeFilteredIssues(secondPage.body.items);
    assertLargeFilteredIssues(thirdPage.body.items);
    expect(firstPage.body.pagination).toMatchObject({
      page: 1,
      limit: 4,
      total: 10,
      totalPages: 3,
      hasMore: true,
      hasPrevious: false
    });
    expect(secondPage.body.pagination).toMatchObject({
      page: 2,
      limit: 4,
      total: 10,
      totalPages: 3,
      hasMore: true,
      hasPrevious: true
    });
    expect(thirdPage.body.pagination).toMatchObject({
      page: 3,
      limit: 4,
      total: 10,
      totalPages: 3,
      hasMore: false,
      hasPrevious: true
    });
    expect(firstPage.body.summary).toMatchObject({
      totalByStatus: {
        todo: 30,
        in_progress: 30,
        review: 30,
        done: 30
      },
      totalHighPriority: 40
    });

    const bulkResponse = await request(app)
      .post('/api/issues/bulk-status')
      .send({ status: 'done', issueIds: firstPageIds })
      .expect(200);
    const updatedIds = bulkResponse.body.updated.map((issue: ListedIssue) => issue.id);
    const reviewAfterBulk = await request(app).get(`${filteredQuery}&limit=4&page=1`).expect(200);
    const secondReviewPageAfterBulk = await request(app).get(`${filteredQuery}&limit=4&page=2`).expect(200);
    const doneAfterBulk = await request(app)
      .get('/api/issues?search=Large%20API%20guard&status=done&priority=high&label=group-2&limit=25&page=1')
      .expect(200);

    expect(updatedIds).toEqual(firstPageIds);
    expect(reviewAfterBulk.body.items.map((issue: ListedIssue) => issue.id)).toEqual(secondPageIds);
    expect(secondReviewPageAfterBulk.body.items.map((issue: ListedIssue) => issue.id)).toEqual(thirdPageIds);
    expect(reviewAfterBulk.body.pagination).toMatchObject({
      page: 1,
      limit: 4,
      total: 6,
      totalPages: 2,
      hasMore: true,
      hasPrevious: false
    });
    assertLargeFilteredIssues(reviewAfterBulk.body.items);
    expect(secondReviewPageAfterBulk.body.pagination).toMatchObject({
      page: 2,
      limit: 4,
      total: 6,
      totalPages: 2,
      hasMore: false,
      hasPrevious: true
    });
    assertLargeFilteredIssues(secondReviewPageAfterBulk.body.items);
    expect(reviewAfterBulk.body.summary).toMatchObject({
      totalByStatus: {
        todo: 30,
        in_progress: 30,
        review: 26,
        done: 34
      },
      totalHighPriority: 40
    });
    expect(doneAfterBulk.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 4,
      totalPages: 1,
      hasMore: false,
      hasPrevious: false
    });
    expect(doneAfterBulk.body.items.map((issue: ListedIssue) => issue.id)).toEqual(
      expect.arrayContaining(firstPageIds)
    );
  });

  it('keeps saved-view large blocked filters paginated with archived inclusion', async () => {
    const app = createApp({ databasePath: ':memory:' });
    type ListedIssue = {
      id: string;
      title: string;
      status: string;
      priority: string;
      labels: string[];
      archivedAt: string | null;
      isBlocked: boolean;
    };
    type SavedView = {
      status: string;
      priority: string;
      label: string;
      includeArchived: boolean;
      blockedOnly: boolean;
      pageSize: number;
    };
    const savedViewLabel = 'large-saved-guard';
    const blockerIds: string[] = [];
    const matchingBlockedIds = new Set<string>();
    const archivedBlockedIds = new Set<string>();

    for (let index = 0; index < 6; index += 1) {
      const blocker = await request(app)
        .post('/api/issues')
        .send({
          title: `Large saved blocker ${String(index).padStart(2, '0')}`,
          status: 'todo',
          priority: 'medium'
        })
        .expect(201);

      blockerIds.push(blocker.body.id);
    }

    for (let index = 0; index < 30; index += 1) {
      const issue = await request(app)
        .post('/api/issues')
        .send({
          title: `Large saved blocked ${String(index).padStart(2, '0')}`,
          description: `Blocked saved-view fixture ${index}`,
          status: 'review',
          priority: 'high',
          labels: [savedViewLabel, `wave-${index % 5}`]
        })
        .expect(201);

      matchingBlockedIds.add(issue.body.id);

      await request(app)
        .post(`/api/issues/${issue.body.id}/dependencies`)
        .send({ dependsOnIssueId: blockerIds[index % blockerIds.length] })
        .expect(201);

      if (index % 3 === 0) {
        await request(app).post(`/api/issues/${issue.body.id}/archive`).expect(200);
        archivedBlockedIds.add(issue.body.id);
      }
    }

    for (let index = 0; index < 40; index += 1) {
      const filler = await request(app)
        .post('/api/issues')
        .send({
          title: `Large saved unblocked filler ${String(index).padStart(2, '0')}`,
          status: index % 2 === 0 ? 'review' : 'todo',
          priority: index % 2 === 0 ? 'high' : 'medium',
          labels: [savedViewLabel, 'unblocked-filler']
        })
        .expect(201);

      if (index % 8 === 0) {
        await request(app).post(`/api/issues/${filler.body.id}/archive`).expect(200);
      }
    }

    const savedViewResponse = await request(app)
      .post('/api/filter-views')
      .send({
        name: 'Large blocked archived view',
        status: 'review',
        priority: 'high',
        label: savedViewLabel,
        includeArchived: true,
        blockedOnly: true,
        pageSize: 7
      })
      .expect(201);
    const savedView = savedViewResponse.body as SavedView;
    const savedViewParams = new URLSearchParams({
      status: savedView.status,
      priority: savedView.priority,
      label: savedView.label,
      includeArchived: String(savedView.includeArchived),
      blockedOnly: String(savedView.blockedOnly),
      limit: String(savedView.pageSize)
    });
    const firstPage = await request(app).get(`/api/issues?${savedViewParams.toString()}&page=1`).expect(200);
    const secondPage = await request(app).get(`/api/issues?${savedViewParams.toString()}&page=2`).expect(200);
    const firstPageItems = firstPage.body.items as ListedIssue[];
    const secondPageItems = secondPage.body.items as ListedIssue[];
    const firstPageIds = firstPageItems.map((issue) => issue.id);
    const secondPageIds = secondPageItems.map((issue) => issue.id);

    expect(savedView).toMatchObject({
      status: 'review',
      priority: 'high',
      label: savedViewLabel,
      includeArchived: true,
      blockedOnly: true,
      pageSize: 7
    });
    expect(firstPageItems).toHaveLength(7);
    expect(secondPageItems).toHaveLength(7);
    expect(new Set([...firstPageIds, ...secondPageIds]).size).toBe(14);
    for (const issue of [...firstPageItems, ...secondPageItems]) {
      expect(matchingBlockedIds.has(issue.id)).toBe(true);
      expect(issue).toMatchObject({
        status: 'review',
        priority: 'high',
        isBlocked: true
      });
      expect(issue.labels).toContain(savedViewLabel);
    }
    expect(firstPage.body.pagination).toMatchObject({
      page: 1,
      limit: 7,
      total: 30,
      totalPages: 5,
      hasMore: true,
      hasPrevious: false
    });
    expect(secondPage.body.pagination).toMatchObject({
      page: 2,
      limit: 7,
      total: 30,
      totalPages: 5,
      hasMore: true,
      hasPrevious: true
    });

    const allSavedViewParams = new URLSearchParams(savedViewParams);
    allSavedViewParams.set('limit', '100');
    const allSavedMatches = await request(app).get(`/api/issues?${allSavedViewParams.toString()}`).expect(200);
    const allSavedItems = allSavedMatches.body.items as ListedIssue[];

    expect(allSavedItems).toHaveLength(30);
    expect(allSavedMatches.body.pagination.total).toBe(30);
    expect(allSavedItems.map((issue) => issue.id).sort()).toEqual([...matchingBlockedIds].sort());
    expect(
      allSavedItems
        .filter((issue) => issue.archivedAt !== null)
        .map((issue) => issue.id)
        .sort()
    ).toEqual([...archivedBlockedIds].sort());

    const activeOnlyParams = new URLSearchParams(savedViewParams);
    activeOnlyParams.delete('includeArchived');
    const activeOnlyMatches = await request(app).get(`/api/issues?${activeOnlyParams.toString()}`).expect(200);
    const activeOnlyItems = activeOnlyMatches.body.items as ListedIssue[];

    expect(activeOnlyItems).toHaveLength(7);
    expect(activeOnlyItems.every((issue) => issue.archivedAt === null)).toBe(true);
    expect(activeOnlyMatches.body.pagination).toMatchObject({
      page: 1,
      limit: 7,
      total: 20,
      totalPages: 3,
      hasMore: true,
      hasPrevious: false
    });
  });

  it('returns an audit summary matching list filter semantics', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const activeOverdueTodo = await request(app)
      .post('/api/issues')
      .send({ title: 'Active overdue todo', dueDate: '2000-01-01', labels: ['ops'] })
      .expect(201);
    const activeBlocked = await request(app)
      .post('/api/issues')
      .send({
        title: 'Active blocked issue',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2000-01-01',
        labels: ['ops']
      })
      .expect(201);
    const activeDone = await request(app)
      .post('/api/issues')
      .send({ title: 'Active done but past due', status: 'done', dueDate: '2000-01-01', labels: ['ops'] })
      .expect(201);
    await request(app)
      .post('/api/issues')
      .send({ title: 'Active future todo', dueDate: '2999-12-31', labels: ['docs'] })
      .expect(201);
    const archivedOverdue = await request(app)
      .post('/api/issues')
      .send({
        title: 'Archived overdue todo',
        dueDate: '2000-01-01',
        status: 'todo',
        priority: 'low',
        labels: ['ops']
      })
      .expect(201);

    await request(app).post(`/api/issues/${archivedOverdue.body.id}/archive`).expect(200);
    await request(app)
      .post(`/api/issues/${activeBlocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: activeOverdueTodo.body.id })
      .expect(201);

    const summary = await request(app).get('/api/issues/audit-summary').expect(200);

    expect(summary.body).toMatchObject({
      totalIssues: 4,
      totalArchivedIssues: 1,
      totalBlockedIssues: 1,
      totalOverdueIssues: 2,
      totalStaleIssues: 0,
      byStatus: {
        todo: 2,
        in_progress: 1,
        review: 0,
        done: 1
      },
      byPriority: {
        low: 0,
        medium: 3,
        high: 1
      },
      dependencyEdges: {
        total: 1,
        blocked: 1,
        archivedBlocked: 0
      }
    });

    const includeArchivedSummary = await request(app).get('/api/issues/audit-summary?includeArchived=true').expect(200);

    expect(includeArchivedSummary.body.totalIssues).toBe(5);
    expect(includeArchivedSummary.body.byStatus).toMatchObject({
      todo: 3,
      in_progress: 1,
      review: 0,
      done: 1
    });

    const blockedOnlySummary = await request(app).get('/api/issues/audit-summary?blockedOnly=true').expect(200);

    expect(blockedOnlySummary.body).toMatchObject({
      totalIssues: 1,
      totalArchivedIssues: 0,
      totalBlockedIssues: 1,
      totalOverdueIssues: 1,
      totalStaleIssues: 0,
      byStatus: {
        todo: 0,
        in_progress: 1,
        review: 0,
        done: 0
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 1
      },
      dependencyEdges: {
        total: 1,
        blocked: 1,
        archivedBlocked: 0
      }
    });

    const labelList = await request(app).get('/api/issues?label=ops').expect(200);
    const labelSummary = await request(app).get('/api/issues/audit-summary?label=ops').expect(200);

    expect(labelList.body.items.map((issue: { id: string }) => issue.id)).toEqual(
      expect.arrayContaining([activeOverdueTodo.body.id, activeBlocked.body.id, activeDone.body.id])
    );
    expect(labelList.body.pagination.total).toBe(3);
    expect(labelSummary.body).toMatchObject({
      totalIssues: 3,
      totalArchivedIssues: 1,
      totalBlockedIssues: 1,
      totalOverdueIssues: 2,
      totalStaleIssues: 0,
      byStatus: {
        todo: 1,
        in_progress: 1,
        review: 0,
        done: 1
      },
      byPriority: {
        low: 0,
        medium: 2,
        high: 1
      },
      dependencyEdges: {
        total: 1,
        blocked: 1,
        archivedBlocked: 0
      }
    });
  });

  it('counts waiting review work separately from actively blocked work', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app).post('/api/issues').send({ title: 'Board health blocker' }).expect(201);
    const waitingReview = await request(app)
      .post('/api/issues')
      .send({ title: 'Board health waiting review', status: 'review', labels: ['health'] })
      .expect(201);
    const blockedReview = await request(app)
      .post('/api/issues')
      .send({ title: 'Board health blocked review', status: 'review', labels: ['health'] })
      .expect(201);
    await request(app)
      .post('/api/issues')
      .send({ title: 'Board health done issue', status: 'done', labels: ['health'] })
      .expect(201);

    await request(app)
      .post(`/api/issues/${blockedReview.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);

    const summary = await request(app).get('/api/issues/audit-summary?label=health').expect(200);

    expect(summary.body).toMatchObject({
      totalIssues: 3,
      totalBlockedIssues: 1,
      totalWaitingIssues: 1,
      byStatus: {
        review: 2,
        done: 1
      }
    });

    const blockedOnlySummary = await request(app)
      .get('/api/issues/audit-summary?label=health&blockedOnly=true')
      .expect(200);

    expect(blockedOnlySummary.body).toMatchObject({
      totalIssues: 1,
      totalBlockedIssues: 1,
      totalWaitingIssues: 0,
      byStatus: {
        review: 1
      }
    });

    await request(app).post(`/api/issues/${blocker.body.id}/close`).expect(200);

    const unblockedSummary = await request(app).get('/api/issues/audit-summary?label=health').expect(200);

    expect(unblockedSummary.body).toMatchObject({
      totalBlockedIssues: 0,
      totalWaitingIssues: 2
    });
    expect(unblockedSummary.body.byStatus.review).toBe(2);
    expect(unblockedSummary.body.totalIssues).toBe(3);
    expect(waitingReview.body.status).toBe('review');
  });

  it('surfaces archived blocker dependency edges without inflating blocked-only counts', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const liveBlocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Live audit blocker', labels: ['audit'] })
      .expect(201);
    const archivedBlocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived audit blocker', labels: ['audit'] })
      .expect(201);
    const activelyBlocked = await request(app)
      .post('/api/issues')
      .send({ title: 'Actively blocked issue', status: 'in_progress', labels: ['audit'] })
      .expect(201);
    const archivedRiskIssue = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived blocker risk issue', status: 'in_progress', labels: ['audit'] })
      .expect(201);

    await request(app)
      .post(`/api/issues/${activelyBlocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: liveBlocker.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${archivedRiskIssue.body.id}/dependencies`)
      .send({ dependsOnIssueId: archivedBlocker.body.id })
      .expect(201);
    await request(app).post(`/api/issues/${archivedBlocker.body.id}/archive`).expect(200);

    const summary = await request(app).get('/api/issues/audit-summary?label=audit').expect(200);

    expect(summary.body).toMatchObject({
      totalIssues: 3,
      totalArchivedIssues: 1,
      totalBlockedIssues: 1,
      totalWaitingIssues: 0,
      dependencyEdges: {
        total: 2,
        blocked: 1,
        archivedBlocked: 1
      }
    });

    const blockedOnlySummary = await request(app)
      .get('/api/issues/audit-summary?label=audit&blockedOnly=true')
      .expect(200);

    expect(blockedOnlySummary.body).toMatchObject({
      totalIssues: 1,
      totalArchivedIssues: 0,
      totalBlockedIssues: 1,
      dependencyEdges: {
        total: 1,
        blocked: 1,
        archivedBlocked: 0
      }
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

  it('recomputes blocked state when blockers are closed archived unarchived or removed', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app).post('/api/issues').send({ title: 'Mutable blocker issue' }).expect(201);
    const blocked = await request(app)
      .post('/api/issues')
      .send({ title: 'Blocked issue with mutable dependency', status: 'in_progress' })
      .expect(201);

    await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);

    const expectBlockedProjection = async (isBlocked: boolean, dependsOnIssueIds = [blocker.body.id]) => {
      const detail = await request(app).get(`/api/issues/${blocked.body.id}`).expect(200);
      const dependencyDetail = await request(app).get(`/api/issues/${blocked.body.id}/dependencies`).expect(200);
      const blockedOnly = await request(app).get('/api/issues?blockedOnly=true').expect(200);

      expect(detail.body).toMatchObject({
        id: blocked.body.id,
        isBlocked,
        dependsOnIssueIds
      });
      expect(dependencyDetail.body).toMatchObject({
        issueId: blocked.body.id,
        isBlocked
      });
      expect(blockedOnly.body.items.map((issue: { id: string }) => issue.id)).toEqual(
        isBlocked ? [blocked.body.id] : []
      );
      expect(blockedOnly.body.pagination.total).toBe(isBlocked ? 1 : 0);
    };

    await expectBlockedProjection(true);

    await request(app).post(`/api/issues/${blocker.body.id}/close`).expect(200);
    await expectBlockedProjection(false);

    await request(app).post(`/api/issues/${blocker.body.id}/reopen`).expect(200);
    await expectBlockedProjection(true);

    await request(app).post(`/api/issues/${blocker.body.id}/archive`).expect(200);
    await expectBlockedProjection(false);

    await request(app).post(`/api/issues/${blocker.body.id}/unarchive`).expect(200);
    await expectBlockedProjection(true);

    await request(app).delete(`/api/issues/${blocked.body.id}/dependencies/${blocker.body.id}`).expect(200);
    await expectBlockedProjection(false, []);
  });

  it('keeps blocked-only visibility scoped to archived issue filters', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived visibility blocker', status: 'todo' })
      .expect(201);
    const blocked = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived visibility blocked issue', status: 'in_progress' })
      .expect(201);

    await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);

    const expectBlockedListVisibility = async ({
      defaultIds,
      includeArchivedIds,
      includeArchivedTotalArchived,
      includeArchivedTotalBlocked
    }: {
      defaultIds: string[];
      includeArchivedIds: string[];
      includeArchivedTotalArchived: number;
      includeArchivedTotalBlocked: number;
    }) => {
      const defaultBlockedOnly = await request(app).get('/api/issues?blockedOnly=true').expect(200);
      const includeArchivedBlockedOnly = await request(app)
        .get('/api/issues?blockedOnly=true&includeArchived=true')
        .expect(200);
      const includeArchivedSummary = await request(app)
        .get('/api/issues/audit-summary?blockedOnly=true&includeArchived=true')
        .expect(200);

      expect(defaultBlockedOnly.body.items.map((issue: { id: string }) => issue.id)).toEqual(defaultIds);
      expect(defaultBlockedOnly.body.pagination.total).toBe(defaultIds.length);
      expect(includeArchivedBlockedOnly.body.items.map((issue: { id: string }) => issue.id)).toEqual(
        includeArchivedIds
      );
      expect(includeArchivedBlockedOnly.body.pagination.total).toBe(includeArchivedIds.length);
      expect(includeArchivedSummary.body).toMatchObject({
        totalIssues: includeArchivedIds.length,
        totalArchivedIssues: includeArchivedTotalArchived,
        totalBlockedIssues: includeArchivedTotalBlocked
      });
    };

    await expectBlockedListVisibility({
      defaultIds: [blocked.body.id],
      includeArchivedIds: [blocked.body.id],
      includeArchivedTotalArchived: 0,
      includeArchivedTotalBlocked: 1
    });

    const archivedBlocked = await request(app).post(`/api/issues/${blocked.body.id}/archive`).expect(200);
    const archivedDetail = await request(app).get(`/api/issues/${blocked.body.id}`).expect(200);

    expect(archivedBlocked.body).toMatchObject({
      id: blocked.body.id,
      archivedAt: expect.any(String),
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });
    expect(archivedDetail.body).toMatchObject({
      archivedAt: archivedBlocked.body.archivedAt,
      isBlocked: true,
      dependsOnIssueIds: [blocker.body.id]
    });
    await expectBlockedListVisibility({
      defaultIds: [],
      includeArchivedIds: [blocked.body.id],
      includeArchivedTotalArchived: 1,
      includeArchivedTotalBlocked: 1
    });

    await request(app).post(`/api/issues/${blocker.body.id}/close`).expect(200);
    await expectBlockedListVisibility({
      defaultIds: [],
      includeArchivedIds: [],
      includeArchivedTotalArchived: 0,
      includeArchivedTotalBlocked: 0
    });

    await request(app).post(`/api/issues/${blocker.body.id}/reopen`).expect(200);
    await expectBlockedListVisibility({
      defaultIds: [],
      includeArchivedIds: [blocked.body.id],
      includeArchivedTotalArchived: 1,
      includeArchivedTotalBlocked: 1
    });

    await request(app).post(`/api/issues/${blocked.body.id}/unarchive`).expect(200);
    await expectBlockedListVisibility({
      defaultIds: [blocked.body.id],
      includeArchivedIds: [blocked.body.id],
      includeArchivedTotalArchived: 0,
      includeArchivedTotalBlocked: 1
    });
  });

  it('filters stale issues by updated timestamp', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app)
      .post('/api/import/apply')
      .send({
        exportVersion: 1,
        issues: [
          {
            id: '00000000-0000-4000-8000-000000000115',
            title: 'Stale API issue',
            description: 'No recent movement.',
            status: 'todo',
            priority: 'medium',
            labels: [],
            dueDate: null,
            isOverdue: false,
            isBlocked: false,
            dependsOnIssueIds: [],
            archivedAt: null,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
            comments: [],
            activityEvents: []
          }
        ]
      })
      .expect(200);

    await request(app).post('/api/issues').send({ title: 'Fresh API issue' }).expect(201);

    const staleOnly = await request(app).get('/api/issues?staleOnly=true').expect(200);

    expect(staleOnly.body.items).toHaveLength(1);
    expect(staleOnly.body.items[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000115',
      title: 'Stale API issue'
    });
    expect(staleOnly.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1
    });

    const staleSummary = await request(app).get('/api/issues/audit-summary?staleOnly=true').expect(200);

    expect(staleSummary.body).toMatchObject({
      totalIssues: 1,
      totalStaleIssues: 1
    });
  });

  it('keeps stale timestamps and activity unchanged for no-op issue updates', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const staleIssueId = '00000000-0000-4000-8000-000000000174';
    const staleUpdatedAt = '2026-04-01T00:00:00.000Z';

    await request(app)
      .post('/api/import/apply')
      .send({
        exportVersion: 1,
        issues: [
          {
            id: staleIssueId,
            title: 'No-op stale issue',
            description: 'Saving unchanged normalized fields should not refresh this issue.',
            status: 'todo',
            priority: 'medium',
            labels: ['stale'],
            dueDate: null,
            isOverdue: false,
            isBlocked: false,
            dependsOnIssueIds: [],
            archivedAt: null,
            createdAt: staleUpdatedAt,
            updatedAt: staleUpdatedAt,
            comments: [],
            activityEvents: [
              {
                id: '00000000-0000-4000-8000-000000000175',
                issueId: staleIssueId,
                type: 'issue_created',
                metadata: { title: 'No-op stale issue' },
                createdAt: staleUpdatedAt
              }
            ]
          }
        ]
      })
      .expect(200);

    const beforeUpdate = await request(app).get(`/api/issues/${staleIssueId}`).expect(200);
    const beforeActivity = await request(app).get(`/api/issues/${staleIssueId}/activity`).expect(200);

    const noOpUpdate = await request(app)
      .put(`/api/issues/${staleIssueId}`)
      .send({
        title: '  No-op stale issue  ',
        description: 'Saving unchanged normalized fields should not refresh this issue.',
        status: 'todo',
        priority: 'medium',
        labels: ['stale', 'stale'],
        dueDate: null
      })
      .expect(200);

    const staleOnly = await request(app).get('/api/issues?staleOnly=true').expect(200);
    const afterActivity = await request(app).get(`/api/issues/${staleIssueId}/activity`).expect(200);

    expect(noOpUpdate.body).toEqual(beforeUpdate.body);
    expect(noOpUpdate.body.updatedAt).toBe(staleUpdatedAt);
    expect(staleOnly.body.items.map((issue: { id: string }) => issue.id)).toEqual([staleIssueId]);
    expect(afterActivity.body).toEqual(beforeActivity.body);
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

    const activity = await request(app).get(`/api/issues/${created.body.id}/activity`).expect(200);
    const activityEvents = activity.body as Array<{ type: string; metadata: unknown; createdAt: string }>;

    expect(activityEvents.map((event) => event.type)).toEqual([
      'issue_created',
      'issue_title_changed',
      'issue_description_changed',
      'issue_status_changed',
      'issue_priority_changed',
      'issue_due_date_changed',
      'issue_labels_changed'
    ]);
    expect(activityEvents.slice(1).map((event) => event.createdAt)).toEqual(
      Array.from({ length: 6 }, () => updated.body.updatedAt)
    );
    expect(activityEvents.slice(1).map((event) => event.metadata)).toEqual([
      { from: 'Needs update', to: 'Updated issue' },
      { from: 'Old description', to: 'New description' },
      { from: 'todo', to: 'in_progress' },
      { from: 'medium', to: 'high' },
      { from: null, to: '2000-01-01' },
      { from: [], to: ['docs', 'ui'] }
    ]);

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

  it('rejects mixed-valid invalid issue updates without partial writes', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({
        title: 'Original validation issue',
        description: 'Original description',
        status: 'todo',
        priority: 'low',
        labels: ['api'],
        dueDate: '2999-12-31'
      })
      .expect(201);

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({
        title: 'Partially applied title',
        description: 'Partially applied description',
        status: 'done',
        priority: 'urgent',
        labels: ['mutated'],
        dueDate: '2000-01-01'
      })
      .expect(400, validationErrorBody('Invalid issue priority'));

    await request(app)
      .get(`/api/issues/${created.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          id: created.body.id,
          title: 'Original validation issue',
          description: 'Original description',
          status: 'todo',
          priority: 'low',
          labels: ['api'],
          dueDate: '2999-12-31',
          isOverdue: false
        });
        expect(response.body.updatedAt).toBe(created.body.updatedAt);
      });

    await request(app)
      .get(`/api/issues/${created.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);
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

  it('restores issue ordering after reopening a closed issue', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const _first = await request(app).post('/api/issues').send({ title: 'Issue 01' }).expect(201);
    const second = await request(app).post('/api/issues').send({ title: 'Issue 02' }).expect(201);
    const _third = await request(app).post('/api/issues').send({ title: 'Issue 03' }).expect(201);

    const initialOrder = await request(app).get('/api/issues').expect(200);
    const expectedOrder = initialOrder.body.items.map((issue: { id: string }) => issue.id);

    await request(app).post(`/api/issues/${second.body.id}/close`).expect(200);

    const closedOrder = await request(app).get('/api/issues').expect(200);
    expect(closedOrder.body.items.map((issue: { id: string }) => issue.id)).toEqual(expectedOrder);

    await request(app).post(`/api/issues/${second.body.id}/reopen`).expect(200);

    const restoredOrder = await request(app).get('/api/issues').expect(200);
    expect(restoredOrder.body.items.map((issue: { id: string }) => issue.id)).toEqual(expectedOrder);
  });

  it('bulk changes status for selected issues with duplicate and unchanged reporting', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const first = await request(app).post('/api/issues').send({ title: 'Bulk first issue' }).expect(201);
    const second = await request(app).post('/api/issues').send({ title: 'Bulk second issue' }).expect(201);
    const unchanged = await request(app)
      .post('/api/issues')
      .send({ title: 'Bulk unchanged issue', status: 'review' })
      .expect(201);

    const response = await request(app)
      .post('/api/issues/bulk-status')
      .send({
        status: 'review',
        issueIds: [first.body.id, second.body.id, unchanged.body.id, first.body.id]
      })
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'review',
      unchangedIds: [unchanged.body.id],
      duplicateIds: [first.body.id],
      notFoundIds: []
    });
    expect(response.body.updated.map((issue: { id: string }) => issue.id)).toEqual([first.body.id, second.body.id]);
    expect(response.body.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.body.id, status: 'review' }),
        expect.objectContaining({ id: second.body.id, status: 'review' })
      ])
    );

    await request(app)
      .get(`/api/issues/${first.body.id}`)
      .expect(200)
      .expect((fetched) => {
        expect(fetched.body).toMatchObject({ status: 'review' });
      });
    await request(app)
      .get(`/api/issues/${unchanged.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);
      });
    await request(app)
      .get(`/api/issues/${first.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
          'issue_created',
          'issue_status_changed'
        ]);
        expect(activity.body[1].metadata).toEqual({ from: 'todo', to: 'review' });
      });
  });

  it('rejects bulk status transitions when every selected issue is already in the requested status', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const unchanged = await request(app)
      .post('/api/issues')
      .send({ title: 'Bulk no-op unchanged issue', status: 'review' })
      .expect(201);

    await request(app)
      .post('/api/issues/bulk-status')
      .send({
        status: 'review',
        issueIds: [unchanged.body.id, unchanged.body.id]
      })
      .expect(409, {
        error:
          'No status changes were applied. 1 selected issue is already Review. 1 duplicate id was ignored. Choose a different status or adjust the selection.'
      });

    await request(app)
      .get(`/api/issues/${unchanged.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('review');
      });
    await request(app)
      .get(`/api/issues/${unchanged.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);
      });
  });

  it('undoes the latest issue status transition with audit evidence', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Undo status API issue', status: 'todo' })
      .expect(201);
    const moved = await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'review' }).expect(200);
    const activityBeforeUndo = await request(app).get(`/api/issues/${created.body.id}/activity`).expect(200);
    const statusEventId = activityBeforeUndo.body.find(
      (event: { type: string }) => event.type === 'issue_status_changed'
    )?.id;

    const undone = await request(app)
      .post(`/api/issues/${created.body.id}/undo-status`)
      .send({ expectedStatusEventId: statusEventId })
      .expect(200);

    expect(moved.body).toMatchObject({
      id: created.body.id,
      status: 'review'
    });
    expect(undone.body).toMatchObject({
      id: created.body.id,
      status: 'todo'
    });

    await request(app)
      .get(`/api/issues/${created.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
          'issue_created',
          'issue_status_changed',
          'issue_status_changed'
        ]);
        expect(activity.body[1].metadata).toEqual({ from: 'todo', to: 'review' });
        expect(activity.body[2].metadata).toEqual({
          from: 'review',
          to: 'todo',
          undoOfEventId: activity.body[1].id
        });
      });
  });

  it('rejects status undo when the audit cursor is stale', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Undo status stale cursor issue', status: 'todo' })
      .expect(201);
    await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'review' }).expect(200);

    const activityBeforeDrift = await request(app).get(`/api/issues/${created.body.id}/activity`).expect(200);
    const staleStatusEventId = activityBeforeDrift.body.find(
      (event: { type: string }) => event.type === 'issue_status_changed'
    )?.id;

    await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'done' }).expect(200);

    await request(app)
      .post(`/api/issues/${created.body.id}/undo-status`)
      .send({ expectedStatusEventId: staleStatusEventId })
      .expect(409, {
        error: 'Status undo audit cursor is stale. Refresh issue activity before undoing status.'
      });

    await request(app)
      .get(`/api/issues/${created.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('done');
      });
    await request(app)
      .get(`/api/issues/${created.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
          'issue_created',
          'issue_status_changed',
          'issue_status_changed'
        ]);
        expect(activity.body[2].metadata).toEqual({ from: 'review', to: 'done' });
      });
  });

  it('rejects malformed status undo audit cursors', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Undo status malformed cursor issue', status: 'todo' })
      .expect(201);
    await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'review' }).expect(200);

    await request(app)
      .post(`/api/issues/${created.body.id}/undo-status`)
      .send({ expectedStatusEventId: '   ' })
      .expect(400, validationErrorBody('Invalid status undo cursor'));
  });

  it('blocks status undo when the previous status is not known', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Undo status blocked issue', status: 'todo' })
      .expect(201);

    await request(app).post(`/api/issues/${created.body.id}/undo-status`).expect(409, {
      error: 'No status transition to undo.'
    });
    await request(app)
      .get(`/api/issues/${created.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('todo');
      });
    await request(app)
      .get(`/api/issues/${created.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);
      });
  });

  it('blocks status undo while an issue is archived', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const created = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived undo status issue', status: 'todo' })
      .expect(201);

    await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'review' }).expect(200);
    await request(app).post(`/api/issues/${created.body.id}/archive`).expect(200);
    await request(app).post(`/api/issues/${created.body.id}/undo-status`).expect(409, {
      error: 'Restore archived issues before undoing status.'
    });
  });

  it('rejects malformed bulk status requests and reports mixed missing ids without blocking valid updates', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const issue = await request(app).post('/api/issues').send({ title: 'Bulk validation issue' }).expect(201);

    await request(app)
      .post('/api/issues/bulk-status')
      .send({ status: 'waiting', issueIds: [issue.body.id] })
      .expect(400, validationErrorBody('Invalid issue status'));
    await request(app)
      .post('/api/issues/bulk-status')
      .send({ status: 'done', issueIds: [] })
      .expect(400, validationErrorBody('Invalid bulk issue ids'));
    await request(app)
      .post('/api/issues/bulk-status')
      .send({ status: 'done', issueIds: [issue.body.id, ''] })
      .expect(400, validationErrorBody('Invalid bulk issue ids'));

    await request(app)
      .post('/api/issues/bulk-status')
      .send({ status: 'done', issueIds: [issue.body.id, 'missing-bulk-issue'] })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          status: 'done',
          updated: [expect.objectContaining({ id: issue.body.id, status: 'done' })],
          unchangedIds: [],
          notFoundIds: ['missing-bulk-issue'],
          duplicateIds: []
        });
      });

    await request(app)
      .get(`/api/issues/${issue.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('done');
      });
    await request(app)
      .get(`/api/issues/${issue.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
          'issue_created',
          'issue_status_changed'
        ]);
      });
  });

  it('bulk status preserves archived issue behavior when the caller explicitly includes archived rows', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const issue = await request(app)
      .post('/api/issues')
      .send({ title: 'Archived bulk status issue', status: 'todo' })
      .expect(201);
    const archived = await request(app).post(`/api/issues/${issue.body.id}/archive`).expect(200);

    const response = await request(app)
      .post('/api/issues/bulk-status')
      .send({ status: 'done', issueIds: [issue.body.id] })
      .expect(200);

    expect(response.body.updated).toEqual([
      expect.objectContaining({
        id: issue.body.id,
        status: 'done',
        archivedAt: archived.body.archivedAt
      })
    ]);

    await request(app)
      .get(`/api/issues/${issue.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
          'issue_created',
          'issue_archived',
          'issue_status_changed'
        ]);
      });
  });

  it('bulk archives selected issues with duplicate unchanged and missing reporting', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const first = await request(app).post('/api/issues').send({ title: 'Bulk archive first issue' }).expect(201);
    const second = await request(app).post('/api/issues').send({ title: 'Bulk archive second issue' }).expect(201);
    const alreadyArchived = await request(app)
      .post('/api/issues')
      .send({ title: 'Bulk archive unchanged issue' })
      .expect(201);

    await request(app).post(`/api/issues/${alreadyArchived.body.id}/archive`).expect(200);

    const response = await request(app)
      .post('/api/issues/bulk-archive')
      .send({
        issueIds: [first.body.id, second.body.id, alreadyArchived.body.id, first.body.id, 'missing-bulk-archive']
      })
      .expect(200);

    expect(response.body).toMatchObject({
      unchangedIds: [alreadyArchived.body.id],
      duplicateIds: [first.body.id],
      notFoundIds: ['missing-bulk-archive']
    });
    expect(response.body.archived.map((issue: { id: string }) => issue.id)).toEqual([first.body.id, second.body.id]);
    expect(response.body.archived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.body.id, archivedAt: expect.any(String) }),
        expect.objectContaining({ id: second.body.id, archivedAt: expect.any(String) })
      ])
    );

    await request(app)
      .get('/api/issues')
      .expect(200)
      .expect((list) => {
        expect(list.body.items.map((issue: { id: string }) => issue.id)).toEqual([]);
      });
    await request(app)
      .get('/api/issues?includeArchived=true')
      .expect(200)
      .expect((list) => {
        expect(list.body.items.map((issue: { id: string }) => issue.id)).toEqual(
          expect.arrayContaining([first.body.id, second.body.id, alreadyArchived.body.id])
        );
      });
    await request(app)
      .get(`/api/issues/${first.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created', 'issue_archived']);
      });
    await request(app)
      .get(`/api/issues/${alreadyArchived.body.id}/activity`)
      .expect(200)
      .expect((activity) => {
        expect(activity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created', 'issue_archived']);
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

  it('duplicates issue fields without copying comments activity archive state or dependencies', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app).post('/api/issues').send({ title: 'Original blocker' }).expect(201);
    const source = await request(app)
      .post('/api/issues')
      .send({
        title: 'Source issue to copy',
        description: 'Copy the planning fields only.',
        status: 'review',
        priority: 'high',
        labels: ['duplication', 'qa'],
        dueDate: '2999-12-31'
      })
      .expect(201);
    const dependent = await request(app).post('/api/issues').send({ title: 'Original dependent' }).expect(201);
    const comment = await request(app)
      .post(`/api/issues/${source.body.id}/comments`)
      .send({ body: 'Original comment should stay behind' })
      .expect(201);
    const editedComment = await request(app)
      .put(`/api/comments/${comment.body.id}`)
      .send({ body: 'Edited source-only comment' })
      .expect(200);

    await request(app)
      .post(`/api/issues/${source.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${dependent.body.id}/dependencies`)
      .send({ dependsOnIssueId: source.body.id })
      .expect(201);
    const archivedSource = await request(app).post(`/api/issues/${source.body.id}/archive`).expect(200);
    const duplicated = await request(app).post(`/api/issues/${source.body.id}/duplicate`).expect(201);

    expect(duplicated.body).toMatchObject({
      title: 'Copy of: Source issue to copy',
      description: 'Copy the planning fields only.',
      status: 'todo',
      priority: 'high',
      labels: ['duplication', 'qa'],
      dueDate: '2999-12-31',
      archivedAt: null,
      dependsOnIssueIds: [],
      isBlocked: false
    });
    expect(duplicated.body.id).not.toBe(source.body.id);

    await request(app).get(`/api/issues/${source.body.id}`).expect(200, archivedSource.body);
    await request(app).get(`/api/issues/${source.body.id}/comments`).expect(200, [editedComment.body]);
    await request(app)
      .get(`/api/comments/${comment.body.id}/history`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
          commentId: comment.body.id,
          previousBody: 'Original comment should stay behind',
          newBody: 'Edited source-only comment'
        });
      });
    await request(app).get(`/api/issues/${duplicated.body.id}/comments`).expect(200, []);
    await request(app)
      .get(`/api/issues/${duplicated.body.id}/dependencies`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          issueId: duplicated.body.id,
          dependencies: [],
          dependents: [],
          isBlocked: false
        });
      });
    await request(app)
      .get(`/api/issues/${source.body.id}/dependencies`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          issueId: source.body.id,
          dependencies: [expect.objectContaining({ id: blocker.body.id, title: 'Original blocker' })],
          dependents: [expect.objectContaining({ id: dependent.body.id, title: 'Original dependent' })],
          isBlocked: true
        });
      });

    const sourceActivity = await request(app).get(`/api/issues/${source.body.id}/activity`).expect(200);
    expect(sourceActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'comment_added',
      'comment_edited',
      'issue_dependency_added',
      'issue_archived'
    ]);

    await request(app)
      .get(`/api/issues/${duplicated.body.id}/activity`)
      .expect(200)
      .expect((response) => {
        expect(response.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);
      });
    await request(app).post('/api/issues/missing-issue/duplicate').expect(404, { error: 'Issue not found' });
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

    await request(app).put(`/api/issues/${blocker.body.id}`).send({ title: 'Renamed blocking issue' }).expect(200);

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
    expect(
      dependencyActivity.body.find((event: { type: string }) => event.type === 'issue_dependency_added')?.metadata
    ).toEqual({
      dependsOnIssueId: blocker.body.id,
      title: 'Blocking issue'
    });

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

    const finalActivity = await request(app).get(`/api/issues/${blocked.body.id}/activity`).expect(200);
    expect(finalActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added',
      'issue_dependency_removed'
    ]);
    expect(
      finalActivity.body.find((event: { type: string }) => event.type === 'issue_dependency_removed')?.metadata
    ).toEqual({
      dependsOnIssueId: blocker.body.id,
      title: 'Renamed blocking issue'
    });
  });

  it('bulk replaces issue dependencies atomically', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const removedBlocker = await request(app).post('/api/issues').send({ title: 'Removed bulk blocker' }).expect(201);
    const firstBlocker = await request(app).post('/api/issues').send({ title: 'First bulk blocker' }).expect(201);
    const secondBlocker = await request(app).post('/api/issues').send({ title: 'Second bulk blocker' }).expect(201);
    const blocked = await request(app)
      .post('/api/issues')
      .send({ title: 'Bulk dependency target', status: 'in_progress' })
      .expect(201);

    await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: removedBlocker.body.id })
      .expect(201);

    const replaced = await request(app)
      .put(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueIds: [firstBlocker.body.id, secondBlocker.body.id] })
      .expect(200);

    expect(replaced.body).toMatchObject({
      issueId: blocked.body.id,
      isBlocked: true,
      dependencies: [
        expect.objectContaining({ id: firstBlocker.body.id, title: 'First bulk blocker' }),
        expect.objectContaining({ id: secondBlocker.body.id, title: 'Second bulk blocker' })
      ],
      dependents: []
    });

    await request(app)
      .get(`/api/issues/${blocked.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          isBlocked: true,
          dependsOnIssueIds: [firstBlocker.body.id, secondBlocker.body.id]
        });
      });

    await request(app)
      .get(`/api/issues/${removedBlocker.body.id}/dependencies`)
      .expect(200)
      .expect((response) => {
        expect(response.body.dependents).toEqual([]);
      });

    const activity = await request(app).get(`/api/issues/${blocked.body.id}/activity`).expect(200);
    expect(activity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added',
      'issue_dependency_removed',
      'issue_dependency_added',
      'issue_dependency_added'
    ]);
  });

  it('rolls back bulk dependency replacements when validation fails', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const existingBlocker = await request(app)
      .post('/api/issues')
      .send({ title: 'Existing rollback blocker' })
      .expect(201);
    const validBlocker = await request(app).post('/api/issues').send({ title: 'Valid rollback blocker' }).expect(201);
    const blocked = await request(app).post('/api/issues').send({ title: 'Rollback dependency target' }).expect(201);
    const cycleSource = await request(app).post('/api/issues').send({ title: 'Cycle source' }).expect(201);
    const cycleTarget = await request(app).post('/api/issues').send({ title: 'Cycle target' }).expect(201);

    await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: existingBlocker.body.id })
      .expect(201);

    await request(app)
      .put(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueIds: [validBlocker.body.id, 'missing-bulk-dependency'] })
      .expect(404, { error: 'Dependency issue not found' });

    await request(app)
      .get(`/api/issues/${blocked.body.id}/dependencies`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          issueId: blocked.body.id,
          dependencies: [expect.objectContaining({ id: existingBlocker.body.id })],
          isBlocked: true
        });
        expect(response.body.dependencies).toHaveLength(1);
      });

    await request(app)
      .put(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueIds: [validBlocker.body.id, validBlocker.body.id] })
      .expect(400, validationErrorBody('Duplicate bulk dependency ids are not allowed'));

    await request(app)
      .put(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueIds: [validBlocker.body.id, blocked.body.id] })
      .expect(409, {
        error: 'Issue cannot depend on itself'
      });

    await request(app)
      .post(`/api/issues/${cycleTarget.body.id}/dependencies`)
      .send({ dependsOnIssueId: cycleSource.body.id })
      .expect(201);
    await request(app)
      .put(`/api/issues/${cycleSource.body.id}/dependencies`)
      .send({ dependsOnIssueIds: [validBlocker.body.id, cycleTarget.body.id] })
      .expect(409, {
        error: 'Cannot add dependency because the selected blocker already depends on this issue'
      });

    await request(app)
      .get(`/api/issues/${cycleSource.body.id}/dependencies`)
      .expect(200)
      .expect((response) => {
        expect(response.body.dependencies).toEqual([]);
      });

    const blockedActivity = await request(app).get(`/api/issues/${blocked.body.id}/activity`).expect(200);
    expect(blockedActivity.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added'
    ]);
    const blockedDependenciesAfterValidationFailures = await request(app)
      .get(`/api/issues/${blocked.body.id}/dependencies`)
      .expect(200);
    expect(blockedDependenciesAfterValidationFailures.body).toMatchObject({
      issueId: blocked.body.id,
      dependencies: [expect.objectContaining({ id: existingBlocker.body.id })],
      isBlocked: true
    });
    expect(blockedDependenciesAfterValidationFailures.body.dependencies).toHaveLength(1);

    const cycleSourceActivity = await request(app).get(`/api/issues/${cycleSource.body.id}/activity`).expect(200);
    expect(cycleSourceActivity.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);
  });

  it('rejects invalid dependency mutations and explains direct or indirect cycles', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const first = await request(app).post('/api/issues').send({ title: 'First dependency issue' }).expect(201);
    const second = await request(app).post('/api/issues').send({ title: 'Second dependency issue' }).expect(201);
    const third = await request(app).post('/api/issues').send({ title: 'Third dependency issue' }).expect(201);
    const archived = await request(app).post('/api/issues').send({ title: 'Archived dependency issue' }).expect(201);

    await request(app).post(`/api/issues/${archived.body.id}/archive`).expect(200);

    const firstActivityBeforeInvalidMutations = await request(app)
      .get(`/api/issues/${first.body.id}/activity`)
      .expect(200);
    expect(firstActivityBeforeInvalidMutations.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created'
    ]);

    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({})
      .expect(400, validationErrorBody('dependsOnIssueId is required'));
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
      .send({ dependsOnIssueId: `  ${first.body.id}  ` })
      .expect(409, {
        error: 'Issue cannot depend on itself'
      });
    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: archived.body.id })
      .expect(409, {
        error: 'Cannot depend on archived issue'
      });

    const firstActivityAfterRejectedAdds = await request(app).get(`/api/issues/${first.body.id}/activity`).expect(200);
    expect(firstActivityAfterRejectedAdds.body.map((event: { type: string }) => event.type)).toEqual(['issue_created']);

    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: `  ${second.body.id}  ` })
      .expect(201);
    await request(app)
      .post(`/api/issues/${first.body.id}/dependencies`)
      .send({ dependsOnIssueId: second.body.id })
      .expect(409, {
        error: 'Issue dependency already exists'
      });

    const firstActivityAfterDuplicateAdd = await request(app).get(`/api/issues/${first.body.id}/activity`).expect(200);
    expect(firstActivityAfterDuplicateAdd.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added'
    ]);

    const firstDependenciesAfterDuplicate = await request(app)
      .get(`/api/issues/${first.body.id}/dependencies`)
      .expect(200);

    expect(firstDependenciesAfterDuplicate.body).toMatchObject({
      issueId: first.body.id,
      isBlocked: true,
      dependencies: [expect.objectContaining({ id: second.body.id })]
    });
    expect(firstDependenciesAfterDuplicate.body.dependencies).toHaveLength(1);

    await request(app)
      .post(`/api/issues/${second.body.id}/dependencies`)
      .send({ dependsOnIssueId: first.body.id })
      .expect(409, {
        error: 'Cannot add dependency because the selected blocker already depends on this issue'
      });

    const secondDependenciesAfterDirectCycle = await request(app)
      .get(`/api/issues/${second.body.id}/dependencies`)
      .expect(200);
    const secondActivityAfterRejectedDirectCycle = await request(app)
      .get(`/api/issues/${second.body.id}/activity`)
      .expect(200);

    expect(secondDependenciesAfterDirectCycle.body).toMatchObject({
      issueId: second.body.id,
      isBlocked: false,
      dependencies: []
    });
    expect(secondActivityAfterRejectedDirectCycle.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created'
    ]);

    await request(app).delete(`/api/issues/missing-issue/dependencies/${second.body.id}`).expect(404, {
      error: 'Issue not found'
    });
    await request(app).delete(`/api/issues/${first.body.id}/dependencies/missing-issue`).expect(404, {
      error: 'Issue dependency not found'
    });
    await request(app).delete(`/api/issues/${first.body.id}/dependencies/${third.body.id}`).expect(404, {
      error: 'Issue dependency not found'
    });

    const firstActivityAfterRejectedRemovals = await request(app)
      .get(`/api/issues/${first.body.id}/activity`)
      .expect(200);
    expect(firstActivityAfterRejectedRemovals.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created',
      'issue_dependency_added'
    ]);

    await request(app)
      .post(`/api/issues/${second.body.id}/dependencies`)
      .send({ dependsOnIssueId: third.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${third.body.id}/dependencies`)
      .send({ dependsOnIssueId: first.body.id })
      .expect(409, {
        error: 'Cannot add dependency because the selected blocker already depends on this issue'
      });

    const thirdDependenciesAfterCycle = await request(app).get(`/api/issues/${third.body.id}/dependencies`).expect(200);
    const thirdActivityAfterRejectedCycle = await request(app).get(`/api/issues/${third.body.id}/activity`).expect(200);

    expect(thirdDependenciesAfterCycle.body).toMatchObject({
      issueId: third.body.id,
      isBlocked: false,
      dependencies: []
    });
    expect(thirdActivityAfterRejectedCycle.body.map((event: { type: string }) => event.type)).toEqual([
      'issue_created'
    ]);
  });

  it('returns standard JSON parse errors for issue and dependency mutations', async () => {
    const app = createApp({ databasePath: ':memory:' });
    const issue = await request(app).post('/api/issues').send({ title: 'Malformed issue contract' }).expect(201);

    await request(app)
      .put(`/api/issues/${issue.body.id}`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });

    await request(app)
      .post(`/api/issues/${issue.body.id}/dependencies`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(response.body).toEqual(validationErrorBody('Request body must be valid JSON.'));
        expect(response.body).not.toHaveProperty('valid');
      });
  });

  it('returns blockers and dependents for issue dependency detail and hydrates archived blockers', async () => {
    const app = createApp({ databasePath: ':memory:' });

    const blocker = await request(app).post('/api/issues').send({ title: 'Archived-aware blocker' }).expect(201);
    const blocked = await request(app)
      .post('/api/issues')
      .send({ title: 'Blocked issue with compact view', status: 'in_progress' })
      .expect(201);
    const dependent = await request(app).post('/api/issues').send({ title: 'Dependent issue' }).expect(201);

    await request(app)
      .post(`/api/issues/${blocked.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocker.body.id })
      .expect(201);
    await request(app)
      .post(`/api/issues/${dependent.body.id}/dependencies`)
      .send({ dependsOnIssueId: blocked.body.id })
      .expect(201);

    const dependencyDetail = await request(app).get(`/api/issues/${blocked.body.id}/dependencies`).expect(200);

    expect(dependencyDetail.body).toMatchObject({
      issueId: blocked.body.id,
      isBlocked: true,
      dependencies: [
        {
          id: blocker.body.id,
          title: 'Archived-aware blocker',
          status: 'todo',
          archivedAt: null
        }
      ],
      dependents: [
        {
          id: dependent.body.id,
          title: 'Dependent issue',
          status: 'todo',
          archivedAt: null
        }
      ]
    });

    await request(app).post(`/api/issues/${blocker.body.id}/archive`).expect(200);

    const postArchiveDependencyDetail = await request(app)
      .get(`/api/issues/${blocked.body.id}/dependencies`)
      .expect(200);

    expect(postArchiveDependencyDetail.body).toMatchObject({
      issueId: blocked.body.id,
      isBlocked: false,
      dependencies: [
        {
          id: blocker.body.id,
          title: 'Archived-aware blocker',
          archivedAt: expect.any(String)
        }
      ]
    });
  });

  it('returns validation errors for invalid issue payloads', async () => {
    const app = createApp({ databasePath: ':memory:' });

    await request(app).post('/api/issues').send({ title: '   ' }).expect(400, validationErrorBody('title is required'));

    const created = await request(app).post('/api/issues').send({ title: 'Valid issue' }).expect(201);

    await request(app)
      .post('/api/issues')
      .send({ title: 'Invalid description issue', description: { text: 'not a string' } })
      .expect(400, validationErrorBody('Invalid issue description'));

    await request(app)
      .post('/api/issues')
      .send({ title: 'Invalid status issue', status: 'triage' })
      .expect(400, validationErrorBody('Invalid issue status'));

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ description: 42 })
      .expect(400, validationErrorBody('Invalid issue description'));

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send([])
      .expect(400, validationErrorBody('Invalid issue payload'));

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ status: 'triage' })
      .expect(400, validationErrorBody('Invalid issue status'));

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ status: 'done', priority: 'urgent' })
      .expect(400, validationErrorBody('Invalid issue priority'));

    await request(app).get('/api/issues?status=archived').expect(400, validationErrorBody('Invalid issue status'));

    await request(app).get('/api/issues?priority=urgent').expect(400, validationErrorBody('Invalid issue priority'));

    await request(app).get('/api/issues?page=0').expect(400, validationErrorBody('Invalid page parameter'));

    await request(app).get('/api/issues?page=1.5').expect(400, validationErrorBody('Invalid page parameter'));

    await request(app).get('/api/issues?limit=0').expect(400, validationErrorBody('Invalid limit parameter'));

    await request(app).get('/api/issues?limit=101').expect(400, validationErrorBody('Invalid limit parameter'));

    await request(app)
      .get('/api/issues?includeArchived=yes')
      .expect(400, validationErrorBody('Invalid includeArchived parameter'));

    await request(app)
      .get('/api/issues?blockedOnly=yes')
      .expect(400, validationErrorBody('Invalid blockedOnly parameter'));

    await request(app).get('/api/issues?staleOnly=yes').expect(400, validationErrorBody('Invalid staleOnly parameter'));

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ labels: [''] })
      .expect(400, validationErrorBody('Invalid issue labels'));

    await request(app)
      .post('/api/issues')
      .send({ title: 'Bad due date', dueDate: '2026-02-30' })
      .expect(400, validationErrorBody('Invalid issue due date'));

    await request(app)
      .put(`/api/issues/${created.body.id}`)
      .send({ dueDate: 'tomorrow' })
      .expect(400, validationErrorBody('Invalid issue due date'));
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
