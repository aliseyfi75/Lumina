import { test, expect } from 'playwright/test';

test.describe('Feature C.7: Synonyms, Antonyms, Etymology & Clickable Word Cross-References', () => {
  test('displays origin, clickable synonyms/antonyms, and interactive definition words', async ({ page }) => {
    await page.route('**/api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
      const url = route.request().url().toLowerCase();
      if (url.endsWith('/ephemeral')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              word: 'ephemeral',
              phonetic: '/əˈfem(ə)rəl/',
              origin: 'Late 16th century: from Greek ephēmeros, lasting only one day.',
              meanings: [
                {
                  partOfSpeech: 'adjective',
                  synonyms: ['transient', 'fleeting', 'evanescent'],
                  antonyms: ['permanent', 'enduring'],
                  definitions: [
                    {
                      definition: 'Lasting for a very brief time.',
                      example: 'Fashions are ephemeral: new ones regularly drive out the old.',
                    },
                  ],
                },
              ],
            },
          ]),
        });
      } else if (url.endsWith('/transient')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              word: 'transient',
              phonetic: '/ˈtranSHənt/',
              meanings: [
                {
                  partOfSpeech: 'adjective',
                  synonyms: ['temporary', 'short-lived'],
                  definitions: [
                    {
                      definition: 'Staying or working in a place for only a short time.',
                    },
                  ],
                },
              ],
            },
          ]),
        });
      } else if (url.endsWith('/staying')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              word: 'staying',
              phonetic: '/ˈstāiNG/',
              meanings: [
                {
                  partOfSpeech: 'noun',
                  definitions: [
                    {
                      definition: 'The action of remaining in a place.',
                    },
                  ],
                },
              ],
            },
          ]),
        });
      } else {
        await route.fulfill({ status: 404, body: 'Not found' });
      }
    });

    await page.goto('http://localhost:5173/#/dictionary');
    await page.waitForTimeout(550);

    // Search for "ephemeral"
    const searchInput = page.locator('input[placeholder="Lookup a word..."]');
    await searchInput.fill('ephemeral');
    await page.getByRole('button', { name: 'Search' }).click();

    // Verify word, origin, synonyms, and antonyms appear
    await expect(page.getByRole('heading', { name: 'ephemeral' })).toBeVisible();
    await expect(page.getByText('Late 16th century: from Greek ephēmeros, lasting only one day.')).toBeVisible();

    const synGroup = page.getByLabel('Synonyms');
    await expect(synGroup.getByRole('button', { name: 'transient' })).toBeVisible();
    await expect(synGroup.getByRole('button', { name: 'fleeting' })).toBeVisible();

    const antGroup = page.getByLabel('Antonyms');
    await expect(antGroup.getByRole('button', { name: 'permanent' })).toBeVisible();

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_c7_dictionary_synonyms.png',
      fullPage: true,
    });

    // Click synonym pill "transient" to cross-reference look it up
    await synGroup.getByRole('button', { name: 'transient' }).click();
    await expect(page.getByRole('heading', { name: 'transient' })).toBeVisible();

    // Click interactive word "Staying" inside the definition of "transient"
    await page.locator('span[role="button"]:has-text("Staying")').click();
    await expect(page.getByRole('heading', { name: 'staying' })).toBeVisible();
  });
});
