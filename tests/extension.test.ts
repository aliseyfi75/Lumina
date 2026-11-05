import { test, expect } from 'playwright/test';
import '../lumina-extension/background.js';

const ext = (globalThis as any).__luminaExtension;

test('Chrome extension checks duplicates across all Pantry chunks and supports Datamuse fallback + 30KB chunking', async () => {
  ext.setRateLimitDelayForTests(0);

  const notifications: { title: string; message: string }[] = [];
  (globalThis as any).chrome = {
    storage: {
      sync: {
        get: async () => ({ luminaPantryId: '11111111-2222-3333-4444-555555555555' }),
      },
    },
    notifications: {
      create: (opts: { title: string; message: string }) => {
        notifications.push(opts);
      },
    },
  };

  const postedBaskets: Record<string, any> = {};
  const originalFetch = globalThis.fetch;

  // Build 75 existing cards split across chunk 0 and chunk 1
  const chunk0Cards = Array.from({ length: 45 }, (_, i) => ({
    id: `c0-${i}`,
    word: `word-a-${i}`,
    mainDefinition: 'x'.repeat(450),
    partOfSpeech: 'noun',
    status: 'New',
    lastReviewed: 0,
    createdAt: 1700000000000 + i,
  }));
  const chunk1Cards = Array.from({ length: 30 }, (_, i) => ({
    id: `c1-${i}`,
    word: i === 15 ? 'ephemeral' : `word-b-${i}`,
    mainDefinition: 'x'.repeat(450),
    partOfSpeech: 'adjective',
    status: 'New',
    lastReviewed: 0,
    createdAt: 1700000001000 + i,
  }));

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    // Primary dictionary 404s for 'perspicacious', succeeds for 'ephemeral'
    if (url.includes('api.dictionaryapi.dev/api/v2/entries/en/ephemeral')) {
      return new Response(
        JSON.stringify([
          {
            word: 'ephemeral',
            phonetic: '/ɪˈfɛm(ə)ɹəl/',
            meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Lasting for a very short time.' }] }],
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('api.dictionaryapi.dev/api/v2/entries/en/perspicacious')) {
      return new Response('Not Found', { status: 404 });
    }
    if (url.includes('api.datamuse.com/words') && url.includes('perspicacious')) {
      return new Response(
        JSON.stringify([
          {
            word: 'perspicacious',
            score: 1000,
            defs: ['adj\tHaving a ready insight into and understanding of things.'],
            tags: ['pron:/pɜːspɪˈkeɪʃəs/'],
          },
        ]),
        { status: 200 }
      );
    }

    if (method === 'GET' && url.includes('/basket/Lumina?')) {
      return new Response(
        JSON.stringify({
          cards: chunk0Cards,
          chunkCount: 2,
          studyHistory: { '2026-11-05': 5 },
          longestStreak: 3,
        }),
        { status: 200 }
      );
    }
    if (method === 'GET' && url.includes('/basket/Lumina_1?')) {
      return new Response(JSON.stringify({ cards: chunk1Cards }), { status: 200 });
    }
    if (method === 'POST' && url.includes('/basket/')) {
      const basketName = url.split('/basket/')[1];
      postedBaskets[basketName] = JSON.parse(String(init?.body ?? '{}'));
      return new Response('{}', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    // 1. Duplicate in chunk 1 ('ephemeral') is detected and not re-added
    await ext.handleAddToLumina('ephemeral');
    expect(notifications.length).toBe(1);
    expect(notifications[0].title).toContain('Duplicate');
    expect(Object.keys(postedBaskets).length).toBe(0);

    // 2. New word ('perspicacious') falls back to Datamuse and saves across chunks without exceeding 30KB
    notifications.length = 0;
    await ext.handleAddToLumina('perspicacious');
    expect(notifications.length).toBe(1);
    expect(notifications[0].title).toContain('Success');
    expect(postedBaskets['Lumina']).toBeTruthy();
    expect(postedBaskets['Lumina'].chunkCount).toBe(2);
    expect(postedBaskets['Lumina_1']).toBeTruthy();

    const totalSaved =
      postedBaskets['Lumina'].cards.length + postedBaskets['Lumina_1'].cards.length;
    expect(totalSaved).toBe(chunk0Cards.length + chunk1Cards.length + 1);
    expect(postedBaskets['Lumina'].cards[0].word).toBe('perspicacious');
    expect(postedBaskets['Lumina'].cards[0].partOfSpeech).toBe('adjective');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
