import { test, expect } from 'playwright/test';

test('global wildcard CSS transition rule is removed so arbitrary DOM/SVG nodes do not incur forced transitions', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  const heading = page.getByRole('heading', { name: /Welcome back/i });
  await expect(heading).toBeVisible();

  const headingTransitionProp = await heading.evaluate((el) => getComputedStyle(el).transitionProperty);
  const headingTransitionDuration = await heading.evaluate((el) => getComputedStyle(el).transitionDuration);
  // Without Tailwind transition classes or universal *, transitionDuration is 0s
  expect(headingTransitionDuration).toBe('0s');
  expect(headingTransitionProp).not.toContain('background-color');

  const bodyTransitionDuration = await page.locator('body').evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(bodyTransitionDuration).toContain('0.2s');
});
