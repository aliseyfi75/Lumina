import { test, expect } from 'playwright/test';

const SCRATCH_DIR = '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch';

test('book study session sorts words from easier to harder within same due date and criteria', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    const sameDueDateMorning = now - 3600_000;
    const sameDueDateAfternoon = now - 1800_000;

    // Seed cards in reverse difficulty order (Advanced first, Beginner last)
    // so that without level-based sorting, 'perspicacious' would appear first.
    const cards = [
      {
        id: 'book-new-adv',
        word: 'perspicacious',
        mainDefinition: 'having a ready insight into and understanding of things',
        partOfSpeech: 'adjective',
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 5000,
        tags: ['Book: Frankenstein'],
        complexityLevel: 'advanced',
        complexityScore: 76,
      },
      {
        id: 'book-new-int',
        word: 'melancholy',
        mainDefinition: 'a feeling of pensive sadness, typically with no obvious cause',
        partOfSpeech: 'noun',
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 4000,
        tags: ['Book: Frankenstein'],
        complexityLevel: 'intermediate',
        complexityScore: 48,
      },
      {
        id: 'book-new-beg',
        word: 'lantern',
        mainDefinition: 'a lamp with a transparent case protecting the flame',
        partOfSpeech: 'noun',
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 1000,
        tags: ['Book: Frankenstein'],
        complexityLevel: 'beginner',
        complexityScore: 20,
      },
      // Two Learning cards with the same due date and repetition=2, seeded Advanced before Beginner
      {
        id: 'book-learn-adv',
        word: 'inexorable',
        mainDefinition: 'impossible to stop or prevent',
        partOfSpeech: 'adjective',
        status: 'Learning',
        lastReviewed: now - 86400_000,
        nextReviewDate: sameDueDateMorning,
        repetition: 2,
        createdAt: now - 9000,
        tags: ['Book: Frankenstein'],
        complexityLevel: 'advanced',
        complexityScore: 70,
      },
      {
        id: 'book-learn-beg',
        word: 'harbor',
        mainDefinition: 'a place on the coast where vessels may find shelter',
        partOfSpeech: 'noun',
        status: 'Learning',
        lastReviewed: now - 86400_000,
        nextReviewDate: sameDueDateAfternoon,
        repetition: 2,
        createdAt: now - 8000,
        tags: ['Book: Frankenstein'],
        complexityLevel: 'beginner',
        complexityScore: 22,
      },
    ];

    window.localStorage.setItem('lumina_cards_v1', JSON.stringify(cards));
    window.localStorage.setItem(
      'lumina_stats',
      JSON.stringify({
        xp: 120,
        level: 2,
        streak: 1,
        lastStudyDate: '',
        cardsMastered: 0,
        dailyProgress: 0,
        dailyGoal: 10,
        history: {},
      })
    );
  });

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');

  // Navigate to Flashcards and click Study Frankenstein from the Book Vocabulary Dock
  await page.getByRole('button', { name: 'Flashcards' }).click();
  await expect(page.getByTestId('book-vocabulary-dock')).toBeVisible();
  await page.getByRole('button', { name: 'Study Frankenstein' }).click();

  // Verify SessionConfigModal opened with Book: Frankenstein selected
  await expect(page.getByLabel('Study tag filter')).toHaveValue('Book: Frankenstein');
  await page.getByRole('button', { name: 'Start Full Session' }).click();

  // 1st card: New + Beginner ('lantern')
  await expect(page.getByRole('heading', { name: 'lantern' })).toBeVisible();
  await expect(page.getByTestId('study-card-complexity-badge').first()).toContainText('beginner');
  await page.screenshot({ path: `${SCRATCH_DIR}/feature1-study-1-beginner.png` });

  // Flip and advance to next card
  await page.getByText('Click to reveal').click();
  await page.getByRole('button', { name: /Learned/i }).click();

  // 2nd card: New + Intermediate ('melancholy')
  await expect(page.getByRole('heading', { name: 'melancholy' })).toBeVisible();
  await expect(page.getByTestId('study-card-complexity-badge').first()).toContainText('intermediate');
  await page.screenshot({ path: `${SCRATCH_DIR}/feature1-study-2-intermediate.png` });

  await page.getByText('Click to reveal').click();
  await page.getByRole('button', { name: /Learned/i }).click();

  // 3rd card: New + Advanced ('perspicacious')
  await expect(page.getByRole('heading', { name: 'perspicacious' })).toBeVisible();
  await expect(page.getByTestId('study-card-complexity-badge').first()).toContainText('advanced');
  await page.screenshot({ path: `${SCRATCH_DIR}/feature1-study-3-advanced.png` });

  await page.getByText('Click to reveal').click();
  await page.getByRole('button', { name: /Learned/i }).click();

  // 4th card: Learning (same due date, repetition=2) + Beginner ('harbor') before Advanced ('inexorable')
  await expect(page.getByRole('heading', { name: 'harbor' })).toBeVisible();
  await expect(page.getByTestId('study-card-complexity-badge').first()).toContainText('beginner');

  await page.getByText('Click to reveal').click();
  await page.getByRole('button', { name: /Learned/i }).click();

  // 5th card: Learning (same due date, repetition=2) + Advanced ('inexorable')
  await expect(page.getByRole('heading', { name: 'inexorable' })).toBeVisible();
  await expect(page.getByTestId('study-card-complexity-badge').first()).toContainText('advanced');
});
