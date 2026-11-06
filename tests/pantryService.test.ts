import { test, expect } from 'playwright/test';
import {
  getDeck,
  keepAlivePantry,
  updateDeck,
  getKnownChunkCount,
  setPantryRateLimitDelayForTests,
  type ChunkProgressInfo,
} from '../services/pantryService';
import { FlashcardStatus, type Flashcard } from '../types';

const TEST_PANTRY_ID = '11111111-2222-3333-4444-555555555555';

const makeCard = (idx: number, extraLen = 300): Flashcard => ({
  id: `card-${idx}`,
  word: `word-${idx}`,
  mainDefinition: `Definition ${idx} - ${'x'.repeat(extraLen)}`,
  partOfSpeech: 'noun',
  status: FlashcardStatus.New,
  lastReviewed: 0,
  createdAt: 1700000000000 + idx,
});

test('keepAlivePantry refreshes all chunks remembered from getDeck even when chunkCount argument is omitted', async () => {
  setPantryRateLimitDelayForTests(0);
  const calls: { url: string; method: string }[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });

    if (method === 'GET' && url.includes('/basket/Lumina?')) {
      return new Response(
        JSON.stringify({
          cards: [makeCard(1, 10)],
          chunkCount: 3,
          studyHistory: {},
          longestStreak: 2,
        }),
        { status: 200 }
      );
    }
    if (method === 'GET' && url.includes('/basket/Lumina_1?')) {
      return new Response(JSON.stringify({ cards: [makeCard(2, 10)] }), { status: 200 });
    }
    if (method === 'GET' && url.includes('/basket/Lumina_2?')) {
      return new Response(JSON.stringify({ cards: [makeCard(3, 10)] }), { status: 200 });
    }
    if (method === 'PUT') {
      return new Response(JSON.stringify({ chunkCount: 3 }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    const deck = await getDeck(TEST_PANTRY_ID);
    expect(deck.cards.length).toBe(3);
    expect(getKnownChunkCount(TEST_PANTRY_ID)).toBe(3);

    calls.length = 0;
    const ok = await keepAlivePantry(TEST_PANTRY_ID);
    expect(ok).toBe(true);

    const putUrls = calls.filter(c => c.method === 'PUT').map(c => c.url);
    expect(putUrls.length).toBe(3);
    expect(putUrls[0]).toContain('/basket/Lumina');
    expect(putUrls[1]).toContain('/basket/Lumina_1');
    expect(putUrls[2]).toContain('/basket/Lumina_2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateDeck deletes stale overflow chunks when a multi-chunk deck shrinks to fewer chunks', async () => {
  setPantryRateLimitDelayForTests(0);
  const calls: { url: string; method: string }[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Push a large deck that splits across multiple chunks (> 30KB)
    const largeDeck = Array.from({ length: 90 }, (_, i) => makeCard(i, 450));
    const progressEvents: ChunkProgressInfo[] = [];
    await updateDeck(
      TEST_PANTRY_ID,
      {
        cards: largeDeck,
        studyHistory: {},
        longestStreak: 1,
        deletedCards: {},
      },
      {
        onProgress: info => progressEvents.push(info),
      }
    );

    const chunkCountAfterLarge = getKnownChunkCount(TEST_PANTRY_ID);
    expect(chunkCountAfterLarge).toBeGreaterThanOrEqual(2);
    expect(progressEvents.length).toBeGreaterThanOrEqual(chunkCountAfterLarge);
    expect(progressEvents[0].step).toContain(`Uploading chunk 1 of ${chunkCountAfterLarge}`);
    expect(progressEvents[0].percent).toBeGreaterThan(0);
    expect(progressEvents[0].estimatedRemainingSec).toBeGreaterThan(0);

    // 2. Now shrink the deck to 2 small cards (fits in 1 chunk)
    calls.length = 0;
    const shrinkProgressEvents: ChunkProgressInfo[] = [];
    await updateDeck(
      TEST_PANTRY_ID,
      {
        cards: [makeCard(1, 10), makeCard(2, 10)],
        studyHistory: {},
        longestStreak: 1,
        deletedCards: {},
      },
      {
        onProgress: info => shrinkProgressEvents.push(info),
      }
    );

    expect(getKnownChunkCount(TEST_PANTRY_ID)).toBe(1);
    expect(shrinkProgressEvents.some(e => e.step?.includes('Cleaning old cloud data'))).toBe(true);

    const deleteUrls = calls.filter(c => c.method === 'DELETE').map(c => c.url);
    expect(deleteUrls.length).toBe(chunkCountAfterLarge - 1);
    expect(deleteUrls[0]).toContain('/basket/Lumina_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
