import { test, expect } from 'playwright/test';
import {
  getDeck,
  keepAlivePantry,
  updateDeck,
  getKnownChunkCount,
  getPendingCloudSyncPlan,
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

test('getDeck automatically sleeps and retries through mid-load 502/429/CORS failures without failing', async () => {
  setPantryRateLimitDelayForTests(0);
  let lumina1Attempts = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      const basketMatch = url.match(/\/basket\/([^?]+)/);
      const basketName = basketMatch ? basketMatch[1] : url;

      if (basketName === 'Lumina') {
        return new Response(
          JSON.stringify({
            cards: [makeCard(10, 20)],
            chunkCount: 3,
          }),
          { status: 200 }
        );
      }
      if (basketName === 'Lumina_1') {
        lumina1Attempts++;
        // Fail the first 4 attempts with simulated CORS/502/429 rate-limit drops, succeed on attempt 5
        if (lumina1Attempts === 1 || lumina1Attempts === 2) {
          throw new TypeError('Failed to fetch');
        }
        if (lumina1Attempts === 3) {
          return new Response('Bad Gateway', { status: 502 });
        }
        if (lumina1Attempts === 4) {
          return new Response('Too Many Requests', { status: 429 });
        }
        return new Response(JSON.stringify({ cards: [makeCard(11, 20)] }), { status: 200 });
      }
      if (basketName === 'Lumina_2') {
        return new Response(JSON.stringify({ cards: [makeCard(12, 20)] }), { status: 200 });
      }
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    const progressSteps: string[] = [];
    const deck = await getDeck('99999999-8888-7777-6666-555555555555', undefined, {
      strict: true,
      onProgress: info => {
        if (info.step) progressSteps.push(info.step);
      },
    });

    expect(lumina1Attempts).toBe(5);
    expect(
      progressSteps.some(step =>
        step.includes('Pantry rate-limit cooldown — waiting') &&
        step.includes('before resuming chunk 2 of 3')
      )
    ).toBe(true);
    expect(deck.cards.map(c => c.id)).toEqual(['card-10', 'card-11', 'card-12']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getDeck skips unchanged overflow chunks on subsequent loads and only downloads modified chunks', async () => {
  setPantryRateLimitDelayForTests(0);
  const getBaskets: string[] = [];
  const postBaskets: string[] = [];
  const cloudStore: Record<string, any> = {};

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const basketMatch = url.match(/\/basket\/([^?]+)/);
    const basketName = basketMatch ? basketMatch[1] : url;

    if (method === 'POST') {
      postBaskets.push(basketName);
      cloudStore[basketName] = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify(cloudStore[basketName]), { status: 200 });
    }
    if (method === 'PUT') {
      const existing = cloudStore[basketName] || {};
      const patch = JSON.parse(String(init?.body || '{}'));
      cloudStore[basketName] = { ...existing, ...patch };
      return new Response(JSON.stringify(cloudStore[basketName]), { status: 200 });
    }
    if (method === 'GET') {
      getBaskets.push(basketName);
      if (cloudStore[basketName]) {
        return new Response(JSON.stringify(cloudStore[basketName]), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    const pantryId = '88888888-7777-6666-5555-444444444444';
    const initialDeck = Array.from({ length: 140 }, (_, i) => makeCard(i + 1, 450));

    // 1. Save 3-chunk deck to cloud
    await updateDeck(pantryId, {
      cards: initialDeck,
      studyHistory: { '2026-11-09': 3 },
      longestStreak: 4,
      deletedCards: {},
    });
    expect(postBaskets).toEqual(['Lumina', 'Lumina_1', 'Lumina_2']);

    // 2. Clicking "Save to Cloud" again immediately when nothing changed makes 0 POST requests!
    postBaskets.length = 0;
    await updateDeck(pantryId, {
      cards: initialDeck,
      studyHistory: { '2026-11-09': 3 },
      longestStreak: 4,
      deletedCards: {},
    });
    expect(postBaskets).toEqual([]);

    // 3. Simulate a fresh device loading from cloud for the first time -> downloads all 3 chunks
    setPantryRateLimitDelayForTests(0);
    getBaskets.length = 0;
    const firstPull = await getDeck(pantryId, undefined, { strict: true });
    expect(getBaskets).toEqual(['Lumina', 'Lumina_1', 'Lumina_2']);
    expect(firstPull.cards.length).toBe(140);

    // 4. Right after loading from cloud, getPendingCloudSyncPlan reports hasChanges: false (so auto-sync does not re-upload!),
    // and clicking "Load from Cloud" again only checks 'Lumina' and skips 'Lumina_1' & 'Lumina_2'!
    const postPullPlan = getPendingCloudSyncPlan(pantryId, {
      cards: firstPull.cards,
      studyHistory: firstPull.studyHistory,
      longestStreak: firstPull.longestStreak,
      deletedCards: firstPull.deletedCards,
    });
    expect(postPullPlan.hasChanges).toBe(false);
    expect(postPullPlan.dirtyChunkCount).toBe(0);

    getBaskets.length = 0;
    const secondPull = await getDeck(pantryId, undefined, { strict: true });
    expect(getBaskets).toEqual(['Lumina']);
    expect(secondPull.cards.length).toBe(140);

    // 5. Simulate auto-sync after studying 1 card in chunk 0 ('card-1' grows by ~150 bytes with review fields & tags):
    // Stable chunk pinning prevents card-1's growth from cascading into Lumina_1 or Lumina_2, so ONLY 'Lumina' is uploaded!
    postBaskets.length = 0;
    const deckAfterChunk0Review = secondPull.cards.map(c =>
      c.id === 'card-1'
        ? {
            ...c,
            status: FlashcardStatus.Learning,
            interval: 3,
            repetition: 2,
            nextReviewDate: 1700086400000,
            lastReviewed: 1700000500000,
            updatedAt: 1700000500000,
            tags: ['Book: Atomic Habits', 'Chapter 1'],
          }
        : c
    );
    const chunk0Plan = getPendingCloudSyncPlan(pantryId, {
      cards: deckAfterChunk0Review,
      studyHistory: { '2026-11-09': 4 },
      longestStreak: 4,
      deletedCards: {},
    });
    expect(chunk0Plan.hasChanges).toBe(true);
    expect(chunk0Plan.dirtyChunkCount).toBe(1);

    await updateDeck(pantryId, {
      cards: deckAfterChunk0Review,
      studyHistory: { '2026-11-09': 4 },
      longestStreak: 4,
      deletedCards: {},
    });
    expect(postBaskets).toEqual(['Lumina']);

    // 6. Simulate auto-sync after studying 1 card in chunk 2 ('Lumina_1') and incrementing studyHistory:
    // Chunk 0 ('Lumina') cards did NOT change, so ONLY 'Lumina_1' is POSTed (metadata on 'Lumina' is updated via lightweight PUT)!
    postBaskets.length = 0;
    const chunk1CardId = cloudStore['Lumina_1'].cards[0].id;
    const deckAfterChunk1Review = deckAfterChunk0Review.map(c =>
      c.id === chunk1CardId
        ? {
            ...c,
            status: FlashcardStatus.Mastered,
            interval: 30,
            repetition: 5,
            nextReviewDate: 1702592000000,
            lastReviewed: 1700000900000,
            updatedAt: 1700000900000,
          }
        : c
    );
    await updateDeck(pantryId, {
      cards: deckAfterChunk1Review,
      studyHistory: { '2026-11-09': 5 },
      longestStreak: 5,
      deletedCards: {},
    });
    expect(postBaskets).toEqual(['Lumina_1']);

    // 7. Now simulate another device modifying ONLY chunk 3 ('Lumina_2') and updating its hash in 'Lumina'
    cloudStore['Lumina_2'] = {
      ...cloudStore['Lumina_2'],
      cards: [...cloudStore['Lumina_2'].cards, makeCard(999, 200)],
    };
    cloudStore['Lumina'] = {
      ...cloudStore['Lumina'],
      chunkHashes: {
        ...cloudStore['Lumina'].chunkHashes,
        2: 'updated-hash-for-chunk-2',
      },
    };

    // Clicking "Load from Cloud" skips unchanged 'Lumina_1' and downloads ONLY 'Lumina' + 'Lumina_2'!
    getBaskets.length = 0;
    const thirdPull = await getDeck(pantryId, undefined, { strict: true });
    expect(getBaskets).toEqual(['Lumina', 'Lumina_2']);
    expect(thirdPull.cards.length).toBe(141);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



