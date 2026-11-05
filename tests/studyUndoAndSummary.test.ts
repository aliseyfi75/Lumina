import { test, expect } from 'playwright/test';

test.describe('Feature A.2: Undo Last Review & Rich Session Summary', () => {
  test('supports undoing a review and displays rich session summary with missed-card retry', async ({ page }) => {
    await page.goto('http://localhost:5173/#/');

    await page.evaluate(async () => {
      const seedCards = [
        {
          id: 'undo-card-1',
          word: 'Alacrity',
          phonetic: '/əˈlakrədē/',
          partOfSpeech: 'noun',
          mainDefinition: 'Brisk and cheerful readiness.',
          status: 'New',
          lastReviewed: 100,
          createdAt: 1000,
        },
        {
          id: 'undo-card-2',
          word: 'Capricious',
          phonetic: '/kəˈpriSHəs/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Given to sudden and unaccountable changes of mood or behavior.',
          status: 'New',
          lastReviewed: 200,
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

    await page.goto('http://localhost:5173/#/study');
    await page.reload();

    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alacrity' })).toBeVisible();

    // Undo button should be disabled initially
    const undoBtn = page.getByRole('button', { name: 'Undo last review' });
    await expect(undoBtn).toBeDisabled();

    // Flip and grade card 1 as Mastered (ArrowRight)
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    await page.keyboard.press('ArrowRight');

    // Now on card 2 / 2
    await expect(page.getByText('2 / 2')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Capricious' })).toBeVisible();
    await expect(undoBtn).toBeEnabled();

    // Click Undo to step back to card 1 / 2 and restore its 'New' status
    await undoBtn.click();
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alacrity' })).toBeVisible();

    const restoredStatus = await page.evaluate(() => {
      const cards = JSON.parse(localStorage.getItem('lumina_cards_v1') || '[]');
      return cards.find((c: any) => c.id === 'undo-card-1')?.status;
    });
    expect(restoredStatus).toBe('New');

    // Now grade card 1 as Learned (ArrowUp) and card 2 as Again (ArrowLeft)
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    await page.keyboard.press('ArrowUp');

    await expect(page.getByText('2 / 2')).toBeVisible();
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    await page.keyboard.press('ArrowLeft');

    // Verify Rich Session Summary screen appears
    await expect(page.getByRole('heading', { name: 'Session Complete!' })).toBeVisible();
    await expect(page.getByText('You reviewed 2 cards with 50% accuracy.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review Missed Cards (1)' })).toBeVisible();
    await page.waitForTimeout(600);

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_a2_summary.png',
      fullPage: true,
    });

    // Click "Review Missed Cards (1)" and verify a 1-card session starts with Capricious
    await page.getByRole('button', { name: 'Review Missed Cards (1)' }).click();
    await expect(page.getByText('1 / 1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Capricious' })).toBeVisible();
  });
});
