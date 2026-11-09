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

test('updateDeck resumes from the failed chunk when interrupted mid-save and skips unchanged chunks when new cards are added', async () => {
  setPantryRateLimitDelayForTests(0);
  const postBaskets: string[] = [];
  let shouldFailChunk2 = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      const basketMatch = url.match(/\/basket\/([^?]+)/);
      const basketName = basketMatch ? basketMatch[1] : url;
      postBaskets.push(basketName);
      if (shouldFailChunk2 && basketName === 'Lumina_2') {
        return new Response('Bad Gateway', { status: 400 }); // non-retryable failure on chunk 3 (Lumina_2)
      }
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // Build a deck large enough to require 3 chunks (Lumina, Lumina_1, Lumina_2)
    const threeChunkDeck = Array.from({ length: 140 }, (_, i) => makeCard(i + 1, 450));

    // Attempt 1: Lumina (chunk 1) and Lumina_1 (chunk 2) succeed, Lumina_2 (chunk 3) fails
    await expect(
      updateDeck(TEST_PANTRY_ID, {
        cards: threeChunkDeck,
        studyHistory: { '2026-11-08': 5 },
        longestStreak: 3,
        deletedCards: {},
      })
    ).rejects.toThrow(/Failed to update Pantry chunk 2/);

    expect(postBaskets).toEqual(['Lumina', 'Lumina_1', 'Lumina_2']);

    // Attempt 2: Retry the interrupted save -> must skip Lumina and Lumina_1 and ONLY upload Lumina_2!
    postBaskets.length = 0;
    shouldFailChunk2 = false;
    const resumeProgress: ChunkProgressInfo[] = [];

    await updateDeck(
      TEST_PANTRY_ID,
      {
        cards: threeChunkDeck,
        studyHistory: { '2026-11-08': 5 },
        longestStreak: 3,
        deletedCards: {},
      },
      {
        onProgress: info => resumeProgress.push(info),
      }
    );

    expect(postBaskets).toEqual(['Lumina_2']);
    expect(resumeProgress[0].step).toContain('Resuming upload at chunk 3 of 3');

    // Attempt 3: Add 2 brand-new flashcards -> older chunks (Lumina and Lumina_1) are unchanged and skipped,
    // so only the last chunk (Lumina_2) is uploaded!
    postBaskets.length = 0;
    const expandedDeck = [
      makeCard(200, 450),
      makeCard(201, 450),
      ...threeChunkDeck,
    ];

    await updateDeck(TEST_PANTRY_ID, {
      cards: expandedDeck,
      studyHistory: { '2026-11-08': 5 },
      longestStreak: 3,
      deletedCards: {},
    });

    expect(postBaskets).toEqual(['Lumina_2']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getDeck delivers partial chunks progressively and resumes from the interrupted chunk without re-downloading earlier chunks', async () => {
  setPantryRateLimitDelayForTests(0);
  const getBaskets: string[] = [];
  let shouldFailChunk2 = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      const basketMatch = url.match(/\/basket\/([^?]+)/);
      const basketName = basketMatch ? basketMatch[1] : url;
      getBaskets.push(basketName);

      if (basketName === 'Lumina') {
        return new Response(
          JSON.stringify({
            cards: [makeCard(1, 20)],
            chunkCount: 3,
            studyHistory: { '2026-11-08': 4 },
            longestStreak: 2,
          }),
          { status: 200 }
        );
      }
      if (basketName === 'Lumina_1') {
        return new Response(JSON.stringify({ cards: [makeCard(2, 20)] }), { status: 200 });
      }
      if (basketName === 'Lumina_2') {
        if (shouldFailChunk2) {
          return new Response('Gateway Timeout', { status: 400 });
        }
        return new Response(JSON.stringify({ cards: [makeCard(3, 20)] }), { status: 200 });
      }
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    const partialCardCounts: number[] = [];

    // Attempt 1: Lumina (chunk 1) and Lumina_1 (chunk 2) download, Lumina_2 (chunk 3) fails
    await expect(
      getDeck(TEST_PANTRY_ID, undefined, {
        strict: true,
        retries: 0,
        onPartialCards: partial => partialCardCounts.push(partial.cards.length),
      })
    ).rejects.toThrow(/Failed to load deck chunk 2/);

    expect(getBaskets).toEqual(['Lumina', 'Lumina_1', 'Lumina_2']);
    // Partial cards from chunk 1 (1 card) and chunk 2 (2 cards) were already emitted progressively!
    expect(partialCardCounts).toEqual([1, 2]);

    // Attempt 2: User clicks "Load from Cloud" again -> skips Lumina and Lumina_1, fetches ONLY Lumina_2!
    getBaskets.length = 0;
    shouldFailChunk2 = false;
    const resumeSteps: string[] = [];

    const fullDeck = await getDeck(TEST_PANTRY_ID, undefined, {
      strict: true,
      retries: 0,
      onProgress: info => {
        if (info.step) resumeSteps.push(info.step);
      },
    });

    expect(getBaskets).toEqual(['Lumina_2']);
    expect(resumeSteps[0]).toContain('Resuming cloud load at chunk 3 of 3');
    expect(fullDeck.cards.map(c => c.id)).toEqual(['card-1', 'card-2', 'card-3']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
