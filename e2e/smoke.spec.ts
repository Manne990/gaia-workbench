import { expect, test } from '@playwright/test';

test('TinyTracker shell renders', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Issue tracking, kept small.' })).toBeVisible();
  await expect(page.getByText('TinyTracker')).toBeVisible();
  await expect(page.getByLabel('TinyTracker status columns')).toBeVisible();
});
