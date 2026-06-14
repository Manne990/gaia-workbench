import { expect, test } from '@playwright/test';

test('TinyTracker dashboard renders seeded issues', async ({ page, request }) => {
  await request.post('/api/issues', {
    data: {
      title: 'Review dashboard metrics',
      description: 'Confirm status counts and issue metadata render.',
      status: 'review',
      priority: 'high'
    }
  });
  await request.post('/api/issues', {
    data: {
      title: 'Prepare empty state copy',
      description: 'Keep the dashboard useful before issues exist.',
      status: 'todo',
      priority: 'medium'
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('TinyTracker')).toBeVisible();
  await expect(page.getByLabel('Issue status summary')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issue List' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Review dashboard metrics.*Review.*High/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Prepare empty state copy/ })).toBeVisible();
  await expect(page.getByText('High', { exact: true })).toBeVisible();
});
