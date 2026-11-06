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
  hypochondriacal: {
    pos: 'adjective',
    def: 'Afflicted with extreme depression of mind or spirits often centered on imaginary physical ailments.',
    phonetic: '/ˌhaɪpəkɒnˈdɹaɪəkəl/',
    freq: '0.18',
  },
  circumambulate: {
    pos: 'verb',
    def: 'To walk all the way around something, especially ritualistically.',
    phonetic: '/ˌsɜːkəmˈæmbjʊleɪt/',
    freq: '0.12',
  },
  prosperous: {
    pos: 'adjective',
    def: 'Successful in material terms; flourishing financially.',
    phonetic: '/ˈpɹɒspəɹəs/',
    freq: '6.20',
  },
  ignominious: {
    pos: 'adjective',
    def: 'Deserving or causing public disgrace or shame.',
    phonetic: '/ˌɪɡnəˈmɪni.əs/',
    freq: '0.35',
  },
  redemption: {
    pos: 'noun',
    def: 'The action of saving or being saved from sin, error, or evil.',
    phonetic: '/ɹɪˈdɛmpʃən/',
    freq: '5.40',
  },
  trepidation: {
    pos: 'noun',
    def: 'A feeling of fear or agitation about something that may happen.',
    phonetic: '/ˌtɹɛpɪˈdeɪʃən/',
    freq: '1.90',
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

  // Mock Open Library & Wikisource in Test 1 so 'Dune' returns empty public domain matches
  await page.route('https://openlibrary.org/search.json**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ docs: [] }),
    });
  });

  await page.route('https://en.wikisource.org/w/api.php**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query: { search: [] } }),
    });
  });

  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query: { search: [] } }),
    });
  });

  await page.route('https://www.googleapis.com/books/v1/volumes**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.route('https://api.datamuse.com/sug**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
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

  // Start the study session for Dune and verify the Book Sentence Hint before flipping the card
  await page.getByRole('button', { name: /Start Full Session/i }).click();

  const hintBtn = page.getByTestId('book-hint-button');
  await expect(hintBtn).toBeVisible();
  await expect(hintBtn).toContainText('Show Book Hint');

  // Click "Show Book Hint" without flipping the card
  await hintBtn.click();

  const hintContent = page.getByTestId('book-hint-content');
  await expect(hintContent).toBeVisible();
  await expect(hintContent).toContainText('From Dune');
  await expect(hintContent.locator('mark')).toBeVisible();

  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_study_book_hint.png',
  });
});

test('supports backup catalog providers when Gutendex fails and shows fuzzy Similar Books when searching with typos', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  // Simulate primary Gutendex API completely failing (502 Bad Gateway)
  await page.route('https://gutendex.com/books**', async (route) => {
    await route.fulfill({
      status: 502,
      body: 'Bad Gateway',
    });
  });

  // Simulate Open Library backup provider returning Moby-Dick
  await page.route('https://openlibrary.org/search.json**', async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (q.includes('moby')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          docs: [
            {
              key: '/works/OL102749W',
              title: 'Moby-Dick; or, The Whale',
              author_name: ['Herman Melville'],
              id_project_gutenberg: ['2701'],
              cover_i: 8231996,
              public_scan_b: true,
              first_publish_year: 1851,
            },
          ],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ docs: [] }),
      });
    }
  });

  await page.route('https://en.wikisource.org/w/api.php**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query: { search: [] } }),
    });
  });

  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query: { search: [] } }),
    });
  });

  await page.route('https://www.googleapis.com/books/v1/volumes**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.route('https://api.datamuse.com/sug**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
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

  // Block external CORS proxies & direct Gutenberg cache so fallback excerpt from Classic Catalog is verified immediately
  await page.route('https://www.gutenberg.org/**', async (route) => {
    await route.fulfill({ status: 404, body: 'Not Found' });
  });
  await page.route('https://corsproxy.io/**', async (route) => {
    await route.fulfill({ status: 503, body: 'Unavailable' });
  });
  await page.route('https://api.codetabs.com/**', async (route) => {
    await route.fulfill({ status: 503, body: 'Unavailable' });
  });
  await page.route('https://api.allorigins.win/**', async (route) => {
    await route.fulfill({ status: 503, body: 'Unavailable' });
  });

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
  await page.getByRole('button', { name: /Prepare for a Book/i }).click();

  // 1. Search with a typo ("Mobi dik") -> should display "Similar Books You Might Mean"
  await page.getByLabel('Search book title').fill('Mobi dik');
  await page.getByRole('button', { name: /Find Book/i }).click();

  const similarSection = page.getByTestId('similar-books-section');
  await expect(similarSection).toBeVisible();
  await expect(similarSection.getByText('Moby-Dick; or, The Whale')).toBeVisible();
  await expect(similarSection.getByTestId('similarity-badge').first()).toContainText('% similar');

  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_book_similar_matches.png',
  });

  // 2. Search "Moby dick" directly even while Gutendex is down -> finds exact match via backup catalog
  await page.getByLabel('Search book title').fill('Moby dick');
  await page.getByRole('button', { name: /Find Book/i }).click();

  const exactSection = page.getByTestId('exact-books-section');
  await expect(exactSection).toBeVisible();
  await expect(exactSection.getByText('Moby-Dick; or, The Whale')).toBeVisible();

  // Extract words from Moby-Dick
  await exactSection.getByRole('button', { name: /Extract Words/i }).first().click();

  await expect(page.getByText('Hypochondriacal', { exact: true })).toBeVisible();
  await expect(page.getByText('Circumambulate', { exact: true })).toBeVisible();

  // Verify Beginner, Intermediate, and Advanced complexity badges and filters are rendered
  const previewComplexityFilter = page.getByTestId('preview-complexity-filter');
  await expect(previewComplexityFilter).toBeVisible();
  await expect(page.getByTestId('word-complexity-badge').first()).toBeVisible();

  // Test filtering by Advanced complexity level
  await page.getByTestId('complexity-filter-advanced').click();
  await expect(page.getByText('Hypochondriacal', { exact: true })).toBeVisible();

  // Switch back to All Levels
  await page.getByTestId('complexity-filter-all').click();
  await expect(page.getByText('Prosperous', { exact: true })).toBeVisible();

  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/feature_book_complexity_levels.png',
  });

  // 3. Go back to book search and search for a modern book ("Kite Runner")
  await page.getByRole('button', { name: /Back to book search/i }).click();
  await page.getByLabel('Search book title').fill('Kite Runner');
  await page.getByRole('button', { name: /Find Book/i }).click();

  await expect(exactSection.getByText('The Kite Runner')).toBeVisible();
  await expect(exactSection.getByText('Khaled Hosseini')).toBeVisible();

  await exactSection.getByRole('button', { name: /Extract Words/i }).first().click();
  await expect(page.getByText('Ignominious', { exact: true })).toBeVisible();
  await expect(page.getByText('Redemption', { exact: true })).toBeVisible();
  await expect(page.getByText('Trepidation', { exact: true })).toBeVisible();
});
