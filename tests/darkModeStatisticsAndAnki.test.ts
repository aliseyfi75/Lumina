import { test, expect } from 'playwright/test';

test('Statistics heatmap/charts and AnkiImportModal render with dark mode styling', async ({ page }) => {
  await page.goto('http://localhost:5173/#/statistics');
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();

  // Enable dark mode if not already dark
  const isInitiallyDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (!isInitiallyDark) {
    await page.getByLabel('Toggle dark mode').click();
  }
  await expect(page.locator('html')).toHaveClass(/dark/);

  // Check that heatmap empty cell uses dark:bg-slate-700 (rgb(51, 65, 85))
  const emptyCell = page.locator('[title$=": 0 interactions"]').first();
  await expect(emptyCell).toHaveClass(/dark:bg-slate-700/);
  await expect(emptyCell).toHaveCSS('background-color', 'rgb(51, 65, 85)');

  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/fix6_dark_statistics.png',
  });

  // Open Data Manager and upload a dummy .apkg file to open AnkiImportModal in dark mode
  await page.getByTitle('Manage Data').click();
  const fileInput = page.locator('input[accept=".apkg"]');
  await fileInput.setInputFiles({
    name: 'sample.apkg',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not-a-zip'),
  });

  const ankiHeading = page.getByRole('heading', { name: 'Import from Anki' });
  await expect(ankiHeading).toBeVisible();
  const modalBox = ankiHeading.locator('xpath=ancestor::div[contains(@class, "max-w-2xl")]');
  await expect(modalBox).toHaveClass(/dark:bg-slate-800/);

  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/fix6_dark_anki_modal.png',
  });
});
