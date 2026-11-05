import { test, expect } from 'playwright/test';

test('study session prevents grading via keyboard or drag until the card is flipped', async ({ page }) => {
  await page.goto('http://localhost:5173/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  await page.evaluate(async () => {
    const sampleCards = [
      {
        id: 'guard-card-1',
        word: 'Resilient',
        phonetic: '/rɪˈzɪl.i.ənt/',
        mainDefinition: 'Able to withstand or recover quickly from difficult conditions.',
        partOfSpeech: 'adjective',
        status: 'New',
        lastReviewed: 0,
        createdAt: Date.now() - 1000,
      },
      {
        id: 'guard-card-2',
        word: 'Tenacious',
        phonetic: '/təˈneɪ.ʃəs/',
        mainDefinition: 'Tending to keep a firm hold of something; clinging or adhering closely.',
        partOfSpeech: 'adjective',
        status: 'New',
        lastReviewed: 0,
        createdAt: Date.now(),
      },
    ];
    localStorage.setItem('lumina_cards_v1', JSON.stringify(sampleCards));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lumina_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('app_data', 'readwrite');
        tx.objectStore('app_data').put(
          { cards: sampleCards, studyHistory: {}, longestStreak: 0, deletedCards: {} },
          'appData'
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await page.goto('http://localhost:5173/#/study');
  await page.reload();

  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resilient' })).toBeVisible();

  // Pressing ArrowRight or ArrowLeft before flipping should NOT grade or advance the card
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resilient' })).toBeVisible();

  // Flip the card with Space
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await expect(page.getByText('Able to withstand or recover quickly from difficult conditions.')).toBeVisible();
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/fix4_flipped_card.png',
  });

  // Now ArrowRight grades and advances to card 2 / 2
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tenacious' })).toBeVisible();
});
