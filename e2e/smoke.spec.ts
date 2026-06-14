import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

type ExportedIssue = {
  title: string;
  comments: Array<{ body: string; editHistory: Array<{ previousBody: string; newBody: string }> }>;
  activityEvents: Array<{ type: string }>;
};

test('TinyTracker smoke creates lists updates and comments on an issue', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('TinyTracker')).toBeVisible();
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
  await expect(page.getByLabel('Issue comments').getByText('Initial detail comment')).toBeVisible();
  await expect(activity.getByText('Comment added')).toBeVisible();

  await page.getByRole('button', { name: 'Edit comment Initial detail comment' }).click();
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
