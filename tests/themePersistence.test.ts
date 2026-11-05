import { test, expect } from 'playwright/test';

test('theme toggle persists user override across page reloads regardless of OS color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://localhost:5173/');

  await expect(page.locator('html')).not.toHaveClass(/dark/);

  // Toggle dark mode on
  await page.getByLabel('Toggle dark mode').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const stored = await page.evaluate(() => localStorage.getItem('lumina_theme'));
  expect(stored).toBe('dark');

  // Reload page while OS colorScheme is still 'light'
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/fix7_persisted_dark_theme.png',
  });
});
