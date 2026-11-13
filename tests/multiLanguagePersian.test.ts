import { test, expect } from 'playwright/test';
import {
  resolveMeaningDisplay,
  sanitizeTranslations,
  mergeTranslations,
  cardNeedsPersianBackfill,
} from '../utils/languageUtils';
import {
  formatPersianMeaning,
  extractPersianFromSenseTranslations,
} from '../services/translationService';
import { mergeWordEntries } from '../services/dictionaryService';
import type { WordEntry } from '../types';

test.describe('Multi-Language Dictionary & Persian (Farsi) Unit Tests', () => {
  test('resolveMeaningDisplay handles English, Persian (with fallback), and Both (English first, Persian second)', () => {
    const english = 'Lasting for a very short time; fleeting or transitory.';
    const translations = { fa: 'زودگذر، ناپایدار — ماندگار برای مدت بسیار کوتاه' };

    // 1. English ('en')
    const enRes = resolveMeaningDisplay(english, translations, 'en');
    expect(enRes.showEnglish).toBe(true);
    expect(enRes.showPersian).toBe(false);
    expect(enRes.englishText).toBe(english);

    // 2. Persian ('fa') when Persian translation exists
    const faRes = resolveMeaningDisplay(english, translations, 'fa');
    expect(faRes.showEnglish).toBe(false);
    expect(faRes.showPersian).toBe(true);
    expect(faRes.persianText).toBe(translations.fa);
    expect(faRes.isFallbackToEnglish).toBe(false);

    // 3. Persian ('fa') clean fallback to English when Persian is not yet available
    const faFallback = resolveMeaningDisplay(english, undefined, 'fa');
    expect(faFallback.showEnglish).toBe(true);
    expect(faFallback.showPersian).toBe(false);
    expect(faFallback.englishText).toBe(english);
    expect(faFallback.isFallbackToEnglish).toBe(true);

    // 4. Both ('both') -> shows BOTH English and Persian
    const bothRes = resolveMeaningDisplay(english, translations, 'both');
    expect(bothRes.showEnglish).toBe(true);
    expect(bothRes.showPersian).toBe(true);
    expect(bothRes.englishText).toBe(english);
    expect(bothRes.persianText).toBe(translations.fa);
  });

  test('formatPersianMeaning and extractPersianFromSenseTranslations normalize and combine equivalents + sense meaning', () => {
    const formatted = formatPersianMeaning(
      ['زودگذر', 'ناپايدار', 'زودگذر'],
      'ماندگار برای مدت بسیار کوتاه.'
    );
    // Normalizes Arabic Yeh (ي -> ی) and deduplicates equivalents
    expect(formatted).toBe('زودگذر، ناپایدار — ماندگار برای مدت بسیار کوتاه');

    const extracted = extractPersianFromSenseTranslations([
      { language: { code: 'fr', name: 'French' }, word: 'éphémère' },
      { language: { code: 'fa', name: 'Persian' }, word: 'زودگذر' },
      { language: { code: 'pes', name: 'Western Persian' }, words: ['فانی'] },
    ]);
    expect(extracted).toEqual(['زودگذر', 'فانی']);

    expect(sanitizeTranslations({ fa: '  پایدار  ' })).toEqual({ fa: 'پایدار' });
    expect(sanitizeTranslations({ fa: '   ' })).toBeUndefined();
    expect(mergeTranslations({ fa: 'قدیمی' }, { fa: 'جدید' }, true)).toEqual({ fa: 'جدید' });
    expect(cardNeedsPersianBackfill({ word: 'Ephemeral', mainDefinition: englishDef() })).toBe(true);
    expect(
      cardNeedsPersianBackfill({
        word: 'Ephemeral',
        mainDefinition: englishDef(),
        translations: { fa: 'زودگذر' },
      })
    ).toBe(false);
  });

  test('mergeWordEntries preserves per-sense translations and wordTranslations across dictionary sources', () => {
    const entryA: WordEntry = {
      word: 'ephemeral',
      phonetic: '/ɪˈfɛmərəl/',
      meanings: [
        {
          partOfSpeech: 'adjective',
          definitions: [
            { definition: 'Lasting for a very short time.' },
          ],
        },
      ],
    };
    const entryB: WordEntry = {
      word: 'ephemeral',
      wordTranslations: { fa: ['زودگذر', 'فانی'] },
      meanings: [
        {
          partOfSpeech: 'adjective',
          definitions: [
            {
              definition: 'Lasting for a very short time.',
              translations: { fa: 'زودگذر، فانی — ماندگار برای مدت بسیار کوتاه' },
            },
          ],
        },
      ],
    };

    const merged = mergeWordEntries([entryA, entryB], 'ephemeral');
    expect(merged?.wordTranslations?.fa).toEqual(['زودگذر', 'فانی']);
    expect(merged?.meanings[0].definitions[0].translations?.fa).toBe(
      'زودگذر، فانی — ماندگار برای مدت بسیار کوتاه'
    );
  });
});

function englishDef() {
  return 'Lasting for a very short time.';
}

test.describe('Multi-Language Dictionary (English + Persian) End-to-End Tests', () => {
  test('always fetches & saves Persian in JSON even in English mode, and switches cleanly between English, Persian, and Both across Dictionary, Deck, Home & Study Session', async ({
    page,
  }) => {
    // Mock dictionary + Persian translation endpoints deterministically
    await page.route('https://api.datamuse.com/sug**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', async (route) => {
      await route.fulfill({ status: 404, body: '{}' });
    });
    await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
      const word = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '').toLowerCase();
      if (word === 'ephemeral') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              word: 'ephemeral',
              phonetic: '/ɪˈfɛmərəl/',
              meanings: [
                {
                  partOfSpeech: 'adjective',
                  definitions: [
                    {
                      definition: 'Lasting for a very short time.',
                      example: 'Fashions are ephemeral, changing with every season.',
                    },
                  ],
                },
              ],
            },
          ]),
        });
        return;
      }
      await route.fulfill({ status: 404, body: 'Not Found' });
    });
    await page.route('https://freedictionaryapi.com/api/v1/entries/en/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' });
    });
    await page.route('https://en.wiktionary.org/api/rest_v1/page/definition/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' });
    });
    await page.route('https://fa.wiktionary.org/w/api.php**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ query: { pages: {} } }),
      });
    });

    // Mock Google Translate (both lexical dt=bd and sense translation dt=t)
    await page.route('https://translate.googleapis.com/translate_a/single**', async (route) => {
      const url = new URL(route.request().url());
      const dts = url.searchParams.getAll('dt');
      const q = (url.searchParams.get('q') || '').trim();

      if (dts.includes('bd')) {
        // Lexical dictionary lookup for 'ephemeral'
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            [['زودگذر', 'ephemeral', null, null, 10]],
            [['adjective', ['زودگذر', 'ناپایدار', 'فانی']]],
          ]),
        });
        return;
      }

      // Sense batch translation
      const translated = q.toLowerCase().includes('lasting for a very short time')
        ? 'ماندگار برای مدت بسیار کوتاه'
        : 'معنای ترجمه‌شده آزمایشی';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([[[translated, q, null, null, 10]]]),
      });
    });

    // Start with empty user store (defaults to English preference)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('test_initialized')) {
        localStorage.clear();
        localStorage.setItem('lumina_cards_v1', JSON.stringify([]));
        sessionStorage.setItem('test_initialized', '1');
      }
    });

    await page.goto('/#/dictionary');

    // 1. Default mode is 'en': search "ephemeral"
    const searchInput = page.getByPlaceholder(/Lookup a word/i);
    await searchInput.fill('ephemeral');
    await searchInput.press('Enter');

    await expect(page.getByTestId('dictionary-def-en')).toContainText('Lasting for a very short time.');
    // In English mode, Persian meaning MUST NOT be shown in Dictionary UI
    await expect(page.getByTestId('dictionary-def-fa')).toHaveCount(0);
    await expect(page.getByTestId('dictionary-word-translation-fa')).toHaveCount(0);

    // Click "Add to Flashcards" while in English mode
    await page.getByRole('button', { name: /Add to Flashcards/i }).click();
    await expect(page.getByRole('button', { name: /Added to Deck/i })).toBeVisible();

    // Verify JSON saved BOTH English mainDefinition AND Persian translations.fa!
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => localStorage.getItem('lumina_cards_v1'));
        const cards = raw ? JSON.parse(raw) : [];
        return cards[0]?.translations?.fa || '';
      })
      .toContain('زودگذر');

    const savedCardsInEnMode = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('lumina_cards_v1') || '[]')
    );
    expect(savedCardsInEnMode).toHaveLength(1);
    expect(savedCardsInEnMode[0].mainDefinition).toBe('Lasting for a very short time.');
    expect(savedCardsInEnMode[0].translations.fa).toBe(
      'زودگذر، ناپایدار، فانی — ماندگار برای مدت بسیار کوتاه'
    );

    // 2. Open Settings and switch to Persian ('fa')
    await page.getByTestId('open-settings-button').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('language-option-fa').click();
    await page.getByRole('button', { name: 'Done' }).click();

    // Dictionary immediately switches to RTL Persian only!
    const dictFa = page.getByTestId('dictionary-def-fa');
    await expect(dictFa).toBeVisible();
    await expect(dictFa).toHaveAttribute('dir', 'rtl');
    await expect(dictFa).toContainText('زودگذر، ناپایدار، فانی — ماندگار برای مدت بسیار کوتاه');
    await expect(page.getByTestId('dictionary-def-en')).toHaveCount(0);

    // Navigate to My Deck (/flashcards) and flip the card -> shows Persian only
    await page.goto('/#/flashcards');
    await page.getByText('ephemeral', { exact: false }).first().click();
    const deckFa = page.getByTestId('deck-card-meaning-fa');
    await expect(deckFa).toBeVisible();
    await expect(deckFa).toHaveAttribute('dir', 'rtl');
    await expect(deckFa).toContainText('زودگذر');
    await expect(page.getByTestId('deck-card-meaning-en')).toHaveCount(0);

    // Start a Classic Flip Study Session -> card back shows Persian only
    await page.getByRole('button', { name: /Start Study Session/i }).click();
    await page.getByRole('button', { name: /Start Full Session/i }).click();
    await expect(page.getByTestId('study-card-front')).toBeVisible();
    await page.getByTestId('study-card-front').click();

    const studyFa = page.getByTestId('study-card-meaning-fa');
    await expect(studyFa).toBeVisible();
    await expect(studyFa).toHaveAttribute('dir', 'rtl');
    await expect(studyFa).toContainText('زودگذر، ناپایدار، فانی — ماندگار برای مدت بسیار کوتاه');
    await expect(page.getByTestId('study-card-meaning-en')).toHaveCount(0);

    // 3. Open Settings right inside Study Session and switch to BOTH ('both')!
    await page.getByTestId('open-settings-button').click();
    await page.getByTestId('language-option-both').click();
    await page.getByRole('button', { name: 'Done' }).click();

    // Verify BOTH English and Persian appear on Study Card Back, with English FIRST (above) and Persian SECOND (below)!
    const studyEnBoth = page.getByTestId('study-card-meaning-en');
    const studyFaBoth = page.getByTestId('study-card-meaning-fa');
    await expect(studyEnBoth).toBeVisible();
    await expect(studyFaBoth).toBeVisible();
    await expect(studyEnBoth).toHaveText('Lasting for a very short time.');
    await expect(studyFaBoth).toHaveAttribute('dir', 'rtl');

    const enBox = await studyEnBoth.boundingBox();
    const faBox = await studyFaBoth.boundingBox();
    expect(enBox).not.toBeNull();
    expect(faBox).not.toBeNull();
    expect(enBox!.y).toBeLessThan(faBox!.y);

    // 4. Verify Multiple-Choice Quiz mode in 'both' preference shows English first + Persian second on every option!
    await page.goto('/#/flashcards');
    await page.getByRole('button', { name: /Start Study Session/i }).click();
    await page.getByText('Multiple-Choice Quiz').click();
    await page.getByRole('button', { name: /Start Quiz Session/i }).click();

    const firstQuizOption = page.getByTestId('quiz-option-0');
    await expect(firstQuizOption).toBeVisible();
    const opt0En = firstQuizOption.getByTestId('quiz-option-en');
    const opt0Fa = firstQuizOption.getByTestId('quiz-option-fa');
    await expect(opt0En).toBeVisible();
    await expect(opt0Fa).toBeVisible();
    const opt0EnBox = await opt0En.boundingBox();
    const opt0FaBox = await opt0Fa.boundingBox();
    expect(opt0EnBox!.y).toBeLessThan(opt0FaBox!.y);

    // Click the correct option for Ephemeral and confirm it registers as Correct!
    await page
      .locator('button[data-testid^="quiz-option-"]', { hasText: 'Lasting for a very short time.' })
      .click();
    await expect(page.getByText('Correct! Marked as Learned.')).toBeVisible();

    // 5. Verify Home Dashboard Word-of-the-Day also shows English first + Persian second, and persists across reload!
    await page.goto('/#/');
    await expect(page.getByTestId('wotd-meaning-en')).toBeVisible();
    await expect(page.getByTestId('wotd-meaning-fa')).toBeVisible();
    const wotdEnBox = await page.getByTestId('wotd-meaning-en').boundingBox();
    const wotdFaBox = await page.getByTestId('wotd-meaning-fa').boundingBox();
    expect(wotdEnBox!.y).toBeLessThan(wotdFaBox!.y);

    await page.reload();
    await expect(page.getByTestId('wotd-meaning-en')).toBeVisible();
    await expect(page.getByTestId('wotd-meaning-fa')).toBeVisible();
  });

  test('Book Extraction ("Prepare for a Book") always saves Persian translations in JSON even when extracted in English mode, and backfills legacy cards automatically', async ({
    page,
  }) => {
    const sampleBookText =
      'Chapter 1. For many silent winters the observant traveler endured the relentless vicissitudes of fortune across distant mountains while recording ancient chronicles beside the stone hearth of the caravan inn.';

    await page.route('https://gutendex.com/books**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          results: [
            {
              id: 7771,
              title: 'Tales of Khorasan',
              authors: [{ name: 'Darius Rostami' }],
              formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/7771.txt.utf-8' },
            },
          ],
        }),
      });
    });
    await page.route('https://openlibrary.org/search.json**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"docs":[]}' })
    );
    await page.route('https://en.wikisource.org/w/api.php**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"query":{"search":[]}}' })
    );
    await page.route('https://en.wikipedia.org/w/api.php**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"query":{"search":[]}}' })
    );
    await page.route('https://www.googleapis.com/books/v1/volumes**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
    );
    await page.route('https://archive.org/advancedsearch.php**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"response":{"docs":[]}}' })
    );
    await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (r) =>
      r.fulfill({ status: 404, body: '{}' })
    );
    await page.route('https://www.gutenberg.org/ebooks/7771.txt.utf-8', (r) =>
      r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: sampleBookText })
    );

    await page.route('https://api.datamuse.com/words**', async (route) => {
      const sp = (new URL(route.request().url()).searchParams.get('sp') || '').toLowerCase();
      const freq = sp === 'vicissitudes' || sp === 'relentless' ? 'f:0.4' : 'f:90.0';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ word: sp, score: 500, tags: [freq] }]),
      });
    });

    await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', (r) =>
      r.fulfill({ status: 404, body: 'Not Found' })
    );
    await page.route('https://freedictionaryapi.com/api/v1/entries/en/**', (r) =>
      r.fulfill({ status: 404, body: 'Not Found' })
    );
    await page.route('https://fa.wiktionary.org/w/api.php**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"query":{"pages":{}}}' })
    );

    await page.route('https://en.wiktionary.org/api/rest_v1/page/definition/**', async (route) => {
      const word = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '').toLowerCase();
      if (word === 'vicissitudes' || word === 'vicissitude') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Noun',
                language: 'English',
                definitions: [
                  { definition: 'Unwelcome changes of circumstances or fortune.' },
                ],
              },
            ],
          }),
        });
        return;
      }
      if (word === 'relentless') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Adjective',
                language: 'English',
                definitions: [{ definition: 'Unceasingly intense and unyielding.' }],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.route('https://translate.googleapis.com/translate_a/single**', async (route) => {
      const url = new URL(route.request().url());
      const dts = url.searchParams.getAll('dt');
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();

      if (dts.includes('bd')) {
        const equivalents = q.includes('vicissitude')
          ? ['فراز و نشیب', 'دگرگونی']
          : q.includes('laconic')
            ? ['کم‌حرف', 'موجز']
            : ['بی‌امان', 'سرسخت'];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            [[equivalents[0], q, null, null, 10]],
            [['noun', equivalents]],
          ]),
        });
        return;
      }

      const senseFa = q.includes('few words')
        ? 'استفاده از کلمات بسیار اندک'
        : q.includes('unwelcome changes')
          ? 'تغییرات ناخوشایند در شرایط یا بخت'
          : 'پیوسته شدید و انعطاف‌ناپذیر';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([[[senseFa, q, null, null, 10]]]),
      });
    });

    // Seed ONE legacy pre-existing card ("Laconic") WITHOUT translations.fa!
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('book_test_init')) {
        localStorage.clear();
        localStorage.setItem(
          'lumina_cards_v1',
          JSON.stringify([
            {
              id: 'legacy-laconic-1',
              word: 'Laconic',
              partOfSpeech: 'adjective',
              mainDefinition: 'Using very few words.',
              status: 'New',
              lastReviewed: 0,
              createdAt: Date.now() - 50000,
            },
          ])
        );
        sessionStorage.setItem('book_test_init', '1');
      }
    });

    await page.goto('/#/flashcards');

    // 1. Extract book words while preference is still 'en'
    await page.getByRole('button', { name: /Prepare for a Book/i }).click();
    await page.getByLabel('Search book title').fill('Tales of Khorasan');
    await page.getByRole('button', { name: /Find Book/i }).click();
    await expect(page.getByText('Darius Rostami')).toBeVisible();
    await page.getByRole('button', { name: /Extract Words/i }).click();

    await expect(page.getByText('Unwelcome changes of circumstances or fortune.')).toBeVisible({
      timeout: 15000,
    });
    // In 'en' mode, book preview shows English only
    await expect(page.locator('[data-testid$="-meaning-fa"]')).toHaveCount(0);

    // Import book words into deck
    await page.getByRole('button', { name: /Add .* Words to Book Dock/i }).click();

    // Verify imported book cards in JSON ALREADY contain Persian translations (`translations.fa`)!
    await expect
      .poll(async () => {
        const cards = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('lumina_cards_v1') || '[]')
        );
        const bookCard = cards.find((c: any) => c.word.toLowerCase().startsWith('vicissitude'));
        return bookCard?.translations?.fa || '';
      })
      .toContain('فراز و نشیب');

    // Meanwhile, legacy card "Laconic" hasn't been backfilled yet while user stays in 'en' mode
    const beforeSwitchCards = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('lumina_cards_v1') || '[]')
    );
    const legacyBefore = beforeSwitchCards.find((c: any) => c.id === 'legacy-laconic-1');
    expect(legacyBefore?.translations?.fa).toBeUndefined();

    // 2. Now open Settings and switch to 'both' -> automatically triggers background backfill for legacy card "Laconic"!
    await page.getByTestId('open-settings-button').click();
    await page.getByTestId('language-option-both').click();

    // Wait for Settings modal coverage to reach all cards translated & verify localStorage updated
    await expect
      .poll(async () => {
        const cards = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('lumina_cards_v1') || '[]')
        );
        const laconic = cards.find((c: any) => c.id === 'legacy-laconic-1');
        return laconic?.translations?.fa || '';
      })
      .toBe('کم‌حرف، موجز — استفاده از کلمات بسیار اندک');

    await expect(
      page.getByText(/All .* flashcards in your deck have both English & Persian saved in JSON/i)
    ).toBeVisible();
  });
});
