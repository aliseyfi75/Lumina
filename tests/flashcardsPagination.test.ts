import { test, expect } from 'playwright/test';

test('Flashcards view paginates large decks by rendering 24 cards per batch and loading more on demand', async ({ page }) => {
  await page.goto('http://localhost:5173/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  await page.evaluate(async () => {
    const manyCards = Array.from({ length: 60 }, (_, i) => ({
      id: `pag-card-${i}`,
      word: `VocabWord${i + 1}`,
      phonetic: `/vəˈkæb.${i + 1}/`,
      mainDefinition: `Sample definition number ${i + 1} for pagination verification.`,
      partOfSpeech: 'noun',
      status: 'New',
      lastReviewed: 0,
      createdAt: Date.now() - i * 1000,
    }));
    localStorage.setItem('lumina_cards_v1', JSON.stringify(manyCards));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lumina_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('app_data', 'readwrite');
        tx.objectStore('app_data').put(
          { cards: manyCards, studyHistory: {}, longestStreak: 0, deletedCards: {} },
          'appData'
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await page.reload();
  await expect(page.getByText('60 cards total')).toBeVisible();
  await expect(page.getByText('Showing 24 of 60 cards')).toBeVisible();

  const renderedHeadings = page.locator('h3', { hasText: /^VocabWord/ });
  await expect(renderedHeadings).toHaveCount(24);

  await page.getByRole('button', { name: 'Load More Cards' }).click();
  await expect(page.getByText('Showing 48 of 60 cards')).toBeVisible();
  await expect(renderedHeadings).toHaveCount(48);

  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/fix9_pagination.png',
  });
});
