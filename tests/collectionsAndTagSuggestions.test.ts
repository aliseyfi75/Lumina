import { test, expect } from 'playwright/test';

test('renders nested Books folder collection without #Book: prefix and suggests clickable related tags when adding words in Dictionary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 920 });

  // Mock dictionary lookup for "Melancholy"
  await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
    const word = decodeURIComponent(route.request().url().split('/').pop() || '').toLowerCase();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          word: word.charAt(0).toUpperCase() + word.slice(1),
          phonetic: '/ˈmɛlənkɒli/',
          origin: 'Middle English: from Old French melancolie, via Late Latin from Greek melankholia.',
          meanings: [
            {
              partOfSpeech: 'noun',
              definitions: [
                {
                  definition: 'A feeling of pensive sadness, typically with no obvious cause.',
                  example: 'An air of melancholy surrounded the old castle.',
                },
              ],
            },
          ],
        },
      ]),
    });
  });

  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', async (route) => {
    await route.fulfill({ status: 404, body: '{}' });
  });

  await page.route('https://api.datamuse.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.addInitScript(() => {
    const now = Date.now();
    const initialCards = [
      {
        id: 'got-1',
        word: 'Usurper',
        partOfSpeech: 'noun',
        phonetic: '/juːˈzɜːpə/',
        mainDefinition: 'A person who takes a position of power or importance illegally or by force.',
        example: 'Robert Baratheon was known across the Narrow Sea as the Usurper.',
        tags: ['Book: A Game of Thrones'],
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 50000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
      {
        id: 'got-2',
        word: 'Craven',
        partOfSpeech: 'adjective',
        phonetic: '/ˈkɹeɪvən/',
        mainDefinition: 'Contemptibly lacking in courage; cowardly.',
        example: 'No brother of the Night’s Watch could afford to be craven.',
        tags: ['Book: A Game of Thrones'],
        status: 'Learning',
        lastReviewed: now - 10000,
        createdAt: now - 40000,
        repetition: 1,
        nextReviewDate: now - 1000,
      },
      {
        id: 'kite-1',
        word: 'Atone',
        partOfSpeech: 'verb',
        phonetic: '/əˈtoʊn/',
        mainDefinition: 'Make amends or reparation for a wrong or error.',
        example: 'There is a way to be good again, a way to atone.',
        tags: ['Book: Kite Runner'],
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 30000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
      {
        id: 'phil-1',
        word: 'Dialectical',
        partOfSpeech: 'adjective',
        phonetic: '/ˌdaɪəˈlɛktɪkəl/',
        mainDefinition: 'Relating to the logical discussion of ideas and opinions.',
        tags: ['Philosophy'],
        status: 'Mastered',
        lastReviewed: now - 5000,
        createdAt: now - 20000,
        repetition: 5,
        nextReviewDate: now + 86400000 * 30,
      },
      {
        id: 'gre-1',
        word: 'Obsequious',
        partOfSpeech: 'adjective',
        phonetic: '/əbˈsiːkwiəs/',
        mainDefinition: 'Obedient or attentive to an excessive or servile degree.',
        tags: ['GRE Prep'],
        status: 'New',
        lastReviewed: 0,
        createdAt: now - 10000,
        repetition: 0,
        nextReviewDate: now - 1000,
      },
    ];
    localStorage.setItem('lumina_cards_v1', JSON.stringify(initialCards));
  });

  await page.goto('/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  // 1. Verify Nested Folder Architecture in Collections bar
  const collectionsRegion = page.getByLabel('Tag filter pills');
  await expect(collectionsRegion).toBeVisible();

  // Top-level has Books folder pill (3 total book words) and flat tags (#GRE Prep, #Philosophy)
  const booksFolderBtn = collectionsRegion.getByTestId('collection-folder-Books');
  await expect(booksFolderBtn).toBeVisible();
  await expect(booksFolderBtn).toContainText('Books');
  await expect(booksFolderBtn).toContainText('(3)');

  // Nested Books subfolder bar shows individual books WITHOUT "#Book:" prefix
  const booksSubfolder = collectionsRegion.getByTestId('collection-subfolder-Books');
  await expect(booksSubfolder).toBeVisible();

  const bookPills = booksSubfolder.getByTestId('collection-book-pill');
  await expect(bookPills).toHaveCount(2);
  await expect(bookPills.nth(0)).toHaveText('A Game of Thrones (2)');
  await expect(bookPills.nth(1)).toHaveText('Kite Runner (1)');

  // Ensure "#Book:" is NOT rendered anywhere in the Collections bar or card badges
  await expect(collectionsRegion).not.toContainText('#Book:');
  await expect(page.getByTestId('card-tag-badge').first()).not.toContainText('#Book:');

  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_nested_collections.png',
  });

  // Clicking "A Game of Thrones (2)" filters deck to its 2 cards
  await bookPills.nth(0).click();
  await expect(page.getByRole('heading', { name: 'Usurper' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Craven' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atone' })).toBeHidden();

  // Clicking "All Books (3)" shows all 3 book cards across both books
  await booksSubfolder.getByTestId('collection-folder-all-Books').click();
  await expect(page.getByRole('heading', { name: 'Usurper' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atone' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Obsequious' })).toBeHidden();

  // 2. Navigate to Dictionary and test Tag Suggestions when typing a tag name
  await page.goto('/#/dictionary');
  const searchInput = page.getByPlaceholder('Lookup a word...');
  await searchInput.fill('Melancholy');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByRole('heading', { name: 'Melancholy' })).toBeVisible();

  const tagSelector = page.getByTestId('tag-selector-input');
  await expect(tagSelector).toBeVisible();

  const tagInput = page.getByLabel('Dictionary word tags');
  // Type partial query "gam" -> suggests related book tag "Books / A Game of Thrones"
  await tagInput.fill('gam');

  const suggestionPills = tagSelector.getByTestId('tag-suggestion-pill');
  await expect(suggestionPills.first()).toContainText('A Game of Thrones');

  await page.waitForTimeout(200);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_dictionary_tag_suggestions.png',
  });

  // Click the suggested tag to select it
  await suggestionPills.first().click();
  const selectedChips = tagSelector.getByTestId('selected-tag-chip');
  await expect(selectedChips).toHaveCount(1);
  await expect(selectedChips.first()).toContainText('Books /');
  await expect(selectedChips.first()).toContainText('A Game of Thrones');

  // Type partial query "phil" -> suggests "#Philosophy"
  await tagInput.fill('phil');
  await expect(suggestionPills.first()).toContainText('#Philosophy');
  await suggestionPills.first().click();
  await expect(selectedChips).toHaveCount(2);

  // Add the word to Flashcards and verify the selected tags were attached
  await page.getByRole('button', { name: /Add to Flashcards/i }).click();
  await expect(page.getByRole('button', { name: /Added to Deck/i })).toBeVisible();

  await page.goto('/#/flashcards');
  await expect(collectionsRegion.getByTestId('collection-folder-Books')).toContainText('(4)');
  await expect(booksSubfolder.getByTestId('collection-book-pill').first()).toHaveText('A Game of Thrones (3)');
});
