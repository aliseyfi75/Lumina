import { test, expect } from 'playwright/test';

test.describe('Feature B.4: Search, Sort & Part-of-Speech Filter Bar', () => {
  test('filters flashcards by search query and part of speech, and sorts them', async ({ page }) => {
    await page.goto('http://localhost:5173/#/flashcards');

    await page.evaluate(async () => {
      const seedCards = [
        {
          id: 'filter-card-1',
          word: 'Zealous',
          phonetic: '/ˈzeləs/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Having or showing great energy or enthusiasm.',
          example: 'She was a zealous supporter of the reform.',
          status: 'New',
          lastReviewed: 0,
          createdAt: 1000,
        },
        {
          id: 'filter-card-2',
          word: 'Abate',
          phonetic: '/əˈbāt/',
          partOfSpeech: 'verb',
          mainDefinition: 'Become less intense or widespread.',
          example: 'The storm suddenly abated.',
          status: 'New',
          lastReviewed: 0,
          createdAt: 3000,
        },
        {
          id: 'filter-card-3',
          word: 'Clemency',
          phonetic: '/ˈklemənsē/',
          partOfSpeech: 'noun',
          mainDefinition: 'Mercy; lenience.',
          example: 'An appeal for clemency.',
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

    // Verify all 3 cards are initially visible
    await expect(page.getByRole('heading', { name: 'Zealous' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Abate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clemency' })).toBeVisible();

    // 1. Search by definition keyword ("lenience")
    const searchInput = page.getByLabel('Search flashcards');
    await searchInput.fill('lenience');
    await expect(page.getByRole('heading', { name: 'Clemency' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zealous' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Abate' })).toHaveCount(0);

    // Clear search
    await page.getByLabel('Clear search').click();
    await expect(page.getByRole('heading', { name: 'Zealous' })).toBeVisible();

    // 2. Filter by part of speech ("verb")
    const posSelect = page.getByLabel('Filter by part of speech');
    await posSelect.selectOption('verb');
    await expect(page.getByRole('heading', { name: 'Abate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clemency' })).toHaveCount(0);

    // Reset part of speech filter
    await posSelect.selectOption('all');

    // 3. Sort Alphabetical (A–Z)
    const sortSelect = page.getByLabel('Sort flashcards');
    await sortSelect.selectOption('alpha');

    const cardHeadingsAlpha = await page.locator('h3').allTextContents();
    expect(cardHeadingsAlpha).toEqual(['Abate', 'Clemency', 'Zealous']);

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_b4_search_sort_filter.png',
      fullPage: true,
    });

    // 4. Sort Oldest First
    await sortSelect.selectOption('oldest');
    const cardHeadingsOldest = await page.locator('h3').allTextContents();
    expect(cardHeadingsOldest).toEqual(['Zealous', 'Clemency', 'Abate']);
  });
});
