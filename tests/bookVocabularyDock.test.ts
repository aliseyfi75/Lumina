import { test, expect } from 'playwright/test';

const SAMPLE_FRANKENSTEIN_TEXT = `
*** START OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN ***
Letter 1
To Mrs. Saville, England.

Victor and Elizabeth walked through the streets of Geneva on a warm evening.
A lugubrious shadow fell across the glaciers as the storm approached the mountain peak.
My soul was filled with an ineffable sense of wonder and terror at the spectacle before me.
Such pernicious ambition had led my inquiries into the hidden secrets of nature and life.
*** END OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN ***
`;

const SAMPLE_DUNE_UPLOAD_TEXT = `
The desert wind blew across the dunes of Arrakis while Paul watched the horizon.
His sudden prescience revealed a labyrinth of shimmering possibilities stretching across time.
The old reverend mother maintained an inscrutable expression throughout the entire ordeal.
`;

const MOCK_DEFINITIONS: Record<string, { pos: string; def: string; phonetic: string; freq: string }> = {
  lugubrious: {
    pos: 'adjective',
    def: 'Looking or sounding sad, mournful, and dismal.',
    phonetic: '/luːˈɡuːbɹi.əs/',
    freq: '0.45',
  },
  ineffable: {
    pos: 'adjective',
    def: 'Too great or extreme to be expressed or described in words.',
    phonetic: '/ɪnˈɛfəbəl/',
    freq: '0.82',
  },
  pernicious: {
    pos: 'adjective',
    def: 'Having a harmful effect, especially in a gradual or subtle way.',
    phonetic: '/pərˈnɪʃəs/',
    freq: '1.15',
  },
  prescience: {
    pos: 'noun',
    def: 'The fact of knowing something in advance; foreknowledge.',
    phonetic: '/ˈpɹɛʃəns/',
    freq: '0.62',
  },
  inscrutable: {
    pos: 'adjective',
    def: 'Impossible to understand or interpret.',
    phonetic: '/ɪnˈskɹuːtəbəl/',
    freq: '0.95',
  },
};

test('supports Tier 1 Gutenberg book vocabulary extraction with real book sentences and Tier 2 file upload fallback when book is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  // Mock Gutendex catalog API
  await page.route('https://gutendex.com/books**', async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').toLowerCase();

    if (search.includes('frankenstein')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          results: [
            {
              id: 84,
              title: 'Frankenstein; Or, The Modern Prometheus',
              authors: [{ name: 'Shelley, Mary Wollstonecraft' }],
              formats: {
                'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/84.txt.utf-8',
              },
            },
          ],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, results: [] }),
      });
    }
  });

  // Mock Gutenberg text download
  await page.route('https://www.gutenberg.org/ebooks/84.txt.utf-8', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: SAMPLE_FRANKENSTEIN_TEXT,
    });
  });

  // Mock Datamuse frequency & fallback defs
  await page.route('https://api.datamuse.com/words**', async (route) => {
    const url = new URL(route.request().url());
    const sp = (url.searchParams.get('sp') || '').toLowerCase();
    const entry = MOCK_DEFINITIONS[sp];

    if (entry) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            word: sp,
            score: 1000,
            tags: [`f:${entry.freq}`, `pron:${entry.phonetic}`],
            defs: [`adj\t${entry.def}`],
          },
        ]),
      });
    } else {
      // High frequency for any non-target word so only the complex words are selected
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            word: sp,
            score: 100,
            tags: ['f:45.0'],
          },
        ]),
      });
    }
  });

  // Mock primary dictionary API
  await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
    const word = decodeURIComponent(route.request().url().split('/').pop() || '').toLowerCase();
    const entry = MOCK_DEFINITIONS[word];
    if (!entry) {
      await route.fulfill({ status: 404, body: 'Not Found' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          word,
          phonetic: entry.phonetic,
          meanings: [
            {
              partOfSpeech: entry.pos,
              definitions: [
                {
                  definition: entry.def,
                  example: 'Generic dictionary example that should be overridden by book sentence.',
                },
              ],
            },
          ],
        },
      ]),
    });
  });

  // Mock Wikipedia image lookup
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', async (route) => {
    await route.fulfill({ status: 404, body: '{}' });
  });

  // Seed one initial card so the deck view loads immediately
  await page.addInitScript(() => {
    const initialCards = [
      {
        id: 'seed-1',
        word: 'Ephemeral',
        partOfSpeech: 'adjective',
        phonetic: '/əˈfɛm(ə)ɹəl/',
        mainDefinition: 'Lasting for a very short time.',
        status: 'New',
        lastReviewed: 0,
        createdAt: Date.now() - 50000,
        repetition: 0,
        nextReviewDate: Date.now() - 1000,
      },
    ];
    localStorage.setItem('lumina_cards_v1', JSON.stringify(initialCards));
  });

  await page.goto('/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  // 1. Open "Prepare for a Book" modal (Tier 1)
  await page.getByRole('button', { name: /Prepare for a Book/i }).click();
  await expect(page.getByRole('heading', { name: 'Prepare for a Book' })).toBeVisible();

  await page.getByLabel('Search book title').fill('Frankenstein');
  await page.getByRole('button', { name: /Find Book/i }).click();

  // Verify Gutenberg result appears
  await expect(page.getByText('Mary Wollstonecraft Shelley')).toBeVisible();
  await page.getByRole('button', { name: /Extract Words/i }).click();

  // Verify extracted complex words & real book sentences appear in preview
  await expect(page.getByText('Lugubrious', { exact: true })).toBeVisible();
  await expect(page.getByText('Ineffable', { exact: true })).toBeVisible();
  await expect(page.getByText('Pernicious', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/A lugubrious shadow fell across the glaciers/i)
  ).toBeVisible();
  await expect(
    page.getByText(/My soul was filled with an ineffable sense of wonder/i)
  ).toBeVisible();

  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_book_prep_preview.png',
  });

  // Confirm adding the 3 extracted words to the Book Vocabulary Dock
  await page.getByRole('button', { name: /Add 3 Words to Book Dock/i }).click();

  // Verify the Book Vocabulary Dock appears with Frankenstein
  const dock = page.getByTestId('book-vocabulary-dock');
  await expect(dock).toBeVisible();
  await expect(dock.getByRole('heading', { name: 'Frankenstein' })).toBeVisible();
  await expect(dock.getByText(/3 complex words/i)).toBeVisible();

  await page.waitForTimeout(400);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_book_dock.png',
  });

  // Verify the card in the deck has the actual book sentence on its back
  await expect(page.getByText(/“A lugubrious shadow fell across the glaciers/i).or(
    page.getByText(/A lugubrious shadow fell across the glaciers/i)
  )).toBeAttached();

  // 2. Test Tier 1 -> Tier 2 fallback when book is not found in Gutenberg
  await dock.getByRole('button', { name: /Add Book/i }).click();
  await page.getByLabel('Search book title').fill('Dune');
  await page.getByRole('button', { name: /Find Book/i }).click();

  const fallbackPrompt = page.getByTestId('book-not-found-upload-prompt');
  await expect(fallbackPrompt).toBeVisible();
  await expect(fallbackPrompt).toContainText('“Dune” wasn’t found in the public domain catalog');

  // Upload a .txt file for Dune (Tier 2)
  const fileInput = page.locator('input[type="file"][aria-label="Upload book file"]');
  await fileInput.setInputFiles({
    name: 'dune.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(SAMPLE_DUNE_UPLOAD_TEXT, 'utf-8'),
  });

  // Verify words and sentences extracted from the uploaded book file
  await expect(page.getByText('Prescience', { exact: true })).toBeVisible();
  await expect(page.getByText('Inscrutable', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/His sudden prescience revealed a labyrinth/i)
  ).toBeVisible();

  await page.getByRole('button', { name: /Add 2 Words to Book Dock/i }).click();

  // Both books now appear in the Book Vocabulary Dock
  await expect(dock.getByRole('heading', { name: 'Frankenstein' })).toBeVisible();
  await expect(dock.getByRole('heading', { name: 'Dune' })).toBeVisible();

  // Clicking "Study Book" on Dune opens SessionConfigModal pre-filtered to #Book: Dune
  await dock.getByRole('button', { name: 'Study Dune' }).click();

  const tagSelect = page.getByLabel('Study tag filter');
  await expect(tagSelect).toBeVisible();
  await expect(tagSelect).toHaveValue('Book: Dune');
});
