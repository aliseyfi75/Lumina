import { test, expect } from 'playwright/test';

test.describe('Feature B.6: Tags, Collections & Tag-Scoped Study Sessions', () => {
  test('filters cards by tag, creates tagged cards, and scopes study sessions by tag', async ({ page }) => {
    await page.goto('http://localhost:5173/#/flashcards');

    await page.evaluate(async () => {
      const seedCards = [
        {
          id: 'tag-card-1',
          word: 'Spice',
          phonetic: '/spīs/',
          partOfSpeech: 'noun',
          mainDefinition: 'A substance vital to space travel in Dune.',
          tags: ['Book: Dune', 'Sci-Fi'],
          status: 'New',
          lastReviewed: 0,
          createdAt: 1000,
        },
        {
          id: 'tag-card-2',
          word: 'Benevolent',
          phonetic: '/bəˈnevələnt/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Well meaning and kindly.',
          tags: ['GRE'],
          status: 'New',
          lastReviewed: 0,
          createdAt: 2000,
        },
      ];
      localStorage.setItem('lumina_cards_v1', JSON.stringify(seedCards));
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('lumina_db', 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('app_data', 'readwrite');
          tx.objectStore('app_data').put(
            { cards: seedCards, studyHistory: {}, longestStreak: 0, deletedCards: {} },
            'appData'
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();
    await page.waitForTimeout(550);

    // 1. Verify tag pills and Collections filter buttons appear
    const tagFilterBar = page.getByLabel('Tag filter pills');
    await expect(tagFilterBar.getByRole('button', { name: '#Book: Dune (1)' })).toBeVisible();
    await expect(tagFilterBar.getByRole('button', { name: '#GRE (1)' })).toBeVisible();

    // 2. Click #Book: Dune (1) to filter the deck
    await tagFilterBar.getByRole('button', { name: '#Book: Dune (1)' }).click();
    await expect(page.getByRole('heading', { name: 'Spice' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Benevolent' })).toHaveCount(0);
    await page.waitForTimeout(200);

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_b6_tags_and_collections.png',
      fullPage: true,
    });

    // Reset filter to All
    await tagFilterBar.getByRole('button', { name: 'All (2)' }).click();
    await expect(page.getByRole('heading', { name: 'Benevolent' })).toBeVisible();

    // 3. Open SessionConfigModal and start a study session filtered by 'GRE'
    await page.getByRole('button', { name: 'Start Study Session' }).click();
    const studyTagSelect = page.getByLabel('Study tag filter');
    await expect(studyTagSelect).toBeVisible();
    await studyTagSelect.selectOption('GRE');
    await expect(page.getByText('Review all 1 cards that are due today in #GRE.')).toBeVisible();

    await page.getByRole('button', { name: 'Start Full Session' }).click();

    // Verify StudySession only contains the 1 card from #GRE
    await expect(page.getByText('1 / 1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Benevolent' })).toBeVisible();
  });
});
