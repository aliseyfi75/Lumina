import { test, expect } from 'playwright/test';

test('deleting the last card persists the empty deck across page reloads in IndexedDB and localStorage', async ({ page }) => {
  await page.goto('http://localhost:5173/#/flashcards');
  // Wait for initial load of default database to settle
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  // Seed a single card into IndexedDB and localStorage, then reload
  await page.evaluate(async () => {
    const singleCard = {
      id: 'last-card-1',
      word: 'Solitude',
      phonetic: '/ˈsɒl.ɪ.tjuːd/',
      mainDefinition: 'The state or situation of being alone.',
      partOfSpeech: 'noun',
      status: 'New',
      lastReviewed: 0,
      createdAt: Date.now(),
    };
    localStorage.setItem('lumina_cards_v1', JSON.stringify([singleCard]));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lumina_db', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
        if (!db.objectStoreNames.contains('app_data')) db.createObjectStore('app_data');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('app_data', 'readwrite');
        tx.objectStore('app_data').put(
          { cards: [singleCard], studyHistory: { '2026-11-05': 1 }, longestStreak: 1, deletedCards: {} },
          'appData'
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Solitude' })).toBeVisible();

  // Click card to flip, then click Delete button
  await page.getByRole('heading', { name: 'Solitude' }).click();
  await page.getByTitle('Delete Card').click();

  await expect(page.getByRole('heading', { name: 'Your deck is empty' })).toBeVisible();

  // Wait briefly for IDB transaction to complete, then reload the page
  await page.waitForTimeout(300);
  await page.reload();

  // Verify the deck remains empty after reload!
  await expect(page.getByRole('heading', { name: 'Your deck is empty' })).toBeVisible();
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/fix3_empty_deck.png',
  });
});
