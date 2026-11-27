import { test, expect } from 'playwright/test';
import { decodeHtmlEntities } from '../services/dictionaryService';
import '../lumina-extension/background.js';

const ext = (globalThis as any).__luminaExtension;

test.describe('High-Priority Bug Fixes', () => {
  test('Dashboard search autocomplete dropdown is not clipped by Hero container even when dueCount is 0', async ({ page }) => {
    await page.addInitScript(() => {
      const card = {
        id: 'mastered-only-1',
        word: 'Luminous',
        mainDefinition: 'Bright or shining.',
        partOfSpeech: 'adjective',
        status: 'Mastered',
        lastReviewed: Date.now(),
        createdAt: Date.now() - 1000,
      };
      localStorage.setItem('lumina_cards_v1', JSON.stringify([card]));
    });

    await page.route('https://api.datamuse.com/sug**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { word: 'ephemeral' },
          { word: 'ephemera' },
          { word: 'ephemeris' },
          { word: 'ephemeron' },
          { word: 'ephemerally' },
        ]),
      });
    });

    await page.route('https://api.dictionaryapi.dev/**', (route) => route.abort());
    await page.route('https://en.wiktionary.org/**', (route) => route.abort());
    await page.route('https://freedictionaryapi.com/**', (route) => route.abort());

    await page.goto('http://localhost:5173/#/');
    const input = page.getByPlaceholder('Look up a word…');
    await input.fill('ephe');

    const lastOption = page.getByText('ephemerally', { exact: true });
    await expect(lastOption).toBeVisible();

    // Verify parent hero does not clip the dropdown via overflow: hidden
    const heroOverflow = await page.evaluate(() => {
      const inp = document.querySelector('input[placeholder="Look up a word…"]');
      let el = inp?.parentElement;
      while (el) {
        if (el.className.includes('bg-gradient-to-br')) {
          return getComputedStyle(el).overflow;
        }
        el = el.parentElement;
      }
      return '';
    });
    expect(heroOverflow).not.toBe('hidden');
  });

  test('StudySession prevents double-submit skipping cards and handles empty deck without blank screen', async ({ page }) => {
    await page.goto('http://localhost:5173/#/');
    await page.evaluate(async () => {
      const seedCards = [
        { id: 'c1', word: 'Ephemeral', partOfSpeech: 'adjective', mainDefinition: 'Short-lived.', status: 'New', lastReviewed: 0, createdAt: 1000 },
        { id: 'c2', word: 'Cogent', partOfSpeech: 'adjective', mainDefinition: 'Clear and convincing.', status: 'New', lastReviewed: 0, createdAt: 2000 },
        { id: 'c3', word: 'Laconic', partOfSpeech: 'adjective', mainDefinition: 'Using very few words.', status: 'New', lastReviewed: 0, createdAt: 3000 },
      ];
      localStorage.setItem('lumina_cards_v1', JSON.stringify(seedCards));
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('lumina_db', 2);
        req.onsuccess = () => {
          const tx = req.result.transaction('app_data', 'readwrite');
          tx.objectStore('app_data').put({ cards: seedCards, studyHistory: {}, longestStreak: 0, deletedCards: {} }, 'appData');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    await page.goto('http://localhost:5173/#/study');
    await page.reload();

    await expect(page.getByText('1 / 3')).toBeVisible();
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);

    // Double-press ArrowRight rapidly within the 300ms transition window
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Must land on 2 / 3 (Cogent), NOT skip to 3 / 3!
    await expect(page.getByText('2 / 3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cogent' })).toBeVisible();

    // Now test empty deck directly on /study
    await page.evaluate(async () => {
      localStorage.setItem('lumina_cards_v1', '[]');
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('lumina_db', 2);
        req.onsuccess = () => {
          const tx = req.result.transaction('app_data', 'readwrite');
          tx.objectStore('app_data').put({ cards: [], studyHistory: {}, longestStreak: 0, deletedCards: { old: Date.now() } }, 'appData');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    await page.goto('http://localhost:5173/#/study');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Session Complete!' })).toBeVisible();
  });

  test('decodeHtmlEntities safely handles out-of-range numeric entities without throwing RangeError', () => {
    expect(decodeHtmlEntities('Valid &#65; &amp; invalid &#999999999; &#xFFFFFFFF;')).toBe('Valid A & invalid  ');
  });

  test('Chrome extension preserves languagePreference and serializes concurrent word additions', async () => {
    ext.setRateLimitDelayForTests(0);
    const notifications: Array<{ title: string; message: string }> = [];
    (globalThis as any).chrome = {
      storage: {
        sync: {
          get: async () => ({ luminaPantryId: '11111111-2222-3333-4444-555555555555' }),
        },
      },
      notifications: {
        create: (opts: { title: string; message: string }) => notifications.push(opts),
      },
    };

    let storedBasket: any = {
      cards: [],
      studyHistory: { '2026-11-20': 4 },
      longestStreak: 2,
      deletedCards: {},
      languagePreference: 'both',
      languagePreferenceUpdatedAt: 1700000000000,
      chunkCount: 1,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('api.dictionaryapi.dev/api/v2/entries/en/')) {
        const w = decodeURIComponent(url.split('/').pop() || 'word');
        return new Response(
          JSON.stringify([{ word: w, meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `Def of ${w}` }] }] }]),
          { status: 200 }
        );
      }
      if (method === 'GET' && url.includes('/basket/Lumina?')) {
        return new Response(JSON.stringify(storedBasket), { status: 200 });
      }
      if (method === 'POST' && url.includes('/basket/Lumina')) {
        storedBasket = JSON.parse(String(init?.body ?? '{}'));
        return new Response('{}', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    try {
      await Promise.all([ext.handleAddToLumina('alpha'), ext.handleAddToLumina('beta')]);
      expect(storedBasket.cards.map((c: any) => c.word).sort()).toEqual(['alpha', 'beta']);
      expect(storedBasket.languagePreference).toBe('both');
      expect(storedBasket.languagePreferenceUpdatedAt).toBe(1700000000000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
