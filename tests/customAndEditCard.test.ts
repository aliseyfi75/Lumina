import { test, expect } from 'playwright/test';

test.describe('Feature B.5: Custom Card Creation & Inline Card Editing', () => {
  test('creates a custom flashcard and edits an existing card via CardEditorModal', async ({ page }) => {
    await page.goto('http://localhost:5173/#/flashcards');

    await page.evaluate(async () => {
      const seedCards = [
        {
          id: 'edit-card-1',
          word: 'Perspicacious',
          phonetic: '/ˌpərspəˈkāSHəs/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Having a ready insight into and understanding of things.',
          example: 'It offers quite a few facts to the perspicacious reporter.',
          status: 'New',
          lastReviewed: 0,
          createdAt: 1000,
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

    // 1. Open Create Custom Card modal
    await page.getByRole('button', { name: 'Create Card' }).click();
    await expect(page.getByRole('heading', { name: 'Create Custom Card' })).toBeVisible();

    await page.getByLabel('Word', { exact: true }).fill('Mellifluous');
    await page.getByLabel('Part of Speech', { exact: true }).selectOption('adjective');
    await page.getByLabel('Phonetic', { exact: true }).fill('/məˈliflo͞oəs/');
    await page.getByLabel('Definition', { exact: true }).fill('Sweet or musical; pleasant to hear.');
    await page.getByLabel('Example Sentence', { exact: true }).fill('She had a rich, mellifluous voice.');

    await page.locator('form button[type="submit"]').click();

    // Verify new card is rendered
    await expect(page.getByRole('heading', { name: 'Mellifluous' })).toBeVisible();

    // 2. Open Edit modal on Perspicacious
    await page.getByLabel('Edit Perspicacious', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Flashcard' })).toBeVisible();
    await expect(page.getByLabel('Word', { exact: true })).toHaveValue('Perspicacious');

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_b5_edit_card_modal.png',
      fullPage: true,
    });

    // Update definition and save
    await page.getByLabel('Definition', { exact: true }).fill('Discerning; mentally sharp and observant.');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Verify updated definition is persisted in localStorage
    const updatedDef = await page.evaluate(() => {
      const cards = JSON.parse(localStorage.getItem('lumina_cards_v1') || '[]');
      return cards.find((c: any) => c.id === 'edit-card-1')?.mainDefinition;
    });
    expect(updatedDef).toBe('Discerning; mentally sharp and observant.');
  });
});
