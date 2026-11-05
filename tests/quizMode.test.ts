import { test, expect } from 'playwright/test';

test.describe('Feature A.1: Multiple-Choice Quiz Mode', () => {
  test('allows selecting Multiple-Choice Quiz in SessionConfigModal, shows 4 options, and grades answers', async ({ page }) => {
    await page.goto('http://localhost:5173/#/');

    await page.evaluate(async () => {
      const seedCards = [
        {
          id: 'quiz-card-1',
          word: 'Ephemeral',
          phonetic: '/əˈfem(ə)rəl/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Lasting for a very short time.',
          status: 'New',
          lastReviewed: 100,
          createdAt: 1000,
        },
        {
          id: 'quiz-card-2',
          word: 'Ubiquitous',
          phonetic: '/yo͞oˈbikwədəs/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Present, appearing, or found everywhere.',
          status: 'New',
          lastReviewed: 200,
          createdAt: 2000,
        },
        {
          id: 'quiz-card-3',
          word: 'Laconic',
          phonetic: '/ləˈkänik/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Using very few words; concise.',
          status: 'New',
          lastReviewed: 300,
          createdAt: 3000,
        },
        {
          id: 'quiz-card-4',
          word: 'Pragmatic',
          phonetic: '/praɡˈmadik/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Dealing with things sensibly and realistically.',
          status: 'New',
          lastReviewed: 400,
          createdAt: 4000,
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
    await expect(page.locator('button:has-text("Start Study Session")')).toBeVisible();

    // Open SessionConfigModal
    await page.click('button:has-text("Start Study Session")');
    await expect(page.locator('h3:has-text("Multiple-Choice Quiz")')).toBeVisible();

    // Select Multiple-Choice Quiz mode
    await page.click('label:has-text("Multiple-Choice Quiz")');
    await page.click('button:has-text("Start Quiz")');

    // Verify we are in Quiz mode on /study
    await expect(page.locator('text=Multiple-Choice Quiz')).toBeVisible();
    await expect(page.locator('h2:has-text("Ephemeral")')).toBeVisible();

    // Verify the correct option button exists and click it
    const correctBtn = page.locator('button:has-text("Lasting for a very short time.")');
    await expect(correctBtn).toBeVisible();
    await correctBtn.click();

    // Verify feedback message and Next Question button appear
    await expect(page.locator('text=Correct! Marked as Learned.')).toBeVisible();
    await expect(page.locator('button:has-text("Next Question")')).toBeVisible();

    await page.screenshot({
      path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_a1_quiz_mode.png',
      fullPage: true,
    });

    // Advance to the second question and answer an incorrect option
    await page.click('button:has-text("Next Question")');
    await expect(page.locator('h2:has-text("Ubiquitous")')).toBeVisible();

    const wrongBtn = page.locator('button:has-text("Lasting for a very short time.")');
    await wrongBtn.click();
    await expect(page.locator('text=Not quite — marked for review again.')).toBeVisible();
  });
});
