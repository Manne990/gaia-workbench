import { expect, test } from '@playwright/test';

test('TinyTracker dashboard creates and edits issues', async ({ page }) => {
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
  await issueForm.getByLabel('Status').selectOption('review');
  await issueForm.getByLabel('Priority').selectOption('high');
  await page.getByRole('button', { name: 'Create Issue' }).click();

  await expect(page.getByRole('row', { name: /Create issue from UI.*Review.*High/ })).toBeVisible();
  await expect(page.getByText('1 high priority')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Create issue from UI' }).click();
  await issueForm.getByLabel('Title').fill('Edit issue from UI');
  await issueForm.getByLabel('Description').fill('Updated through the dashboard form.');
  await issueForm.getByLabel('Status').selectOption('done');
  await issueForm.getByLabel('Priority').selectOption('low');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page.getByRole('row', { name: /Edit issue from UI.*Done.*Low/ })).toBeVisible();
  await expect(page.getByText('Create issue from UI')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Edit issue from UI' }).click();
  const detail = page.getByRole('region', { name: 'Edit issue from UI' });

  await expect(detail.getByRole('heading', { name: 'Edit issue from UI' })).toBeVisible();
  await expect(detail.getByText('Updated through the dashboard form.')).toBeVisible();
  await expect(detail.getByText('No comments yet.')).toBeVisible();

  const commentForm = page.getByRole('form', { name: 'Comment form' });

  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  await expect(commentForm.getByRole('alert')).toHaveText('Comment is required.');

  await commentForm.getByLabel('New comment').fill('Initial detail comment');
  await commentForm.getByRole('button', { name: 'Add Comment' }).click();
  await expect(page.getByLabel('Issue comments').getByText('Initial detail comment')).toBeVisible();

  await page.getByRole('button', { name: 'Edit comment Initial detail comment' }).click();
  const editCommentForm = page.getByRole('form', { name: 'Edit comment form' });

  await editCommentForm.getByLabel('Comment').fill('Edited detail comment');
  await editCommentForm.getByRole('button', { name: 'Save Comment' }).click();

  await expect(page.getByLabel('Issue comments').getByText('Edited detail comment')).toBeVisible();
  await expect(page.getByText('1 edit')).toBeVisible();
  await expect(page.getByText('Previous: Initial detail comment')).toBeVisible();
});
