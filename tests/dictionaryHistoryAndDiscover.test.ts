import { test, expect } from 'playwright/test';

test.describe('Feature C.8: Recent Search History & Curated Word Discovery Packs', () => {
  test('renders curated word packs, supports Surprise Me lookup, and persists recent search history', async ({ page }) => {
    await page.route('**/api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
      const urlParts = route.request().url().split('/');
      const rawWord = decodeURIComponent(urlParts[urlParts.length - 1] || 'word').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            word: rawWord,
            phonetic: `/${rawWord}/`,
            meanings: [
              {
                partOfSpeech: 'adjective',
                definitions: [
                  {
                    definition: `Definition for ${rawWord}.`,
                  },
                ],
              },
            ],
          },
        ]),
      });
    });

    await page.goto('http://localhost:5173/#/dictionary');
    await page.waitForTimeout(550);

    // 1. Verify Curated Word Packs and Surprise Me button are visible
    const packsSection = page.getByLabel('Curated word packs');
    await expect(packsSection).toBeVisible();
    await expect(packsSection.getByRole('heading', { name: 'Literary Gems' })).toBeVisible();
    await expect(packsSection.getByRole('heading', { name: 'GRE High-Frequency' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Surprise Me' })).toBeVisible();

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_c8_discover_packs.png',
      fullPage: true,
    });

    // 2. Click "Mellifluous" in Literary Gems pack
    await packsSection.getByRole('button', { name: 'Mellifluous' }).click();
    await expect(page.getByRole('heading', { name: 'mellifluous' })).toBeVisible();

    // Verify "mellifluous" is added to Recent Searches
    const recentBar = page.getByLabel('Recent searches');
    await expect(recentBar.getByRole('button', { name: 'mellifluous' })).toBeVisible();

    // 3. Click "Surprise Me" and verify a second word is added to Recent Searches
    await page.getByRole('button', { name: 'Surprise Me' }).click();
    await expect(recentBar.locator('button')).toHaveCount(3); // 2 recent words + 1 "Clear" button

    // 4. Reload and verify Recent Searches persisted in localStorage
    await page.reload();
    await expect(page.getByLabel('Recent searches').getByRole('button', { name: 'mellifluous' })).toBeVisible();

    // 5. Clear recent searches
    await page.getByLabel('Clear recent searches').click();
    await expect(page.getByLabel('Recent searches').locator('button')).toHaveCount(0);
  });
});
