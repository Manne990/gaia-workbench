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

const largeIssueStatuses = ['todo', 'in_progress', 'review', 'done'] as const;
const largeIssuePriorities = ['low', 'medium', 'high'] as const;
const largeIssueCount = 500;

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

async function createIssueThroughApi(
  page: Page,
  issue: { title: string; description?: string; status?: string; priority?: string }
): Promise<CreatedIssue> {
  const response = await page.request.post('/api/issues', { data: issue });

  expect(response.ok()).toBe(true);

  return (await response.json()) as CreatedIssue;
}

async function createLargeIssueSet(page: Page, count: number): Promise<CreatedIssue[]> {
  const issues: CreatedIssue[] = [];
  const batchSize = 25;

  for (let offset = 0; offset < count; offset += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - offset) }, async (_, batchIndex) => {
      const index = offset + batchIndex;
      const title = `Large issue ${String(index).padStart(4, '0')}`;
      const response = await page.request.post('/api/issues', {
        data: {
          title,
          description: `Large-list guardrail item ${String(index).padStart(4, '0')}`,
          status: largeIssueStatuses[index % largeIssueStatuses.length],
          priority: largeIssuePriorities[index % largeIssuePriorities.length],
          labels: ['bulk', `group-${index % 10}`],
          dueDate: index % 5 === 0 ? '2999-12-31' : null
        }
      });

      expect(response.ok()).toBe(true);

      return (await response.json()) as CreatedIssue;
    });

    issues.push(...(await Promise.all(batch)));
  }

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
  await filters.getByLabel('Search').fill('not in the tracker');
  await expect(page.getByLabel('Active filters')).toContainText('Search: not in the tracker');
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();
  await filters.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(updatedRow).toBeVisible();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);

  await filters.getByLabel('Search').fill('Edit issue');
  await filters.getByLabel('Status').selectOption('done');
  await filters.getByLabel('Priority').selectOption('low');
  await expect(page.getByLabel('Active filters')).toContainText('Search: Edit issue');
  await expect(page.getByLabel('Active filters')).toContainText('Status: Done');
  await expect(page.getByLabel('Active filters')).toContainText('Priority: Low');
  await expect(updatedRow).toBeVisible();

  await filters.getByLabel('Priority').selectOption('high');
  await expect(filters.getByLabel('Search')).toHaveValue('Edit issue');
  await expect(page.getByLabel('Active filters')).toContainText('Priority: High');
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();
  await filters.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(updatedRow).toBeVisible();

  await page.getByRole('button', { name: 'Open Edit issue from UI' }).click();
  const detail = page.getByRole('region', { name: 'Edit issue from UI' });

  await expect(detail.getByRole('heading', { name: 'Edit issue from UI' })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Updated through the dashboard form.');
  await expect(detail.getByLabel('Issue labels').getByText('docs')).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('api')).toBeVisible();
  await expect(detail.locator('.detail-overdue')).toHaveCount(0);
  const activity = detail.getByLabel('Issue activity');
  await expect(activity.getByText('Issue created')).toBeVisible();
  await expect(activity.getByText('Status changed')).toBeVisible();
  await expect(activity.getByText('Priority changed')).toBeVisible();
  await expect(detail.getByText('No comments yet.')).toBeVisible();

  const commentForm = page.getByRole('form', { name: 'Comment form' });

  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  await expect(commentForm.getByRole('alert')).toHaveText('Comment is required.');

  await commentForm.getByLabel('New comment').fill('Initial detail comment');
  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  const commentsList = page.getByLabel('Issue comments');
  const initialCommentItem = commentsList.getByRole('listitem').filter({ hasText: 'Initial detail comment' });

  await expect(initialCommentItem.getByText('Initial detail comment')).toBeVisible();
  await expect(activity.getByText('Comment added')).toBeVisible();

  await initialCommentItem.getByRole('button', { name: 'Edit comment' }).click();
  const editCommentForm = page.getByRole('form', { name: 'Edit comment form' });

  await editCommentForm.getByLabel('Comment').fill('Edited detail comment');
  await editCommentForm.getByRole('button', { name: 'Save Comment' }).click();

  await expect(page.getByLabel('Issue comments').getByText('Edited detail comment')).toBeVisible();
  await expect(activity.getByText('Comment edited')).toBeVisible();
  await expect(page.getByText('1 edit')).toBeVisible();
  await expect(page.getByText('Previous: Initial detail comment')).toBeVisible();

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
});

test('imports tracker JSON through preview and apply', async ({ page }, testInfo) => {
  await page.goto('/');

  const importPayload = {
    exportVersion: 1,
    issues: [
      {
        id: 'e2e-import-issue',
        title: 'Imported issue from JSON',
        description: 'Created through the JSON import flow.',
        status: 'review',
        priority: 'high',
        labels: ['imported'],
        dueDate: null,
        isOverdue: false,
        createdAt: '2999-01-01T00:00:00.000Z',
        updatedAt: '2999-01-01T00:00:00.000Z',
        comments: [
          {
            id: 'e2e-import-comment',
            issueId: 'e2e-import-issue',
            body: 'Imported comment body',
            createdAt: '2999-01-01T00:01:00.000Z',
            updatedAt: '2999-01-01T00:01:00.000Z',
            editHistory: []
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
          }
        ]
      }
    ]
  };
  const importFilePath = testInfo.outputPath('tinytracker-import.json');

  writeFileSync(importFilePath, JSON.stringify(importPayload), 'utf8');
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByRole('heading', { name: 'Import Preview' })).toBeVisible();
  await expect(importPanel.getByRole('radio', { name: 'Skip existing conflicts (default)' })).toBeChecked();
  await expect(importPanel.getByText('Ready to create 1 issues, replace 0 changed issues, and skip 0.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+1\s+0\s+0\s+1\s+0\s+0/ })).toBeVisible();

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();

  await expect(
    importPanel.getByText('Import applied: 1 issues created, 0 changed issues replaced, 0 skipped.')
  ).toBeVisible();

  const importedRow = page.getByRole('row', { name: /Imported issue from JSON.*Review.*High/ });
  await expect(importedRow).toBeVisible();

  await page.getByRole('button', { name: 'Open Imported issue from JSON' }).click();

  const detail = page.getByRole('region', { name: 'Imported issue from JSON' });

  await expect(detail.getByText('Created through the JSON import flow.')).toBeVisible();
  await expect(detail.getByText('Imported comment body')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Issue created')).toBeVisible();
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
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByText('Ready to create 0 issues, replace 0 changed issues, and skip 1.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+1\s+0\s+1\s+0\s+0\s+1/ })).toBeVisible();

  await importPanel.getByRole('radio', { name: 'Replace changed issues' }).check();

  await expect(importPanel.getByText('Ready to create 0 issues, replace 1 changed issues, and skip 0.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+1\s+0\s+1\s+0\s+1\s+0/ })).toBeVisible();

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();

  await expect(
    importPanel.getByText('Import applied: 0 issues created, 1 changed issues replaced, 0 skipped.')
  ).toBeVisible();

  const replacedRow = page.getByRole('row', { name: /Conflict issue replaced from JSON.*Review.*High/ });

  await expect(replacedRow).toBeVisible();
  await page.getByRole('button', { name: 'Open Conflict issue replaced from JSON' }).click();

  const detail = page.getByRole('region', { name: 'Conflict issue replaced from JSON' });

  await expect(detail.getByText('Changed through explicit replace policy.')).toBeVisible();
  await expect(detail.getByLabel('Issue labels').getByText('conflict', { exact: true })).toBeVisible();
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
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();

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

  await page.goto(`/issues/${blocked.id}`);

  const detail = page.getByRole('region', { name: blocked.title });
  const dependencyForm = detail.getByRole('form', { name: 'Dependency form' });

  await expect(detail.getByText('No dependencies yet.')).toBeVisible();
  await dependencyForm.getByLabel('Add blocker issue ID').fill(blocker.id);
  await dependencyForm.getByRole('button', { name: 'Add Dependency' }).click();

  await expect(detail.getByText('Waiting on at least one active dependency.')).toBeVisible();
  await expect(detail.getByLabel('Issue dependencies').getByText('Dependency blocker issue')).toBeVisible();
  await expect(detail.getByLabel('Issue dependencies').locator('.blocked-pill')).toHaveText('Blocking');
  await expect(detail.getByLabel('Issue activity').getByText('Dependency added')).toBeVisible();

  const blockedRow = page.getByRole('row', { name: /Dependency blocked issue.*In Progress.*Medium/ });

  await expect(blockedRow.locator('.blocked-pill')).toHaveText('Blocked');

  await detail.getByRole('button', { name: 'Remove dependency Dependency blocker issue' }).click();

  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(detail.getByText('No dependencies yet.')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Dependency removed')).toBeVisible();
  await expect(blockedRow.locator('.blocked-pill')).toHaveCount(0);
});

test('dashboard density toggle compacts rows without hiding issue information', async ({ page }) => {
  await createIssueThroughApi(page, {
    title: 'Density toggle issue',
    description: 'Operational row text remains visible in every density.',
    status: 'review',
    priority: 'high'
  });

  await page.goto('/');

  const densityControls = page.getByLabel('Dashboard density');
  const compactButton = densityControls.getByRole('button', { name: 'Compact' });
  const comfortableButton = densityControls.getByRole('button', { name: 'Comfortable' });
  const issueRow = page.getByRole('row', { name: /Density toggle issue.*Review.*High/ });

  await expect(densityControls).toBeVisible();
  await expect(page.locator('.issue-table-density-comfortable')).toHaveCount(1);
  await expect(issueRow).toBeVisible();
  await expect(issueRow).toContainText('Operational row text remains visible in every density.');
  await expect(issueRow).toContainText('No due date');
  await expect(issueRow.getByRole('button', { name: 'Open Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Edit Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Archive Density toggle issue' })).toBeVisible();

  await compactButton.click();
  await expect(compactButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.issue-table-density-compact')).toHaveCount(1);
  await expect(issueRow).toBeVisible();
  await expect(issueRow).toContainText('Density toggle issue');
  await expect(issueRow).toContainText('Operational row text remains visible in every density.');
  await expect(issueRow).toContainText('Review');
  await expect(issueRow).toContainText('High');
  await expect(issueRow).toContainText('No due date');
  await expect(issueRow.getByRole('button', { name: 'Open Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Edit Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Archive Density toggle issue' })).toBeVisible();

  await comfortableButton.click();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.issue-table-density-comfortable')).toHaveCount(1);
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

  const editIssueButton = page.getByRole('button', { name: 'Edit Keyboard issue' });
  await pressTabUntilFocused(page, editIssueButton);
  await page.keyboard.press('Enter');
  await expect(issueTitle).toBeFocused();

  const cancelIssueButton = issueForm.getByRole('button', { name: 'Cancel' });
  await pressTabUntilFocused(page, cancelIssueButton);
  await page.keyboard.press('Enter');
  await expect(editIssueButton).toBeFocused();

  const openIssueButton = page.getByRole('button', { name: 'Open Keyboard issue' });
  await pressTabUntilFocused(page, openIssueButton, 80);
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
  await pressTabUntilFocused(page, closeDetailButton, 80);
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

test('dashboard filters hydrate from URL and compose with issue detail routes', async ({ page }) => {
  const targetIssue = await createIssueThroughApi(page, {
    title: 'URL filter target',
    description: 'Restored from a copied dashboard URL.',
    status: 'review',
    priority: 'high'
  });
  await createIssueThroughApi(page, {
    title: 'URL filter other',
    description: 'Should be hidden by composed filters.',
    status: 'todo',
    priority: 'low'
  });

  await page.goto('/?search=URL%20filter%20target&status=review&priority=high');

  const filters = page.getByLabel('Issue filters');
  await expect(filters.getByLabel('Search')).toHaveValue('URL filter target');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(page.getByLabel('Active filters')).toContainText('Search: URL filter target');
  await expect(page.getByLabel('Active filters')).toContainText('Status: Review');
  await expect(page.getByLabel('Active filters')).toContainText('Priority: High');
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toHaveCount(0);

  await filters.getByLabel('Search').fill('URL filter');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('URL filter');
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toHaveCount(0);

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('URL filter');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('high');

  await page.goBack();
  await expect(page.getByRole('region', { name: targetIssue.title })).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('URL filter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('review');

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

  await filters.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /URL filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /URL filter other.*Todo.*Low/ })).toBeVisible();
  await expect(page).toHaveURL('/');

  await page.goto('/?search=%20%20&status=bogus&priority=weird');
  await expect(filters.getByLabel('Search')).toHaveValue('');
  await expect(filters.getByLabel('Status')).toHaveValue('all');
  await expect(filters.getByLabel('Priority')).toHaveValue('all');
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('saved filter views persist restore and compose with detail routes', async ({ page }) => {
  const targetIssue = await createIssueThroughApi(page, {
    title: 'Saved view target',
    description: 'Archived issue restored by saved view.',
    status: 'review',
    priority: 'high'
  });
  await createIssueThroughApi(page, {
    title: 'Saved view active other',
    description: 'Should not match the saved filter.',
    status: 'todo',
    priority: 'low'
  });
  const archiveResponse = await page.request.post(`/api/issues/${targetIssue.id}/archive`);

  expect(archiveResponse.ok()).toBe(true);

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  const savedViews = page.getByLabel('Saved filter views');

  await filters.getByLabel('Search').fill('Saved view target');
  await filters.getByLabel('Status').selectOption('review');
  await filters.getByLabel('Priority').selectOption('high');
  await filters.getByLabel('Include archived').check();
  await filters.getByLabel('Page size').selectOption('50');
  await savedViews.getByLabel('View name').fill('Review archive view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view');
  await expect(page.getByLabel('Active filters')).toContainText('Page size: 50');
  await expect(page.getByRole('row', { name: /Saved view target.*Review.*High/ })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await filters.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('');
  await expect(filters.getByLabel('Page size')).toHaveValue('25');
  await expect(page).toHaveURL('/');

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(filters.getByLabel('Page size')).toHaveValue('50');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await page.reload();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view');
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Review archive view' });
  await savedViews.getByLabel('View name').fill('Renamed archive view');
  await savedViews.getByRole('button', { name: 'Rename' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Renamed archive view');

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await filters.getByLabel('Search').fill('no matching saved view row');
  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();

  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await expect(savedViews.getByRole('option', { name: 'Renamed archive view' })).toHaveCount(0);

  const savedViewList = await page.request.get('/api/filter-views');
  const savedViewListBody = (await savedViewList.json()) as unknown[];

  expect(savedViewList.ok()).toBe(true);
  expect(savedViewListBody).toEqual([]);
});

test('large issue lists remain filterable and can open detail', async ({ page }) => {
  test.setTimeout(60_000);

  const issues = await createLargeIssueSet(page, largeIssueCount);
  const targetIssue = issues[420];
  const listRequestStartedAt = Date.now();
  const listResponse = await page.request.get('/api/issues?search=Large%20issue&limit=25&page=1');
  const listRequestElapsedMs = Date.now() - listRequestStartedAt;
  const listBody = (await listResponse.json()) as IssueListResponse;
  const secondPageResponse = await page.request.get('/api/issues?search=Large%20issue&limit=25&page=2');
  const secondPageBody = (await secondPageResponse.json()) as IssueListResponse;
  const secondPageTarget = secondPageBody.items[0];

  expect(listResponse.ok()).toBe(true);
  expect(secondPageResponse.ok()).toBe(true);
  expect(listRequestElapsedMs).toBeLessThan(1000);
  expect(listBody.items).toHaveLength(25);
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

  await page.goto('/');

  const filters = page.getByLabel('Issue filters');
  await filters.getByLabel('Search').fill('Large issue');
  await expect(page.getByText(`Showing 1-25 of ${largeIssueCount} matches`)).toBeVisible();
  await expect(page.getByLabel('Active filters')).toContainText('25 shown');
  await expect(page.getByLabel('25 issues shown')).toBeVisible();

  const pagination = page.getByLabel('Issue pagination');
  await expect(pagination).toContainText('Page 1 of 20');
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 20');
  await expect(page.getByRole('row', { name: new RegExp(`${secondPageTarget.title}.*`) })).toBeVisible();

  await page.getByRole('button', { name: `Open ${secondPageTarget.title}` }).click();
  const pagedDetail = page.getByRole('region', { name: secondPageTarget.title });

  await expect(pagedDetail.getByRole('heading', { name: secondPageTarget.title })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${secondPageTarget.id}`);
  await pagedDetail.getByRole('button', { name: `Close issue detail for ${secondPageTarget.title}` }).click();

  const filterStartedAt = Date.now();
  await filters.getByLabel('Search').fill(targetIssue.title);
  await expect(page.getByLabel('Active filters')).toContainText('1 shown');
  expect(Date.now() - filterStartedAt).toBeLessThan(1000);

  const targetRow = page.getByRole('row', { name: /Large issue 0420.*Todo.*Low/ });
  await expect(targetRow).toBeVisible();

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  const detail = page.getByRole('region', { name: targetIssue.title });

  await expect(detail.getByRole('heading', { name: targetIssue.title })).toBeVisible();
  await expect(detail.locator('.detail-description')).toHaveText('Large-list guardrail item 0420');
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(targetIssue.title);
});
