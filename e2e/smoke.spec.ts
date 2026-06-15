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
  await expect(page.getByLabel('Active filter count')).toHaveText('1 active filter');
  await expect(page.getByText('No issues match the active filters.')).toBeVisible();
  await filters.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(updatedRow).toBeVisible();
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByLabel('Active filter count')).toHaveCount(0);

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
  await importJsonFileInput(page).setInputFiles(importFilePath);

  const importPanel = page.getByRole('region', { name: 'Import preview' });

  await expect(importPanel.getByRole('heading', { name: 'Import Preview' })).toBeVisible();
  await expect(importPanel.getByRole('radio', { name: 'Skip existing conflicts (default)' })).toBeChecked();
  await expect(importPanel.getByText('Ready to create 1 issues, replace 0 changed issues, and skip 0.')).toBeVisible();
  await expect(importPanel.getByRole('row', { name: /Issues\s+1\s+0\s+0\s+1\s+0\s+0/ })).toBeVisible();
  const reportDownloadPromise = page.waitForEvent('download');

  await importPanel.getByRole('button', { name: 'Download report' }).click();
  const reportDownload = await reportDownloadPromise;
  const reportPath = await reportDownload.path();
  const reportData = JSON.parse(readFileSync(reportPath ?? '', 'utf8')) as {
    sourceFileName: string | null;
    policy: string;
    summary: { toCreate: { issues: number; comments: number; editHistory: number; activityEvents: number } };
    decisions: unknown[];
    warnings: string[];
    errors: unknown[];
  };

  expect(reportData.sourceFileName).toBe('tinytracker-import.json');
  expect(reportData.policy).toBe('skip-conflicts');
  expect(reportData.summary.toCreate).toEqual({ issues: 1, comments: 1, editHistory: 0, activityEvents: 1 });
  expect(Array.isArray(reportData.decisions)).toBe(true);
  expect(reportData.errors).toEqual([]);
  expect(reportData.warnings).toEqual([]);

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
  await importJsonFileInput(page).setInputFiles(importFilePath);

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

  await expect(importPanel.getByText('Ready to create 0 issues, replace 0 changed issues, and skip 1.')).toBeVisible();
  await importPanel.getByRole('radio', { name: 'Replace changed issues' }).check();
  await expect(importPanel.getByText('Ready to create 0 issues, replace 1 changed issues, and skip 0.')).toBeVisible();

  await importPanel.getByRole('button', { name: 'Apply Import' }).click();

  await expect(
    importPanel.getByText('Import applied: 0 issues created, 1 changed issues replaced, 0 skipped.')
  ).toBeVisible();

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

test('archive action offers undo recovery in active and include-archived modes', async ({ page }) => {
  const issue = await createIssueThroughApi(page, {
    title: 'Undo archive recovery issue',
    description: 'Allows accidental archive recovery from list actions.',
    priority: 'medium'
  });

  await page.goto(`/?search=${encodeURIComponent(issue.title)}`);

  const filters = page.getByLabel('Issue filters');
  const includeArchived = filters.getByLabel('Include archived');
  const issueRow = page.getByRole('row', { name: new RegExp(`Undo archive recovery issue.*Todo.*Medium`) });
  const undoArchiveButton = page.getByRole('button', { name: `Undo archive of ${issue.title}` });
  const archiveNotice = page.getByRole('status').filter({ hasText: `Issue "${issue.title}" archived.` });

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

  const activeUndoResponse = waitForIssueActionResponse(page, issue.id, 'unarchive');
  await undoArchiveButton.click();
  await activeUndoResponse;

  await expect(archiveNotice).toHaveCount(0);
  await expect(issueRow).toBeVisible();

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

  const includedUndoResponse = waitForIssueActionResponse(page, issue.id, 'unarchive');
  await undoArchiveButton.click();
  await includedUndoResponse;

  await expect(archiveNotice).toHaveCount(0);
  await expect(issueRow.locator('.archived-pill')).toHaveCount(0);
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

  await expect(page.getByRole('row', { name: /Bulk status visible first.*Todo.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status visible second.*In Progress.*Medium/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status visible unchanged.*Done.*Low/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bulk status hidden issue/ })).toHaveCount(0);
  await expect(bulkActions).toContainText('0 selected');

  await bulkActions.getByRole('button', { name: 'Select all visible' }).click();
  await expect(bulkActions).toContainText('3 selected');
  await bulkActions.getByLabel('Status').selectOption('done');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Change 3 selected issues to Done?');
    await dialog.accept();
  });
  await bulkActions.getByRole('button', { name: 'Change Status' }).click();

  await expect(bulkActions).toContainText('Changed 2 issues to Done.');
  await expect(bulkActions).toContainText('1 already was Done.');
  await expect(bulkActions).toContainText('0 selected');
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

  await expect(detail.getByText('Waiting on at least one active dependency.')).toBeVisible();
  await expect(blockerRow).toContainText('Todo');
  await expect(blockerRow).toContainText('High');
  await expect(dependentRow).toContainText('In Progress');
  await expect(dependentRow).toContainText('Low');
  await expect(dependentRow.locator('.blocked-pill')).toHaveText('Blocked');
  await blockerRow.getByLabel(`Select ${blocker.title}`).check();

  const bulkActions = page.getByLabel('Bulk status actions');

  await expect(bulkActions).toContainText('1 selected');
  await bulkActions.getByLabel('Status').selectOption('done');

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

  await filters.getByRole('button', { name: 'Clear Filters' }).click();
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

  await expect(detail.getByText('Waiting on at least one active dependency.')).toBeVisible();
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
  await expect(detail.getByText('Waiting on at least one active dependency.')).toBeVisible();
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
  await expect(detail.getByText('Waiting on at least one active dependency.')).toBeVisible();
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
  await expect(detail.getByText('Waiting on at least one active dependency.')).toBeVisible();
  await expect(detail.getByLabel('Issue activity').getByText('Dependency added')).toHaveCount(2);

  await blockerAfterArchiveItem.getByRole('button', { name: `Remove dependency ${blockerAfterArchive.title}` }).click();

  await expect(detail.getByText('Waiting on at least one active dependency.')).toHaveCount(0);
  await expect(blockedRow.locator('.blocked-pill')).toHaveCount(0);
  await expect(detail.getByLabel('Issue activity').getByText('Dependency removed')).toBeVisible();
  await expect(dependentsSection.getByText(dependent.title)).toBeVisible();
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
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
  await expect(issueRow).toBeVisible();
  await expect(issueRow).toContainText('Operational row text remains visible in every density.');
  await expect(issueRow).toContainText('No due date');
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
  await expect(issueRow.getByRole('button', { name: 'Open Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Edit Density toggle issue' })).toBeVisible();
  await expect(issueRow.getByRole('button', { name: 'Archive Density toggle issue' })).toBeVisible();

  await comfortableButton.click();
  await expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
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

  await filters.getByRole('button', { name: 'Clear Filters' }).click();
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

  await filters.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toHaveCount(0);
  await expect(filters.getByLabel('Search')).toHaveValue('');
  await expect(filters.getByLabel('Status')).toHaveValue('all');
  await expect(filters.getByLabel('Priority')).toHaveValue('all');
  await expect(page.getByLabel('Active filters')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Rapid filter target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rapid filter review low.*Review.*Low/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rapid filter todo high.*Todo.*High/ })).toBeVisible();
  await expect(page).toHaveURL('/');
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
  await savedViews.getByLabel('View name').fill('Review archive view');
  await savedViews.getByRole('button', { name: 'Save View' }).click();

  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view');
  await expect(page.getByLabel('Active filters')).toContainText('Label: archive');
  await expect(page.getByLabel('Active filters')).toContainText('Page size: 50');
  await expect(page.getByRole('row', { name: /Saved view target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view active other.*Todo.*Low/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await filters.getByRole('button', { name: 'Clear Filters' }).click();
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
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await page.reload();
  settings = await expandDashboardSettings(page);
  savedViews = settings.getByLabel('Saved filter views');
  await expect(savedViews.getByLabel('Saved views')).toContainText('Review archive view');
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');

  await savedViews.getByLabel('Saved views').selectOption({ label: 'Review archive view' });
  await savedViews.getByLabel('View name').fill('Renamed archive view');
  await savedViews.getByRole('button', { name: 'Rename' }).click();
  await expect(savedViews.getByLabel('Saved views')).toContainText('Renamed archive view');

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

  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect(filters.getByLabel('Search')).toHaveValue('Saved view target');
  await expect(filters.getByLabel('Label')).toHaveValue('archive');
  await expect(filters.getByLabel('Status')).toHaveValue('review');
  await expect(filters.getByLabel('Priority')).toHaveValue('high');
  await expect(filters.getByLabel('Include archived')).toBeChecked();
  await expect(settings.getByLabel('Page size')).toHaveValue('50');
  await expect(page.getByRole('row', { name: /Saved view target.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Saved view active other.*Todo.*Low/ })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect.poll(() => new URL(page.url()).searchParams.get('limit')).toBe('50');

  await page.getByRole('button', { name: `Open ${targetIssue.title}` }).click();
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();
  await filters.getByLabel('Search').fill('no matching saved view row');
  await savedViews.getByRole('button', { name: 'Apply View' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/issues/${targetIssue.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Saved view target');
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('archive');
  await expect(page.getByRole('region', { name: targetIssue.title })).toBeVisible();

  await savedViews.getByRole('button', { name: 'Delete' }).click();
  await expect(savedViews.getByRole('option', { name: 'Renamed archive view' })).toHaveCount(0);
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
