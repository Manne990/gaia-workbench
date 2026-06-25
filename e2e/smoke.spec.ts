import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

type ExportedIssue = {
  title: string;
  isBlocked?: boolean;
  dependsOnIssueIds?: string[];
  comments: Array<{ body: string; editHistory: Array<{ previousBody: string; newBody: string }> }>;
  activityEvents: Array<{ type: string }>;
};

type CreatedIssue = {
  id: string;
  title: string;
  description: string;
};

type ApiIssue = CreatedIssue & {
  status: string;
  priority: string;
  labels: string[];
  dueDate: string | null;
  isOverdue: boolean;
  archivedAt: string | null;
  isBlocked: boolean;
  dependsOnIssueIds: string[];
  createdAt: string;
  updatedAt: string;
};

type IssueListResponse = {
  items: CreatedIssue[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
    hasPrevious: boolean;
  };
};

type LargeIssueSetOptions = {
  idOffset?: number;
  titlePrefix?: string;
  descriptionPrefix?: string;
};

type ImportSummaryResponse = {
  summary: {
    toCreate: {
      issues: number;
    };
  };
};

const largeIssueStatuses = ['todo', 'in_progress', 'review', 'done'] as const;
const largeIssuePriorities = ['low', 'medium', 'high'] as const;
const largeIssueCount = 500;
const largeIssueImportBaseDate = Date.UTC(2026, 0, 1, 0, 0, 0);

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

async function pressTabUntilFocused(page: Page, locator: Locator, maxTabs = 40): Promise<void> {
  for (let count = 0; count <= maxTabs; count += 1) {
    if (await isFocused(locator)) {
      return;
    }

    await page.keyboard.press('Tab');
  }

  throw new Error('Expected target to receive focus through keyboard tab navigation.');
}

async function pressShiftTabUntilFocused(page: Page, locator: Locator, maxTabs = 40): Promise<void> {
  for (let count = 0; count <= maxTabs; count += 1) {
    if (await isFocused(locator)) {
      return;
    }

    await page.keyboard.press('Shift+Tab');
  }

  throw new Error('Expected target to receive focus through reverse keyboard tab navigation.');
}

function commandPaletteShortcutKey(): string {
  return process.platform === 'darwin' ? 'Meta+K' : 'Control+K';
}

async function expandDashboardSettings(page: Page): Promise<Locator> {
  const settings = page.getByLabel('Saved views and page settings');
  const settingsToggle = settings.locator('summary').filter({ hasText: 'Saved views & page settings' });

  await expect(settings).toHaveCount(1);

  if ((await settings.getAttribute('open')) === null) {
    await settingsToggle.click();
  }

  return settings;
}

function importJsonFileInput(page: Page): Locator {
  return page.getByLabel('Import JSON file');
}

async function createIssueThroughApi(
  page: Page,
  issue: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    labels?: string[];
    dueDate?: string | null;
  }
): Promise<CreatedIssue> {
  const response = await page.request.post('/api/issues', { data: issue });

  expect(response.ok()).toBe(true);

  return (await response.json()) as CreatedIssue;
}

async function waitForIssueActionResponse(page: Page, issueId: string, action: 'archive' | 'unarchive'): Promise<void> {
  const response = await page.waitForResponse((nextResponse) => {
    const responseUrl = new URL(nextResponse.url());

    return nextResponse.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${issueId}/${action}`;
  });

  expect(response.ok()).toBe(true);
}

async function waitForBulkArchiveResponse(page: Page): Promise<void> {
  const response = await page.waitForResponse((nextResponse) => {
    const responseUrl = new URL(nextResponse.url());

    return nextResponse.request().method() === 'POST' && responseUrl.pathname === '/api/issues/bulk-archive';
  });

  expect(response.ok()).toBe(true);
}

async function changeDashboardFiltersInSameTask(
  page: Page,
  values: { search?: string; status?: string; priority?: string; label?: string }
): Promise<void> {
  await page.evaluate((nextValues) => {
    const inputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const selectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;

    if (!inputValueSetter || !selectValueSetter) {
      throw new Error('Unable to resolve native dashboard filter setters.');
    }

    function setInputValue(id: string, value: string) {
      const input = document.getElementById(id);

      if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing dashboard input ${id}.`);
      }

      inputValueSetter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function setSelectValue(id: string, value: string) {
      const select = document.getElementById(id);

      if (!(select instanceof HTMLSelectElement)) {
        throw new Error(`Missing dashboard select ${id}.`);
      }

      selectValueSetter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (nextValues.status !== undefined) {
      setSelectValue('issue-status-filter', nextValues.status);
    }

    if (nextValues.priority !== undefined) {
      setSelectValue('issue-priority-filter', nextValues.priority);
    }

    if (nextValues.search !== undefined) {
      setInputValue('issue-search-filter', nextValues.search);
    }

    if (nextValues.label !== undefined) {
      setInputValue('issue-label-filter', nextValues.label);
    }
  }, values);
}

async function createLargeIssueSet(
  page: Page,
  count: number,
  options: LargeIssueSetOptions = {}
): Promise<CreatedIssue[]> {
  const { idOffset = 0, titlePrefix = 'Large issue', descriptionPrefix = 'Large-list guardrail item' } = options;
  const issues = Array.from({ length: count }, (_, index) => {
    const paddedIndex = String(index).padStart(4, '0');
    const title = `${titlePrefix} ${paddedIndex}`;
    const timestamp = new Date(largeIssueImportBaseDate + index * 1000).toISOString();

    return {
      id: `00000000-0000-4000-9000-${String(idOffset + index).padStart(12, '0')}`,
      title,
      description: `${descriptionPrefix} ${paddedIndex}`,
      status: largeIssueStatuses[index % largeIssueStatuses.length],
      priority: largeIssuePriorities[index % largeIssuePriorities.length],
      labels: ['bulk', `group-${index % 10}`],
      dueDate: index % 5 === 0 ? '2999-12-31' : null,
      isOverdue: false,
      isBlocked: false,
      dependsOnIssueIds: [],
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      comments: [],
      activityEvents: []
    };
  });

  const response = await page.request.post('/api/import/apply', {
    data: {
      exportVersion: 1,
      issues
    }
  });

  expect(response.ok()).toBe(true);
  expect(((await response.json()) as ImportSummaryResponse).summary.toCreate.issues).toBe(count);

  return issues;
}

test('TinyTracker smoke creates lists updates and comments on an issue', async ({ page }) => {
  const healthResponse = await page.request.get('/api/health');

  expect(healthResponse.ok()).toBe(true);
  expect(await healthResponse.json()).toEqual({ status: 'ok', service: 'TinyTracker' });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('TinyTracker')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Service status' })).toHaveText('Service: online');
  await expect(page.getByLabel('Tracker audit summary')).toBeVisible();
  await expect(page.getByLabel('Tracker audit summary')).toContainText('Open');
  await expect(page.getByLabel('Tracker audit summary')).toContainText('Done');
  await expect(page.getByLabel('Tracker audit summary')).toContainText('Blocked');
  await expect(page.getByLabel('Issue status summary')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issue List' })).toBeVisible();
  await expect(page.getByText('No issues yet.')).toBeVisible();

  await page.getByRole('button', { name: 'New Issue' }).click();
  await page.getByRole('button', { name: 'Create Issue' }).click();
  await expect(page.getByRole('alert')).toHaveText('Title is required.');

  const issueForm = page.getByRole('form', { name: 'Issue form' });

  await issueForm.getByLabel('Title').fill('Create issue from UI');
  await issueForm.getByLabel('Description').fill('Created through the dashboard form.');
  await issueForm.getByLabel('Labels').fill('ui, bug, ui');
  await issueForm.getByLabel('Due Date').fill('2000-01-01');
  await issueForm.getByLabel('Status').selectOption('review');
  await issueForm.getByLabel('Priority').selectOption('high');
  await page.getByRole('button', { name: 'Create Issue' }).click();

  const createdRow = page.getByRole('row', { name: /Create issue from UI.*Review.*High/ });
  await expect(createdRow).toBeVisible();
  await expect(createdRow.locator('.label-pill').getByText('ui', { exact: true })).toBeVisible();
  await expect(createdRow.locator('.label-pill').getByText('bug', { exact: true })).toBeVisible();
  await expect(createdRow.locator('.overdue-pill')).toHaveText('Overdue');
  await expect(page.getByText('1 high priority')).toBeVisible();
  await expect(page.getByLabel('Tracker audit summary')).toContainText('Open');
  await expect(page.getByLabel('Tracker audit summary')).toContainText('1');
  await expect(page.getByLabel('Tracker audit summary')).toContainText('Overdue');

  await page.getByRole('button', { name: 'Edit Create issue from UI' }).click();
  await issueForm.getByLabel('Title').fill('Edit issue from UI');
  await issueForm.getByLabel('Description').fill('Updated through the dashboard form.');
  await issueForm.getByLabel('Labels').fill('docs, api');
  await issueForm.getByLabel('Status').selectOption('done');
  await issueForm.getByLabel('Priority').selectOption('low');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  const updatedRow = page.getByRole('row', { name: /Edit issue from UI.*Done.*Low/ });
  await expect(updatedRow).toBeVisible();
  await expect(updatedRow.locator('.label-pill').getByText('docs', { exact: true })).toBeVisible();
  await expect(updatedRow.locator('.label-pill').getByText('api', { exact: true })).toBeVisible();
  await expect(updatedRow.locator('.overdue-pill')).toHaveCount(0);
  await expect(page.getByText('Create issue from UI')).toHaveCount(0);

  const filters = page.getByLabel('Issue filters');
  await expect(page.getByRole('button', { name: 'Clear board filters' })).toHaveCount(0);

  await filters.getByLabel('Search').fill('not in the tracker');
  await expect(page.getByLabel('Active filters')).toContainText('Search: not in the tracker');
  await expect(page.getByLabel('Active filter count')).toHaveText('1 active filter');
  await expect(page.getByRole('button', { name: 'Clear board filters' })).toBeVisible();
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();
  await expect(page.getByLabel('Audit summary empty reason')).toContainText(
    'Active filters are hiding all audit results: Search: not in the tracker.'
  );
  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(updatedRow).toBeVisible();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByLabel('Active filter count')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear board filters' })).toHaveCount(0);

  await filters.getByLabel('Search').fill('Edit issue');
  await filters.getByLabel('Label').fill('docs');
  await filters.getByLabel('Status').selectOption('done');
  await filters.getByLabel('Priority').selectOption('low');
  await expect(page.getByLabel('Active filters')).toContainText('Search: Edit issue');
  await expect(page.getByLabel('Active filters')).toContainText('Label: docs');
  await expect(page.getByLabel('Active filters')).toContainText('Status: Done');
  await expect(page.getByLabel('Active filters')).toContainText('Priority: Low');
  await expect(page.getByLabel('Active filter count')).toHaveText('4 active filters');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('docs');
  await expect(updatedRow).toBeVisible();

  await filters.getByLabel('Label').fill('missing');
  await expect(page.getByLabel('Active filters')).toContainText('Label: missing');
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();

  await filters.getByLabel('Label').fill('api');
  await expect(page.getByLabel('Active filters')).toContainText('Label: api');
  await expect(updatedRow).toBeVisible();

  await filters.getByLabel('Priority').selectOption('high');
  await expect(filters.getByLabel('Search')).toHaveValue('Edit issue');
  await expect(filters.getByLabel('Label')).toHaveValue('api');
  await expect(page.getByLabel('Active filters')).toContainText('Priority: High');
  await expect(page.getByLabel('Active filter count')).toHaveText('4 active filters');
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(updatedRow).toBeVisible();

  await page.getByRole('button', { name: 'Open Edit issue from UI' }).click();
  const detail = page.getByRole('region', { name: 'Edit issue from UI' });

  await expect(detail.getByRole('heading', { name: 'Edit issue from UI' })).toBeVisible();
  const detailPath = new URL(page.url()).pathname;

  await filters.getByLabel('Search').fill('hidden by detail route filter');
  await expect(page.getByLabel('Active filters')).toContainText('Search: hidden by detail route filter');
  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(detailPath);
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await expect(detail.getByRole('heading', { name: 'Edit issue from UI' })).toBeVisible();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);

  await expect(detail.locator('.detail-description')).toHaveText('Updated through the dashboard form.');
  await expect(detail.getByLabel('Issue labels').getByText('docs')).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('api')).toBeVisible();
  await expect(detail.locator('.detail-overdue')).toHaveCount(0);
  const activity = detail.getByLabel('Issue activity');
  await expect(activity.getByText('Issue created')).toBeVisible();
  await expect(activity.getByText('Title changed')).toBeVisible();
  await expect(activity.getByText('Create issue from UI -> Edit issue from UI')).toBeVisible();
  await expect(activity.getByText('Description changed')).toBeVisible();
  await expect(
    activity.getByText('Created through the dashboard form. -> Updated through the dashboard form.')
  ).toBeVisible();
  await expect(activity.getByText('Status changed')).toBeVisible();
  await expect(activity.getByText('Priority changed')).toBeVisible();
  await expect(detail.getByText('No comments yet.')).toBeVisible();

  const commentForm = page.getByRole('form', { name: 'Comment form' });

  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  await expect(commentForm.getByRole('alert')).toHaveText('Comment is required.');
  await commentForm.getByLabel('New comment').fill(' \n\t  ');
  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  await expect(commentForm.getByRole('alert')).toHaveText('Comment is required.');
  await expect(detail.getByText('No comments yet.')).toBeVisible();

  await commentForm.getByLabel('New comment').fill('Initial detail comment');
  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  const commentsList = page.getByLabel('Issue comments');
  const initialCommentItem = commentsList.getByRole('listitem').filter({ hasText: 'Initial detail comment' });

  await expect(initialCommentItem.getByText('Initial detail comment')).toBeVisible();
  await expect(activity.getByText('Comment added')).toBeVisible();

  await initialCommentItem.getByRole('button', { name: 'Edit comment' }).click();
  const editCommentForm = page.getByRole('form', { name: 'Edit comment form' });

  await editCommentForm.getByLabel('Comment').fill(' \n\t  ');
  await editCommentForm.getByRole('button', { name: 'Save Comment' }).click();
  await expect(editCommentForm.getByRole('alert')).toHaveText('Comment is required.');

  await editCommentForm.getByLabel('Comment').fill('Edited detail comment');
  await editCommentForm.getByRole('button', { name: 'Save Comment' }).click();

  await expect(page.getByLabel('Issue comments').getByText('Edited detail comment')).toBeVisible();
  await expect(activity.getByText('Comment edited')).toBeVisible();
  await expect(activity.getByRole('listitem').locator('strong')).toHaveText([
    'Issue created',
    'Title changed',
    'Description changed',
    'Status changed',
    'Priority changed',
    'Labels changed',
    'Comment added',
    'Comment edited'
  ]);
  await expect(page.getByText('1 edit')).toBeVisible();
  const editedCommentHistory = commentsList
    .getByRole('listitem')
    .filter({ hasText: 'Edited detail comment' })
    .locator('.comment-history');

  await expect(editedCommentHistory.getByText('Previous:')).toBeVisible();
  await expect(editedCommentHistory.getByText('Initial detail comment', { exact: true })).toBeVisible();

  const exportDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON' }).click();
  const exportDownload = await exportDownloadPromise;
  const exportPath = await exportDownload.path();

  expect(exportDownload.suggestedFilename()).toBe('tinytracker-export.json');
  expect(exportPath).not.toBeNull();

  const exportedData = JSON.parse(readFileSync(exportPath ?? '', 'utf8')) as {
    exportVersion: number;
    issues: ExportedIssue[];
  };
  const exportedIssue = exportedData.issues.find((issue) => issue.title === 'Edit issue from UI');

  expect(exportedData.exportVersion).toBe(1);
  expect(exportedIssue?.comments[0]).toMatchObject({
    body: 'Edited detail comment',
    editHistory: [
      {
        previousBody: 'Initial detail comment',
        newBody: 'Edited detail comment'
      }
    ]
  });
  const exportedActivityTypes = exportedIssue?.activityEvents.map((event) => event.type);

  expect(exportedActivityTypes).toContain('issue_created');
  expect(exportedActivityTypes).toContain('comment_added');
  expect(exportedActivityTypes).toContain('comment_edited');

  await filters.getByLabel('Status').selectOption('done');
  await filters.getByLabel('Search').fill('Edit issue from UI');
  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  const csvPath = await csvDownload.path();

  expect(csvDownload.suggestedFilename()).toBe('tinytracker-issues.csv');
  expect(csvPath).not.toBeNull();

  const exportedCsv = readFileSync(csvPath ?? '', 'utf8');
  const csvLines = exportedCsv.trim().split('\n');

  expect(csvLines).toHaveLength(2);
  expect(csvLines[1]).toContain('Edit issue from UI');
  expect(csvLines[1]).toContain('done');
  expect(csvLines[1]).toContain('low');

  const settings = await expandDashboardSettings(page);

  await filters.getByLabel('Label').fill('api');
  await filters.getByLabel('Priority').selectOption('low');
  await filters.getByLabel('Include archived').check();
  await filters.getByLabel('Blocked only').check();
  await filters.getByLabel('Stale only').check();
  await settings.getByLabel('Page size').selectOption('10');

  await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
    'href',
    '/api/export.csv?search=Edit+issue+from+UI&status=done&priority=low&label=api&includeArchived=true&blockedOnly=true&staleOnly=true'
  );

  await filters.getByLabel('Label').fill('');
  await filters.getByLabel('Include archived').uncheck();
  await filters.getByLabel('Blocked only').uncheck();
  await filters.getByLabel('Stale only').uncheck();

  await createIssueThroughApi(page, {
    title: '=CSV dashboard formula',
    description: '+CSV dashboard description',
    status: 'done',
    priority: 'low',
    labels: ['-risk', 'safe']
  });
  await filters.getByLabel('Search').fill('=CSV dashboard formula');
  const formulaCsvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const formulaCsvDownload = await formulaCsvDownloadPromise;
  const formulaCsvPath = await formulaCsvDownload.path();

  expect(formulaCsvDownload.suggestedFilename()).toBe('tinytracker-issues.csv');
  expect(formulaCsvPath).not.toBeNull();

  const formulaCsv = readFileSync(formulaCsvPath ?? '', 'utf8');
  const formulaCsvLines = formulaCsv.trim().split('\n');

  expect(formulaCsvLines).toHaveLength(2);
  expect(formulaCsvLines[1]).toContain("'=CSV dashboard formula");
  expect(formulaCsvLines[1]).toContain("'+CSV dashboard description");
  expect(formulaCsvLines[1]).toContain("'-risk|safe");
});

test('board health badge distinguishes blocked and waiting review work', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Board health blocker',
    description: 'Keeps one review issue blocked.',
    status: 'todo',
    priority: 'medium',
    labels: ['board-health']
  });
  await createIssueThroughApi(page, {
    title: 'Board health waiting review',
    description: 'Review work waiting on normal flow.',
    status: 'review',
    priority: 'high',
    labels: ['board-health']
  });
  const blockedReview = await createIssueThroughApi(page, {
    title: 'Board health blocked review',
    description: 'Review work that should count as blocked instead of waiting.',
    status: 'review',
    priority: 'high',
    labels: ['board-health']
  });
  await createIssueThroughApi(page, {
    title: 'Board health unrelated waiting',
    description: 'Outside the active label filter.',
    status: 'review',
    priority: 'low',
    labels: ['other-health']
  });

  const dependencyResponse = await page.request.post(`/api/issues/${blockedReview.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto('/?label=board-health');

  const auditSummary = page.getByLabel('Tracker audit summary');
  const boardHealth = auditSummary.getByLabel('Board health: 1 blocked, 1 waiting');

  await expect(boardHealth).toBeVisible();
  await expect(boardHealth).toContainText('1 blocked');
  await expect(boardHealth).toContainText('1 waiting');
  await expect(page.getByLabel('Issue filters').getByLabel('Label')).toHaveValue('board-health');
  await expect(page.getByRole('row', { name: /Board health waiting review.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Board health blocked review.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Board health unrelated waiting.*Review.*Low/ })).toHaveCount(0);
});

test('dashboard issue-list error state preserves the API error and recovers on retry', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Retryable dashboard issue',
    description: 'Should appear after the dashboard list retries.',
    status: 'todo',
    priority: 'medium'
  });

  let issueListAttempts = 0;

  await page.route('**/api/issues**', async (route) => {
    issueListAttempts += 1;

    if (issueListAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary issue list outage' })
      });
      return;
    }

    await route.continue();
  });

  await page.goto('/');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Temporary issue list outage');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByRole('row', { name: /Retryable dashboard issue.*Todo.*Medium/ })).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(issueListAttempts).toBeGreaterThanOrEqual(2);

  const issueResponse = await page.request.get(`/api/issues/${issue.id}`);
  expect(issueResponse.ok()).toBe(true);
});

test('issue detail activity filters timeline by category with a clear filtered empty state', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Activity filter blocker',
    description: 'Provides a dependency event.'
  });
  const issue = await createIssueThroughApi(page, {
    title: 'Activity filter target',
    description: 'Shows activity categories in issue detail.'
  });

  const updateResponse = await page.request.put(`/api/issues/${issue.id}`, {
    data: {
      status: 'in_progress'
    }
  });
  expect(updateResponse.ok()).toBe(true);

  const dependencyResponse = await page.request.post(`/api/issues/${issue.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });
  expect(dependencyResponse.ok()).toBe(true);

  const commentResponse = await page.request.post(`/api/issues/${issue.id}/comments`, {
    data: { body: 'Activity filter comment' }
  });
  expect(commentResponse.ok()).toBe(true);

  await page.goto(`/issues/${issue.id}`);

  const detail = page.getByRole('region', { name: 'Activity filter target' });
  const activitySection = detail.locator('.activity-section');
  const activityFilters = detail.getByLabel('Activity category filters');
  const visibleCount = detail.getByLabel('Visible activity count');

  await expect(detail.getByRole('heading', { name: 'Activity filter target' })).toBeVisible();
  await expect(visibleCount).toHaveText('4');
  await expect(activitySection.getByText('Issue created')).toBeVisible();
  await expect(activitySection.getByText('Status changed')).toBeVisible();
  await expect(activitySection.getByText('Dependency added')).toBeVisible();
  await expect(activitySection.getByText('Comment added')).toBeVisible();

  await activityFilters.getByRole('button', { name: 'Comments' }).click();
  await expect(visibleCount).toHaveText('1/4');
  await expect(activitySection.getByText('Comment added')).toBeVisible();
  await expect(activitySection.getByText('Dependency added')).toHaveCount(0);
  await expect(activitySection.getByText('Status changed')).toHaveCount(0);

  await activityFilters.getByRole('button', { name: 'Issue changes' }).click();
  await expect(visibleCount).toHaveText('2/4');
  await expect(activitySection.getByText('Issue created')).toBeVisible();
  await expect(activitySection.getByText('Status changed')).toBeVisible();
  await expect(activitySection.getByText('Comment added')).toHaveCount(0);

  await activityFilters.getByRole('button', { name: 'Dependencies' }).click();
  await expect(visibleCount).toHaveText('1/4');
  await expect(activitySection.getByText('Dependency added')).toBeVisible();
  await expect(activitySection.getByText('Comment added')).toHaveCount(0);

  await activityFilters.getByRole('button', { name: 'Archive changes' }).click();
  await expect(visibleCount).toHaveText('0/4');
  await expect(activitySection.getByText('No archive activity for this issue yet.')).toBeVisible();
  await expect(activitySection.getByRole('listitem')).toHaveCount(0);

  await activityFilters.getByRole('button', { name: 'All activity' }).click();
  await expect(visibleCount).toHaveText('4');
  await expect(activitySection.getByText('Issue created')).toBeVisible();
  await expect(activitySection.getByText('Comment added')).toBeVisible();
});

test('open issue detail reconciles after a background issue mutation refreshes the list', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Background refresh detail issue',
    description: 'Original detail state.',
    status: 'todo',
    priority: 'high'
  });

  await page.goto(`/issues/${issue.id}?search=${encodeURIComponent('Background refresh detail')}`);

  const filters = page.getByRole('search', { name: 'Issue filters' });
  const detail = page.getByRole('region', { name: issue.title });
  const issueDetails = detail.getByLabel('Issue details');

  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Original detail state.');
  await expect(issueDetails).toContainText('Todo');
  await expect(issueDetails).toContainText('High');

  const updateResponse = await page.request.put(`/api/issues/${issue.id}`, {
    data: {
      description: 'Updated by a background API mutation.',
      status: 'review',
      priority: 'low'
    }
  });

  expect(updateResponse.ok()).toBe(true);

  await filters.getByLabel('Priority').selectOption('low');
  await expect(page.getByRole('row', { name: /Background refresh detail issue.*Review.*Low/ })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Updated by a background API mutation.');
  await expect(issueDetails).toContainText('Review');
  await expect(issueDetails).toContainText('Low');
  await expect(detail.getByLabel('Issue activity').getByText('Description changed')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Status changed')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Priority changed')).toBeVisible();
});

test('issue detail dependency count updates after add and remove', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Dependency count blocker issue'
  });
  const issue = await createIssueThroughApi(page, {
    title: 'Dependency count target',
    description: 'Starts with zero blockers in header detail panel.'
  });

  await page.goto(`/issues/${issue.id}`);

  const detail = page.getByRole('region', { name: 'Dependency count target' });
  const dependencyInput = detail.getByLabel('Add blocker issue ID');
  const addDependencyButton = detail.getByRole('button', { name: 'Add Dependency' });

  await expect(detail.getByText('Dependencies: 0')).toBeVisible();

  const addDependencyResponse = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${issue.id}/dependencies`;
  });

  await dependencyInput.fill(blocker.id);
  await addDependencyButton.click();

  const addDependencyResult = await addDependencyResponse;
  expect(addDependencyResult.ok()).toBe(true);
  await expect(detail.getByText('Dependencies: 1')).toBeVisible();

  const removeDependencyResponse = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return (
      response.request().method() === 'DELETE' &&
      responseUrl.pathname === `/api/issues/${issue.id}/dependencies/${blocker.id}`
    );
  });

  await detail.getByRole('button', { name: `Remove dependency ${blocker.title}` }).click();

  const removeDependencyResult = await removeDependencyResponse;
  expect(removeDependencyResult.ok()).toBe(true);
  await expect(detail.getByText('Dependencies: 0')).toBeVisible();
});

test('duplicates an issue from detail without copying history or dependencies', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Duplicate source blocker'
  });
  const source = await createIssueThroughApi(page, {
    title: 'Duplicate source issue',
    description: 'Duplicate should keep this description.',
    status: 'review',
    priority: 'high',
    labels: ['copy-me', 'triage'],
    dueDate: '2999-12-31'
  });

  const commentResponse = await page.request.post(`/api/issues/${source.id}/comments`, {
    data: { body: 'Source-only comment' }
  });
  const dependencyResponse = await page.request.post(`/api/issues/${source.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });

  expect(commentResponse.ok()).toBe(true);
  expect(dependencyResponse.ok()).toBe(true);

  await page.goto(`/issues/${source.id}`);
  const sourceDetail = page.getByRole('region', { name: 'Duplicate source issue' });

  await expect(sourceDetail.getByRole('heading', { name: 'Duplicate source issue' })).toBeVisible();
  await expect(
    sourceDetail.getByLabel('Issue comments').getByText('Source-only comment', { exact: true })
  ).toBeVisible();
  await sourceDetail.getByRole('button', { name: 'Duplicate', exact: true }).click();

  const duplicateTitle = 'Copy of: Duplicate source issue';
  const duplicateDetail = page.getByRole('region', { name: duplicateTitle });

  await expect(duplicateDetail.getByRole('heading', { name: duplicateTitle })).toBeVisible();
  await expect(duplicateDetail.locator('.detail-description')).toHaveText('Duplicate should keep this description.');
  await expect(duplicateDetail.getByLabel('Issue labels').getByText('copy-me', { exact: true })).toBeVisible();
  await expect(duplicateDetail.getByLabel('Issue labels').getByText('triage', { exact: true })).toBeVisible();
  await expect(duplicateDetail.getByText('No comments yet.')).toBeVisible();
  await expect(duplicateDetail.getByText('No blockers.')).toBeVisible();
  await expect(duplicateDetail.getByText('No dependents.')).toBeVisible();

  const duplicateActivity = duplicateDetail.getByLabel('Issue activity');
  await expect(duplicateActivity.getByRole('listitem')).toHaveCount(1);
  await expect(duplicateActivity.getByText('Issue created')).toBeVisible();

  const duplicateListResponse = await page.request.get('/api/issues?includeArchived=true&limit=100');
  expect(duplicateListResponse.ok()).toBe(true);
  const duplicateList = (await duplicateListResponse.json()) as {
    items: Array<{
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      labels: string[];
      dueDate: string | null;
      archivedAt: string | null;
      dependsOnIssueIds: string[];
    }>;
  };
  const duplicatedIssue = duplicateList.items.find((issue) => issue.title === duplicateTitle);

  expect(duplicatedIssue).toMatchObject({
    title: duplicateTitle,
    description: 'Duplicate should keep this description.',
    status: 'todo',
    priority: 'high',
    labels: ['copy-me', 'triage'],
    dueDate: '2999-12-31',
    archivedAt: null,
    dependsOnIssueIds: []
  });
  expect(duplicatedIssue?.id).not.toBe(source.id);

  const originalIssueResponse = await page.request.get(`/api/issues/${source.id}`);
  const originalCommentsResponse = await page.request.get(`/api/issues/${source.id}/comments`);

  expect(originalIssueResponse.ok()).toBe(true);
  expect(originalCommentsResponse.ok()).toBe(true);
  expect(await originalIssueResponse.json()).toMatchObject({
    title: 'Duplicate source issue',
    status: 'review',
    priority: 'high',
    dependsOnIssueIds: [blocker.id]
  });
  expect(await originalCommentsResponse.json()).toEqual([
    expect.objectContaining({
      body: 'Source-only comment'
    })
  ]);
});

test('command palette opens with keyboard shortcut, restores focus, and runs commands', async ({ page }) => {
  await page.goto('/');

  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const issueForm = page.getByRole('form', { name: 'Issue form' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');
  const commandList = page.getByRole('list', { name: 'Available commands' });
  const commandButtonHasFocus = () =>
    commandPalette.evaluate((dialog) => {
      const activeElement = document.activeElement;

      return (
        activeElement instanceof HTMLButtonElement &&
        dialog.contains(activeElement) &&
        activeElement.getAttribute('aria-label') !== 'Run first matching command'
      );
    });

  await quickActionsButton.focus();
  await expect(quickActionsButton).toBeFocused();
  await page.keyboard.press(commandPaletteShortcutKey());

  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await expect(commandSearch).toHaveAttribute('aria-label', 'Search commands');
  await expect(commandList).toBeVisible();

  const newIssueCommand = commandPalette.getByRole('button', { name: 'New issue. Create a new issue' });

  await page.keyboard.press('Tab');
  await expect(newIssueCommand).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(commandSearch).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect.poll(commandButtonHasFocus).toBe(true);
  await page.keyboard.press('Tab');
  await expect(commandSearch).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect.poll(commandButtonHasFocus).toBe(true);
  await page.keyboard.press('Escape');
  await expect(commandPalette).toHaveCount(0);
  await expect(quickActionsButton).toBeFocused();

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(commandPalette).toHaveCount(0);
  await expect(quickActionsButton).toBeFocused();

  await page.keyboard.press(commandPaletteShortcutKey());
  await expect(commandSearch).toBeVisible();
  await commandSearch.fill('new issue');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(issueForm).toBeVisible();
  await expect(issueForm.getByLabel('Title')).toBeFocused();

  await issueForm.getByRole('button', { name: 'Cancel' }).click();
  await expect(issueForm).toHaveCount(0);
});

test('command palette clear filters restores focus after dialog state changes', async ({ page }) => {
  await page.goto('/');

  const filters = page.getByRole('search', { name: 'Issue filters' });
  const issueSearch = filters.getByLabel('Search');
  const issueListHeading = page.getByRole('heading', { name: 'Issue List' });
  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');

  await issueSearch.fill('no matching issue');
  await expect(issueSearch).toHaveValue('no matching issue');
  await expect(page).toHaveURL(/search=no\+matching\+issue/);

  await quickActionsButton.click();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('clear active filters');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(issueSearch).toHaveValue('');
  await expect(page).toHaveURL('/');
  await expect(issueListHeading).toBeFocused();
});

test('command palette preserves the current query across a focus bounce and clears it after a command runs', async ({
  page
}) => {
  await page.goto('/');

  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');
  const issueForm = page.getByRole('form', { name: 'Issue form' });

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('new issue');
  await page.keyboard.press('Escape');

  await expect(commandPalette).toHaveCount(0);
  await expect(quickActionsButton).toBeFocused();

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toHaveValue('new issue');
  await expect(commandSearch).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(issueForm).toBeVisible();
  await issueForm.getByRole('button', { name: 'Cancel' }).click();
  await expect(issueForm).toHaveCount(0);

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toHaveValue('');
});

test('command palette opens and closes issue detail from keyboard commands', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Palette keyboard issue',
    description: 'Command palette should route issue detail by keyboard.',
    status: 'review',
    priority: 'high'
  });

  await page.goto('/');

  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');
  const issueListHeading = page.getByRole('heading', { name: 'Issue List' });
  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });

  await quickActionsButton.focus();
  await expect(quickActionsButton).toBeFocused();
  await page.keyboard.press(commandPaletteShortcutKey());
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('open first visible issue');
  await page.keyboard.press('Enter');

  const detail = page.getByRole('region', { name: 'Palette keyboard issue' });
  const detailHeading = detail.getByRole('heading', { name: 'Palette keyboard issue' });

  await expect(commandPalette).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.id}`));
  await expect(detailHeading).toBeFocused();

  await page.keyboard.press(commandPaletteShortcutKey());
  await expect(commandPalette).toBeVisible();
  await commandSearch.fill('close issue detail');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL('/');
  await expect(issueListHeading).toBeFocused();
});

test('command palette executes the selected issue command when labels are duplicated', async ({ page }) => {
  const duplicateTitle = `Palette duplicate command ${Date.now()}`;
  const firstIssue = await createIssueThroughApi(page, {
    title: duplicateTitle,
    description: 'First duplicate command target.'
  });
  const secondIssue = await createIssueThroughApi(page, {
    title: duplicateTitle,
    description: 'Second duplicate command target.'
  });

  const listResponse = await page.request.get(`/api/issues?search=${encodeURIComponent(duplicateTitle)}`);

  expect(listResponse.ok()).toBe(true);

  const listBody = (await listResponse.json()) as IssueListResponse;
  const visibleDuplicateIssues = listBody.items.filter((issue) => issue.title === duplicateTitle);

  expect(visibleDuplicateIssues).toHaveLength(2);
  expect(new Set(visibleDuplicateIssues.map((issue) => issue.id))).toEqual(new Set([firstIssue.id, secondIssue.id]));

  const secondVisibleIssue = visibleDuplicateIssues[1];

  if (!secondVisibleIssue) {
    throw new Error('Expected a second duplicate issue command target.');
  }

  await page.goto(`/?search=${encodeURIComponent(duplicateTitle)}`);

  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');
  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const duplicateCommandName = `Open issue: ${duplicateTitle}. Open ${duplicateTitle}`;

  await expect(page.getByRole('row', { name: new RegExp(duplicateTitle) })).toHaveCount(2);

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await commandSearch.fill(duplicateTitle);

  const duplicateCommands = commandPalette.getByRole('button', { name: duplicateCommandName, exact: true });

  await expect(duplicateCommands).toHaveCount(2);
  await duplicateCommands.nth(1).click();

  await expect(commandPalette).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/issues/${secondVisibleIssue.id}(?:\\?|$)`));
  await expect(page.getByRole('region', { name: duplicateTitle })).toBeVisible();
});

test('keyboard shortcuts move detail focus through visible issues without stealing search focus', async ({ page }) => {
  const firstCreated = await createIssueThroughApi(page, {
    title: 'Keyboard focus path alpha',
    description: 'Keyboard navigation candidate alpha.'
  });
  const secondCreated = await createIssueThroughApi(page, {
    title: 'Keyboard focus path beta',
    description: 'Keyboard navigation candidate beta.'
  });
  const thirdCreated = await createIssueThroughApi(page, {
    title: 'Keyboard focus path gamma',
    description: 'Keyboard navigation candidate gamma.'
  });
  const issuesByTitle = new Map(
    [firstCreated, secondCreated, thirdCreated].map((issue) => [issue.title, issue] as const)
  );

  await page.goto(`/?search=${encodeURIComponent('Keyboard focus path')}`);

  const issueTitleCells = page.locator('tbody .issue-title-text');
  await expect(issueTitleCells).toHaveCount(3);
  const visibleTitles = await issueTitleCells.allTextContents();
  const firstVisibleIssue = issuesByTitle.get(visibleTitles[0]);
  const secondVisibleIssue = issuesByTitle.get(visibleTitles[1]);

  expect(firstVisibleIssue).toBeDefined();
  expect(secondVisibleIssue).toBeDefined();

  await page.keyboard.press('Alt+ArrowDown');

  const firstDetail = page.getByRole('region', { name: firstVisibleIssue!.title });
  const firstHeading = firstDetail.getByRole('heading', { name: firstVisibleIssue!.title });

  await expect(page).toHaveURL(new RegExp(`/issues/${firstVisibleIssue!.id}`));
  await expect(firstHeading).toBeFocused();

  await page.keyboard.press('Alt+ArrowDown');

  const secondDetail = page.getByRole('region', { name: secondVisibleIssue!.title });
  const secondHeading = secondDetail.getByRole('heading', { name: secondVisibleIssue!.title });

  await expect(page).toHaveURL(new RegExp(`/issues/${secondVisibleIssue!.id}`));
  await expect(secondHeading).toBeFocused();

  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(new RegExp(`/issues/${firstVisibleIssue!.id}`));
  await expect(firstHeading).toBeFocused();

  const issueSearch = page.getByRole('search', { name: 'Issue filters' }).getByLabel('Search');

  await issueSearch.focus();
  await expect(issueSearch).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');

  await expect(page).toHaveURL(new RegExp(`/issues/${firstVisibleIssue!.id}`));
  await expect(issueSearch).toBeFocused();
});

test('command palette changes the selected issue status and handles no selection', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Palette status shortcut issue',
    description: 'Command palette should move selected issue status.',
    status: 'todo',
    priority: 'medium'
  });

  await page.goto('/');

  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');

  await quickActionsButton.click();
  await commandSearch.fill('move selected issue to done');
  await expect(
    commandPalette.getByRole('button', {
      name: 'Move selected issue to Done. Select an issue to change its status to Done'
    })
  ).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.goto(`/issues/${issue.id}?search=${encodeURIComponent('Palette status shortcut')}`);

  const detail = page.getByRole('region', { name: issue.title });

  await expect(detail).toBeVisible();
  await expect(detail.getByLabel('Issue details')).toContainText('Todo');
  await expect(page.getByRole('row', { name: /Palette status shortcut issue.*Todo.*Medium/ })).toBeVisible();

  await quickActionsButton.click();
  await commandSearch.fill('move selected issue to done');
  await expect(
    commandPalette.getByRole('button', {
      name: 'Move selected issue to Done. Set Palette status shortcut issue to Done'
    })
  ).toBeEnabled();

  const statusResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === '/api/issues/bulk-status';
  });

  await page.keyboard.press('Enter');

  const statusResponse = await statusResponsePromise;
  const issueResponse = await page.request.get(`/api/issues/${issue.id}`);
  const updatedIssue = (await issueResponse.json()) as ApiIssue;

  expect(statusResponse.ok()).toBe(true);
  expect(issueResponse.ok()).toBe(true);
  expect(updatedIssue.status).toBe('done');
  await expect(commandPalette).toHaveCount(0);
  await expect(detail.getByLabel('Issue details')).toContainText('Done');
  await expect(page.getByRole('row', { name: /Palette status shortcut issue.*Done.*Medium/ })).toBeVisible();
});

test('issue detail undoes the latest status transition with audit evidence', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Undo status detail issue',
    description: 'Detail action should restore the previous status.',
    status: 'todo',
    priority: 'medium'
  });
  const statusUpdateResponse = await page.request.put(`/api/issues/${issue.id}`, {
    data: { status: 'review' }
  });

  expect(statusUpdateResponse.ok()).toBe(true);

  await page.goto(`/issues/${issue.id}?search=${encodeURIComponent('Undo status detail')}`);

  const detail = page.getByRole('region', { name: issue.title });

  await expect(detail).toBeVisible();
  await expect(detail.getByLabel('Issue details')).toContainText('Review');
  await expect(page.getByRole('row', { name: /Undo status detail issue.*Review.*Medium/ })).toBeVisible();
  await expect(detail.getByLabel('Issue activity')).toContainText('Todo -> Review');

  const undoResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${issue.id}/undo-status`;
  });

  await detail.getByRole('button', { name: `Undo last status change for ${issue.title}` }).click();

  const undoResponse = await undoResponsePromise;
  const activityResponse = await page.request.get(`/api/issues/${issue.id}/activity`);
  const activity = (await activityResponse.json()) as Array<{
    id: string;
    type: string;
    metadata: Record<string, string>;
  }>;
  const statusEvents = activity.filter((event) => event.type === 'issue_status_changed');

  expect(undoResponse.ok()).toBe(true);
  expect(activityResponse.ok()).toBe(true);
  expect(statusEvents).toHaveLength(2);
  expect(undoResponse.request().postDataJSON()).toEqual({ expectedStatusEventId: statusEvents[0].id });
  expect(statusEvents[0].metadata).toEqual({ from: 'todo', to: 'review' });
  expect(statusEvents[1].metadata).toEqual({
    from: 'review',
    to: 'todo',
    undoOfEventId: statusEvents[0].id
  });
  await expect(detail.getByLabel('Issue details')).toContainText('Todo');
  await expect(page.getByRole('row', { name: /Undo status detail issue.*Todo.*Medium/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Restored status to Todo.' })).toBeVisible();
  await expect(detail.getByLabel('Issue activity')).toContainText('Review -> Todo');
});

test('issue detail reports blocked status undo without mutating the issue', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Undo status unavailable issue',
    description: 'No prior status transition exists.',
    status: 'todo',
    priority: 'high'
  });

  await page.goto(`/issues/${issue.id}?search=${encodeURIComponent('Undo status unavailable')}`);

  const detail = page.getByRole('region', { name: issue.title });

  await expect(detail).toBeVisible();
  await expect(detail.getByLabel('Issue details')).toContainText('Todo');
  await expect(detail.getByLabel('Issue activity')).toContainText('Issue created');

  const undoResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${issue.id}/undo-status`;
  });

  await detail.getByRole('button', { name: `Undo last status change for ${issue.title}` }).click();

  const undoResponse = await undoResponsePromise;
  const issueResponse = await page.request.get(`/api/issues/${issue.id}`);
  const unchangedIssue = (await issueResponse.json()) as ApiIssue;

  expect(undoResponse.status()).toBe(409);
  expect(issueResponse.ok()).toBe(true);
  expect(unchangedIssue.status).toBe('todo');
  await expect(detail.getByRole('alert')).toContainText('No status transition to undo.');
  await expect(detail.getByLabel('Issue details')).toContainText('Todo');
});

test('issue detail reports stale status undo cursors without mutating the issue', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Undo status stale cursor issue',
    description: 'Detail action should reject stale undo cursors.',
    status: 'todo',
    priority: 'medium'
  });
  const firstStatusUpdateResponse = await page.request.put(`/api/issues/${issue.id}`, {
    data: { status: 'review' }
  });

  expect(firstStatusUpdateResponse.ok()).toBe(true);

  await page.goto(`/issues/${issue.id}?search=${encodeURIComponent('Undo status stale cursor')}`);

  const detail = page.getByRole('region', { name: issue.title });

  await expect(detail).toBeVisible();
  await expect(detail.getByLabel('Issue details')).toContainText('Review');
  await expect(detail.getByLabel('Issue activity')).toContainText('Todo -> Review');

  const secondStatusUpdateResponse = await page.request.put(`/api/issues/${issue.id}`, {
    data: { status: 'done' }
  });

  expect(secondStatusUpdateResponse.ok()).toBe(true);

  const undoResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${issue.id}/undo-status`;
  });

  await detail.getByRole('button', { name: `Undo last status change for ${issue.title}` }).click();

  const undoResponse = await undoResponsePromise;
  const issueResponse = await page.request.get(`/api/issues/${issue.id}`);
  const unchangedIssue = (await issueResponse.json()) as ApiIssue;

  expect(undoResponse.status()).toBe(409);
  expect(issueResponse.ok()).toBe(true);
  expect(unchangedIssue.status).toBe('done');
  await expect(detail.getByRole('alert')).toContainText(
    'Status undo audit cursor is stale. Refresh issue activity before undoing status.'
  );
});

test('command palette jumps to saved views and applies saved view commands', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Palette saved target',
    description: 'Saved view command should reveal this row.',
    status: 'review',
    priority: 'high',
    labels: ['palette-saved']
  });
  await createIssueThroughApi(page, {
    title: 'Palette saved other',
    description: 'Saved view command should filter this row away.',
    status: 'todo',
    priority: 'low',
    labels: ['palette-other']
  });

  const savedViewResponse = await page.request.post('/api/filter-views', {
    data: {
      name: 'Palette review view',
      search: 'Palette saved target',
      status: 'review',
      priority: 'high',
      label: 'palette-saved',
      includeArchived: false,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 25
    }
  });

  expect(savedViewResponse.ok()).toBe(true);
  const savedView = (await savedViewResponse.json()) as { id: string };

  await page.goto('/?search=Palette%20saved%20other');

  const filters = page.getByRole('search', { name: 'Issue filters' });
  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');
  const settings = page.getByLabel('Saved views and page settings');

  await expect(page.getByRole('row', { name: /Palette saved other.*Todo.*Low/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Palette saved target.*Review.*High/ })).toHaveCount(0);

  await quickActionsButton.click();
  await commandSearch.fill('focus saved views');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(settings).toHaveJSProperty('open', true);
  await expect(settings.getByLabel('Saved views')).toBeFocused();
  await expect(settings.getByLabel('Saved views')).toContainText('Palette review view');

  await quickActionsButton.click();
  await commandSearch.fill('palette review view');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('Palette saved target');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('palette-saved');
  await expect(settings.getByLabel('Saved views')).toHaveValue(savedView.id);
  await expect(page.getByRole('row', { name: /Palette saved target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Palette saved other.*Todo.*Low/ })).toHaveCount(0);

  const cleanupSavedViewResponse = await page.request.delete(`/api/filter-views/${savedView.id}`);
  expect(cleanupSavedViewResponse.ok()).toBe(true);
});

test('command palette focuses dependency actions only with a selected issue', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Palette dependency blocker',
    description: 'Command palette dependency action should add this blocker.',
    status: 'todo',
    priority: 'medium'
  });
  const target = await createIssueThroughApi(page, {
    title: 'Palette dependency target',
    description: 'Command palette should focus the dependency field.',
    status: 'review',
    priority: 'high'
  });

  await page.goto('/');

  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');

  await quickActionsButton.click();
  await commandSearch.fill('focus dependency actions');
  await expect(
    commandPalette.getByRole('button', {
      name: 'Focus dependency actions. Select an issue to manage dependencies'
    })
  ).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.goto(`/issues/${target.id}?search=${encodeURIComponent('Palette dependency target')}`);

  const detail = page.getByRole('region', { name: target.title });
  const dependencyInput = detail.getByLabel('Add blocker issue ID');

  await expect(detail).toBeVisible();
  await expect(dependencyInput).toBeEnabled();

  await quickActionsButton.click();
  await commandSearch.fill('focus dependency actions');
  await expect(
    commandPalette.getByRole('button', {
      name: 'Focus dependency actions. Add blocker dependency to Palette dependency target'
    })
  ).toBeEnabled();
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(dependencyInput).toBeFocused();

  const dependencyResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${target.id}/dependencies`;
  });

  await dependencyInput.fill(blocker.id);
  await detail.getByRole('button', { name: 'Add Dependency' }).click();

  const dependencyResponse = await dependencyResponsePromise;

  expect(dependencyResponse.ok()).toBe(true);
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
});

test('command palette toggles dashboard density and restores focus', async ({ page }) => {
  await page.goto('/');

  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');
  const densityControls = page.getByLabel('Dashboard density');
  const compactButton = densityControls.getByRole('button', { name: 'Compact' });
  const comfortableButton = densityControls.getByRole('button', { name: 'Comfortable' });

  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('compact density');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(quickActionsButton).toBeFocused();

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('comfortable density');
  await page.keyboard.press('Enter');

  await expect(commandPalette).toHaveCount(0);
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(quickActionsButton).toBeFocused();

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill('compact density');
  await page.keyboard.press('Enter');
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
});

test('imports tracker JSON through preview and apply', async ({ page }, testInfo) => {
  await page.goto('/');

  const importedDescription = [
    'Created through the JSON import flow with **safe import bold** and [Docs](https://example.com/import).',
    'Malformed markdown stays inert: [missing target]( and **unterminated strong',
    'Unsafe imported text: <script>window.__tinytrackerImportXss = true</script> and [bad](javascript:alert(1)).'
  ].join('\n');
  const importedCommentBefore =
    'Imported previous comment keeps [bad history](javascript:alert(1)) and <script>history()</script>.';
  const importedCommentAfter =
    'Imported comment body after edit with **safe comment bold** and <img src=x onerror=alert(1)> [bad](data:text/html,alert).';
  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: 'e2e-import-blocker',
        title: 'Imported blocker from JSON',
        description: 'Blocks the imported replay issue.',
        status: 'todo',
        priority: 'medium',
        labels: ['imported'],
        dueDate: null,
        isOverdue: false,
        isBlocked: false,
        dependsOnIssueIds: [],
        archivedAt: null,
        createdAt: '2999-01-01T00:00:00.000Z',
        updatedAt: '2999-01-01T00:00:00.000Z',
        comments: [],
        activityEvents: [
          {
            id: 'e2e-import-blocker-activity',
            issueId: 'e2e-import-blocker',
            type: 'issue_created',
            metadata: {
              title: 'Imported blocker from JSON'
            },
            createdAt: '2999-01-01T00:00:00.000Z'
          }
        ]
      },
      {
        id: 'e2e-import-issue',
        title: 'Imported issue from JSON',
        description: importedDescription,
        status: 'review',
        priority: 'high',
        labels: ['imported', 'replay'],
        dueDate: '2999-01-31',
        isOverdue: false,
        isBlocked: true,
        dependsOnIssueIds: ['e2e-import-blocker'],
        archivedAt: null,
        createdAt: '2999-01-01T00:00:00.000Z',
        updatedAt: '2999-01-01T00:04:00.000Z',
        comments: [
          {
            id: 'e2e-import-comment',
            issueId: 'e2e-import-issue',
            body: importedCommentAfter,
            createdAt: '2999-01-01T00:01:00.000Z',
            updatedAt: '2999-01-01T00:04:00.000Z',
            editHistory: [
              {
                id: 'e2e-import-comment-history',
                commentId: 'e2e-import-comment',
                previousBody: importedCommentBefore,
                newBody: importedCommentAfter,
                editedAt: '2999-01-01T00:04:00.000Z'
              }
            ]
          }
        ],
        activityEvents: [
          {
            id: 'e2e-import-activity',
            issueId: 'e2e-import-issue',
            type: 'issue_created',
            metadata: {
              title: 'Imported issue from JSON'
            },
            createdAt: '2999-01-01T00:00:00.000Z'
          },
          {
            id: 'e2e-import-dependency-activity',
            issueId: 'e2e-import-issue',
            type: 'issue_dependency_added',
            metadata: {
              dependsOnIssueId: 'e2e-import-blocker',
              title: 'Imported blocker from JSON'
            },
            createdAt: '2999-01-01T00:02:00.000Z'
          },
          {
            id: 'e2e-import-comment-activity',
            issueId: 'e2e-import-issue',
            type: 'comment_added',
            metadata: {
              commentId: 'e2e-import-comment',
              preview: importedCommentBefore
            },
            createdAt: '2999-01-01T00:03:00.000Z'
          },
          {
            id: 'e2e-import-comment-edit-activity',
            issueId: 'e2e-import-issue',
            type: 'comment_edited',
            metadata: {
              commentId: 'e2e-import-comment',
              previousPreview: importedCommentBefore,
              newPreview: importedCommentAfter
            },
            createdAt: '2999-01-01T00:04:00.000Z'
          }
        ]
      }
    ],
    savedFilterViews: [
      {
        id: 'e2e-import-saved-view',
        name: 'Imported replay view',
        search: 'Imported issue from JSON',
        status: 'review',
        priority: 'high',
        label: 'replay',
        includeArchived: true,
        blockedOnly: true,
        staleOnly: false,
        pageSize: 25,
        createdAt: '2999-01-01T00:05:00.000Z',
        updatedAt: '2999-01-01T00:05:00.000Z'
      }
    ]
  };
  const importFilePath = testInfo.outputPath('tinytracker-import.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');
  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByRole('heading', { name: 'Import Preview' })).toBeVisible();
  await expect(importPanel.getByRole('radio', { name: 'Skip existing conflicts (default)' })).toBeChecked();
  await expect(importPanel.getByText('Ready: 10 creates, 0 updates, 0 duplicates, 0 conflicts.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+2\s+2\s+0\s+0\s+0/ })).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Saved Views\s+1\s+1\s+0\s+0\s+0/ })).toBeVisible();
  const reportDownloadPromise = page.waitForEvent('download');

  await importPanel.getByRole('button', { name: 'Download report' }).click();
  const reportDownload = await reportDownloadPromise;
  const reportPath = await reportDownload.path();
  const reportData = JSON.parse(readFileSync(reportPath ?? '', 'utf8')) as {
    sourceFileName: string | null;
    policy: string;
    summary: {
      toCreate: {
        issues: number;
        comments: number;
        editHistory: number;
        activityEvents: number;
        savedFilterViews: number;
      };
      categories: {
        creates: {
          issues: number;
          comments: number;
          editHistory: number;
          activityEvents: number;
          savedFilterViews: number;
        };
      };
    };
    decisions: unknown[];
    warnings: string[];
    errors: unknown[];
  };

  expect(reportData.sourceFileName).toBe('tinytracker-import.json');
  expect(reportData.policy).toBe('skip-conflicts');
  expect(reportData.summary.toCreate).toEqual({
    issues: 2,
    comments: 1,
    editHistory: 1,
    activityEvents: 5,
    savedFilterViews: 1
  });
  expect(reportData.summary.categories.creates).toEqual(reportData.summary.toCreate);
  expect(Array.isArray(reportData.decisions)).toBe(true);
  expect(reportData.errors).toEqual([]);
  expect(reportData.warnings).toEqual([]);

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();

  await expect(
    importPanel.getByText('Import applied: 10 created, 0 updated, 0 duplicates, 0 conflicts.')
  ).toBeVisible();

  await importPanel.getByRole('radio', { name: 'Replace changed issues' }).check();
  const postApplyReportDownloadPromise = page.waitForEvent('download');

  await importPanel.getByRole('button', { name: 'Download report' }).click();
  const postApplyReportDownload = await postApplyReportDownloadPromise;
  const postApplyReportPath = await postApplyReportDownload.path();
  const postApplyReportData = JSON.parse(readFileSync(postApplyReportPath ?? '', 'utf8')) as {
    sourceFileName: string | null;
    policy: string;
  };

  expect(postApplyReportData.sourceFileName).toBe('tinytracker-import.json');
  expect(postApplyReportData.policy).toBe('replace-conflicts');

  const importedRow = page.getByRole('row', { name: /Imported issue from JSON.*Review.*High/ });
  await expect(importedRow).toBeVisible();
  await expect(importedRow.locator('.blocked-pill')).toHaveText('Blocked');

  const quickActionsButton = page.getByRole('button', { name: 'Quick Actions' });
  const commandPalette = page.getByRole('dialog', { name: 'Command palette' });
  const commandSearch = page.getByLabel('Search commands');

  await quickActionsButton.click();
  await expect(commandPalette).toBeVisible();
  await commandSearch.fill('e2e-import-issue');
  await expect(
    commandPalette.getByRole('button', {
      name: 'Open issue: Imported issue from JSON. Open Imported issue from JSON'
    })
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(commandPalette).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues\/e2e-import-issue/);

  const detail = page.getByRole('region', { name: 'Imported issue from JSON' });
  const description = detail.locator('.detail-description');

  await expect(description.getByText('Created through the JSON import flow')).toBeVisible();
  await expect(description.locator('strong').getByText('safe import bold')).toBeVisible();
  await expect(description.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/import');
  await expect(description.getByText('[missing target](')).toBeVisible();
  await expect(description.getByText('**unterminated strong')).toBeVisible();
  await expect(description.getByText('<script>window.__tinytrackerImportXss = true</script>')).toBeVisible();
  await expect(description.getByText('[bad](javascript:alert(1)).')).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('replay', { exact: true })).toBeVisible();
  await expect(detail.getByText('1 unresolved dependency remains: Imported blocker from JSON.')).toBeVisible();
  await expect(
    detail.getByLabel('Issue blockers').getByRole('listitem').filter({ hasText: 'Imported blocker from JSON' })
  ).toContainText('Blocking');
  const commentItem = detail.getByLabel('Issue comments').getByRole('listitem').filter({
    hasText: 'Imported comment body after edit'
  });
  const commentHistory = commentItem.locator('.comment-history');

  await expect(commentItem.locator('.comment-body').locator('strong').getByText('safe comment bold')).toBeVisible();
  await expect(commentItem.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(commentItem.getByText('[bad](data:text/html,alert)')).toBeVisible();
  await expect(commentHistory.getByText('Previous:')).toBeVisible();
  await expect(commentHistory.getByText('Imported previous comment')).toBeVisible();
  await expect(commentHistory.getByText('[bad history](javascript:alert(1))')).toBeVisible();
  await expect(commentHistory.getByText('<script>history()</script>')).toBeVisible();
  await expect(detail.locator('script')).toHaveCount(0);
  await expect(detail.locator('img')).toHaveCount(0);
  await expect(detail.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(detail.locator('a[href^="data:"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { __tinytrackerImportXss?: boolean }).__tinytrackerImportXss)
  ).toBeUndefined();
  await expect(detail.getByLabel('Issue activity').getByText('Issue created')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Dependency added')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Comment edited')).toBeVisible();

  const savedViewResponse = await page.request.get('/api/filter-views');
  expect(savedViewResponse.ok()).toBe(true);
  expect(await savedViewResponse.json()).toEqual([
    expect.objectContaining({
      name: 'Imported replay view'
    })
  ]);

  const savedViews = await expandDashboardSettings(page);

  await expect(savedViews.getByLabel('Saved views')).toContainText('Imported replay view');

  const cleanupSavedViewResponse = await page.request.delete('/api/filter-views/e2e-import-saved-view');
  expect(cleanupSavedViewResponse.ok()).toBe(true);
});

test('import preview cancel restores keyboard focus to the import trigger', async ({ page }, testInfo) => {
  await page.goto('/');

  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: 'e2e-import-cancel-focus',
        title: 'Import cancel focus issue',
        description: 'Preview only.',
        status: 'todo',
        priority: 'medium',
        labels: [],
        dueDate: null,
        isOverdue: false,
        isBlocked: false,
        dependsOnIssueIds: [],
        archivedAt: null,
        createdAt: '2999-01-01T00:00:00.000Z',
        updatedAt: '2999-01-01T00:00:00.000Z',
        comments: [],
        activityEvents: []
      }
    ],
    savedFilterViews: []
  };
  const importFilePath = testInfo.outputPath('tinytracker-import-cancel-focus.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');

  const importButton = page.getByRole('button', { name: 'Import JSON', exact: true });
  await importButton.focus();
  await expect(importButton).toBeFocused();

  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });
  const cancelImportButton = importPanel.getByRole('button', { name: 'Cancel Import' });

  await expect(importPanel.getByRole('heading', { name: 'Import Preview' })).toBeVisible();
  await cancelImportButton.focus();
  await expect(cancelImportButton).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(importPanel).toHaveCount(0);
  await expect(importButton).toBeFocused();
});

test('imports changed issue conflicts with an explicit replace policy', async ({ page }, testInfo) => {
  const existingResponse = await page.request.post('/api/issues', {
    data: {
      title: 'Conflict import issue',
      description: 'Local issue before import.',
      status: 'todo',
      priority: 'medium'
    }
  });

  expect(existingResponse.ok()).toBe(true);
  const existing = (await existingResponse.json()) as CreatedIssue & {
    status: string;
    priority: string;
    labels: string[];
    dueDate: string | null;
    isOverdue: boolean;
    archivedAt: string | null;
    isBlocked: boolean;
    dependsOnIssueIds: string[];
    createdAt: string;
    updatedAt: string;
  };
  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: existing.id,
        title: 'Conflict issue replaced from JSON',
        description: 'Changed through explicit replace policy.',
        status: 'review',
        priority: 'high',
        labels: ['conflict'],
        dueDate: null,
        isOverdue: false,
        isBlocked: false,
        dependsOnIssueIds: [],
        archivedAt: null,
        createdAt: existing.createdAt,
        updatedAt: '2999-02-01T00:00:00.000Z',
        comments: [],
        activityEvents: []
      }
    ]
  };
  const importFilePath = testInfo.outputPath('tinytracker-conflict-import.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');

  await page.goto('/');
  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByText('Ready: 0 creates, 0 updates, 0 duplicates, 1 conflicts.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+1\s+0\s+0\s+0\s+1/ })).toBeVisible();

  await importPanel.getByRole('radio', { name: 'Replace changed issues' }).check();

  await expect(importPanel.getByText('Ready: 0 creates, 1 updates, 0 duplicates, 0 conflicts.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+1\s+0\s+1\s+0\s+0/ })).toBeVisible();

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();

  await expect(importPanel.getByText('Import applied: 0 created, 1 updated, 0 duplicates, 0 conflicts.')).toBeVisible();

  const replacedRow = page.getByRole('row', { name: /Conflict issue replaced from JSON.*Review.*High/ });

  await expect(replacedRow).toBeVisible();
  await page.getByRole('button', { name: 'Open Conflict issue replaced from JSON' }).click();

  const detail = page.getByRole('region', { name: 'Conflict issue replaced from JSON' });

  await expect(detail.getByText('Changed through explicit replace policy.')).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('conflict', { exact: true })).toBeVisible();
});

test('import replace refreshes an already open issue detail route', async ({ page }, testInfo) => {
  const existingResponse = await page.request.post('/api/issues', {
    data: {
      title: 'Selected import stale issue',
      description: 'Local detail before import.',
      status: 'todo',
      priority: 'medium',
      labels: ['local']
    }
  });

  expect(existingResponse.ok()).toBe(true);
  const existing = (await existingResponse.json()) as ApiIssue;

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${existing.title}` }).click();

  const initialDetail = page.getByRole('region', { name: existing.title });

  await expect(initialDetail.getByRole('heading', { name: existing.title })).toBeVisible();
  await expect(initialDetail.locator('.detail-description')).toHaveText('Local detail before import.');
  await expect(page).toHaveURL(new RegExp(`/issues/${existing.id}$`));

  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: existing.id,
        title: 'Selected import replaced issue',
        description: 'Imported detail after replace.',
        status: 'review',
        priority: 'high',
        labels: ['import-refresh'],
        dueDate: null,
        isOverdue: false,
        isBlocked: false,
        dependsOnIssueIds: [],
        archivedAt: null,
        createdAt: existing.createdAt,
        updatedAt: '2999-03-01T00:00:00.000Z',
        comments: [
          {
            id: 'selected-import-refresh-comment',
            issueId: existing.id,
            body: 'Selected detail refreshed comment',
            createdAt: '2999-03-01T00:01:00.000Z',
            updatedAt: '2999-03-01T00:01:00.000Z',
            editHistory: []
          }
        ],
        activityEvents: [
          {
            id: 'selected-import-refresh-activity',
            issueId: existing.id,
            type: 'issue_created',
            metadata: {
              title: 'Selected import replaced issue'
            },
            createdAt: '2999-03-01T00:00:00.000Z'
          }
        ]
      }
    ]
  };
  const importFilePath = testInfo.outputPath('tinytracker-selected-refresh-import.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');
  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByText('Ready: 0 creates, 0 updates, 0 duplicates, 3 conflicts.')).toBeVisible();
  await importPanel.getByRole('radio', { name: 'Replace changed issues' }).check();
  await expect(importPanel.getByText('Ready: 2 creates, 1 updates, 0 duplicates, 0 conflicts.')).toBeVisible();

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();

  await expect(importPanel.getByText('Import applied: 2 created, 1 updated, 0 duplicates, 0 conflicts.')).toBeVisible();

  const refreshedDetail = page.getByRole('region', { name: 'Selected import replaced issue' });

  await expect(refreshedDetail.getByRole('heading', { name: 'Selected import replaced issue' })).toBeVisible();
  await expect(refreshedDetail.locator('.detail-description')).toHaveText('Imported detail after replace.');
  await expect(refreshedDetail.getByLabel('Issue labels').getByText('import-refresh', { exact: true })).toBeVisible();
  await expect(refreshedDetail.getByText('Selected detail refreshed comment')).toBeVisible();
  await expect(
    refreshedDetail.getByLabel('Issue activity').getByText('Created Selected import replaced issue.')
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Selected import replaced issue.*Review.*High/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/issues/${existing.id}$`));
});

test('import skip keeps an already open issue detail route aligned to persisted issue state', async ({
  page
}, testInfo) => {
  const existingResponse = await page.request.post('/api/issues', {
    data: {
      title: 'Selected import skipped issue',
      description: 'Local detail that should remain after skip.',
      status: 'todo',
      priority: 'medium',
      labels: ['local-skip']
    }
  });

  expect(existingResponse.ok()).toBe(true);
  const existing = (await existingResponse.json()) as ApiIssue;

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${existing.title}` }).click();

  const detail = page.getByRole('region', { name: existing.title });

  await expect(detail.getByRole('heading', { name: existing.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Local detail that should remain after skip.');

  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: existing.id,
        title: 'Selected import skipped replacement',
        description: 'Imported detail that should not replace the selected issue under skip.',
        status: 'review',
        priority: 'high',
        labels: ['import-skip'],
        dueDate: null,
        isOverdue: false,
        isBlocked: false,
        dependsOnIssueIds: [],
        archivedAt: null,
        createdAt: existing.createdAt,
        updatedAt: '2999-04-01T00:00:00.000Z',
        comments: [],
        activityEvents: []
      }
    ]
  };
  const importFilePath = testInfo.outputPath('tinytracker-selected-skip-import.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');
  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByText('Ready: 0 creates, 0 updates, 0 duplicates, 1 conflicts.')).toBeVisible();
  await importPanel.getByRole('button', { name: 'Apply Import' }).click();
  await expect(importPanel.getByText('Import applied: 0 created, 0 updated, 0 duplicates, 1 conflicts.')).toBeVisible();

  await expect(detail.getByRole('heading', { name: existing.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Local detail that should remain after skip.');
  await expect(detail.getByLabel('Issue labels').getByText('local-skip', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('import-skip', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Selected import skipped issue.*Todo.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Selected import skipped replacement.*Review.*High/ })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/issues/${existing.id}$`));
});

test('import reject keeps an already open issue detail route aligned to persisted issue state', async ({
  page
}, testInfo) => {
  const existingResponse = await page.request.post('/api/issues', {
    data: {
      title: 'Selected import rejected issue',
      description: 'Local detail that should remain after rejected apply.',
      status: 'todo',
      priority: 'medium',
      labels: ['local-reject']
    }
  });

  expect(existingResponse.ok()).toBe(true);
  const existing = (await existingResponse.json()) as ApiIssue;

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${existing.title}` }).click();

  const detail = page.getByRole('region', { name: existing.title });

  await expect(detail.getByRole('heading', { name: existing.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText(
    'Local detail that should remain after rejected apply.'
  );

  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: existing.id,
        title: 'Selected import rejected replacement',
        description: 'Apply rejection should keep the selected detail unchanged.',
        status: 'review',
        priority: 'high',
        labels: ['import-reject'],
        dueDate: null,
        isOverdue: false,
        isBlocked: false,
        dependsOnIssueIds: [],
        archivedAt: null,
        createdAt: existing.createdAt,
        updatedAt: '2999-05-01T00:00:00.000Z',
        comments: [],
        activityEvents: []
      }
    ]
  };
  const importFilePath = testInfo.outputPath('tinytracker-selected-reject-import.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');
  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByText('Ready: 0 creates, 0 updates, 0 duplicates, 1 conflicts.')).toBeVisible();

  await page.route('**/api/import/apply', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        valid: false,
        exportVersion: 1,
        policy: 'skip-conflicts',
        summary: {
          input: { issues: 1, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
          toCreate: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
          toReplace: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
          skip: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
          exactMatches: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
          changed: { issues: 1, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
          categories: {
            creates: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
            updates: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
            duplicates: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 },
            conflicts: { issues: 0, comments: 0, editHistory: 0, activityEvents: 0, savedFilterViews: 0 }
          },
          reject: 1
        },
        decisions: [
          {
            entity: 'issue',
            sourceId: existing.id,
            sourceIndex: 0,
            issueId: existing.id,
            decision: 'reject',
            matchType: 'changed',
            policyDecision: 'skip',
            reasons: ['simulated reject for selected issue']
          }
        ],
        errors: [
          {
            code: 'simulated_reject',
            path: '$.issues[0]',
            message: 'Simulated reject for selected issue.'
          }
        ],
        warnings: []
      })
    });
  });

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();
  await expect(importPanel.getByText('Import apply found validation errors.')).toBeVisible();

  await expect(detail.getByRole('heading', { name: existing.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText(
    'Local detail that should remain after rejected apply.'
  );
  await expect(detail.getByLabel('Issue labels').getByText('local-reject', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('import-reject', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Selected import rejected issue.*Todo.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Selected import rejected replacement.*High/ })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/issues/${existing.id}$`));
});

test('archives hides restores and preserves issue activity', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Archive recovery issue',
    description: 'Archived issues stay recoverable.',
    priority: 'high'
  });

  await page.goto('/?search=Archive%20recovery%20issue');

  const filters = page.getByLabel('Issue filters');
  const includeArchived = filters.getByLabel('Include archived');
  const issueRow = page.getByRole('row', { name: /Archive recovery issue.*Todo.*High/ });

  await expect(includeArchived).not.toBeChecked();
  await expect(issueRow).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Archive "Archive recovery issue"?');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Archive Archive recovery issue' }).click();

  await expect(issueRow).toHaveCount(0);
  await expect(page.getByText('Matching issues are archived.')).toBeVisible();
  await expect(
    page.getByText('Include archived issues to review results that are hidden from the active board.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Include Archived' })).toBeVisible();

  await includeArchived.check();
  await expect(page.getByLabel('Active filters')).toContainText('Archived: Included');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBe('true');
  await expect(issueRow).toBeVisible();
  await expect(issueRow.locator('.archived-pill')).toHaveText('Archived');

  await page.getByRole('button', { name: 'Open Archive recovery issue' }).click();

  const detail = page.getByRole('region', { name: issue.title });

  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(detail.getByText('Hidden from the active dashboard since')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Issue archived')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${issue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBe('true');

  await detail.getByRole('button', { name: 'Unarchive' }).click();

  await expect(detail.getByText('Hidden from the active dashboard since')).toHaveCount(0);
  await expect(detail.getByLabel('Issue activity').getByText('Issue restored')).toBeVisible();

  await detail.getByRole('button', { name: `Close issue detail for ${issue.title}` }).click();

  await expect(issueRow).toBeVisible();
  await expect(issueRow.locator('.archived-pill')).toHaveCount(0);

  await includeArchived.uncheck();
  await expect(issueRow).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBeNull();
});

test('archive action offers undo recovery in active and include-archived modes', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Undo archive recovery issue',
    description: 'Allows accidental archive recovery from list actions.',
    priority: 'medium'
  });

  await page.goto(`/?search=${encodeURIComponent(issue.title)}`);

  const filters = page.getByLabel('Issue filters');
  const includeArchived = filters.getByLabel('Include archived');
  const issueListHeading = page.getByRole('heading', { name: 'Issue List' });
  const issueRow = page.getByRole('row', { name: new RegExp(`Undo archive recovery issue.*Todo.*Medium`) });
  const undoArchiveButton = page.getByRole('button', { name: `Undo archive of ${issue.title}` });
  const archiveNotice = page.getByRole('status').filter({ hasText: `Issue "${issue.title}" archived.` });
  const dismissArchiveButton = page.getByRole('button', { name: 'Dismiss' });

  await expect(includeArchived).not.toBeChecked();
  await expect(issueRow).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Archive "Undo archive recovery issue"?');
    await dialog.accept();
  });
  const activeArchiveResponse = waitForIssueActionResponse(page, issue.id, 'archive');
  await page.getByRole('button', { name: `Archive ${issue.title}` }).click();
  await activeArchiveResponse;

  await expect(archiveNotice).toBeVisible();
  await expect(undoArchiveButton).toBeVisible();
  await expect(issueRow).toHaveCount(0);

  await undoArchiveButton.focus();
  await expect(undoArchiveButton).toBeFocused();

  const activeUndoResponse = waitForIssueActionResponse(page, issue.id, 'unarchive');
  await undoArchiveButton.click();
  await activeUndoResponse;

  await expect(archiveNotice).toHaveCount(0);
  await expect(issueRow).toBeVisible();
  await expect(issueListHeading).toBeFocused();

  await includeArchived.check();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Archive "Undo archive recovery issue"?');
    await dialog.accept();
  });
  const includedArchiveResponse = waitForIssueActionResponse(page, issue.id, 'archive');
  await page.getByRole('button', { name: `Archive ${issue.title}` }).click();
  await includedArchiveResponse;

  await expect(archiveNotice).toBeVisible();
  await expect(issueRow.locator('.archived-pill')).toHaveText('Archived');

  await dismissArchiveButton.focus();
  await expect(dismissArchiveButton).toBeFocused();
  await dismissArchiveButton.click();

  await expect(archiveNotice).toHaveCount(0);
  await expect(issueListHeading).toBeFocused();
  await expect(issueRow.locator('.archived-pill')).toHaveText('Archived');

  const includedUndoResponse = waitForIssueActionResponse(page, issue.id, 'unarchive');
  await page.getByRole('button', { name: `Unarchive ${issue.title}` }).click();
  await includedUndoResponse;

  await expect(issueRow.locator('.archived-pill')).toHaveCount(0);
});

test('archiving selected detail preserves active filters page size and route state', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Selected detail archive issue',
    description: 'Selected detail should stay coherent when archive visibility changes.',
    status: 'review',
    priority: 'high'
  });

  await createIssueThroughApi(page, {
    title: 'Selected detail archive mismatch',
    description: 'Should stay hidden by the active priority filter.',
    status: 'review',
    priority: 'low'
  });

  await page.goto(
    `/issues/${issue.id}?search=${encodeURIComponent('Selected detail archive')}&status=review&priority=high&limit=10`
  );

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const issueRow = page.getByRole('row', { name: /Selected detail archive issue.*Review.*High/ });
  const mismatchRow = page.getByRole('row', { name: /Selected detail archive mismatch.*Review.*Low/ });
  const detail = page.getByRole('region', { name: issue.title });

  await expect(filters.getByLabel('Search')).toHaveValue('Selected detail archive');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(settings.getByLabel('Page size')).toHaveValue('10');
  await expect(page.getByLabel('Active filters')).toContainText('Page size: 10');
  await expect(issueRow).toBeVisible();
  await expect(mismatchRow).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${issue.id}`);

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Archive "Selected detail archive issue"?');
    await dialog.accept();
  });
  const archiveResponse = waitForIssueActionResponse(page, issue.id, 'archive');
  await detail.getByRole('button', { name: 'Archive', exact: true }).click();
  await archiveResponse;

  await expect(detail.getByText('Hidden from the active dashboard since')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Issue archived')).toBeVisible();
  await expect(issueRow).toHaveCount(0);
  await expect(page.getByText('Matching issues are archived.')).toBeVisible();
  await expect(
    page.getByText('Include archived issues to review results that are hidden from the active board.')
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${issue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Selected detail archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('10');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBeNull();

  await filters.getByLabel('Include archived').check();

  await expect(page.getByLabel('Active filters')).toContainText('Archived: Included');
  await expect(issueRow).toBeVisible();
  await expect(issueRow.locator('.archived-pill')).toHaveText('Archived');
  await expect(mismatchRow).toHaveCount(0);
  await expect(detail.getByText('Hidden from the active dashboard since')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${issue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('10');
});

test('create dependency archive and recovery flow preserves blocker context', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Combined flow blocker',
    description: 'Blocks the issue created through the dashboard flow.',
    status: 'todo',
    priority: 'high'
  });

  await page.goto('/');

  await page.getByRole('button', { name: 'New Issue' }).click();

  const issueForm = page.getByRole('form', { name: 'Issue form' });

  await issueForm.getByLabel('Title').fill('Combined flow issue');
  await issueForm.getByLabel('Description').fill('Created through the combined archive dependency recovery flow.');
  await issueForm.getByLabel('Status').selectOption('in_progress');
  await issueForm.getByLabel('Priority').selectOption('high');
  await issueForm.getByRole('button', { name: 'Create Issue' }).click();

  const issueRow = page.getByRole('row', { name: /Combined flow issue.*In Progress.*High/ });

  await expect(issueRow).toBeVisible();

  await issueRow.getByRole('button', { name: 'Open Combined flow issue' }).click();

  const detail = page.getByRole('region', { name: 'Combined flow issue' });
  const dependencyForm = detail.getByRole('form', { name: 'Dependency form' });
  const blockersSection = detail.getByLabel('Issue blockers');
  const blockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });
  const issueId = new URL(page.url()).pathname.split('/').at(-1);

  if (!issueId) {
    throw new Error('Expected opened detail route to include the selected issue id.');
  }

  await dependencyForm.getByLabel('Add blocker issue ID').fill(blocker.id);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerItem.getByText(blocker.title)).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(detail.getByLabel('Issue activity').getByText('Dependency added')).toBeVisible();
  await expect(issueRow.locator('.blocked-pill')).toHaveText('Blocked');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Archive "Combined flow issue"?');
    await dialog.accept();
  });
  const archiveResponse = waitForIssueActionResponse(page, issueId, 'archive');
  await detail.getByRole('button', { name: 'Archive', exact: true }).click();
  await archiveResponse;

  await expect(detail.getByText('Hidden from the active dashboard since')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Issue archived')).toBeVisible();
  await expect(issueRow).toHaveCount(0);

  const unarchiveResponse = waitForIssueActionResponse(page, issueId, 'unarchive');
  await detail.getByRole('button', { name: 'Unarchive' }).click();
  await unarchiveResponse;

  await expect(detail.getByText('Hidden from the active dashboard since')).toHaveCount(0);
  await expect(detail.getByLabel('Issue activity').getByText('Issue restored')).toBeVisible();
  await expect(blockerItem.getByText(blocker.title)).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(issueRow).toBeVisible();
  await expect(issueRow.locator('.blocked-pill')).toHaveText('Blocked');
});

test('bulk visible selection changes issue status with confirmation and scoped activity', async ({ page }) => {
  const first = await createIssueThroughApi(page, {
    title: 'Bulk status visible first',
    description: 'Selected from the current filtered page.',
    status: 'todo',
    priority: 'high'
  });
  await createIssueThroughApi(page, {
    title: 'Bulk status visible second',
    description: 'Also selected from the current filtered page.',
    status: 'in_progress',
    priority: 'medium'
  });
  const unchanged = await createIssueThroughApi(page, {
    title: 'Bulk status visible unchanged',
    description: 'Already has the target status.',
    status: 'done',
    priority: 'low'
  });
  const hidden = await createIssueThroughApi(page, {
    title: 'Bulk status hidden issue',
    description: 'Must not be changed by visible-only bulk status.',
    status: 'todo',
    priority: 'medium'
  });

  await page.goto('/?search=Bulk%20status%20visible');

  const bulkActions = page.getByLabel('Bulk status actions');
  const firstSelection = page.getByLabel(`Select ${first.title}`);
  const statusSelect = bulkActions.getByLabel(/Bulk status target\./);
  const changeStatusButton = bulkActions.getByLabel('Change status for 3 selected issues');

  await expect(page.getByRole('row', { name: /Bulk status visible first.*Todo.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status visible second.*In Progress.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status visible unchanged.*Done.*Low/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status hidden issue/ })).toHaveCount(0);
  await expect(bulkActions).toContainText('0 selected');
  await expect(firstSelection).toHaveAttribute('aria-describedby', 'bulk-selection-context');
  await expect(firstSelection).toHaveAccessibleDescription('0 issues selected from the current page.');

  await bulkActions.getByRole('button', { name: 'Select all 3 visible issues' }).click();
  await expect(bulkActions).toContainText('3 selected');
  await expect(statusSelect).toHaveAccessibleName('Bulk status target. 3 issues selected.');
  await expect(changeStatusButton).toBeEnabled();
  await statusSelect.selectOption('done');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Change 3 selected issues to Done?');
    await dialog.accept();
  });
  await bulkActions.getByRole('button', { name: 'Change Status' }).click();

  await expect(bulkActions).toContainText('Changed 2 issues to Done.');
  await expect(bulkActions).toContainText('1 already was Done.');
  await expect(bulkActions).toContainText('0 selected');
  await expect(bulkActions.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  await expect(bulkActions.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
  await expect(page.getByRole('row', { name: /Bulk status visible first.*Done.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status visible second.*Done.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status visible unchanged.*Done.*Low/ })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Bulk status visible');

  const [firstActivityResponse, unchangedActivityResponse, hiddenIssueResponse] = await Promise.all([
    page.request.get(`/api/issues/${first.id}/activity`),
    page.request.get(`/api/issues/${unchanged.id}/activity`),
    page.request.get(`/api/issues/${hidden.id}`)
  ]);
  const firstActivity = (await firstActivityResponse.json()) as Array<{
    type: string;
    metadata: Record<string, string>;
  }>;
  const unchangedActivity = (await unchangedActivityResponse.json()) as Array<{ type: string }>;
  const hiddenIssue = (await hiddenIssueResponse.json()) as { status: string };

  expect(firstActivity.filter((event) => event.type === 'issue_status_changed')).toEqual([
    expect.objectContaining({
      metadata: {
        from: 'todo',
        to: 'done'
      }
    })
  ]);
  expect(unchangedActivity.map((event) => event.type)).toEqual(['issue_created']);
  expect(hiddenIssue.status).toBe('todo');
});

test('bulk status reports mixed invalid selections clearly and clears stale selection state', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Bulk mixed invalid first',
    description: 'Should still update when one selection goes missing.',
    status: 'todo',
    priority: 'high'
  });
  await createIssueThroughApi(page, {
    title: 'Bulk mixed invalid second',
    description: 'Provides a visible multi-selection path.',
    status: 'in_progress',
    priority: 'medium'
  });

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = typeof input === 'string' ? input : (request?.url ?? '');
      const method = init?.method ?? request?.method ?? 'GET';

      if (method === 'POST' && new URL(url, window.location.origin).pathname === '/api/issues/bulk-status') {
        const response = await originalFetch(input, init);
        const body = (await response.clone().json()) as {
          status: string;
          updated: ApiIssue[];
          unchangedIds: string[];
          duplicateIds: string[];
          notFoundIds: string[];
        };

        body.notFoundIds = ['missing-bulk-selection'];
        window.sessionStorage.setItem('bulk-status-mixed-invalid-mutated', 'true');

        return new Response(JSON.stringify(body), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }

      return originalFetch(input, init);
    };
  });

  await page.goto('/?search=Bulk%20mixed%20invalid');

  const bulkActions = page.getByLabel('Bulk status actions');
  await bulkActions.getByRole('button', { name: 'Select all 2 visible issues' }).click();
  await expect(bulkActions).toContainText('2 selected');
  await bulkActions.getByLabel(/Bulk status target\./).selectOption('done');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Change 2 selected issues to Done?');
    await dialog.accept();
  });
  await bulkActions.getByRole('button', { name: 'Change status for 2 selected issues' }).click();

  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('bulk-status-mixed-invalid-mutated')))
    .toBe('true');
  await expect(bulkActions).toContainText('Changed 2 issues to Done.');
  await expect(bulkActions).toContainText('1 missing id was skipped.');
  await expect(bulkActions).toContainText('0 selected');
  await expect(page.getByRole('row', { name: /Bulk mixed invalid first.*Done.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk mixed invalid second.*Done.*Medium/ })).toBeVisible();
});

test('bulk archive clears focused detail and offers undo recovery', async ({ page }) => {
  const focused = await createIssueThroughApi(page, {
    title: 'Bulk archive focus detail',
    description: 'Focused detail should be cleared after bulk archive.',
    status: 'todo',
    priority: 'high'
  });
  const second = await createIssueThroughApi(page, {
    title: 'Bulk archive focus companion',
    description: 'Archived with the focused issue.',
    status: 'review',
    priority: 'medium'
  });
  await createIssueThroughApi(page, {
    title: 'Bulk archive focus survivor',
    description: 'Should remain visible after selected issues archive.',
    status: 'in_progress',
    priority: 'low'
  });

  await page.goto(`/issues/${focused.id}?search=Bulk%20archive%20focus`);

  const detail = page.getByRole('region', { name: focused.title });
  const bulkActions = page.getByLabel('Bulk status actions');

  await expect(detail.getByRole('heading', { name: focused.title })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive focus detail.*Todo.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive focus companion.*Review.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive focus survivor.*In Progress.*Low/ })).toBeVisible();

  await page.getByLabel(`Select ${focused.title}`).check();
  await page.getByLabel(`Select ${second.title}`).check();
  await expect(bulkActions).toContainText('2 selected');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Archive 2 selected issues?');
    await dialog.accept();
  });
  const archiveResponse = waitForBulkArchiveResponse(page);
  await bulkActions.getByRole('button', { name: 'Archive 2 selected issues' }).click();
  await archiveResponse;

  await expect(page.getByRole('region', { name: focused.title })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect(bulkActions).toContainText('Archived 2 issues.');
  await expect(bulkActions).toContainText('0 selected');
  await expect(page.getByRole('status').filter({ hasText: '2 issues archived.' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive focus detail/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Bulk archive focus companion/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Bulk archive focus survivor.*In Progress.*Low/ })).toBeVisible();

  const focusedAfterArchiveResponse = await page.request.get(`/api/issues/${focused.id}`);
  const focusedAfterArchive = (await focusedAfterArchiveResponse.json()) as ApiIssue;

  expect(focusedAfterArchive.archivedAt).toEqual(expect.any(String));

  const restoreFocusedResponse = waitForIssueActionResponse(page, focused.id, 'unarchive');
  const restoreSecondResponse = waitForIssueActionResponse(page, second.id, 'unarchive');

  await page.getByRole('button', { name: 'Undo archive of 2 issues' }).click();
  await Promise.all([restoreFocusedResponse, restoreSecondResponse]);

  await expect(page.getByRole('status').filter({ hasText: '2 issues archived.' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: focused.title })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Bulk archive focus detail.*Todo.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive focus companion.*Review.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive focus survivor.*In Progress.*Low/ })).toBeVisible();
});

test('bulk archive failure restores action focus and announces the reason', async ({ page }) => {
  const first = await createIssueThroughApi(page, {
    title: 'Bulk archive failure first',
    description: 'Failed archive should keep focus anchored.',
    status: 'todo',
    priority: 'high'
  });
  const second = await createIssueThroughApi(page, {
    title: 'Bulk archive failure second',
    description: 'Failed archive should keep the selection intact.',
    status: 'review',
    priority: 'medium'
  });

  await page.route('**/api/issues/bulk-archive', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Bulk archive temporarily unavailable.' })
    });
  });

  await page.goto('/?search=Bulk%20archive%20failure');

  const bulkActions = page.getByLabel('Bulk status actions');

  await page.getByLabel(`Select ${first.title}`).check();
  await page.getByLabel(`Select ${second.title}`).check();
  await expect(bulkActions).toContainText('2 selected');

  const archiveButton = bulkActions.getByRole('button', { name: 'Archive 2 selected issues' });

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Archive 2 selected issues?');
    await dialog.accept();
  });
  await archiveButton.click();

  const failureAlert = bulkActions.getByRole('alert');

  await expect(failureAlert).toHaveText('Bulk archive temporarily unavailable.');
  await expect(failureAlert).toHaveAttribute('aria-live', 'assertive');
  await expect(failureAlert).toHaveAttribute('aria-atomic', 'true');
  await expect(archiveButton).toBeFocused();
  await expect(archiveButton).toHaveAccessibleDescription(
    '2 issues selected from the current page. Bulk archive temporarily unavailable.'
  );
  await expect(bulkActions).toContainText('2 selected');
  await expect(page.getByRole('row', { name: /Bulk archive failure first.*Todo.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk archive failure second.*Review.*Medium/ })).toBeVisible();
});

test('bulk status refreshes selected dependency detail when a blocker resolves', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Bulk blocker refresh source',
    description: 'Resolving this issue should unblock the selected dependent.',
    status: 'todo',
    priority: 'high'
  });
  const dependent = await createIssueThroughApi(page, {
    title: 'Bulk blocker refresh dependent',
    description: 'Open detail must reflect derived dependency state after bulk status.',
    status: 'in_progress',
    priority: 'low'
  });
  const dependencyResponse = await page.request.post(`/api/issues/${dependent.id}/dependencies`, {
    data: {
      dependsOnIssueId: blocker.id
    }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto(`/issues/${dependent.id}?search=Bulk%20blocker%20refresh`);

  const detail = page.getByRole('region', { name: dependent.title });
  const blockerRow = page.getByRole('row', { name: /Bulk blocker refresh source/ });
  const dependentRow = page.getByRole('row', { name: /Bulk blocker refresh dependent/ });

  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerRow).toContainText('Todo');
  await expect(blockerRow).toContainText('High');
  await expect(dependentRow).toContainText('In Progress');
  await expect(dependentRow).toContainText('Low');
  await expect(dependentRow.locator('.blocked-pill')).toHaveText('Blocked');
  await blockerRow.getByLabel(`Select ${blocker.title}`).check();

  const bulkActions = page.getByLabel('Bulk status actions');

  await expect(bulkActions).toContainText('1 selected');
  await bulkActions.getByLabel(/Bulk status target\./).selectOption('done');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Change 1 selected issue to Done?');
    await dialog.accept();
  });
  await bulkActions.getByRole('button', { name: 'Change Status' }).click();

  await expect(bulkActions).toContainText('Changed 1 issue to Done.');
  await expect(blockerRow).toContainText('Done');
  await expect(dependentRow.locator('.blocked-pill')).toHaveCount(0);

  const blockerItem = detail.getByLabel('Issue blockers').getByRole('listitem').filter({ hasText: blocker.title });
  const selectedIssueResponse = await page.request.get(`/api/issues/${dependent.id}`);
  const selectedIssue = (await selectedIssueResponse.json()) as ApiIssue;

  expect(selectedIssueResponse.ok()).toBe(true);
  expect(selectedIssue).toMatchObject({
    isBlocked: false,
    dependsOnIssueIds: [blocker.id]
  });
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(blockerItem.getByText('Done')).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveCount(0);
});

test('bulk status failure announces an assertive error without clearing selection', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Bulk status failure issue',
    description: 'Used to verify accessible failure feedback.',
    status: 'todo',
    priority: 'medium'
  });

  await page.goto('/?search=Bulk%20status%20failure');

  await page.route('**/api/issues/bulk-status', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Bulk status update failed test.' })
    });
  });

  const bulkActions = page.getByLabel('Bulk status actions');
  const selection = page.getByLabel('Select Bulk status failure issue');

  await selection.check();
  await expect(bulkActions).toContainText('1 selected');
  await bulkActions.getByLabel(/Bulk status target\./).selectOption('done');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Change 1 selected issue to Done?');
    await dialog.accept();
  });
  await bulkActions.getByRole('button', { name: 'Change status for 1 selected issue' }).click();

  const alert = bulkActions.getByRole('alert');

  await expect(alert).toHaveText('Bulk status update failed test.');
  await expect(alert).toHaveAttribute('aria-live', 'assertive');
  await expect(alert).toHaveAttribute('aria-atomic', 'true');
  await expect(bulkActions).toContainText('1 selected');
});

test('bulk status no-op gives actionable feedback without clearing selection', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Bulk status no-op issue',
    description: 'Already in the requested status.',
    status: 'done',
    priority: 'medium'
  });

  await page.goto('/?search=Bulk%20status%20no-op');

  const bulkActions = page.getByLabel('Bulk status actions');
  const selection = page.getByLabel('Select Bulk status no-op issue');

  await selection.check();
  await expect(bulkActions).toContainText('1 selected');
  await bulkActions.getByLabel(/Bulk status target\./).selectOption('done');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Change 1 selected issue to Done?');
    await dialog.accept();
  });
  await bulkActions.getByRole('button', { name: 'Change status for 1 selected issue' }).click();

  const alert = bulkActions.getByRole('alert');

  await expect(alert).toHaveText(
    'No status changes were applied. 1 selected issue is already Done. Choose a different status or adjust the selection.'
  );
  await expect(alert).toHaveAttribute('aria-live', 'assertive');
  await expect(selection).toBeChecked();
  await expect(bulkActions).toContainText('1 selected');
});

test('stale issue signal filters and persists through saved views', async ({ page }) => {
  const staleIssueId = '00000000-0000-4000-8000-000000000215';
  const importResponse = await page.request.post('/api/import/apply', {
    data: {
      exportVersion: 1,
      issues: [
        {
          id: staleIssueId,
          title: 'Stale triage issue',
          description: 'Needs operator attention after a long quiet period.',
          status: 'todo',
          priority: 'medium',
          labels: ['triage'],
          dueDate: null,
          isOverdue: false,
          isBlocked: false,
          dependsOnIssueIds: [],
          archivedAt: null,
          createdAt: '2000-01-01T00:00:00.000Z',
          updatedAt: '2000-01-01T00:00:00.000Z',
          comments: [],
          activityEvents: []
        }
      ]
    }
  });

  expect(importResponse.ok()).toBe(true);

  await createIssueThroughApi(page, {
    title: 'Fresh triage issue',
    description: 'Recently updated work should not match stale-only.',
    status: 'todo',
    priority: 'medium'
  });

  await page.goto('/?staleOnly=true');

  const filters = page.getByLabel('Issue filters');
  const staleRow = page.getByRole('row', { name: /Stale triage issue.*Todo.*Medium/ });

  await expect(filters.getByLabel('Stale only')).toBeChecked();
  await expect(page.getByLabel('Active filters')).toContainText('Stale: Only');
  await expect.poll(() => new URL(page.url()).searchParams.get('staleOnly')).toBe('true');
  await expect(staleRow).toBeVisible();
  await expect(staleRow.locator('.stale-pill')).toHaveText('Stale');
  await expect(page.getByRole('row', { name: /Fresh triage issue.*Todo.*Medium/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Stale triage issue' }).click();

  const detail = page.getByRole('region', { name: 'Stale triage issue' });

  await expect(detail.getByText('No updates in 30+ days.')).toBeVisible();
  await expect(detail.getByText('Freshness')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${staleIssueId}`);
  await detail.getByRole('button', { name: 'Close issue detail for Stale triage issue' }).click();

  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');

  await savedViews.getByLabel('View name').fill('Stale triage view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Stale triage view');

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(filters.getByLabel('Stale only')).not.toBeChecked();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Stale only')).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.get('staleOnly')).toBe('true');
  await expect(staleRow).toBeVisible();

  const savedViewList = await page.request.get('/api/filter-views');
  const savedViewListBody = (await savedViewList.json()) as Array<{ name: string; staleOnly: boolean }>;

  expect(savedViewList.ok()).toBe(true);
  expect(savedViewListBody).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'Stale triage view',
        staleOnly: true
      })
    ])
  );

  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await expect(savedViews.getByRole('option', { name: 'Stale triage view' })).toHaveCount(0);
});

test('dependency links show and clear blocked issue visibility', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Dependency blocker issue',
    description: 'Must finish before the blocked issue.',
    status: 'todo',
    priority: 'high'
  });
  const blocked = await createIssueThroughApi(page, {
    title: 'Dependency blocked issue',
    description: 'Shows derived blocked state.',
    status: 'in_progress',
    priority: 'medium'
  });
  const dependent = await createIssueThroughApi(page, {
    title: 'Dependency dependent issue',
    description: 'Blocked by the target issue.',
    status: 'review',
    priority: 'low'
  });
  const blockerAfterArchive = await createIssueThroughApi(page, {
    title: 'Dependency blocker after archive',
    description: 'Used to clear block state after an archived blocker remains.',
    status: 'todo',
    priority: 'low'
  });

  await page.goto(`/issues/${blocked.id}`);

  const detail = page.getByRole('region', { name: blocked.title });
  const dependencyForm = detail.getByRole('form', { name: 'Dependency form' });

  await expect(detail.getByRole('heading', { name: 'Blockers' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Dependents' })).toBeVisible();
  await expect(detail.getByLabel('Issue blockers')).toContainText('No blockers.');
  await expect(detail.getByLabel('Issue dependents')).toContainText('No dependents.');

  await dependencyForm.getByLabel('Add blocker issue ID').fill(blocker.id);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const blockersSection = detail.getByLabel('Issue blockers');
  const blockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });

  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerItem.getByText(blocker.title)).toBeVisible();
  await expect(blockerItem.getByRole('button', { name: `Remove dependency ${blocker.title}` })).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(detail.getByLabel('Issue activity').getByText('Dependency added')).toBeVisible();

  const blockedRow = page.getByRole('row', { name: /Dependency blocked issue.*In Progress.*Medium/ });

  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  await page.request.post(`/api/issues/${dependent.id}/dependencies`, {
    data: {
      dependsOnIssueId: blocked.id
    }
  });
  await page.reload();

  const dependentsSection = detail.getByLabel('Issue dependents');
  const dependentItem = dependentsSection.getByRole('listitem').filter({ hasText: dependent.title });

  await expect(dependentItem).toBeVisible();
  await expect(dependentItem.getByText('Review')).toBeVisible();

  await page.request.post(`/api/issues/${blocker.id}/archive`);
  await page.reload();

  const archivedBlockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });

  await expect(archivedBlockerItem.getByText('Archived')).toBeVisible();
  await expect(archivedBlockerItem.getByText('Blocking')).toHaveCount(0);
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);

  await page.request.post(`/api/issues/${blocker.id}/unarchive`);
  await page.reload();

  const unarchivedBlockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });

  await expect(unarchivedBlockerItem.getByText('Archived')).toHaveCount(0);
  await expect(unarchivedBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  await page.request.post(`/api/issues/${blocker.id}/close`);
  await page.reload();

  const closedBlockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });

  await expect(closedBlockerItem.getByText('Done')).toBeVisible();
  await expect(closedBlockerItem.locator('.blocked-pill')).toHaveCount(0);
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(blockedRow.locator('.blocked-pill')).toHaveCount(0);

  await page.request.post(`/api/issues/${blocker.id}/reopen`);
  await page.reload();

  const reopenedBlockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });

  await expect(reopenedBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  await page.request.post(`/api/issues/${blocker.id}/archive`);
  await page.reload();

  await expect(
    blockersSection.getByRole('listitem').filter({ hasText: blocker.title }).getByText('Archived')
  ).toBeVisible();
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);

  await dependencyForm.getByLabel('Add blocker issue ID').fill(blockerAfterArchive.id);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const blockerAfterArchiveItem = blockersSection.getByRole('listitem').filter({ hasText: blockerAfterArchive.title });

  await expect(blockerAfterArchiveItem).toBeVisible();
  await expect(
    detail.getByText(
      `1 unresolved dependency remains: ${blockerAfterArchive.title}. 1 other dependency is already resolved.`
    )
  ).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Dependency added')).toHaveCount(2);

  await blockerAfterArchiveItem.getByRole('button', { name: `Remove dependency ${blockerAfterArchive.title}` }).click();

  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(blockedRow.locator('.blocked-pill')).toHaveCount(0);
  await expect(detail.getByLabel('Issue activity').getByText('Dependency removed')).toBeVisible();
  await expect(dependentsSection.getByText(dependent.title)).toBeVisible();
});

test('dependency removal clears final blocker banner when selected issue refresh fails', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Final refresh failure blocker',
    description: 'Removing this dependency should unblock the selected detail immediately.',
    status: 'todo',
    priority: 'high'
  });
  const blocked = await createIssueThroughApi(page, {
    title: 'Final refresh failure blocked issue',
    description: 'Should not keep a stale blocked banner after the final blocker is removed.',
    status: 'in_progress',
    priority: 'medium'
  });
  const dependencyResponse = await page.request.post(`/api/issues/${blocked.id}/dependencies`, {
    data: {
      dependsOnIssueId: blocker.id
    }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto(`/issues/${blocked.id}?search=${encodeURIComponent('Final refresh failure blocked issue')}`);

  const detail = page.getByRole('region', { name: blocked.title });
  const blockedRow = page.getByRole('row', { name: /Final refresh failure blocked issue.*In Progress.*Medium/ });
  const blockerItem = detail.getByLabel('Issue blockers').getByRole('listitem').filter({ hasText: blocker.title });

  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  let failNextSelectedIssueRefresh = false;
  await page.route(`**/api/issues/${blocked.id}`, async (route) => {
    const requestUrl = new URL(route.request().url());

    if (
      route.request().method() === 'GET' &&
      requestUrl.pathname === `/api/issues/${blocked.id}` &&
      failNextSelectedIssueRefresh
    ) {
      failNextSelectedIssueRefresh = false;

      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Transient selected issue refresh failure' })
      });
      return;
    }

    await route.continue();
  });

  const removeDependencyResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return (
      response.request().method() === 'DELETE' &&
      responseUrl.pathname === `/api/issues/${blocked.id}/dependencies/${blocker.id}`
    );
  });

  failNextSelectedIssueRefresh = true;
  await blockerItem.getByRole('button', { name: `Remove dependency ${blocker.title}` }).click();

  const removeDependencyResponse = await removeDependencyResponsePromise;

  expect(removeDependencyResponse.ok()).toBe(true);
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(detail.getByLabel('Issue blockers')).toContainText('No blockers.');
  await expect(blockedRow.locator('.blocked-pill')).toHaveCount(0);
  await expect(detail.getByLabel('Issue activity').getByText('Dependency removed')).toBeVisible();

  await page.reload();

  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(detail.getByLabel('Issue blockers')).toContainText('No blockers.');
  await expect(blockedRow.locator('.blocked-pill')).toHaveCount(0);
});

test('dependency removal preserves blocked banner while another active blocker remains', async ({ page }) => {
  const removedBlocker = await createIssueThroughApi(page, {
    title: 'Remaining banner removed blocker',
    description: 'This blocker is removed while another blocker still blocks the issue.',
    status: 'todo',
    priority: 'medium'
  });
  const remainingBlocker = await createIssueThroughApi(page, {
    title: 'Remaining banner active blocker',
    description: 'This blocker should keep the selected issue blocked.',
    status: 'in_progress',
    priority: 'high'
  });
  const blocked = await createIssueThroughApi(page, {
    title: 'Remaining banner blocked issue',
    description: 'Removing one dependency must not hide a valid blocked banner.',
    status: 'review',
    priority: 'medium'
  });

  for (const dependsOnIssueId of [removedBlocker.id, remainingBlocker.id]) {
    const dependencyResponse = await page.request.post(`/api/issues/${blocked.id}/dependencies`, {
      data: {
        dependsOnIssueId
      }
    });

    expect(dependencyResponse.ok()).toBe(true);
  }

  await page.goto(`/issues/${blocked.id}?search=${encodeURIComponent('Remaining banner blocked issue')}`);

  const detail = page.getByRole('region', { name: blocked.title });
  const blockedRow = page.getByRole('row', { name: /Remaining banner blocked issue.*Review.*Medium/ });
  const blockersSection = detail.getByLabel('Issue blockers');
  const removedBlockerItem = blockersSection.getByRole('listitem').filter({ hasText: removedBlocker.title });
  const remainingBlockerItem = blockersSection.getByRole('listitem').filter({ hasText: remainingBlocker.title });

  await expect(
    detail.getByText(`2 unresolved dependencies remain: ${removedBlocker.title} and ${remainingBlocker.title}.`)
  ).toBeVisible();
  await expect(removedBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(remainingBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  const removeDependencyResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return (
      response.request().method() === 'DELETE' &&
      responseUrl.pathname === `/api/issues/${blocked.id}/dependencies/${removedBlocker.id}`
    );
  });

  await removedBlockerItem.getByRole('button', { name: `Remove dependency ${removedBlocker.title}` }).click();

  const removeDependencyResponse = await removeDependencyResponsePromise;

  expect(removeDependencyResponse.ok()).toBe(true);
  await expect(detail.getByText(`1 unresolved dependency remains: ${remainingBlocker.title}.`)).toBeVisible();
  await expect(removedBlockerItem).toHaveCount(0);
  await expect(remainingBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  await page.reload();

  await expect(detail.getByText(`1 unresolved dependency remains: ${remainingBlocker.title}.`)).toBeVisible();
  await expect(blockersSection).not.toContainText(removedBlocker.title);
  await expect(remainingBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
});

test('dependency add refreshes blocked-only list while preserving detail route', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Blocked-only live blocker',
    description: 'Blocks the selected issue after the detail form changes.',
    status: 'todo',
    priority: 'high'
  });
  const blocked = await createIssueThroughApi(page, {
    title: 'Blocked-only live detail issue',
    description: 'Starts outside blocked-only results and should join them live.',
    status: 'in_progress',
    priority: 'medium'
  });

  await page.goto(`/issues/${blocked.id}?blockedOnly=true&search=Blocked-only%20live%20detail`);

  const filters = page.getByLabel('Issue filters');
  const detail = page.getByRole('region', { name: blocked.title });
  const dependencyForm = detail.getByRole('form', { name: 'Dependency form' });
  const blockedRow = page.getByRole('row', { name: /Blocked-only live detail issue.*In Progress.*Medium/ });

  await expect(filters.getByLabel('Search')).toHaveValue('Blocked-only live detail');
  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect(page.getByLabel('Active filters')).toContainText('Search: Blocked-only live detail');
  await expect(page.getByLabel('Active filters')).toContainText('Blocked: Only');
  await expect(blockedRow).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: blocked.title })).toBeVisible();
  await expect(detail.getByLabel('Issue blockers')).toContainText('No blockers.');
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${blocked.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Blocked-only live detail');

  const dependencyResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${blocked.id}/dependencies`;
  });

  await dependencyForm.getByLabel('Add blocker issue ID').fill(blocker.id);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const dependencyResponse = await dependencyResponsePromise;

  expect(dependencyResponse.ok()).toBe(true);

  const blockerItem = detail.getByLabel('Issue blockers').getByRole('listitem').filter({ hasText: blocker.title });
  const selectedIssueResponse = await page.request.get(`/api/issues/${blocked.id}`);
  const selectedIssue = (await selectedIssueResponse.json()) as ApiIssue;

  expect(selectedIssueResponse.ok()).toBe(true);
  expect(selectedIssue).toMatchObject({
    isBlocked: true,
    dependsOnIssueIds: [blocker.id]
  });
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerItem.getByText(blocker.title)).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(page.getByText('No issues match the active filters.')).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('Blocked-only live detail');
  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${blocked.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Blocked-only live detail');

  const removeDependencyResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return (
      response.request().method() === 'DELETE' &&
      responseUrl.pathname === `/api/issues/${blocked.id}/dependencies/${blocker.id}`
    );
  });

  await blockerItem.getByRole('button', { name: `Remove dependency ${blocker.title}` }).click();

  const removeDependencyResponse = await removeDependencyResponsePromise;

  expect(removeDependencyResponse.ok()).toBe(true);

  const unblockedIssueResponse = await page.request.get(`/api/issues/${blocked.id}`);
  const unblockedIssue = (await unblockedIssueResponse.json()) as ApiIssue;

  expect(unblockedIssueResponse.ok()).toBe(true);
  expect(unblockedIssue).toMatchObject({
    isBlocked: false,
    dependsOnIssueIds: []
  });
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(detail.getByLabel('Issue blockers')).toContainText('No blockers.');
  await expect(blockedRow).toHaveCount(0);
  await expect(page.getByText('No blocked issues match the current filters.')).toBeVisible();
  await expect(
    page.getByText('Turn off Blocked only to widen the list without losing the rest of your current filters.')
  ).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Dependency removed')).toBeVisible();
  await expect(filters.getByLabel('Search')).toHaveValue('Blocked-only live detail');
  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${blocked.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Blocked-only live detail');
});

test('blocked-only detail recovers when an archived blocker is restored', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Blocked archive recovery blocker',
    description: 'Archiving this issue should unblock the dependent until recovery.',
    status: 'todo',
    priority: 'high'
  });
  const blocked = await createIssueThroughApi(page, {
    title: 'Blocked archive recovery target',
    description: 'Stays selected while its blocker is archived and restored.',
    status: 'in_progress',
    priority: 'medium'
  });
  const dependencyResponse = await page.request.post(`/api/issues/${blocked.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto(`/issues/${blocked.id}?blockedOnly=true&search=${encodeURIComponent('Blocked archive recovery')}`);

  const filters = page.getByLabel('Issue filters');
  const detail = page.getByRole('region', { name: blocked.title });
  const blockedRow = page.getByRole('row', { name: /Blocked archive recovery target.*In Progress.*Medium/ });
  const blockersSection = detail.getByLabel('Issue blockers');
  const blockerItem = blockersSection.getByRole('listitem').filter({ hasText: blocker.title });

  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(detail.getByRole('heading', { name: blocked.title })).toBeVisible();
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');

  const archiveBlockerResponse = await page.request.post(`/api/issues/${blocker.id}/archive`);
  expect(archiveBlockerResponse.ok()).toBe(true);
  await page.reload();

  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect(page.getByText('No blocked issues match the current filters.')).toBeVisible();
  await expect(
    page.getByText('Turn off Blocked only to widen the list without losing the rest of your current filters.')
  ).toBeVisible();
  await expect(blockedRow).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: blocked.title })).toBeVisible();
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(blockerItem.getByText('Archived')).toBeVisible();
  await expect(blockerItem.locator('.blocked-pill')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${blocked.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');

  const restoreBlockerResponse = await page.request.post(`/api/issues/${blocker.id}/unarchive`);
  expect(restoreBlockerResponse.ok()).toBe(true);
  await page.reload();

  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(blockerItem.getByText('Archived')).toHaveCount(0);
  await expect(blockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(page.getByText('No issues match the active filters.')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${blocked.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
});

test('dependency duplicate and cycle rejections keep UI graph state unchanged', async ({ page }) => {
  const first = await createIssueThroughApi(page, {
    title: 'Duplicate cycle first issue',
    description: 'Owns the first dependency edge.',
    status: 'in_progress',
    priority: 'medium'
  });
  const second = await createIssueThroughApi(page, {
    title: 'Duplicate cycle second issue',
    description: 'Blocks the first issue and depends on the third.',
    status: 'todo',
    priority: 'high'
  });
  const third = await createIssueThroughApi(page, {
    title: 'Duplicate cycle third issue',
    description: 'Must reject a cycle back to the first issue.',
    status: 'review',
    priority: 'low'
  });

  await page.goto(`/issues/${first.id}`);

  const firstDetail = page.getByRole('region', { name: first.title });
  const firstDependencyForm = firstDetail.getByRole('form', { name: 'Dependency form' });

  await firstDependencyForm.getByLabel('Add blocker issue ID').fill(second.id);
  await firstDependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const firstBlockers = firstDetail.getByLabel('Issue blockers');
  const secondBlockerItem = firstBlockers.getByRole('listitem').filter({ hasText: second.title });

  await expect(secondBlockerItem).toBeVisible();
  await expect(firstDetail.getByText(`1 unresolved dependency remains: ${second.title}.`)).toBeVisible();
  await expect(
    page.getByRole('row', { name: /Duplicate cycle first issue.*In Progress.*Medium/ }).locator('.blocked-pill')
  ).toHaveText('Blocked');

  await firstDependencyForm.getByLabel('Add blocker issue ID').fill(second.id);
  await firstDependencyForm.getByRole('button', { name: 'Add Dependency' }).click();
  await expect(firstDetail.getByRole('alert')).toHaveText('Issue dependency already exists');
  await expect(firstBlockers.getByRole('listitem')).toHaveCount(1);
  await expect(secondBlockerItem).toBeVisible();
  await expect(firstDetail.getByLabel('Issue activity').getByText('Dependency added')).toHaveCount(1);
  await expect(firstDetail.getByText(`1 unresolved dependency remains: ${second.title}.`)).toBeVisible();

  const secondDependency = await page.request.post(`/api/issues/${second.id}/dependencies`, {
    data: {
      dependsOnIssueId: third.id
    }
  });

  expect(secondDependency.ok()).toBe(true);

  await page.goto(`/issues/${third.id}`);

  const thirdDetail = page.getByRole('region', { name: third.title });
  const thirdDependencyForm = thirdDetail.getByRole('form', { name: 'Dependency form' });
  const thirdBlockers = thirdDetail.getByLabel('Issue blockers');

  await expect(thirdBlockers).toContainText('No blockers.');

  await thirdDependencyForm.getByLabel('Add blocker issue ID').fill(first.id);
  await thirdDependencyForm.getByRole('button', { name: 'Add Dependency' }).click();
  await expect(thirdDetail.getByRole('alert')).toHaveText(
    'Cannot add dependency because the selected blocker already depends on this issue'
  );
  await expect(thirdBlockers).toContainText('No blockers.');
  await expect(thirdBlockers.getByRole('listitem')).toHaveCount(0);
  await expect(thirdDetail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(
    page.getByRole('row', { name: /Duplicate cycle third issue.*Review.*Low/ }).locator('.blocked-pill')
  ).toHaveCount(0);

  const thirdStateResponse = await page.request.get(`/api/issues/${third.id}/dependencies`);
  const thirdState = (await thirdStateResponse.json()) as { dependencies: unknown[]; isBlocked: boolean };

  expect(thirdStateResponse.ok()).toBe(true);
  expect(thirdState).toMatchObject({
    dependencies: [],
    isBlocked: false
  });
});

test('failed dependency cycle edit reconciles stale blocker state', async ({ page }) => {
  const first = await createIssueThroughApi(page, {
    title: 'Rollback cycle first issue',
    description: 'Depends on the second issue to form a rejection path.',
    status: 'in_progress',
    priority: 'medium'
  });
  const second = await createIssueThroughApi(page, {
    title: 'Rollback cycle second issue',
    description: 'Depends on the target issue.',
    status: 'todo',
    priority: 'high'
  });
  const target = await createIssueThroughApi(page, {
    title: 'Rollback cycle target issue',
    description: 'Its stale blocker should disappear after a failed cycle edit.',
    status: 'review',
    priority: 'low'
  });
  const staleBlocker = await createIssueThroughApi(page, {
    title: 'Rollback stale blocker issue',
    description: 'Removed outside the current UI before the failed edit.',
    status: 'todo',
    priority: 'medium'
  });

  for (const [issueId, dependsOnIssueId] of [
    [first.id, second.id],
    [second.id, target.id],
    [target.id, staleBlocker.id]
  ]) {
    const dependencyResponse = await page.request.post(`/api/issues/${issueId}/dependencies`, {
      data: {
        dependsOnIssueId
      }
    });

    expect(dependencyResponse.ok()).toBe(true);
  }

  await page.goto(`/issues/${target.id}?search=${encodeURIComponent('Rollback cycle target issue')}`);

  const detail = page.getByRole('region', { name: target.title });
  const dependencyForm = detail.getByRole('form', { name: 'Dependency form' });
  const dependencyInput = dependencyForm.getByLabel('Add blocker issue ID');
  const blockers = detail.getByLabel('Issue blockers');
  const staleBlockerItem = blockers.getByRole('listitem').filter({ hasText: staleBlocker.title });
  const targetRow = page.getByRole('row', { name: /Rollback cycle target issue.*Review.*Low/ });

  await expect(detail.getByText(`1 unresolved dependency remains: ${staleBlocker.title}.`)).toBeVisible();
  await expect(staleBlockerItem.locator('.blocked-pill')).toHaveText('Blocking');
  await expect(targetRow.locator('.blocked-pill')).toHaveText('Blocked');

  const externalRemovalResponse = await page.request.delete(`/api/issues/${target.id}/dependencies/${staleBlocker.id}`);

  expect(externalRemovalResponse.ok()).toBe(true);
  await expect(staleBlockerItem).toBeVisible();

  const failedCycleResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${target.id}/dependencies`;
  });

  await dependencyInput.fill(first.id);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const failedCycleResponse = await failedCycleResponsePromise;

  expect(failedCycleResponse.status()).toBe(409);
  await expect(dependencyForm.getByRole('alert')).toHaveText(
    'Cannot add dependency because the selected blocker already depends on this issue'
  );
  const rollbackFeedback = detail.locator('.dependency-rollback-feedback');

  await expect(rollbackFeedback).toHaveText(
    'Dependency edit rolled back. Cannot add dependency because the selected blocker already depends on this issue'
  );
  await expect(rollbackFeedback).toHaveAttribute('aria-live', 'assertive');
  await expect(rollbackFeedback).toHaveAttribute('aria-atomic', 'true');
  await expect(dependencyInput).toHaveValue(first.id);
  await expect(staleBlockerItem).toHaveCount(0);
  await expect(blockers).toContainText('No blockers.');
  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(targetRow.locator('.blocked-pill')).toHaveCount(0);
  await expect(detail.getByLabel('Issue activity').getByText('Dependency removed')).toBeVisible();

  const reconciledStateResponse = await page.request.get(`/api/issues/${target.id}/dependencies`);
  const reconciledState = (await reconciledStateResponse.json()) as { dependencies: unknown[]; isBlocked: boolean };

  expect(reconciledStateResponse.ok()).toBe(true);
  expect(reconciledState).toMatchObject({
    dependencies: [],
    isBlocked: false
  });

  const successfulDependencyResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return response.request().method() === 'POST' && responseUrl.pathname === `/api/issues/${target.id}/dependencies`;
  });

  await dependencyInput.fill(staleBlocker.id);
  await expect(rollbackFeedback).toHaveCount(0);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const successfulDependencyResponse = await successfulDependencyResponsePromise;

  expect(successfulDependencyResponse.ok()).toBe(true);
  await expect(dependencyForm.getByRole('alert')).toHaveCount(0);
  await expect(dependencyInput).toHaveValue('');
  await expect(blockers.getByRole('listitem').filter({ hasText: staleBlocker.title })).toBeVisible();
  await expect(detail.getByText(`1 unresolved dependency remains: ${staleBlocker.title}.`)).toBeVisible();
  await expect(targetRow.locator('.blocked-pill')).toHaveText('Blocked');
});

test('dependency form trims whitespace and blocks self-dependency before submit', async ({ page }) => {
  const selected = await createIssueThroughApi(page, {
    title: 'Whitespace self dependency issue',
    description: 'Owns the dependency form under test.',
    status: 'in_progress',
    priority: 'medium'
  });
  const blocker = await createIssueThroughApi(page, {
    title: 'Trimmed blocker issue',
    description: 'Should be added after whitespace normalization.',
    status: 'todo',
    priority: 'high'
  });

  await page.goto(`/issues/${selected.id}`);

  const detail = page.getByRole('region', { name: selected.title });
  const dependencyForm = detail.getByRole('form', { name: 'Dependency form' });
  const dependencyInput = dependencyForm.getByLabel('Add blocker issue ID');
  const blockers = detail.getByLabel('Issue blockers');

  let dependencyPostCount = 0;

  await page.route('**/api/issues/*/dependencies', async (route) => {
    if (route.request().method() === 'POST') {
      dependencyPostCount += 1;
    }

    await route.continue();
  });

  await dependencyInput.fill(`  ${selected.id}  `);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  await expect(detail.getByRole('alert')).toHaveText('Issue cannot depend on itself');
  await expect(dependencyInput).toHaveValue(selected.id);
  await expect(blockers).toContainText('No blockers.');
  expect(dependencyPostCount).toBe(0);

  const dependencyRequestPromise = page.waitForRequest((request) => {
    const requestUrl = new URL(request.url());
    return request.method() === 'POST' && requestUrl.pathname === `/api/issues/${selected.id}/dependencies`;
  });

  await dependencyInput.fill(`  ${blocker.id}  `);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  const dependencyRequest = await dependencyRequestPromise;
  expect(dependencyRequest.postDataJSON()).toEqual({ dependsOnIssueId: blocker.id });

  const blockerItem = blockers.getByRole('listitem').filter({ hasText: blocker.title });
  await expect(blockerItem).toBeVisible();
  await expect(detail.getByText(`1 unresolved dependency remains: ${blocker.title}.`)).toBeVisible();
  await expect(dependencyInput).toHaveValue('');
  expect(dependencyPostCount).toBe(1);
});

test('dependency dependents show blocking only when the selected issue can block', async ({ page }) => {
  const completedBlocker = await createIssueThroughApi(page, {
    title: 'Completed dependency source',
    description: 'A finished issue should not currently block active dependents.',
    status: 'done',
    priority: 'high'
  });
  const activeDependent = await createIssueThroughApi(page, {
    title: 'Active downstream dependent',
    description: 'This issue depends on a completed source.',
    status: 'in_progress',
    priority: 'medium'
  });

  const dependencyResponse = await page.request.post(`/api/issues/${activeDependent.id}/dependencies`, {
    data: {
      dependsOnIssueId: completedBlocker.id
    }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto(`/issues/${completedBlocker.id}`);

  const detail = page.getByRole('region', { name: completedBlocker.title });
  const dependentsSection = detail.getByLabel('Issue dependents');
  const activeDependentItem = dependentsSection.getByRole('listitem').filter({ hasText: activeDependent.title });

  await expect(activeDependentItem).toBeVisible();
  await expect(activeDependentItem.getByText('In Progress')).toBeVisible();
  await expect(activeDependentItem.locator('.blocked-pill')).toHaveCount(0);
});

test('dashboard density toggle compacts rows without hiding issue information', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Density blocker issue',
    description: 'Keeps the primary row in a blocked state.',
    status: 'in_progress',
    priority: 'medium'
  });
  const blocked = await createIssueThroughApi(page, {
    title: 'Density toggle issue',
    description: 'Operational row text remains visible in every density.',
    status: 'review',
    priority: 'high'
  });
  const dependencyResponse = await page.request.post(`/api/issues/${blocked.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto('/');

  const densityControls = page.getByLabel('Dashboard density');
  const compactButton = densityControls.getByRole('button', { name: 'Compact' });
  const comfortableButton = densityControls.getByRole('button', { name: 'Comfortable' });
  const issueRow = page.getByRole('row', { name: /Density toggle issue.*Review.*High/ });

  await expect(densityControls).toBeVisible();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(issueRow).toBeVisible();
  await expect(issueRow).toContainText('Operational row text remains visible in every density.');
  await expect(issueRow).toContainText('No due date');
  await expect(issueRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(issueRow.getByRole('button', { name: 'Open Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Edit Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Archive Density toggle issue' })).toBeVisible();
  await expect(page.getByText('Saved views & page settings')).toBeVisible();

  await compactButton.click();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(issueRow).toBeVisible();
  await expect(issueRow).toContainText('Density toggle issue');
  await expect(issueRow).toContainText('Operational row text remains visible in every density.');
  await expect(issueRow).toContainText('Review');
  await expect(issueRow).toContainText('High');
  await expect(issueRow).toContainText('No due date');
  await expect(issueRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(issueRow.getByRole('button', { name: 'Open Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Edit Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Archive Density toggle issue' })).toBeVisible();

  await comfortableButton.click();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');

  await compactButton.click();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(issueRow).toBeVisible();
  await expect(issueRow).toContainText('Operational row text remains visible in every density.');
  await expect(issueRow.locator('.blocked-pill')).toHaveText('Blocked');

  await comfortableButton.click();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(issueRow).toBeVisible();
  await expect(issueRow.locator('.blocked-pill')).toHaveText('Blocked');
});

test('large queues keep dashboard rows scannable in compact and mobile layouts', async ({ page }) => {
  const issues = await createLargeIssueSet(page, 120, {
    idOffset: 1000,
    titlePrefix: 'Scan issue',
    descriptionPrefix: 'Scan guardrail item'
  });
  const blockedIssue = issues[117];
  const blockerIssue = issues[118];
  const archivedIssue = issues[116];

  const dependencyResponse = await page.request.post(`/api/issues/${blockedIssue.id}/dependencies`, {
    data: { dependsOnIssueId: blockerIssue.id }
  });
  const archiveResponse = await page.request.post(`/api/issues/${archivedIssue.id}/archive`);

  expect(dependencyResponse.ok()).toBe(true);
  expect(archiveResponse.ok()).toBe(true);

  await page.goto('/?limit=25&includeArchived=true&search=Scan%20issue');

  const densityControls = page.getByLabel('Dashboard density');
  const compactButton = densityControls.getByRole('button', { name: 'Compact' });
  const blockedRow = page.getByRole('row', { name: /Scan issue 0117.*In Progress.*Low/ });
  const archivedRow = page.getByRole('row', { name: /Scan issue 0116.*Todo.*High/ });
  const blockedDescription = blockedRow.locator('.issue-description-snippet');

  await expect(blockedRow).toBeVisible();
  await expect(blockedRow.locator('.issue-title-text')).toHaveText('Scan issue 0117');
  await expect(blockedDescription).toContainText('Scan guardrail item 0117');
  await expect(blockedRow.locator('.issue-state-flags')).toBeVisible();
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(blockedRow.locator('.pill.status-in_progress')).toHaveText('In Progress');
  await expect(blockedRow.locator('.pill.priority-low')).toHaveText('Low');
  await expect(blockedRow.getByText('No due date')).toBeVisible();
  await expect(blockedRow.getByText('bulk', { exact: true })).toBeVisible();
  await expect(blockedRow.getByText('group-7', { exact: true })).toBeVisible();
  await expect(blockedRow.getByRole('button', { name: 'Open Scan issue 0117' })).toBeVisible();
  await expect(blockedRow.getByRole('button', { name: 'Edit Scan issue 0117' })).toBeVisible();
  await expect(blockedRow.getByRole('button', { name: 'Archive Scan issue 0117' })).toBeVisible();
  await expect(archivedRow.locator('.archived-pill')).toHaveText('Archived');
  await expect
    .poll(() =>
      blockedDescription.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-line-clamp'))
    )
    .toBe('2');

  await compactButton.click();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(blockedRow).toBeVisible();
  await expect(blockedRow.locator('.label-row')).toHaveCSS('overflow', 'hidden');
  await expect
    .poll(() =>
      blockedDescription.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-line-clamp'))
    )
    .toBe('1');
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(blockedRow.locator('.pill.status-in_progress')).toHaveText('In Progress');
  await expect(blockedRow.locator('.pill.priority-low')).toHaveText('Low');
  await expect(blockedRow.getByRole('button', { name: 'Open Scan issue 0117' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.locator('.table-wrap')).toBeVisible();
  await expect(page.locator('.table-wrap')).toHaveCSS('overflow-x', 'auto');
  await expect(blockedRow).toBeVisible();
  await expect(blockedRow.locator('.issue-state-flags')).toBeVisible();
  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');
  await expect(blockedRow.locator('.pill.status-in_progress')).toHaveText('In Progress');
  await expect(blockedRow.locator('.pill.priority-low')).toHaveText('Low');
  await expect(blockedRow.getByRole('button', { name: 'Open Scan issue 0117' })).toBeVisible();
});

test('keyboard focus survives density changes and issue detail navigation', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Keyboard density focus issue',
    description: 'Focus should survive density changes before detail navigation.',
    status: 'review',
    priority: 'high'
  });

  await page.goto('/');

  const densityControls = page.getByLabel('Dashboard density');
  const compactButton = densityControls.getByRole('button', { name: 'Compact' });
  const issueRow = page.getByRole('row', { name: /Keyboard density focus issue.*Review.*High/ });
  const openIssueButton = issueRow.getByRole('button', { name: 'Open Keyboard density focus issue' });

  await expect(issueRow).toBeVisible();
  await pressTabUntilFocused(page, compactButton, 80);
  await page.keyboard.press('Enter');
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(compactButton).toBeFocused();

  await pressTabUntilFocused(page, openIssueButton, 120);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.id}`));

  const detail = page.getByRole('region', { name: 'Keyboard density focus issue' });
  const detailHeading = detail.getByRole('heading', { name: 'Keyboard density focus issue' });
  await expect(detailHeading).toBeFocused();

  const closeDetailButton = detail.getByRole('button', {
    name: 'Close issue detail for Keyboard density focus issue'
  });
  await pressTabUntilFocused(page, closeDetailButton, 40);
  await page.keyboard.press('Enter');

  await expect(detail).toHaveCount(0);
  await expect(openIssueButton).toBeFocused();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
});

test('secondary dashboard controls are discoverable and accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = page.getByLabel('Saved views and page settings');
  const settingsToggle = settings.locator('summary').filter({ hasText: 'Saved views & page settings' });
  const pageSizeSelect = settings.getByLabel('Page size');
  const savedViews = settings.getByLabel('Saved filter views');
  const savedViewsSelect = savedViews.getByLabel('Saved views');

  await expect(filters.getByLabel('Search')).toBeVisible();
  await expect(filters.getByLabel('Status')).toBeVisible();
  await expect(filters.getByLabel('Priority')).toBeVisible();
  await expect(filters.getByLabel('Include archived')).toBeVisible();
  await expect(filters.getByLabel('Stale only')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download JSON' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import JSON', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Issue' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Service status' })).toBeVisible();
  await expect(settingsToggle).toContainText('Saved views & page settings');
  await expect(pageSizeSelect).toBeHidden();
  await expect(savedViewsSelect).toBeHidden();

  await page.keyboard.press('Tab');
  await pressTabUntilFocused(page, settingsToggle, 40);
  await page.keyboard.press('Enter');
  await expect(pageSizeSelect).toBeVisible();
  await expect(savedViewsSelect).toBeVisible();
  await expect(settings.getByLabel('View name')).toBeVisible();

  const hasNoHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  );

  expect(hasNoHorizontalOverflow).toBe(true);
});

test('markdown-lite renders safe formatting and keeps unsafe input inert', async ({ page }) => {
  const rawDescription = [
    'Description with **bold text**, _italic text_, `inline code`, and [Example](https://example.com/docs?q=1#top).',
    'Second line stays in the same paragraph.',
    '',
    '```',
    'const safe = true;',
    '<script>not real html</script>',
    '```',
    '',
    'Unsafe text: <script>window.__tinytrackerXss = true</script> and [bad](javascript:alert(1)).'
  ].join('\n');
  const rawComment =
    'Comment has **strong comment** and [bad](data:text/html,alert) plus <img src=x onerror=alert(1)>.';
  const previousHistoryComment = [
    'Previous comment keeps **history bold** and [History docs](https://example.com/history).',
    'Second history line stays visible.',
    '',
    '```',
    '<script>history code stays text</script>',
    '```',
    '',
    'Unsafe history: <script>window.__tinytrackerHistoryXss = true</script> and [bad history](javascript:alert(1)).'
  ].join('\n');
  const editedHistoryComment = 'Edited history comment keeps **current bold**.';
  const issue = await createIssueThroughApi(page, {
    title: 'Markdown render issue',
    description: rawDescription
  });
  const commentResponse = await page.request.post(`/api/issues/${issue.id}/comments`, {
    data: {
      body: rawComment
    }
  });

  expect(commentResponse.ok()).toBe(true);

  const historyCommentResponse = await page.request.post(`/api/issues/${issue.id}/comments`, {
    data: {
      body: previousHistoryComment
    }
  });

  expect(historyCommentResponse.ok()).toBe(true);

  const historyComment = (await historyCommentResponse.json()) as { id: string };
  const editHistoryCommentResponse = await page.request.put(`/api/comments/${historyComment.id}`, {
    data: {
      body: editedHistoryComment
    }
  });
  const apiHistoryResponse = await page.request.get(`/api/comments/${historyComment.id}/history`);
  const apiHistory = (await apiHistoryResponse.json()) as Array<{ previousBody: string; newBody: string }>;

  expect(editHistoryCommentResponse.ok()).toBe(true);
  expect(apiHistoryResponse.ok()).toBe(true);
  expect(apiHistory[0]).toMatchObject({
    previousBody: previousHistoryComment,
    newBody: editedHistoryComment
  });

  await page.goto(`/issues/${issue.id}`);

  const detail = page.getByRole('region', { name: issue.title });
  const description = detail.locator('.detail-description');

  await expect(description.locator('strong').getByText('bold text')).toBeVisible();
  await expect(description.locator('em').getByText('italic text')).toBeVisible();
  await expect(description.locator('code').getByText('inline code')).toBeVisible();
  await expect(description.locator('pre code')).toContainText('const safe = true;');
  await expect(description.locator('pre code')).toContainText('<script>not real html</script>');

  const safeLink = description.getByRole('link', { name: 'Example' });
  await expect(safeLink).toHaveAttribute('href', 'https://example.com/docs?q=1#top');
  await expect(safeLink).toHaveAttribute('target', '_blank');
  await expect(safeLink).toHaveAttribute('rel', 'noopener noreferrer');

  await expect(description.getByText('<script>window.__tinytrackerXss = true</script>')).toBeVisible();
  await expect(description.getByText('[bad](javascript:alert(1)).')).toBeVisible();
  await expect(detail.locator('script')).toHaveCount(0);
  await expect(detail.locator('img')).toHaveCount(0);
  await expect(detail.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(detail.locator('a[href^="data:"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { __tinytrackerXss?: boolean }).__tinytrackerXss)
  ).toBeUndefined();

  const commentItem = detail.getByLabel('Issue comments').getByRole('listitem').filter({ hasText: 'Comment has' });

  await expect(commentItem.locator('strong').getByText('strong comment')).toBeVisible();
  await expect(commentItem.getByText('[bad](data:text/html,alert)')).toBeVisible();
  await expect(commentItem.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(commentItem.locator('a[href^="data:"]')).toHaveCount(0);
  await expect(commentItem.locator('img')).toHaveCount(0);

  const historyCommentItem = detail.getByLabel('Issue comments').getByRole('listitem').filter({
    hasText: 'Edited history comment keeps'
  });
  const commentHistory = historyCommentItem.locator('.comment-history');
  const previousHistoryBody = commentHistory.locator('.comment-history-body');

  await expect(historyCommentItem.locator('.comment-body').locator('strong').getByText('current bold')).toBeVisible();
  await expect(commentHistory.getByText('Previous:')).toBeVisible();
  await expect(previousHistoryBody.locator('strong').getByText('history bold')).toBeVisible();
  await expect(previousHistoryBody.getByRole('link', { name: 'History docs' })).toHaveAttribute(
    'href',
    'https://example.com/history'
  );
  await expect(previousHistoryBody.getByText('Second history line stays visible.')).toBeVisible();
  await expect(previousHistoryBody.locator('pre code')).toContainText('<script>history code stays text</script>');
  await expect(previousHistoryBody.getByText('<script>window.__tinytrackerHistoryXss = true</script>')).toBeVisible();
  await expect(previousHistoryBody.getByText('[bad history](javascript:alert(1)).')).toBeVisible();
  await expect(historyCommentItem.locator('script')).toHaveCount(0);
  await expect(historyCommentItem.locator('img')).toHaveCount(0);
  await expect(historyCommentItem.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { __tinytrackerHistoryXss?: boolean }).__tinytrackerHistoryXss)
  ).toBeUndefined();

  const exportDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON' }).click();
  const exportDownload = await exportDownloadPromise;
  const exportPath = await exportDownload.path();

  expect(exportDownload.suggestedFilename()).toBe('tinytracker-export.json');
  expect(exportPath).not.toBeNull();

  const exportedData = JSON.parse(readFileSync(exportPath ?? '', 'utf8')) as {
    issues: ExportedIssue[];
  };
  const exportedIssue = exportedData.issues.find((candidate) => candidate.title === issue.title);
  const exportedHistoryComment = exportedIssue?.comments.find((comment) => comment.body === editedHistoryComment);

  expect(exportedHistoryComment?.editHistory[0]).toMatchObject({
    previousBody: previousHistoryComment,
    newBody: editedHistoryComment
  });

  await page.getByRole('button', { name: 'Edit Markdown render issue' }).click();

  const issueForm = page.getByRole('form', { name: 'Issue form' });

  await expect(issueForm.getByLabel('Description')).toHaveValue(rawDescription);
});

test('keyboard users can create open comment edit and close an issue', async ({ page }) => {
  await page.goto('/');

  const downloadLink = page.getByRole('link', { name: 'Download JSON' });
  const importButton = page.getByRole('button', { name: 'Import JSON', exact: true });
  const newIssueButton = page.getByRole('button', { name: 'New Issue' });

  await page.keyboard.press('Tab');
  await expect(downloadLink).toBeFocused();
  const keyboardExportDownloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const keyboardExportDownload = await keyboardExportDownloadPromise;
  expect(keyboardExportDownload.suggestedFilename()).toBe('tinytracker-export.json');

  await page.keyboard.press('Tab');
  await expect(importButton).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(newIssueButton).toBeFocused();
  await page.keyboard.press('Enter');

  const issueForm = page.getByRole('form', { name: 'Issue form' });
  const issueTitle = issueForm.getByLabel('Title');
  const issueDescription = issueForm.getByLabel('Description');
  const createIssueButton = issueForm.getByRole('button', { name: 'Create Issue' });

  await expect(issueTitle).toBeFocused();
  await page.keyboard.type('Keyboard issue');
  await expect(issueTitle).toHaveValue('Keyboard issue');
  await page.keyboard.press('Tab');
  await expect(issueDescription).toBeFocused();
  await page.keyboard.type('Created with keyboard navigation.');
  await expect(issueDescription).toHaveValue('Created with keyboard navigation.');
  await pressTabUntilFocused(page, createIssueButton);
  await page.keyboard.press('Enter');

  const keyboardRow = page.getByRole('row', { name: /Keyboard issue.*Todo.*Medium/ });
  await expect(keyboardRow).toBeVisible();
  await expect(newIssueButton).toBeFocused();

  const selectKeyboardIssue = keyboardRow.getByRole('checkbox', { name: 'Select Keyboard issue' });
  await pressTabUntilFocused(page, selectKeyboardIssue, 80);
  await page.keyboard.press('Space');
  await expect(selectKeyboardIssue).toBeChecked();
  await page.keyboard.press('Space');
  await expect(selectKeyboardIssue).not.toBeChecked();

  const editIssueButton = page.getByRole('button', { name: 'Edit Keyboard issue' });
  await pressTabUntilFocused(page, editIssueButton);
  await page.keyboard.press('Enter');
  await expect(issueTitle).toBeFocused();

  const cancelIssueButton = issueForm.getByRole('button', { name: 'Cancel' });
  await pressTabUntilFocused(page, cancelIssueButton);
  await page.keyboard.press('Enter');
  await expect(editIssueButton).toBeFocused();

  const openIssueButton = page.getByRole('button', { name: 'Open Keyboard issue' });
  await pressShiftTabUntilFocused(page, openIssueButton);
  await page.keyboard.press('Enter');

  const detail = page.getByRole('region', { name: 'Keyboard issue' });
  const detailHeading = detail.getByRole('heading', { name: 'Keyboard issue' });
  await expect(detailHeading).toBeFocused();

  const commentForm = detail.getByRole('form', { name: 'Comment form' });
  const commentTextarea = commentForm.getByLabel('New comment');
  const addCommentButton = commentForm.getByRole('button', { name: 'Add Comment' });

  await expect(detail.getByText('No comments yet.')).toBeVisible();
  await expect(commentTextarea).toBeEnabled();
  await pressTabUntilFocused(page, commentTextarea);
  await page.keyboard.type('Keyboard comment one');
  await expect(commentTextarea).toHaveValue('Keyboard comment one');
  await pressTabUntilFocused(page, addCommentButton);
  await page.keyboard.press('Enter');

  const keyboardCommentsList = detail.getByLabel('Issue comments');
  const keyboardCommentItem = keyboardCommentsList.getByRole('listitem').filter({ hasText: 'Keyboard comment one' });

  await expect(keyboardCommentItem.getByText('Keyboard comment one')).toBeVisible();

  const editCommentButton = keyboardCommentItem.getByRole('button', { name: 'Edit comment' });
  await pressTabUntilFocused(page, editCommentButton);
  await page.keyboard.press('Enter');

  const editCommentForm = detail.getByRole('form', { name: 'Edit comment form' });
  const editCommentTextarea = editCommentForm.getByLabel('Comment');
  const saveCommentButton = editCommentForm.getByRole('button', { name: 'Save Comment' });

  await expect(editCommentTextarea).toBeFocused();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type('Keyboard comment edited');
  await expect(editCommentTextarea).toHaveValue('Keyboard comment edited');
  await pressTabUntilFocused(page, saveCommentButton);
  await page.keyboard.press('Enter');

  const editedKeyboardCommentItem = keyboardCommentsList
    .getByRole('listitem')
    .filter({ hasText: 'Keyboard comment edited' });

  await expect(editedKeyboardCommentItem.getByText('Keyboard comment edited')).toBeVisible();
  await expect(editedKeyboardCommentItem.getByRole('button', { name: 'Edit comment' })).toBeFocused();

  const closeDetailButton = detail.getByRole('button', {
    name: 'Close issue detail for Keyboard issue'
  });
  await pressShiftTabUntilFocused(page, closeDetailButton);
  await page.keyboard.press('Enter');

  await expect(detail).toHaveCount(0);
  await expect(openIssueButton).toBeFocused();
});

test('shareable issue detail URLs support direct load refresh and history', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Shareable URL issue',
    description: 'Opened directly from a path.'
  });

  await page.goto(`/issues/${issue.id}`);

  const detail = page.getByRole('region', { name: issue.title });
  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Opened directly from a path.');
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.id}$`));

  await page.reload();
  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.id}$`));

  await detail.getByRole('button', { name: `Close issue detail for ${issue.title}` }).click();
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL('/');

  await page.goBack();
  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.id}$`));

  await page.goForward();
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('copies stable issue links from list and detail actions', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Stable link copy issue',
    description: 'Copied from filtered and detail contexts.',
    status: 'review'
  });

  await page.goto('/?search=Stable%20link%20copy&status=review');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin
  });

  const expectedStableLink = new URL(`/issues/${issue.id}`, page.url()).toString();
  const row = page.getByRole('row', { name: /Stable link copy issue.*Review/ });

  await expect(row).toBeVisible();

  const filteredListUrl = page.url();
  const listCopyButton = row.getByRole('button', { name: `Copy link for ${issue.title}` });

  await listCopyButton.click();
  await expect(listCopyButton).toBeFocused();
  await expect(page.locator('.link-copy-feedback')).toHaveText(`Copied link for "${issue.title}".`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedStableLink);
  expect(page.url()).toBe(filteredListUrl);

  await row.getByRole('button', { name: `Open ${issue.title}` }).click();

  const detail = page.getByRole('region', { name: issue.title });

  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();

  const detailRoute = new URL(page.url());

  expect(detailRoute.pathname).toBe(`/issues/${issue.id}`);
  expect(detailRoute.searchParams.get('search')).toBe('Stable link copy');
  expect(detailRoute.searchParams.get('status')).toBe('review');

  const detailUrl = page.url();
  const detailCopyButton = detail.getByRole('button', { name: `Copy issue link for ${issue.title}` });

  await detailCopyButton.click();
  await expect(detailCopyButton).toBeFocused();
  await expect(detail.locator('.link-copy-feedback')).toHaveText(`Copied link for "${issue.title}".`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedStableLink);
  expect(page.url()).toBe(detailUrl);
});

test('issue detail URLs deep-link directly to comment entries', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Comment deep link issue',
    description: 'Target for comment anchor links.'
  });
  const commentResponse = await page.request.post(`/api/issues/${issue.id}/comments`, {
    data: {
      body: 'Deep link comment body'
    }
  });

  expect(commentResponse.ok()).toBe(true);

  const comment = (await commentResponse.json()) as { id: string; body: string };

  await page.goto(`/issues/${issue.id}#comment-${comment.id}`);

  const detail = page.getByRole('region', { name: issue.title });
  const commentItem = detail.locator(`#comment-${comment.id}`);

  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(commentItem).toBeVisible();
  await expect(commentItem).toContainText('Deep link comment body');
  await expect(commentItem).toBeFocused();
  await expect(page).toHaveURL(`/issues/${issue.id}#comment-${comment.id}`);
});

test('direct issue detail URLs hydrate before the full issue list finishes loading', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'List-independent detail issue',
    description: 'Loaded through the direct issue endpoint.'
  });
  let releaseIssueList: () => void = () => undefined;
  const issueListDelay = new Promise<void>((resolve) => {
    releaseIssueList = resolve;
  });

  await page.route('**/api/issues**', async (route) => {
    const url = new URL(route.request().url());

    if (route.request().method() === 'GET' && url.pathname === '/api/issues') {
      await issueListDelay;
    }

    await route.continue();
  });

  await page.goto(`/issues/${issue.id}`);

  const detail = page.getByRole('region', { name: issue.title });
  await expect(detail.getByRole('heading', { name: issue.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Loaded through the direct issue endpoint.');
  await expect(page.getByText('Loading issues...')).toBeVisible();

  releaseIssueList();
  await expect(page.getByRole('row', { name: /List-independent detail issue.*Todo.*Medium/ })).toBeVisible();
});

test('dashboard issue open updates the URL and unknown issue links can return to list', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Dashboard URL issue',
    description: 'Opened from the issue list.'
  });

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${issue.title}` }).click();
  await expect(page.getByRole('region', { name: issue.title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/issues/${issue.id}$`));

  await page.goto('/issues/not-found');
  const missingIssue = page.getByRole('region', { name: 'Issue not found' });
  await expect(missingIssue.getByRole('heading', { name: 'Issue not found' })).toBeVisible();
  await expect(missingIssue).toContainText('No issue matches this link.');
  await expect(page.getByRole('row', { name: /Dashboard URL issue.*Todo.*Medium/ })).toBeVisible();

  await missingIssue.getByRole('button', { name: 'Back to issue list' }).click();
  await expect(missingIssue).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('switching issue detail clears issue-specific comment drafts', async ({ page }) => {
  const firstIssue = await createIssueThroughApi(page, {
    title: 'Draft source issue',
    description: 'Receives an abandoned draft.'
  });
  const secondIssue = await createIssueThroughApi(page, {
    title: 'Draft target issue',
    description: 'Must not inherit another issue draft.'
  });

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${firstIssue.title}` }).click();

  const firstDetail = page.getByRole('region', { name: firstIssue.title });
  await expect(firstDetail.getByRole('heading', { name: firstIssue.title })).toBeVisible();

  const firstCommentForm = firstDetail.getByRole('form', { name: 'Comment form' });
  await firstCommentForm.getByLabel('New comment').fill('Draft meant for the first issue');
  await expect(firstCommentForm.getByLabel('New comment')).toHaveValue('Draft meant for the first issue');

  await page.getByRole('button', { name: `Open ${secondIssue.title}` }).click();

  const secondDetail = page.getByRole('region', { name: secondIssue.title });
  await expect(secondDetail.getByRole('heading', { name: secondIssue.title })).toBeVisible();

  const secondCommentForm = secondDetail.getByRole('form', { name: 'Comment form' });
  await expect(secondCommentForm.getByLabel('New comment')).toHaveValue('');

  await secondCommentForm.getByLabel('New comment').fill('Comment for the second issue');
  await secondCommentForm.getByRole('button', { name: 'Add Comment' }).click();
  await expect(secondDetail.getByLabel('Issue comments').getByText('Comment for the second issue')).toBeVisible();

  const [firstCommentsResponse, secondCommentsResponse] = await Promise.all([
    page.request.get(`/api/issues/${firstIssue.id}/comments`),
    page.request.get(`/api/issues/${secondIssue.id}/comments`)
  ]);

  expect(firstCommentsResponse.ok()).toBe(true);
  expect(secondCommentsResponse.ok()).toBe(true);

  const firstComments = (await firstCommentsResponse.json()) as Array<{ body: string }>;
  const secondComments = (await secondCommentsResponse.json()) as Array<{ body: string }>;

  expect(firstComments.map((comment) => comment.body)).not.toContain('Draft meant for the first issue');
  expect(secondComments.map((comment) => comment.body)).toEqual(['Comment for the second issue']);
});

test('dashboard filters hydrate from URL and compose with issue detail routes', async ({ page }) => {
  const targetIssue = await createIssueThroughApi(page, {
    title: 'URL filter target',
    description: 'Restored from a copied dashboard URL.',
    status: 'review',
    priority: 'high',
    labels: ['api']
  });
  await createIssueThroughApi(page, {
    title: 'URL filter label mismatch',
    description: 'Matches the other URL filters but not the label.',
    status: 'review',
    priority: 'high',
    labels: ['docs']
  });
  await createIssueThroughApi(page, {
    title: 'URL filter other',
    description: 'Should be hidden by composed filters.',
    status: 'todo',
    priority: 'low',
    labels: ['api']
  });

  await page.goto('/?search=URL%20filter&status=review&priority=high&label=api');

  const filters = page.getByLabel('Issue filters');
  await expect(filters.getByLabel('Search')).toHaveValue('URL filter');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('api');
  await expect(page.getByLabel('Active filters')).toContainText('Search: URL filter');
  await expect(page.getByLabel('Active filters')).toContainText('Status: Review');
  await expect(page.getByLabel('Active filters')).toContainText('Priority: High');
  await expect(page.getByLabel('Active filters')).toContainText('Label: api');
  await expect(page.getByLabel('Active filter count')).toHaveText('4 active filters');
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter label mismatch.*Review.*High/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toHaveCount(0);

  await filters.getByLabel('Search').fill('URL filter');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('URL filter');
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter label mismatch.*Review.*High/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toHaveCount(0);

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('URL filter');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('api');

  const editTargetButton = page.getByRole('button', { name: `Edit ${targetIssue.title}` });
  await editTargetButton.click();
  const issueForm = page.getByRole('form', { name: 'Issue form' });
  await expect(issueForm.getByLabel('Title')).toBeFocused();
  await issueForm.getByLabel('Title').fill('URL filter draft should cancel');
  await issueForm.getByRole('button', { name: 'Cancel' }).click();
  await expect(issueForm).toHaveCount(0);
  await expect(editTargetButton).toBeFocused();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByText('URL filter draft should cancel')).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('URL filter');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('api');
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('URL filter');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('api');

  await page.goBack();
  await expect(page.getByRole('region', { name: targetIssue.title })).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('URL filter');
  await expect(filters.getByLabel('Label')).toHaveValue('api');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('api');

  await page.goForward();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);

  await page
    .getByRole('region', { name: targetIssue.title })
    .getByRole('button', { name: `Close issue detail for ${targetIssue.title}` })
    .click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('URL filter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('api');

  await filters.getByLabel('Label').fill('');
  await expect(filters.getByLabel('Label')).toHaveValue('');
  await expect(page.getByLabel('Active filters')).not.toContainText('Label: api');
  await expect(page.getByLabel('Active filter count')).toHaveText('3 active filters');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBeNull();
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter label mismatch.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter label mismatch.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toBeVisible();
  await expect(page).toHaveURL('/');

  await page.goto('/?search=%20%20&status=bogus&priority=weird&label=%20%20');
  await expect(filters.getByLabel('Search')).toHaveValue('');
  await expect(filters.getByLabel('Status')).toHaveValue('all');
  await expect(filters.getByLabel('Priority')).toHaveValue('all');
  await expect(filters.getByLabel('Label')).toHaveValue('');
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('rapid dashboard filter changes keep URL controls and detail routes consistent', async ({ page }) => {
  const targetIssue = await createIssueThroughApi(page, {
    title: 'Rapid filter target',
    description: 'Receives rapid composed dashboard filters.',
    status: 'review',
    priority: 'high',
    labels: ['api']
  });
  await createIssueThroughApi(page, {
    title: 'Rapid filter review low',
    description: 'Matches only the rapid status filter.',
    status: 'review',
    priority: 'low',
    labels: ['api']
  });
  await createIssueThroughApi(page, {
    title: 'Rapid filter todo high',
    description: 'Matches only the rapid priority filter.',
    status: 'todo',
    priority: 'high',
    labels: ['api']
  });

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');

  await changeDashboardFiltersInSameTask(page, {
    status: 'review',
    priority: 'high',
    search: 'Rapid filter target'
  });

  await expect(filters.getByLabel('Search')).toHaveValue('Rapid filter target');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(page.getByLabel('Active filter count')).toHaveText('3 active filters');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Rapid filter target');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect(page.getByRole('row', { name: /Rapid filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rapid filter review low.*Review.*Low/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Rapid filter todo high.*Todo.*High/ })).toHaveCount(0);

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Rapid filter target');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect(filters.getByLabel('Search')).toHaveValue('');
  await expect(filters.getByLabel('Status')).toHaveValue('all');
  await expect(filters.getByLabel('Priority')).toHaveValue('all');
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Rapid filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rapid filter review low.*Review.*Low/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rapid filter todo high.*Todo.*High/ })).toBeVisible();
  await expect(page).toHaveURL(`/issues/${targetIssue.id}`);
});

test('rapid create edit search and filter changes preserve issue visibility', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New Issue' }).click();
  const issueForm = page.getByRole('form', { name: 'Issue form' });

  await issueForm.getByLabel('Title').fill('Rapid workflow draft');
  await issueForm.getByLabel('Description').fill('Created before a rapid filter pass.');
  await issueForm.getByLabel('Labels').fill('rapid, smoke');
  await issueForm.getByLabel('Status').selectOption('todo');
  await issueForm.getByLabel('Priority').selectOption('medium');
  await issueForm.getByRole('button', { name: 'Create Issue' }).click();

  const draftRow = page.getByRole('row', { name: /Rapid workflow draft.*Todo.*Medium/ });

  await expect(draftRow).toBeVisible();

  await draftRow.getByRole('button', { name: 'Edit Rapid workflow draft' }).click();
  await issueForm.getByLabel('Title').fill('Rapid workflow final');
  await issueForm.getByLabel('Description').fill('Edited before filters settle.');
  await issueForm.getByLabel('Labels').fill('rapid, filtered');
  await issueForm.getByLabel('Status').selectOption('review');
  await issueForm.getByLabel('Priority').selectOption('high');
  await issueForm.getByRole('button', { name: 'Save Changes' }).click();

  const finalRow = page.getByRole('row', { name: /Rapid workflow final.*Review.*High/ });
  const filters = page.getByLabel('Issue filters');

  await expect(finalRow).toBeVisible();
  await expect(page.getByText('Rapid workflow draft')).toHaveCount(0);

  await changeDashboardFiltersInSameTask(page, {
    search: 'Rapid workflow final',
    status: 'review',
    priority: 'high',
    label: 'filtered'
  });

  await expect(filters.getByLabel('Search')).toHaveValue('Rapid workflow final');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('filtered');
  await expect(page.getByLabel('Active filter count')).toHaveText('4 active filters');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Rapid workflow final');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('filtered');
  await expect(finalRow).toBeVisible();

  await filters.getByLabel('Status').selectOption('todo');
  await expect(filters.getByLabel('Status')).toHaveValue('todo');
  await expect(page.getByLabel('Active filters')).toContainText('Status: Todo');
  await expect(page.getByLabel('Active filter count')).toHaveText('4 active filters');
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();
  await expect(finalRow).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('todo');

  await filters.getByLabel('Status').selectOption('review');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(page.getByLabel('Active filters')).toContainText('Status: Review');
  await expect(page.getByLabel('Active filter count')).toHaveText('4 active filters');
  await expect(finalRow).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
});

test('saved filter views persist restore and compose with detail routes', async ({ page }) => {
  const targetIssue = await createIssueThroughApi(page, {
    title: 'Saved view target',
    description: 'Archived issue restored by saved view.',
    status: 'review',
    priority: 'high',
    labels: ['archive']
  });
  await createIssueThroughApi(page, {
    title: 'Saved view active other',
    description: 'Should not match the saved filter.',
    status: 'todo',
    priority: 'low',
    labels: ['other']
  });
  const archiveResponse = await page.request.post(`/api/issues/${targetIssue.id}/archive`);

  expect(archiveResponse.ok()).toBe(true);

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  let settings = await expandDashboardSettings(page);
  let savedViews = settings.getByLabel('Saved filter views');

  await filters.getByLabel('Search').fill('Saved view target');
  await filters.getByLabel('Label').fill('archive');
  await filters.getByLabel('Status').selectOption('review');
  await filters.getByLabel('Priority').selectOption('high');
  await filters.getByLabel('Include archived').check();
  await settings.getByLabel('Page size').selectOption('50');
  await savedViews.getByLabel('View name').fill('  Review   archive   view  ');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view');
  await expect(savedViews.getByLabel('View name')).toHaveValue('Review archive view');
  const savedViewId = await savedViews.getByLabel('Saved views').inputValue();

  expect(savedViewId).not.toBe('');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Review archive view');
  await expect(page.getByLabel('Active filters')).toContainText('Label: archive');
  await expect(page.getByLabel('Active filters')).toContainText('Page size: 50');
  await expect(page.getByRole('row', { name: /Saved view target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view active other.*Todo.*Low/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('');
  await expect(filters.getByLabel('Label')).toHaveValue('');
  await expect(settings.getByLabel('Page size')).toHaveValue('25');
  await expect(page).toHaveURL('/');

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(settings.getByLabel('Page size')).toHaveValue('50');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Review archive view');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await page.reload();
  settings = await expandDashboardSettings(page);
  savedViews = settings.getByLabel('Saved filter views');
  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view');
  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Review archive view');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);

  await filters.getByLabel('Search').fill('Saved view active other');
  await filters.getByLabel('Label').fill('other');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Review archive view (edited)');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBeNull();

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByLabel('Active filter count')).toHaveCount(0);
  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);
  await expect(page).toHaveURL('/');

  await page.goto(`/?savedView=${encodeURIComponent(savedViewId)}&search=stale-local&label=other&limit=10`);
  settings = await expandDashboardSettings(page);
  savedViews = settings.getByLabel('Saved filter views');
  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(settings.getByLabel('Page size')).toHaveValue('50');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Review archive view');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBe('true');

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Review archive view' });
  await savedViews.getByRole('button', { name: 'Duplicate' }).click();
  const duplicatedSavedViewList = await page.request.get('/api/filter-views');
  const duplicatedSavedViewListBody = (await duplicatedSavedViewList.json()) as Array<{ id: string; name: string }>;
  const duplicatedSavedView = duplicatedSavedViewListBody.find((view) => view.name === 'Review archive view (copy)');

  expect(duplicatedSavedViewList.ok()).toBe(true);
  expect(duplicatedSavedView).toBeDefined();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view (copy)');
  await expect(savedViews.getByLabel('Saved views')).toHaveValue(duplicatedSavedView!.id);
  await expect(savedViews.getByLabel('View name')).toHaveValue('Review archive view (copy)');
  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');
  await expect(settings.getByLabel('Page size')).toHaveValue('50');

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Review archive view' });
  await savedViews.getByLabel('View name').fill('  Renamed   archive   view  ');
  await savedViews.getByRole('button', { name: 'Rename' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Renamed archive view');
  await expect(savedViews.getByLabel('View name')).toHaveValue('Renamed archive view');

  await filters.getByLabel('Search').fill('Saved view active other');
  await filters.getByLabel('Label').fill('other');
  await filters.getByLabel('Status').selectOption('todo');
  await filters.getByLabel('Priority').selectOption('low');
  await filters.getByLabel('Include archived').uncheck();
  await settings.getByLabel('Page size').selectOption('10');
  await expect(page.getByRole('row', { name: /Saved view active other.*Todo.*Low/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view target.*Review.*High/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view active other');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('other');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('10');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBeNull();
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Review archive view (copy) (edited)');

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(settings.getByLabel('Page size')).toHaveValue('50');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Renamed archive view');
  await expect(page.getByRole('row', { name: /Saved view target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view active other.*Todo.*Low/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await filters.getByLabel('Search').fill('no matching saved view row');
  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();

  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBeNull();
  await savedViews.getByLabel('Saved views').selectOption({ label: 'Review archive view (copy)' });
  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await expect(savedViews.getByRole('option', { name: 'Renamed archive view' })).toHaveCount(0);
  await expect(savedViews.getByRole('option', { name: 'Review archive view (copy)' })).toHaveCount(0);
  await expect(savedViews.getByLabel('Saved views')).toHaveValue('');
  await expect(savedViews.getByLabel('View name')).toHaveValue('');
  await expect(savedViews.getByRole('button', { name: 'Apply View' })).toBeDisabled();
  await expect(savedViews.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await expect(savedViews.getByRole('button', { name: 'Delete' })).toBeDisabled();

  const savedViewList = await page.request.get('/api/filter-views');
  const savedViewListBody = (await savedViewList.json()) as unknown[];

  expect(savedViewList.ok()).toBe(true);
  expect(savedViewListBody).toEqual([]);
});

test('toggling archived visibility preserves the current filter context and saved-view restore behavior', async ({
  page
}) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Archived toggle blocker',
    description: 'Blocks archived-toggle regression targets.'
  });
  const activeTarget = await createIssueThroughApi(page, {
    title: 'Archived toggle active target',
    description: 'Visible when active-only blocked filters are applied.',
    status: 'review',
    priority: 'high',
    labels: ['ops']
  });
  const archivedTarget = await createIssueThroughApi(page, {
    title: 'Archived toggle archived target',
    description: 'Visible only when archived matches are included.',
    status: 'review',
    priority: 'high',
    labels: ['ops']
  });
  await createIssueThroughApi(page, {
    title: 'Archived toggle mismatch row',
    description: 'Should stay hidden by the composed filters.',
    status: 'review',
    priority: 'low',
    labels: ['ops']
  });

  for (const issueId of [activeTarget.id, archivedTarget.id]) {
    const dependencyResponse = await page.request.post(`/api/issues/${issueId}/dependencies`, {
      data: { dependsOnIssueId: blocker.id }
    });

    expect(dependencyResponse.ok()).toBe(true);
  }

  const archiveResponse = await page.request.post(`/api/issues/${archivedTarget.id}/archive`);
  expect(archiveResponse.ok()).toBe(true);

  await page.goto('/?search=Archived%20toggle&status=review&priority=high&label=ops&blockedOnly=true');

  const filters = page.getByLabel('Issue filters');
  const includeArchived = filters.getByLabel('Include archived');
  const blockedOnly = filters.getByLabel('Blocked only');
  const activeFilters = page.getByLabel('Active filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');
  const activeRow = page.getByRole('row', { name: /Archived toggle active target.*Review.*High/ });
  const archivedRow = page.getByRole('row', { name: /Archived toggle archived target.*Review.*High/ });
  const mismatchRow = page.getByRole('row', { name: /Archived toggle mismatch row.*Review.*Low/ });

  await expect(filters.getByLabel('Search')).toHaveValue('Archived toggle');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('ops');
  await expect(blockedOnly).toBeChecked();
  await expect(includeArchived).not.toBeChecked();
  await expect(activeFilters).toContainText('Search: Archived toggle');
  await expect(activeFilters).toContainText('Status: Review');
  await expect(activeFilters).toContainText('Priority: High');
  await expect(activeFilters).toContainText('Label: ops');
  await expect(activeFilters).toContainText('Blocked: Only');
  await expect(page.getByLabel('Active filter count')).toHaveText('5 active filters');
  await expect(activeRow).toBeVisible();
  await expect(archivedRow).toHaveCount(0);
  await expect(mismatchRow).toHaveCount(0);

  await savedViews.getByLabel('View name').fill('Blocked review ops');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Blocked review ops');
  const savedViewId = await savedViews.getByLabel('Saved views').inputValue();

  expect(savedViewId).not.toBe('');
  await expect(activeFilters).toContainText('Saved view: Blocked review ops');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);

  await includeArchived.check();

  await expect(filters.getByLabel('Search')).toHaveValue('Archived toggle');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('ops');
  await expect(blockedOnly).toBeChecked();
  await expect(includeArchived).toBeChecked();
  await expect(activeFilters).toContainText('Saved view: Blocked review ops (edited)');
  await expect(activeFilters).toContainText('Archived: Included');
  await expect(page.getByLabel('Active filter count')).toHaveText('7 active filters');
  await expect(activeRow).toBeVisible();
  await expect(archivedRow).toBeVisible();
  await expect(archivedRow.locator('.archived-pill')).toHaveText('Archived');
  await expect(mismatchRow).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Archived toggle');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('ops');
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBeNull();

  await includeArchived.uncheck();

  await expect(filters.getByLabel('Search')).toHaveValue('Archived toggle');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('ops');
  await expect(blockedOnly).toBeChecked();
  await expect(includeArchived).not.toBeChecked();
  await expect(activeFilters).not.toContainText('Saved view: Blocked review ops');
  await expect(activeFilters).not.toContainText('Archived: Included');
  await expect(page.getByLabel('Active filter count')).toHaveText('5 active filters');
  await expect(activeRow).toBeVisible();
  await expect(archivedRow).toHaveCount(0);
  await expect(mismatchRow).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBeNull();

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(page).toHaveURL('/');

  await savedViews.getByRole('button', { name: 'Apply View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);
  await expect(filters.getByLabel('Search')).toHaveValue('Archived toggle');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('ops');
  await expect(blockedOnly).toBeChecked();
  await expect(includeArchived).not.toBeChecked();
  await expect(activeFilters).toContainText('Saved view: Blocked review ops');
  await expect(activeFilters).not.toContainText('Archived: Included');
  await expect(activeRow).toBeVisible();
  await expect(archivedRow).toHaveCount(0);
  await expect(mismatchRow).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Archived toggle');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('ops');
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBeNull();
});

test('saved view route restore keeps active filter chips aligned with restored filters', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Saved chip restore target',
    description: 'Target issue restored by a saved view route.',
    status: 'review',
    priority: 'high',
    labels: ['chip-restore']
  });

  const savedViewResponse = await page.request.post('/api/filter-views', {
    data: {
      name: 'Chip restore view',
      search: 'Saved chip restore target',
      status: 'review',
      priority: 'high',
      label: 'chip-restore',
      includeArchived: true,
      blockedOnly: false,
      staleOnly: false,
      pageSize: 50
    }
  });

  expect(savedViewResponse.ok()).toBe(true);

  const savedView = (await savedViewResponse.json()) as { id: string };
  let resolveSavedViewDetailIntercepted = () => {};
  let releaseSavedViewDetail: (() => void) | null = null;
  const savedViewDetailIntercepted = new Promise<void>((resolve) => {
    resolveSavedViewDetailIntercepted = resolve;
  });
  const savedViewDetailRelease = new Promise<void>((resolve) => {
    releaseSavedViewDetail = resolve;
  });

  await page.route(`**/api/filter-views/${savedView.id}`, async (route) => {
    if (route.request().method() === 'GET') {
      resolveSavedViewDetailIntercepted();
      await savedViewDetailRelease;
    }

    await route.continue();
  });

  await page.goto(
    `/?savedView=${encodeURIComponent(savedView.id)}&search=stale-route-filter&status=todo&priority=low&label=stale-label&limit=10`
  );

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');
  const activeFilters = page.getByLabel('Active filters');

  await savedViewDetailIntercepted;
  await expect(savedViews.getByLabel('Saved views')).toContainText('Chip restore view');
  await expect(filters.getByLabel('Search')).toHaveValue('stale-route-filter');
  await expect(filters.getByLabel('Status')).toHaveValue('todo');
  await expect(settings.getByLabel('Page size')).toHaveValue('10');
  await expect(activeFilters).toContainText('Search: stale-route-filter');
  await expect(activeFilters).toContainText('Label: stale-label');
  await expect(activeFilters).not.toContainText('Saved view: Chip restore view');

  if (!releaseSavedViewDetail) {
    throw new Error('Expected saved view detail request to be intercepted.');
  }

  releaseSavedViewDetail();

  await expect(filters.getByLabel('Search')).toHaveValue('Saved chip restore target');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('chip-restore');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(settings.getByLabel('Page size')).toHaveValue('50');
  await expect(activeFilters).toContainText('Saved view: Chip restore view');
  await expect(activeFilters).toContainText('Search: Saved chip restore target');
  await expect(activeFilters).toContainText('Status: Review');
  await expect(activeFilters).toContainText('Priority: High');
  await expect(activeFilters).toContainText('Label: chip-restore');
  await expect(activeFilters).toContainText('Archived: Included');
  await expect(activeFilters).toContainText('Page size: 50');
  await expect(activeFilters).not.toContainText('stale-route-filter');
  await expect(activeFilters).not.toContainText('stale-label');

  await page.getByRole('button', { name: 'Clear board filters' }).click();

  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByLabel('Active filter count')).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('clearing a default saved view removes the active filter summary', async ({ page }) => {
  await page.goto('/');

  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');

  await savedViews.getByLabel('View name').fill('Default clear summary view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toContainText('Default clear summary view');
  const savedViewId = await savedViews.getByLabel('Saved views').inputValue();

  expect(savedViewId).not.toBe('');
  await expect(page.getByLabel('Active filters')).toContainText('Saved view: Default clear summary view');
  await expect(page.getByLabel('Active filter count')).toHaveText('1 active filter');

  await page.getByRole('button', { name: 'Clear board filters' }).click();

  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByLabel('Active filter count')).toHaveCount(0);
  await expect(page).toHaveURL('/');
  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);

  const cleanupSavedViewResponse = await page.request.delete(`/api/filter-views/${savedViewId}`);

  expect(cleanupSavedViewResponse.ok()).toBe(true);
});

test('missing saved filter view URLs fall back to explicit filters', async ({ page }) => {
  await page.goto(
    '/?savedView=missing-e2e-view&search=Fallback%20view&status=review&includeArchived=true&blockedOnly=true'
  );

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');

  await expect(savedViews.getByText('Saved view not found. Showing filters from the URL instead.')).toBeVisible();
  await expect(filters.getByLabel('Search')).toHaveValue('Fallback view');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
});

test('applying an active-only saved view preserves an archived detail selection', async ({ page }) => {
  const archivedTarget = await createIssueThroughApi(page, {
    title: 'Saved view archived detail target',
    description: 'Opened from an archived-including saved view.',
    status: 'review',
    priority: 'high',
    labels: ['archived-view']
  });
  await createIssueThroughApi(page, {
    title: 'Saved view active detail row',
    description: 'Visible in the active-only saved view.',
    status: 'todo',
    priority: 'medium',
    labels: ['active-view']
  });

  const archiveResponse = await page.request.post(`/api/issues/${archivedTarget.id}/archive`);
  expect(archiveResponse.ok()).toBe(true);

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');

  await filters.getByLabel('Search').fill('Saved view archived detail');
  await filters.getByLabel('Label').fill('archived-view');
  await filters.getByLabel('Status').selectOption('review');
  await filters.getByLabel('Priority').selectOption('high');
  await filters.getByLabel('Include archived').check();
  await savedViews.getByLabel('View name').fill('Archived detail view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await filters.getByLabel('Search').fill('Saved view active detail');
  await filters.getByLabel('Label').fill('active-view');
  await filters.getByLabel('Status').selectOption('todo');
  await filters.getByLabel('Priority').selectOption('medium');
  await savedViews.getByLabel('View name').fill('Active detail view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Archived detail view' });
  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(page.getByRole('row', { name: /Saved view archived detail target.*Review.*High/ })).toBeVisible();
  await page.getByRole('button', { name: `Open ${archivedTarget.title}` }).click();
  await expect(page.getByRole('region', { name: archivedTarget.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${archivedTarget.id}`);
  await expect(filters.getByLabel('Include archived')).toBeChecked();

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Active detail view' });
  await savedViews.getByRole('button', { name: 'Apply View' }).click();

  await expect(page.getByRole('region', { name: archivedTarget.title })).toBeVisible();
  await expect(page.getByText('Hidden from the active dashboard since')).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view active detail row.*Todo.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view archived detail target.*Review.*High/ })).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view active detail');
  await expect(filters.getByLabel('Label')).toHaveValue('active-view');
  await expect(filters.getByLabel('Status')).toHaveValue('todo');
  await expect(filters.getByLabel('Priority')).toHaveValue('medium');
  await expect(filters.getByLabel('Include archived')).not.toBeChecked();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${archivedTarget.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view active detail');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('active-view');
  await expect.poll(() => new URL(page.url()).searchParams.get('includeArchived')).toBeNull();
});

test('applying a saved view preserves detail selection when the issue no longer matches the view filters', async ({
  page
}) => {
  const detailTarget = await createIssueThroughApi(page, {
    title: 'Saved view mismatch detail target',
    description: 'Should stay selected when a different saved view is applied.',
    status: 'review',
    priority: 'high',
    labels: ['detail-target']
  });
  await createIssueThroughApi(page, {
    title: 'Saved view matching row',
    description: 'Should remain visible after saved view apply.',
    status: 'todo',
    priority: 'medium',
    labels: ['saved-view-match']
  });

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');

  await filters.getByLabel('Search').fill('Saved view matching row');
  await filters.getByLabel('Label').fill('saved-view-match');
  await filters.getByLabel('Status').selectOption('todo');
  await filters.getByLabel('Priority').selectOption('medium');
  await savedViews.getByLabel('View name').fill('Mismatched detail preserving view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await page.getByRole('button', { name: `Open ${detailTarget.title}` }).click();
  await expect(page.getByRole('region', { name: detailTarget.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${detailTarget.id}`);

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Mismatched detail preserving view' });
  await savedViews.getByRole('button', { name: 'Apply View' }).click();

  await expect(page.getByRole('region', { name: detailTarget.title })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view matching row.*Todo.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view mismatch detail target.*Review.*High/ })).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view matching row');
  await expect(filters.getByLabel('Label')).toHaveValue('saved-view-match');
  await expect(filters.getByLabel('Status')).toHaveValue('todo');
  await expect(filters.getByLabel('Priority')).toHaveValue('medium');
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${detailTarget.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view matching row');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('saved-view-match');
});

test('saved filter view apply resets stale pagination and preserves page size', async ({ page }) => {
  const fillerIssues = Array.from({ length: 14 }, (_, index) =>
    createIssueThroughApi(page, {
      title: `Saved page filler ${String(index + 1).padStart(2, '0')}`,
      description: 'Broad saved-view pagination reset filler.',
      status: 'todo',
      priority: 'low',
      labels: ['bulk']
    })
  );
  const targetIssue = await createIssueThroughApi(page, {
    title: 'Saved page target',
    description: 'Single row restored by saved view from a later page.',
    status: 'review',
    priority: 'high',
    labels: ['target']
  });

  await Promise.all(fillerIssues);
  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');
  const pagination = page.getByLabel('Issue pagination');

  await settings.getByLabel('Page size').selectOption('10');
  await filters.getByLabel('Search').fill(targetIssue.title);
  await filters.getByLabel('Label').fill('target');
  await savedViews.getByLabel('View name').fill('Target pagination view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toContainText('Target pagination view');
  await expect(page.getByRole('row', { name: /Saved page target.*Review.*High/ })).toBeVisible();

  await filters.getByLabel('Search').fill('Saved page');
  await filters.getByLabel('Label').fill('');
  await expect(page.getByText('Showing 1-10 of 15 matches')).toBeVisible();
  await expect(pagination).toContainText('Page 1 of 2');

  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.getByText('Showing 11-15 of 15 matches')).toBeVisible();

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Target pagination view' });
  await savedViews.getByRole('button', { name: 'Apply View' }).click();

  await expect(filters.getByLabel('Search')).toHaveValue(targetIssue.title);
  await expect(filters.getByLabel('Label')).toHaveValue('target');
  await expect(settings.getByLabel('Page size')).toHaveValue('10');
  await expect(pagination).toContainText('Page 1 of 1');
  await expect(page.getByText('No issues on this page.')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Saved page target.*Review.*High/ })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(targetIssue.title);
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('target');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('10');
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
});

test('blocked-only filter resets later pagination and keeps the canonical route', async ({ page }) => {
  const fillerIssues = Array.from({ length: 14 }, (_, index) =>
    createIssueThroughApi(page, {
      title: `Blocked pagination filler ${String(index + 1).padStart(2, '0')}`,
      description: 'Broad result set used to reach a later page before narrowing.',
      status: 'todo',
      priority: 'low',
      labels: ['blocked-pagination']
    })
  );
  const blocker = await createIssueThroughApi(page, {
    title: 'Blocked pagination blocker',
    description: 'Active dependency that keeps one issue blocked.',
    status: 'todo',
    priority: 'medium',
    labels: ['blocked-pagination']
  });
  const blockedIssue = await createIssueThroughApi(page, {
    title: 'Blocked pagination target',
    description: 'Should remain after blocked-only narrows the list.',
    status: 'in_progress',
    priority: 'high',
    labels: ['blocked-pagination', 'focus-target']
  });

  await Promise.all(fillerIssues);
  expect(
    (
      await page.request.post(`/api/issues/${blockedIssue.id}/dependencies`, {
        data: { dependsOnIssueId: blocker.id }
      })
    ).ok()
  ).toBe(true);

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const pagination = page.getByLabel('Issue pagination');

  await settings.getByLabel('Page size').selectOption('10');
  await filters.getByLabel('Search').fill('Blocked pagination');
  await expect(pagination).toContainText('Page 1 of 2');
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.getByText('Showing 11-16 of 16 matches')).toBeVisible();

  await filters.getByLabel('Blocked only').check();

  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect(pagination).toContainText('Page 1 of 1');
  await expect(page.getByText('No issues on this page.')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Blocked pagination target.*In Progress.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Blocked pagination filler 14.*Todo.*Low/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Blocked pagination');
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('10');
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
});

test('stale-only filter resets later pagination and keeps the canonical route', async ({ page }) => {
  const issues = Array.from({ length: 14 }, (_, index) => {
    const paddedIndex = String(index + 1).padStart(2, '0');

    return {
      id: `00000000-0000-4000-8100-${String(index + 1).padStart(12, '0')}`,
      title: `Stale pagination filler ${paddedIndex}`,
      description: 'Fresh result set used to reach a later page before narrowing.',
      status: 'todo',
      priority: 'low',
      labels: ['stale-pagination'],
      dueDate: null,
      isOverdue: false,
      isBlocked: false,
      dependsOnIssueIds: [],
      archivedAt: null,
      createdAt: `2026-06-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      updatedAt: `2026-06-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      comments: [],
      activityEvents: []
    };
  });

  issues.push({
    id: '00000000-0000-4000-8100-000000000099',
    title: 'Stale pagination target',
    description: 'Old enough to survive stale-only after the list narrows.',
    status: 'review',
    priority: 'high',
    labels: ['stale-pagination', 'focus-target'],
    dueDate: null,
    isOverdue: false,
    isBlocked: false,
    dependsOnIssueIds: [],
    archivedAt: null,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    comments: [],
    activityEvents: []
  });

  const importResponse = await page.request.post('/api/import/apply', {
    data: {
      exportVersion: 1,
      issues
    }
  });

  expect(importResponse.ok()).toBe(true);

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const pagination = page.getByLabel('Issue pagination');

  await settings.getByLabel('Page size').selectOption('10');
  await filters.getByLabel('Search').fill('Stale pagination');
  await expect(pagination).toContainText('Page 1 of 2');
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.getByText('Showing 11-15 of 15 matches')).toBeVisible();

  await filters.getByLabel('Stale only').check();

  await expect(filters.getByLabel('Stale only')).toBeChecked();
  await expect(pagination).toContainText('Page 1 of 1');
  await expect(page.getByText('No issues on this page.')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Stale pagination target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Stale pagination filler 14.*Todo.*Low/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Stale pagination');
  await expect.poll(() => new URL(page.url()).searchParams.get('staleOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('10');
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
});

test('saved filter view apply preserves the local view after transient fetch failures', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Saved view transient target',
    description: 'Saved view should survive a temporary fetch failure.',
    status: 'review',
    priority: 'high',
    labels: ['transient']
  });
  await createIssueThroughApi(page, {
    title: 'Saved view transient other',
    description: 'Should not match the saved view after retry.',
    status: 'todo',
    priority: 'low',
    labels: ['other']
  });

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');
  const savedViewSelect = savedViews.getByLabel('Saved views');

  await filters.getByLabel('Search').fill('Saved view transient target');
  await filters.getByLabel('Status').selectOption('review');
  await filters.getByLabel('Priority').selectOption('high');
  await filters.getByLabel('Label').fill('transient');
  await savedViews.getByLabel('View name').fill('Transient saved view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViewSelect).toContainText('Transient saved view');

  await page.getByRole('button', { name: 'Clear board filters' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('');

  let failedApply = false;

  await page.route('**/api/filter-views/*', async (route) => {
    if (route.request().method() === 'GET' && !failedApply) {
      failedApply = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary saved view outage' })
      });
      return;
    }

    await route.continue();
  });

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(savedViews.getByText('Temporary saved view outage')).toBeVisible();
  await expect(savedViewSelect).toContainText('Transient saved view');
  await expect(savedViewSelect).not.toHaveValue('');
  await expect(savedViews.getByRole('button', { name: 'Apply View' })).toBeEnabled();

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view transient target');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Label')).toHaveValue('transient');
  await expect(page.getByRole('row', { name: /Saved view transient target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view transient other.*Todo.*Low/ })).toHaveCount(0);
});

test('saved filter view controls stay locked during rename and delete requests', async ({ page }) => {
  await page.goto('/');

  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');
  const savedViewSelect = savedViews.getByLabel('Saved views');
  const savedViewName = savedViews.getByLabel('View name');

  await savedViewName.fill('Busy first view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViewSelect).toContainText('Busy first view');

  await savedViewName.fill('Busy second view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViewSelect).toContainText('Busy second view');

  let resolvePatchIntercepted = () => {};
  let resolveDeleteIntercepted = () => {};
  let releasePatch: (() => void) | null = null;
  let releaseDelete: (() => void) | null = null;
  const patchIntercepted = new Promise<void>((resolve) => {
    resolvePatchIntercepted = resolve;
  });
  const deleteIntercepted = new Promise<void>((resolve) => {
    resolveDeleteIntercepted = resolve;
  });

  await page.route('**/api/filter-views/*', async (route) => {
    const method = route.request().method();

    if (method === 'PATCH') {
      resolvePatchIntercepted();
      await new Promise<void>((resolve) => {
        releasePatch = resolve;
      });
    } else if (method === 'DELETE') {
      resolveDeleteIntercepted();
      await new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
    }

    await route.continue();
  });

  await savedViewSelect.selectOption({ label: 'Busy first view' });
  await savedViewName.fill('Busy renamed view');

  const renameResponse = page.waitForResponse((response) => {
    return response.request().method() === 'PATCH' && new URL(response.url()).pathname.startsWith('/api/filter-views/');
  });

  await savedViews.getByRole('button', { name: 'Rename' }).click();
  await patchIntercepted;
  await expect(savedViewSelect).toBeDisabled();
  await expect(savedViewName).toBeDisabled();

  if (!releasePatch) {
    throw new Error('Expected saved view rename request to be intercepted.');
  }

  releasePatch();
  await renameResponse;
  await expect(savedViewSelect).toBeEnabled();
  await expect(savedViewName).toBeEnabled();
  await expect(savedViewSelect).toContainText('Busy renamed view');
  await expect(savedViewSelect).not.toHaveValue('');

  const deleteResponse = page.waitForResponse((response) => {
    return (
      response.request().method() === 'DELETE' && new URL(response.url()).pathname.startsWith('/api/filter-views/')
    );
  });

  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await deleteIntercepted;
  await expect(savedViewSelect).toBeDisabled();
  await expect(savedViewName).toBeDisabled();

  if (!releaseDelete) {
    throw new Error('Expected saved view delete request to be intercepted.');
  }

  releaseDelete();
  await deleteResponse;
  await expect(savedViewSelect).toBeEnabled();
  await expect(savedViewName).toBeEnabled();
  await expect(savedViewSelect).toHaveValue('');
  await expect(savedViewName).toHaveValue('');
});

test('saved filter views recover from stale rename and delete selections', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Saved view stale recovery target',
    description: 'Used to keep manual query state visible during stale view recovery.',
    status: 'review',
    priority: 'high',
    labels: ['stale-view']
  });

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  let settings = await expandDashboardSettings(page);
  let savedViews = settings.getByLabel('Saved filter views');
  let savedViewSelect = savedViews.getByLabel('Saved views');

  await filters.getByLabel('Search').fill('Saved view stale recovery target');
  await filters.getByLabel('Status').selectOption('review');
  await savedViews.getByLabel('View name').fill('Stale rename view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViewSelect).toContainText('Stale rename view');

  const staleRenameViewId = await savedViewSelect.inputValue();

  await page.reload();
  settings = await expandDashboardSettings(page);
  savedViews = settings.getByLabel('Saved filter views');
  savedViewSelect = savedViews.getByLabel('Saved views');
  await savedViewSelect.selectOption({ label: 'Stale rename view' });
  await filters.getByLabel('Search').fill('manual query after reload');

  const staleRenameDelete = await page.request.delete(`/api/filter-views/${staleRenameViewId}`);

  expect(staleRenameDelete.ok()).toBe(true);

  await savedViews.getByLabel('View name').fill('Renamed stale view');
  await savedViews.getByRole('button', { name: 'Rename' }).click();
  await expect(savedViews.getByText('Saved view not found')).toBeVisible();
  await expect(savedViews.getByRole('option', { name: 'Stale rename view' })).toHaveCount(0);
  await expect(savedViewSelect).toHaveValue('');
  await expect(savedViews.getByLabel('View name')).toHaveValue('');
  await expect(filters.getByLabel('Search')).toHaveValue('manual query after reload');
  await expect(savedViews.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await expect(savedViews.getByRole('button', { name: 'Delete' })).toBeDisabled();

  await savedViews.getByLabel('View name').fill('Stale delete view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViewSelect).toContainText('Stale delete view');

  const staleDeleteViewId = await savedViewSelect.inputValue();
  const staleDelete = await page.request.delete(`/api/filter-views/${staleDeleteViewId}`);

  expect(staleDelete.ok()).toBe(true);

  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await expect(savedViews.getByText('Saved view not found')).toBeVisible();
  await expect(savedViews.getByRole('option', { name: 'Stale delete view' })).toHaveCount(0);
  await expect(savedViewSelect).toHaveValue('');
  await expect(savedViews.getByLabel('View name')).toHaveValue('');
  await expect(savedViews.getByRole('button', { name: 'Apply View' })).toBeDisabled();
});

test('blocked-only filter is shareable and restores from saved views', async ({ page }) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Blocked filter blocker',
    status: 'todo',
    description: 'Active blocker for filtering.'
  });
  const blockedIssue = await createIssueThroughApi(page, {
    title: 'Blocked filter issue',
    status: 'in_progress',
    description: 'Issue hidden when not blocked-only.'
  });
  await createIssueThroughApi(page, {
    title: 'Unblocked issue',
    status: 'todo',
    description: 'Should be excluded by blocked-only filter.'
  });
  const resolvedBlocker = await createIssueThroughApi(page, {
    title: 'Blocked filter resolved blocker',
    status: 'done',
    description: 'Resolved dependency should not block.'
  });
  const resolvedIssue = await createIssueThroughApi(page, {
    title: 'Blocked filter resolved issue',
    status: 'todo',
    description: 'Depends on resolved blocker.'
  });

  const blockedDependency = await page.request.post(`/api/issues/${blockedIssue.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });

  expect(blockedDependency.ok()).toBe(true);

  const resolvedDependency = await page.request.post(`/api/issues/${resolvedIssue.id}/dependencies`, {
    data: { dependsOnIssueId: resolvedBlocker.id }
  });

  expect(resolvedDependency.ok()).toBe(true);

  const filters = page.getByLabel('Issue filters');

  await page.goto('/');

  await filters.getByLabel('Blocked only').check();
  await expect(page.getByLabel('Active filters')).toContainText('Blocked: Only');
  await expect(page.getByRole('row', { name: /Blocked filter issue.*In Progress/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Unblocked issue.*Todo/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Blocked filter resolved issue/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');

  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');

  await savedViews.getByLabel('View name').fill('Blocked-only only review');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Blocked-only only review');

  await filters.getByLabel('Blocked only').uncheck();
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBeNull();
  await expect(page.getByRole('row', { name: /Unblocked issue.*Todo/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Blocked filter issue.*In Progress/ })).toBeVisible();

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(page.getByLabel('Active filters')).toContainText('Blocked: Only');
  await expect(filters.getByLabel('Blocked only')).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect(page.getByRole('row', { name: /Blocked filter issue.*In Progress/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Unblocked issue.*Todo/ })).toHaveCount(0);

  const viewsResponse = await page.request.get('/api/filter-views');
  const savedViewsPayload = (await viewsResponse.json()) as Array<{ id: string; name: string }>;

  expect(viewsResponse.ok()).toBe(true);
  const blockedOnlyView = savedViewsPayload.find((view) => view.name === 'Blocked-only only review');

  if (blockedOnlyView) {
    await page.request.delete(`/api/filter-views/${blockedOnlyView.id}`);
  }
});

test('saved view URL roundtrip preserves blocked-only filters across compact and comfortable density', async ({
  page
}) => {
  const blocker = await createIssueThroughApi(page, {
    title: 'Density saved-view blocker',
    status: 'todo',
    description: 'Blocks the saved-view target.'
  });
  const blockedIssue = await createIssueThroughApi(page, {
    title: 'Density saved-view issue',
    status: 'review',
    priority: 'high',
    description: 'Should remain visible when the blocked-only saved view is applied.'
  });
  await createIssueThroughApi(page, {
    title: 'Density saved-view mismatch',
    status: 'todo',
    description: 'Should stay hidden when blocked-only is restored.'
  });

  const dependencyResponse = await page.request.post(`/api/issues/${blockedIssue.id}/dependencies`, {
    data: { dependsOnIssueId: blocker.id }
  });

  expect(dependencyResponse.ok()).toBe(true);

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const blockedOnly = filters.getByLabel('Blocked only');
  const settings = await expandDashboardSettings(page);
  const savedViews = settings.getByLabel('Saved filter views');
  const densityControls = page.getByLabel('Dashboard density');
  const compactButton = densityControls.getByRole('button', { name: 'Compact' });
  const comfortableButton = densityControls.getByRole('button', { name: 'Comfortable' });

  await blockedOnly.check();
  await compactButton.click();

  await expect(blockedOnly).toBeChecked();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('density')).toBe('compact');

  await savedViews.getByLabel('View name').fill('Blocked density roundtrip');
  await savedViews.getByRole('button', { name: 'Save View' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Blocked density roundtrip');

  const savedViewId = await savedViews.getByLabel('Saved views').inputValue();

  expect(savedViewId).not.toBe('');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);

  await page.getByRole('button', { name: 'Clear board filters' }).click();

  await expect(blockedOnly).not.toBeChecked();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('density')).toBe('compact');

  await savedViews.getByRole('button', { name: 'Apply View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);
  await expect(blockedOnly).toBeChecked();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('row', { name: /Density saved-view issue.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Density saved-view mismatch.*Todo/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('density')).toBe('compact');

  await comfortableButton.click();

  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(blockedOnly).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('density')).toBeNull();

  await page.reload();

  await expect(savedViews.getByLabel('Saved views')).toHaveValue(savedViewId);
  await expect(blockedOnly).toBeChecked();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('row', { name: /Density saved-view issue.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Density saved-view mismatch.*Todo/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('savedView')).toBe(savedViewId);
  await expect.poll(() => new URL(page.url()).searchParams.get('blockedOnly')).toBe('true');
  await expect.poll(() => new URL(page.url()).searchParams.get('density')).toBeNull();
});

test('large issue lists remain filterable and can open detail', async ({ page }) => {
  test.setTimeout(60_000);

  const issues = await createLargeIssueSet(page, largeIssueCount);
  const targetIssue = issues[420];
  const listResponse = await page.request.get('/api/issues?search=Large%20issue&limit=25&page=1');
  const listBody = (await listResponse.json()) as IssueListResponse;
  const secondPageResponse = await page.request.get('/api/issues?search=Large%20issue&limit=25&page=2');
  const secondPageBody = (await secondPageResponse.json()) as IssueListResponse;
  const secondPageTarget = secondPageBody.items[0];
  const firstPageIds = new Set(listBody.items.map((issue) => issue.id));
  const secondPageIds = secondPageBody.items.map((issue) => issue.id);

  expect(listResponse.ok()).toBe(true);
  expect(secondPageResponse.ok()).toBe(true);
  expect(listBody.items).toHaveLength(25);
  expect(firstPageIds.size).toBe(25);
  expect(secondPageBody.items).toHaveLength(25);
  expect(secondPageIds.every((issueId) => !firstPageIds.has(issueId))).toBe(true);
  expect(listBody.pagination).toMatchObject({
    page: 1,
    limit: 25,
    total: largeIssueCount,
    totalPages: 20,
    hasMore: true,
    hasPrevious: false
  });
  expect(secondPageBody.pagination).toMatchObject({
    page: 2,
    limit: 25,
    total: largeIssueCount,
    totalPages: 20,
    hasMore: true,
    hasPrevious: true
  });

  await page.goto(`/issues/${targetIssue.id}`);
  const directDetail = page.getByRole('region', { name: targetIssue.title });
  await expect(directDetail.getByRole('heading', { name: targetIssue.title })).toBeVisible();
  await expect(directDetail.locator('.detail-description')).toHaveText('Large-list guardrail item 0420');
  await expect(page).toHaveURL(new RegExp(`/issues/${targetIssue.id}$`));

  const auditSummaryRequests: string[] = [];

  page.on('request', (request) => {
    const requestUrl = new URL(request.url());

    if (requestUrl.pathname === '/api/issues/audit-summary') {
      auditSummaryRequests.push(requestUrl.search);
    }
  });

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  await filters.getByLabel('Search').fill('Large issue');
  await expect(page.getByText(`Showing 1-25 of ${largeIssueCount} matches`)).toBeVisible();
  await expect(page.getByLabel('Active filters')).toContainText('25 shown');
  await expect(page.getByLabel('25 issues shown')).toBeVisible();

  const pagination = page.getByLabel('Issue pagination');
  const auditRequestsBeforePagination = auditSummaryRequests.length;

  await expect(pagination).toContainText('Page 1 of 20');
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 20');
  await expect(page.getByRole('row', { name: new RegExp(`${secondPageTarget.title}.*`) })).toBeVisible();
  expect(auditSummaryRequests).toHaveLength(auditRequestsBeforePagination);

  await page.getByRole('button', { name: `Open ${secondPageTarget.title}` }).click();
  const pagedDetail = page.getByRole('region', { name: secondPageTarget.title });

  await expect(pagedDetail.getByRole('heading', { name: secondPageTarget.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${secondPageTarget.id}`);
  await pagedDetail.getByRole('button', { name: `Close issue detail for ${secondPageTarget.title}` }).click();

  await filters.getByLabel('Search').fill(targetIssue.title);
  await expect(page.getByLabel('Active filters')).toContainText('1 shown');
  await expect(page.getByText('Showing 1-1 of 1 matches')).toBeVisible();

  const targetRow = page.getByRole('row', { name: /Large issue 0420.*Todo.*Low/ });
  await expect(targetRow).toBeVisible();

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  const detail = page.getByRole('region', { name: targetIssue.title });

  await expect(detail.getByRole('heading', { name: targetIssue.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Large-list guardrail item 0420');
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(targetIssue.title);
});
