import { test, expect } from 'playwright/test';

test('displays categories on the Home screen with Books in priority, showing progress and status for each', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 950 });

  const pantryPosts: Array<{ cards: Array<{ id: string }>; deletedCards: Record<string, number> }> = [];

  await page.route('https://getpantry.cloud/apiv1/pantry/**', async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      pantryPosts.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cards: [], chunkCount: 1 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ chunkCount: 1 }),
    });
  });

  await page.addInitScript(() => {
    const now = Date.now();
    const cards = [
      // General untagged card (Not Started)
      {
        id: 'gen-1',
        word: 'Quixotic',
        partOfSpeech: 'adjective',
        phonetic: '/kwɪkˈsɒtɪk/',
        mainDefinition: 'Extremely idealistic; unrealistic and impractical.',
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 80000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
      // Custom category: GRE Prep (Completed - 100%)
      {
        id: 'gre-1',
        word: 'Laconic',
        partOfSpeech: 'adjective',
        phonetic: '/ləˈkɒnɪk/',
        mainDefinition: 'Using very few words.',
        tags: ['GRE Prep'],
        status: 'Mastered',
        lastReviewed: now - 10000,
        createdAt: now - 70000,
        repetition: 5,
        nextReviewDate: now + 86400000 * 30,
      },
      // Book 1: Frankenstein (In Progress - 1 Mastered, 1 Learning, 1 New -> 50%)
      {
        id: 'book-frank-1',
        word: 'Lugubrious',
        partOfSpeech: 'adjective',
        phonetic: '/luːˈɡuːbɹi.əs/',
        mainDefinition: 'Looking or sounding sad and dismal.',
        example: 'A lugubrious shadow fell across the glaciers.',
        tags: ['Book: Frankenstein'],
        status: 'Mastered',
        lastReviewed: now - 5000,
        createdAt: now - 40000,
        repetition: 5,
        nextReviewDate: now + 86400000 * 30,
      },
      {
        id: 'book-frank-2',
        word: 'Ineffable',
        partOfSpeech: 'adjective',
        phonetic: '/ɪnˈɛfəbəl/',
        mainDefinition: 'Too great or extreme to be expressed in words.',
        example: 'My soul was filled with an ineffable sense of wonder.',
        tags: ['Book: Frankenstein'],
        status: 'Learning',
        lastReviewed: now - 5000,
        createdAt: now - 39000,
        repetition: 1,
        nextReviewDate: now - 1000,
      },
      {
        id: 'book-frank-3',
        word: 'Pernicious',
        partOfSpeech: 'adjective',
        phonetic: '/pərˈnɪʃəs/',
        mainDefinition: 'Having a harmful effect in a gradual or subtle way.',
        example: 'Such pernicious ambition had led my inquiries.',
        tags: ['Book: Frankenstein'],
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 38000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
      // Book 2: Moby-Dick (Not Started - 2 New -> 0%)
      {
        id: 'book-moby-1',
        word: 'Hypochondriacal',
        partOfSpeech: 'adjective',
        mainDefinition: 'Afflicted with extreme depression of mind or spirits.',
        tags: ['Book: Moby-Dick'],
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 10000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
      {
        id: 'book-moby-2',
        word: 'Inscrutable',
        partOfSpeech: 'adjective',
        mainDefinition: 'Impossible to understand or interpret.',
        tags: ['Book: Moby-Dick'],
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 9000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
    ];
    localStorage.setItem('lumina_cards_v1', JSON.stringify(cards));
    localStorage.setItem(
      'lumina_cloud_config',
      JSON.stringify({ pantryId: '11111111-2222-3333-4444-555555555555' })
    );
  });

  await page.goto('/#/');

  const categoriesSection = page.getByTestId('home-categories-section');
  await expect(categoriesSection).toBeVisible();
  await expect(categoriesSection.getByRole('heading', { name: 'Categories & Books' })).toBeVisible();

  const categoryCards = categoriesSection.getByTestId('home-category-card');
  await expect(categoryCards).toHaveCount(4);

  // Verify priority order: Books first (Moby-Dick, Frankenstein), then custom tag (GRE Prep), then General Vocabulary
  const firstKind = await categoryCards.nth(0).getAttribute('data-category-kind');
  const secondKind = await categoryCards.nth(1).getAttribute('data-category-kind');
  const thirdKind = await categoryCards.nth(2).getAttribute('data-category-kind');
  const fourthKind = await categoryCards.nth(3).getAttribute('data-category-kind');

  expect(firstKind).toBe('book');
  expect(secondKind).toBe('book');
  expect(thirdKind).toBe('tag');
  expect(fourthKind).toBe('general');

  // Verify Moby-Dick (Not Started, 0%)
  await expect(categoryCards.nth(0)).toContainText('Moby-Dick');
  await expect(categoryCards.nth(0).getByTestId('category-status-badge')).toHaveText('Not Started');
  await expect(categoryCards.nth(0).getByTestId('category-progress-pct')).toHaveText('0%');

  // Verify Frankenstein (In Progress, 50%)
  await expect(categoryCards.nth(1)).toContainText('Frankenstein');
  await expect(categoryCards.nth(1).getByTestId('category-status-badge')).toHaveText('In Progress');
  await expect(categoryCards.nth(1).getByTestId('category-progress-pct')).toHaveText('50%');

  // Verify GRE Prep (Completed, 100%)
  await expect(categoryCards.nth(2)).toContainText('GRE Prep');
  await expect(categoryCards.nth(2).getByTestId('category-status-badge')).toHaveText('Completed');
  await expect(categoryCards.nth(2).getByTestId('category-progress-pct')).toHaveText('100%');

  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_home_categories.png',
  });

  // Clicking "Study Frankenstein" opens SessionConfigModal pre-filtered to "Book: Frankenstein"
  await categoriesSection.getByRole('button', { name: 'Study Frankenstein' }).click();
  const tagSelect = page.getByLabel('Study tag filter');
  await expect(tagSelect).toBeVisible();
  await expect(tagSelect).toHaveValue('Book: Frankenstein');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Test removing a book (Moby-Dick) from the Home page with confirmation popup
  await categoriesSection.getByRole('button', { name: 'Remove Moby-Dick' }).click();
  const confirmModal = page.getByTestId('confirm-delete-book-modal');
  await expect(confirmModal).toBeVisible();
  await expect(confirmModal).toContainText('Remove “Moby-Dick”?');
  await expect(confirmModal).toContainText('2 words');

  await page.waitForTimeout(200);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_remove_book_confirm.png',
  });

  await confirmModal.getByTestId('confirm-delete-book-btn').click();
  await expect(confirmModal).toBeHidden();
  await expect(categoryCards).toHaveCount(3);
  await expect(categoriesSection).not.toContainText('Moby-Dick');

  // Verify Pantry received an immediate POST with Moby-Dick flashcards removed and tombstoned
  await expect.poll(() => pantryPosts.length, { timeout: 2000 }).toBeGreaterThanOrEqual(1);
  const latestPostAfterMoby = pantryPosts[pantryPosts.length - 1];
  expect(latestPostAfterMoby.cards.some(c => c.id === 'book-moby-1' || c.id === 'book-moby-2')).toBe(false);
  expect(latestPostAfterMoby.deletedCards['book-moby-1']).toBeGreaterThan(0);
  expect(latestPostAfterMoby.deletedCards['book-moby-2']).toBeGreaterThan(0);

  // Navigate to Flashcards page and test removing a book (Frankenstein) from Book Vocabulary Dock
  const postsBeforeFrank = pantryPosts.length;
  await page.goto('/#/flashcards');
  const dock = page.getByTestId('book-vocabulary-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Frankenstein');

  await dock.getByRole('button', { name: 'Remove Frankenstein' }).click();
  const flashcardsConfirmModal = page.getByTestId('confirm-delete-book-modal');
  await expect(flashcardsConfirmModal).toBeVisible();
  await expect(flashcardsConfirmModal).toContainText('Remove “Frankenstein”?');
  await expect(flashcardsConfirmModal).toContainText('3 words');

  await flashcardsConfirmModal.getByTestId('confirm-delete-book-btn').click();
  await expect(flashcardsConfirmModal).toBeHidden();
  await expect(dock).toBeHidden();
  await expect(page.getByText('Lugubrious')).toBeHidden();

  // Verify Pantry received an immediate POST with Frankenstein flashcards removed and tombstoned
  await expect.poll(() => pantryPosts.length, { timeout: 2000 }).toBeGreaterThan(postsBeforeFrank);
  const latestPostAfterFrank = pantryPosts[pantryPosts.length - 1];
  expect(
    latestPostAfterFrank.cards.some(
      c => c.id === 'book-frank-1' || c.id === 'book-frank-2' || c.id === 'book-frank-3'
    )
  ).toBe(false);
  expect(latestPostAfterFrank.deletedCards['book-frank-1']).toBeGreaterThan(0);
  expect(latestPostAfterFrank.deletedCards['book-frank-2']).toBeGreaterThan(0);
  expect(latestPostAfterFrank.deletedCards['book-frank-3']).toBeGreaterThan(0);
});
