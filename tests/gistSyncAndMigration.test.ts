import { test, expect } from 'playwright/test';
import {
  findOrCreateLuminaGist,
  getGistDeck,
  updateGistDeck,
  hasPendingGistSyncChanges,
  clearGistSyncCacheForTests,
  cleanGitHubToken,
  LUMINA_GIST_FILENAME,
  LUMINA_GIST_PART_PREFIX,
} from '../services/gistService';
import { mergeFlashcardDecks } from '../utils/cardMerge';
import { FlashcardStatus, type Flashcard } from '../types';

const makeCard = (idx: number): Flashcard => ({
  id: `gist-card-${idx}`,
  word: `Word-${idx}`,
  mainDefinition: `Definition for word ${idx}`,
  partOfSpeech: 'noun',
  status: FlashcardStatus.New,
  lastReviewed: 0,
  createdAt: 1700000000000 + idx,
});

test('gistService uploads 850 cards in a single PATCH request, skips unchanged pushes, and uses ETag 304 caching', async () => {
  clearGistSyncCacheForTests();
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  let storedContent = '';
  const currentEtag = '"etag-v1"';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, method, headers });

    if (method === 'GET' && url === 'https://api.github.com/gists?per_page=100') {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    if (method === 'POST' && url === 'https://api.github.com/gists') {
      const body = JSON.parse(String(init?.body || '{}'));
      storedContent = body.files?.[LUMINA_GIST_FILENAME]?.content || '{}';
      return new Response(
        JSON.stringify({
          id: 'created-gist-123',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: storedContent,
            },
          },
        }),
        { status: 201, headers: { ETag: currentEtag } }
      );
    }

    if (method === 'PATCH' && url.includes('/gists/created-gist-123')) {
      const body = JSON.parse(String(init?.body || '{}'));
      storedContent = body.files?.[LUMINA_GIST_FILENAME]?.content || '{}';
      return new Response(
        JSON.stringify({
          id: 'created-gist-123',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: storedContent,
            },
          },
        }),
        { status: 200, headers: { ETag: '"etag-v2"' } }
      );
    }

    if (method === 'GET' && url.includes('/gists/created-gist-123')) {
      if (headers['If-None-Match'] === '"etag-v2"') {
        return new Response(null, { status: 304 });
      }
      return new Response(
        JSON.stringify({
          id: 'created-gist-123',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: storedContent,
            },
          },
        }),
        { status: 200, headers: { ETag: '"etag-v2"' } }
      );
    }

    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Auto-create a new Secret Gist when none exists
    const found = await findOrCreateLuminaGist('ghp_test_token_123');
    expect(found.created).toBe(true);
    expect(found.gistId).toBe('created-gist-123');

    // 2. Upload 850 cards in a single PATCH request
    const largeDeck = Array.from({ length: 850 }, (_, i) => makeCard(i));
    calls.length = 0;

    const payload = {
      cards: largeDeck,
      studyHistory: { '2026-11-10': 25 },
      longestStreak: 12,
      deletedCards: {},
    };

    expect(hasPendingGistSyncChanges('created-gist-123', payload)).toBe(true);
    const updateRes = await updateGistDeck('ghp_test_token_123', 'created-gist-123', payload);
    expect(updateRes.skippedUnchanged).toBe(false);
    expect(calls.filter((c) => c.method === 'PATCH').length).toBe(1);

    // 3. Immediate second updateGistDeck with identical data is skipped with 0 network requests
    calls.length = 0;
    expect(hasPendingGistSyncChanges('created-gist-123', payload)).toBe(false);
    const secondUpdate = await updateGistDeck('ghp_test_token_123', 'created-gist-123', payload);
    expect(secondUpdate.skippedUnchanged).toBe(true);
    expect(calls.length).toBe(0);

    // 4. getGistDeck uses If-None-Match ETag and handles 304 Not Modified in 1 fast request
    const pulled = await getGistDeck('ghp_test_token_123', 'created-gist-123');
    expect(pulled.cards.length).toBe(850);
    expect(pulled.longestStreak).toBe(12);
    expect(calls.length).toBe(1);
    expect(calls[0].headers['If-None-Match']).toBe('"etag-v2"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gistService loads >1 MB truncated Gists from gist.githubusercontent.com without CORS preflight failure and splits large decks into multi-part files', async () => {
  clearGistSyncCacheForTests();
  const full960Cards = Array.from({ length: 960 }, (_, i) => ({
    ...makeCard(i),
    status: i < 120 ? FlashcardStatus.Mastered : i < 240 ? FlashcardStatus.Learning : FlashcardStatus.New,
    repetition: i < 120 ? 5 : i < 240 ? 2 : 0,
    lastReviewed: i < 240 ? 1700005000000 + i : 0,
    translations: { fa: `ترجمه آزمایشی برای واژه شماره ${i}` },
  }));

  const rawUrl =
    'https://gist.githubusercontent.com/testuser/truncated-gist-999/raw/commitsha123/lumina_flashcards_backup.json';
  const fullRawPayload = JSON.stringify({
    cards: full960Cards,
    studyHistory: { '2026-11-12': 42 },
    longestStreak: 15,
    deletedCards: {},
    languagePreference: 'both',
    languagePreferenceUpdatedAt: 1700006000000,
  });

  const storedFiles: Record<string, { filename: string; content: string }> = {};
  let lastPatchFilesPayload: Record<string, { content: string } | null> = {};

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;

    // Exact simulation of gist.githubusercontent.com CORS behavior:
    // Any custom header (such as Authorization) triggers an OPTIONS preflight that fails with TypeError('Failed to fetch')!
    if (url === rawUrl) {
      if (Object.keys(headers).length > 0 || init?.credentials === 'include') {
        throw new TypeError('Failed to fetch');
      }
      return new Response(fullRawPayload, {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (method === 'GET' && url === 'https://api.github.com/gists/truncated-gist-999') {
      return new Response(
        JSON.stringify({
          id: 'truncated-gist-999',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              truncated: true,
              content: fullRawPayload.slice(0, 1024), // truncated invalid JSON slice
              raw_url: rawUrl,
            },
          },
        }),
        { status: 200, headers: { ETag: '"etag-trunc-1"' } }
      );
    }

    if (method === 'PATCH' && url === 'https://api.github.com/gists/multipart-gist-777') {
      const body = JSON.parse(String(init?.body || '{}'));
      lastPatchFilesPayload = body.files || {};
      for (const [fname, spec] of Object.entries(lastPatchFilesPayload)) {
        if (spec === null) {
          delete storedFiles[fname];
        } else if (spec && typeof spec.content === 'string') {
          storedFiles[fname] = { filename: fname, content: spec.content };
        }
      }
      return new Response(
        JSON.stringify({ id: 'multipart-gist-777', files: storedFiles }),
        { status: 200, headers: { ETag: `"etag-mp-${Object.keys(storedFiles).length}"` } }
      );
    }

    if (method === 'GET' && url === 'https://api.github.com/gists/multipart-gist-777') {
      return new Response(
        JSON.stringify({ id: 'multipart-gist-777', files: storedFiles }),
        { status: 200, headers: { ETag: `"etag-mp-${Object.keys(storedFiles).length}"` } }
      );
    }

    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // Part A: Loading >1 MB truncated single-file Gist succeeds without "Failed to fetch"
    const pulledTruncated = await getGistDeck('ghp_test_token_123', 'truncated-gist-999', {
      forceRefresh: true,
    });
    expect(pulledTruncated.cards.length).toBe(960);
    expect(pulledTruncated.cards.filter(c => c.status === FlashcardStatus.Mastered).length).toBe(120);
    expect(pulledTruncated.cards.filter(c => c.status === FlashcardStatus.Learning).length).toBe(120);
    expect(pulledTruncated.languagePreference).toBe('both');

    // Part B: Saving with a 90 KB per-part limit splits across multi-part files in 1 PATCH and cleans up obsolete parts on shrink
    await updateGistDeck(
      'ghp_test_token_123',
      'multipart-gist-777',
      {
        cards: full960Cards,
        studyHistory: { '2026-11-12': 42 },
        longestStreak: 15,
        deletedCards: {},
        languagePreference: 'both',
        languagePreferenceUpdatedAt: 1700006000000,
      },
      { maxBytesPerPart: 90 * 1024 }
    );

    const partNames = Object.keys(storedFiles).sort();
    expect(partNames).toContain(LUMINA_GIST_FILENAME);
    expect(partNames.some(k => k.startsWith(LUMINA_GIST_PART_PREFIX))).toBe(true);
    expect(partNames.length).toBeGreaterThanOrEqual(3);

    // Re-pulling from cold cache reassembles all 960 cards in 1 GET
    clearGistSyncCacheForTests();
    const reassembled = await getGistDeck('ghp_test_token_123', 'multipart-gist-777');
    expect(reassembled.cards.length).toBe(960);
    expect(reassembled.cards.filter(c => c.status === FlashcardStatus.Mastered).length).toBe(120);

    // Shrinking deck down to 10 cards deletes obsolete overflow part files (sets them to null in PATCH)
    await updateGistDeck(
      'ghp_test_token_123',
      'multipart-gist-777',
      {
        cards: full960Cards.slice(0, 10),
        studyHistory: { '2026-11-12': 42 },
        longestStreak: 15,
        deletedCards: {},
      },
      { maxBytesPerPart: 90 * 1024 }
    );
    expect(lastPatchFilesPayload[`${LUMINA_GIST_PART_PREFIX}2.json`]).toBeNull();
    expect(Object.keys(storedFiles)).toEqual([LUMINA_GIST_FILENAME]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mergeFlashcardDecks preserves latest SRS study statuses even when local updatedAt was bumped by translation backfill', () => {
  const NOV_11 = 1794400000000;
  const NOV_13_BACKFILL = 1794600000000;
  const NOV_14_AGAIN = 1794700000000;

  const localCards: Flashcard[] = [
    // Card 1: Unreviewed locally, but Persian backfill bumped updatedAt on Nov 13!
    {
      id: 'c-1',
      word: 'ameliorate',
      partOfSpeech: 'verb',
      mainDefinition: 'Old imprecise definition',
      translations: { fa: 'بهبود بخشیدن' },
      status: FlashcardStatus.New,
      repetition: 0,
      lastReviewed: 0,
      createdAt: NOV_11 - 100000,
      updatedAt: NOV_13_BACKFILL,
    },
    // Card 2: Previously corrupted hybrid card (New + repetition 0, but lastReviewed copied from earlier buggy merge)
    {
      id: 'c-2',
      word: 'ephemeral',
      partOfSpeech: 'adjective',
      mainDefinition: 'Lasting for a very short time.',
      status: FlashcardStatus.New,
      repetition: 0,
      lastReviewed: NOV_11,
      createdAt: NOV_11 - 100000,
      updatedAt: NOV_13_BACKFILL,
    },
    // Card 3: Reviewed locally TODAY with "Again" (quality=1 -> Learning, repetition=0)
    {
      id: 'c-3',
      word: 'obdurate',
      partOfSpeech: 'adjective',
      mainDefinition: 'Stubbornly refusing to change one’s opinion.',
      status: FlashcardStatus.Learning,
      repetition: 0,
      lastQuality: 1,
      lastReviewed: NOV_14_AGAIN,
      statusUpdatedAt: NOV_14_AGAIN,
      createdAt: NOV_11 - 100000,
      updatedAt: NOV_14_AGAIN,
    },
  ];

  const cloudCards: Flashcard[] = [
    // Card 1 was Mastered on another device on Nov 11 and has upgraded definition
    {
      id: 'c-1',
      word: 'ameliorate',
      partOfSpeech: 'verb',
      mainDefinition: 'To make something bad or unsatisfactory better.',
      status: FlashcardStatus.Mastered,
      repetition: 5,
      lastReviewed: NOV_11,
      createdAt: NOV_11 - 100000,
      updatedAt: NOV_11,
    },
    // Card 2 is Mastered on Cloud
    {
      id: 'c-2',
      word: 'ephemeral',
      partOfSpeech: 'adjective',
      mainDefinition: 'Lasting for a very short time.',
      status: FlashcardStatus.Mastered,
      repetition: 4,
      lastReviewed: NOV_11,
      createdAt: NOV_11 - 100000,
      updatedAt: NOV_11,
    },
    // Card 3 was Mastered on Cloud earlier (Nov 11), before user clicked "Again" today (Nov 14)
    {
      id: 'c-3',
      word: 'obdurate',
      partOfSpeech: 'adjective',
      mainDefinition: 'Stubbornly refusing to change one’s opinion.',
      status: FlashcardStatus.Mastered,
      repetition: 5,
      lastReviewed: NOV_11,
      createdAt: NOV_11 - 100000,
      updatedAt: NOV_11,
    },
  ];

  // Manual "Load from Cloud" (preferIncomingContent: true)
  const merged = mergeFlashcardDecks(localCards, cloudCards, {}, { preferIncomingContent: true });
  const byId = new Map(merged.map(c => [c.id, c]));

  // Card 1 updates to Mastered (rep 5), adopts Cloud's upgraded definition, AND keeps local Persian translation!
  expect(byId.get('c-1')?.status).toBe(FlashcardStatus.Mastered);
  expect(byId.get('c-1')?.repetition).toBe(5);
  expect(byId.get('c-1')?.mainDefinition).toBe('To make something bad or unsatisfactory better.');
  expect(byId.get('c-1')?.translations?.fa).toBe('بهبود بخشیدن');

  // Card 2 heals from corrupted New -> Mastered (rep 4)
  expect(byId.get('c-2')?.status).toBe(FlashcardStatus.Mastered);
  expect(byId.get('c-2')?.repetition).toBe(4);

  // Card 3 keeps today's newer "Again" review (Learning, repetition 0 — no leaked repetition: 5!)
  expect(byId.get('c-3')?.status).toBe(FlashcardStatus.Learning);
  expect(byId.get('c-3')?.repetition).toBe(0);
});

test('migrates from an active Pantry connection to GitHub Gist without losing any local, Pantry, or existing Gist data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  let uploadedGistPayload: any = null;
  let gistPatchCount = 0;

  // Mock Pantry API (multi-chunk Pantry deck)
  await page.route('https://getpantry.cloud/apiv1/pantry/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'GET' && url.includes('/basket/Lumina_1')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cards: [
            {
              id: 'pantry-card-2',
              word: 'Ephemeral',
              partOfSpeech: 'adjective',
              mainDefinition: 'Lasting for a very short time.',
              status: 'Mastered',
              lastReviewed: 1700000050000,
              createdAt: 1700000010000,
              updatedAt: 1700000050000,
            },
          ],
        }),
      });
      return;
    }

    if (method === 'GET' && url.includes('/basket/Lumina')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cards: [
            {
              id: 'pantry-card-1',
              word: 'Sagacious',
              partOfSpeech: 'adjective',
              mainDefinition: 'Having or showing keen mental discernment and good judgment.',
              status: 'Learning',
              lastReviewed: 1700000040000,
              createdAt: 1700000005000,
              updatedAt: 1700000040000,
            },
          ],
          studyHistory: {
            '2026-11-08': 8,
          },
          longestStreak: 6,
          deletedCards: {},
          chunkCount: 2,
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Mock GitHub Gist API
  await page.route('https://api.github.com/gists**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Auto-discover existing Lumina Gist on user's GitHub account
    if (method === 'GET' && url.includes('per_page=100')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'gist-abc123456789',
            description: 'Lumina Flashcards Cloud Sync Backup (Do not delete)',
            files: {
              [LUMINA_GIST_FILENAME]: {
                filename: LUMINA_GIST_FILENAME,
              },
            },
          },
        ]),
      });
      return;
    }

    // Fetch existing Gist content (has 1 existing card 'Magnanimous')
    if (method === 'GET' && url.includes('/gists/gist-abc123456789')) {
      const existingData = uploadedGistPayload || {
        cards: [
          {
            id: 'gist-existing-1',
            word: 'Magnanimous',
            partOfSpeech: 'adjective',
            mainDefinition: 'Generous or forgiving, especially toward a rival.',
            status: 'New',
            lastReviewed: 0,
            createdAt: 1700000020000,
            updatedAt: 1700000020000,
          },
        ],
        studyHistory: {
          '2026-11-07': 5,
        },
        longestStreak: 3,
        deletedCards: {},
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: '"gist-etag-1"' },
        body: JSON.stringify({
          id: 'gist-abc123456789',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: JSON.stringify(existingData),
            },
          },
        }),
      });
      return;
    }

    // Single-request PATCH upload to GitHub Gist
    if (method === 'PATCH' && url.includes('/gists/gist-abc123456789')) {
      gistPatchCount += 1;
      const body = JSON.parse(route.request().postData() || '{}');
      const rawContent = body.files?.[LUMINA_GIST_FILENAME]?.content || '{}';
      uploadedGistPayload = JSON.parse(rawContent);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: '"gist-etag-2"' },
        body: JSON.stringify({
          id: 'gist-abc123456789',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: rawContent,
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Seed local card + active Pantry connection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    localStorage.setItem(
      'lumina_cloud_config',
      JSON.stringify({ pantryId: 'pantry-old-1111-2222' })
    );
    localStorage.setItem(
      'lumina_cards_v1',
      JSON.stringify([
        {
          id: 'local-card-1',
          word: 'Perspicacious',
          partOfSpeech: 'adjective',
          mainDefinition: 'Having a ready insight into and understanding of things.',
          status: 'New',
          lastReviewed: 0,
          createdAt: 1700000030000,
          updatedAt: 1700000030000,
        },
      ])
    );
    localStorage.setItem(
      'lumina_study_history',
      JSON.stringify({
        '2026-11-09': 10,
      })
    );
    localStorage.setItem('lumina_longest_streak', '4');
  });

  await page.goto('/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  // Wait for startup Pantry pull to finish
  await expect(page.getByText('Perspicacious')).toBeVisible();
  await expect(page.getByText('Sagacious')).toBeVisible();
  await expect(page.getByText('Ephemeral')).toBeVisible();

  // Open Data Manager modal
  await page.getByTitle('Manage Data').click();
  await expect(page.getByRole('heading', { name: 'Data Manager' })).toBeVisible();

  // Verify the Pantry -> GitHub Gist migration callout is visible inside the connected Pantry view
  const openMigrateBtn = page.getByTestId('open-pantry-to-gist-migration');
  await expect(openMigrateBtn).toBeVisible();
  await openMigrateBtn.click();

  const tokenInput = page.getByTestId('pantry-to-gist-token-input');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill('ghp_valid_token_abc123');

  // Click "Migrate Pantry to GitHub Gist"
  await page.getByTestId('confirm-pantry-to-gist-btn').click();

  // Verify migration completes and switches active provider to GitHub Gist
  await expect(page.getByTestId('gist-active-badge')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('connected-gist-id')).toContainText('gist-abc123456789');
  await expect(page.getByText(/Migrated to GitHub Gist!/i)).toBeVisible();

  // Verify the uploaded Gist payload contains all 4 cards (local + 2 Pantry chunks + 1 existing Gist card), all 3 study days, and max streak 6
  expect(gistPatchCount).toBe(1);
  expect(uploadedGistPayload).toBeTruthy();
  const uploadedWords = uploadedGistPayload.cards.map((c: any) => c.word).sort();
  expect(uploadedWords).toEqual(['Ephemeral', 'Magnanimous', 'Perspicacious', 'Sagacious']);
  expect(uploadedGistPayload.studyHistory).toEqual({
    '2026-11-07': 5,
    '2026-11-08': 8,
    '2026-11-09': 10,
  });
  expect(uploadedGistPayload.longestStreak).toBe(6);

  // Close modal and verify all 4 cards are visible in the deck UI
  await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first().click();
  await expect(page.getByText('4 cards total')).toBeVisible();
  await expect(page.getByText('Magnanimous')).toBeVisible();
});

test('Load from Cloud succeeds on truncated >1 MB GitHub Gist without Failed to fetch and updates stale card statuses', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const rawGistUrl =
    'https://gist.githubusercontent.com/aliseyfi75/gist-large-954/raw/sha999/lumina_flashcards_backup.json';

  let remoteStage: 'initial' | 'afterRemoteStudy' = 'initial';
  let sawForbiddenAuthHeaderOnRaw = false;

  const getRemoteDeckJson = () =>
    JSON.stringify({
      cards: [
        {
          id: 'sync-card-1',
          word: 'Taciturn',
          partOfSpeech: 'adjective',
          mainDefinition: 'Reserved or uncommunicative in speech; saying little.',
          status: 'Mastered',
          repetition: 5,
          lastReviewed: 1794400000000,
          createdAt: 1794000000000,
          updatedAt: 1794400000000,
        },
        {
          id: 'sync-card-2',
          word: 'Fastidious',
          partOfSpeech: 'adjective',
          mainDefinition: 'Very attentive to and concerned about accuracy and detail.',
          status: remoteStage === 'afterRemoteStudy' ? 'Mastered' : 'Learning',
          repetition: remoteStage === 'afterRemoteStudy' ? 5 : 2,
          lastReviewed: remoteStage === 'afterRemoteStudy' ? 1794800000000 : 1794400000000,
          createdAt: 1794000005000,
          updatedAt: remoteStage === 'afterRemoteStudy' ? 1794800000000 : 1794400000000,
        },
      ],
      studyHistory: { '2026-11-11': 18 },
      longestStreak: 9,
      deletedCards: {},
      languagePreference: 'en',
      languagePreferenceUpdatedAt: 1794400000000,
    });

  await page.route('https://gist.githubusercontent.com/**', async (route) => {
    const reqHeaders = route.request().headers();
    if (reqHeaders['authorization'] || reqHeaders['x-github-api-version']) {
      sawForbiddenAuthHeaderOnRaw = true;
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: getRemoteDeckJson(),
    });
  });

  await page.route('https://api.github.com/gists/gist-large-954', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          ETag: remoteStage === 'afterRemoteStudy' ? '"etag-stage-2"' : '"etag-stage-1"',
        },
        body: JSON.stringify({
          id: 'gist-large-954',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              truncated: true,
              content: '{"cards":[', // truncated >1MB preview
              raw_url: rawGistUrl,
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Seed local cards as stale 'New' with an artificially NEWER updatedAt (simulating Persian backfill timestamp pollution)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    localStorage.setItem(
      'lumina_cloud_config',
      JSON.stringify({
        provider: 'gist',
        gistToken: 'ghp_valid_token_large',
        gistId: 'gist-large-954',
        pantryId: 'gist-large-954',
      })
    );
    localStorage.setItem(
      'lumina_cards_v1',
      JSON.stringify([
        {
          id: 'sync-card-1',
          word: 'Taciturn',
          partOfSpeech: 'adjective',
          mainDefinition: 'Old stale definition for taciturn',
          status: 'New',
          repetition: 0,
          lastReviewed: 0,
          createdAt: 1794000000000,
          updatedAt: 1794650000000, // newer than Cloud's 1794400000000!
        },
        {
          id: 'sync-card-2',
          word: 'Fastidious',
          partOfSpeech: 'adjective',
          mainDefinition: 'Very attentive to detail.',
          status: 'New',
          repetition: 0,
          lastReviewed: 0,
          createdAt: 1794000005000,
          updatedAt: 1794650000000, // newer than Cloud's 1794400000000!
        },
      ])
    );
  });

  await page.goto('/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  // Startup Gist sync must succeed without CORS error and update statuses from New -> Mastered & Learning!
  await expect(page.getByTestId('status-filter-mastered')).toContainText('1', { timeout: 8000 });
  await expect(page.getByTestId('status-filter-learning')).toContainText('1');
  await expect(page.getByTestId('status-filter-new')).toContainText('0');
  expect(sawForbiddenAuthHeaderOnRaw).toBe(false);

  // Now simulate studying 'Fastidious' -> Mastered on another device and clicking "Load from Cloud"
  remoteStage = 'afterRemoteStudy';

  await page.getByTitle('Manage Data').click();
  await expect(page.getByRole('heading', { name: 'Data Manager' })).toBeVisible();

  await page.getByRole('button', { name: 'Load from Cloud' }).click();
  await expect(
    page.getByText('Flashcards loaded from Cloud! Latest study statuses synced.')
  ).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Failed to fetch/i)).toHaveCount(0);
  expect(sawForbiddenAuthHeaderOnRaw).toBe(false);

  // Close Data Manager and verify both cards are now Mastered AND upgraded definition was adopted!
  await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first().click();
  await expect(page.getByTestId('status-filter-mastered')).toContainText('2');
  await expect(page.getByTestId('status-filter-learning')).toContainText('0');
  await page.getByRole('heading', { name: 'Taciturn' }).click();
  await expect(
    page.getByText('Reserved or uncommunicative in speech; saying little.')
  ).toBeVisible();
});

test('gistService distinguishes 403 secondary rate limits from 401/missing-scope errors, auto-retries short Retry-After, cleans tokens, and omits unchanged overflow parts on PATCH', async () => {
  clearGistSyncCacheForTests();

  // 1. Token sanitization strips accidental quotes, zero-width spaces, and Bearer/token prefixes
  expect(cleanGitHubToken('  "Bearer ghp_exampleToken123\u200B"  ')).toBe('ghp_exampleToken123');
  expect(cleanGitHubToken("'token ghp_anotherToken456'")).toBe('ghp_anotherToken456');

  let shortRetryAttempts = 0;
  const patchFilesHistory: Record<string, { content: string } | null>[] = [];
  const storedFiles: Record<string, { filename: string; content: string }> = {};

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;
    const authHeader = headers['Authorization'] || '';

    // Case A: Short secondary rate limit (Retry-After: 1) -> auto-retried transparently!
    if (url === 'https://api.github.com/gists/rate-short-1') {
      shortRetryAttempts += 1;
      if (shortRetryAttempts === 1) {
        return new Response(
          JSON.stringify({
            message:
              'You have exceeded a secondary rate limit. Please wait a few moments before you try again.',
          }),
          {
            status: 403,
            headers: {
              'Retry-After': '1',
              'X-OAuth-Scopes': 'gist',
            },
          }
        );
      }
      return new Response(
        JSON.stringify({
          id: 'rate-short-1',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: JSON.stringify({
                cards: [makeCard(1)],
                studyHistory: { '2026-11-15': 10 },
                longestStreak: 5,
                deletedCards: {},
              }),
            },
          },
        }),
        { status: 200, headers: { ETag: '"etag-short-ok"' } }
      );
    }

    // Case B: Longer secondary rate limit cooldown (Retry-After: 45) -> truthful rate-limit message
    if (url === 'https://api.github.com/gists?per_page=100' && authHeader.includes('rate_limited_tok')) {
      return new Response(
        JSON.stringify({
          message:
            'You have exceeded a secondary rate limit and have been temporarily blocked from content creation.',
        }),
        {
          status: 403,
          headers: {
            'Retry-After': '45',
            'X-OAuth-Scopes': 'gist',
          },
        }
      );
    }

    // Case C: Truly invalid/revoked token (401)
    if (url === 'https://api.github.com/gists?per_page=100' && authHeader.includes('revoked_tok')) {
      return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    }

    // Case D: Valid token missing "gist" OAuth scope (403 with X-OAuth-Scopes: repo)
    if (url === 'https://api.github.com/gists?per_page=100' && authHeader.includes('noscope_tok')) {
      return new Response(
        JSON.stringify({ message: 'Resource not accessible by personal access token' }),
        {
          status: 403,
          headers: { 'X-OAuth-Scopes': 'repo, read:user' },
        }
      );
    }

    // Case E: Differential multi-part PATCH verification
    if (method === 'PATCH' && url === 'https://api.github.com/gists/diff-parts-gist') {
      const body = JSON.parse(String(init?.body || '{}'));
      patchFilesHistory.push(body.files || {});
      for (const [fname, spec] of Object.entries(body.files || {})) {
        if (spec === null) {
          delete storedFiles[fname];
        } else if (spec && typeof (spec as any).content === 'string') {
          storedFiles[fname] = { filename: fname, content: (spec as any).content };
        }
      }
      return new Response(JSON.stringify({ id: 'diff-parts-gist', files: storedFiles }), {
        status: 200,
        headers: { ETag: `"etag-diff-${patchFilesHistory.length}"` },
      });
    }

    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // Verify Case A: Short Retry-After succeeds automatically
    const recovered = await getGistDeck('  "Bearer ghp_valid_short"  ', 'rate-short-1');
    expect(shortRetryAttempts).toBe(2);
    expect(recovered.cards.length).toBe(1);

    // Verify Case B: Longer 403 secondary rate limit NEVER claims token is invalid
    await expect(findOrCreateLuminaGist('ghp_rate_limited_tok')).rejects.toThrow(
      /rate limit reached due to rapid updates \(your token is valid\).*45s/i
    );

    // Verify Case C: 401 reports invalid/expired/revoked token
    await expect(findOrCreateLuminaGist('ghp_revoked_tok')).rejects.toThrow(
      /invalid, expired, or revoked/i
    );

    // Verify Case D: 403 without gist scope reports missing "gist" permission
    await expect(findOrCreateLuminaGist('ghp_noscope_tok')).rejects.toThrow(
      /missing "gist" permission/i
    );

    // Verify Case E: Reviewing 1 card in part 1 does NOT re-upload unchanged lumina_flashcards_part_2.json!
    const cards200 = Array.from({ length: 200 }, (_, i) => ({
      ...makeCard(i),
      mainDefinition: `Detailed definition text for vocabulary entry number ${i} to exceed part threshold.`,
    }));
    await updateGistDeck(
      'ghp_diff_tok',
      'diff-parts-gist',
      {
        cards: cards200,
        studyHistory: { '2026-11-15': 1 },
        longestStreak: 3,
        deletedCards: {},
      },
      { maxBytesPerPart: 18 * 1024 }
    );
    expect(patchFilesHistory.length).toBe(1);
    expect(Object.keys(patchFilesHistory[0])).toContain(`${LUMINA_GIST_PART_PREFIX}2.json`);

    // Now grade ONLY card 0 (which lives in lumina_flashcards_backup.json)
    const updatedCards = cards200.map((c, idx) =>
      idx === 0
        ? {
            ...c,
            status: FlashcardStatus.Mastered,
            repetition: 5,
            lastReviewed: 1700099999000,
            statusUpdatedAt: 1700099999000,
            updatedAt: 1700099999000,
          }
        : c
    );
    await updateGistDeck(
      'ghp_diff_tok',
      'diff-parts-gist',
      {
        cards: updatedCards,
        studyHistory: { '2026-11-15': 2 },
        longestStreak: 3,
        deletedCards: {},
      },
      { maxBytesPerPart: 18 * 1024 }
    );
    expect(patchFilesHistory.length).toBe(2);
    // Only the primary file was transmitted in the second PATCH — overflow part 2 was omitted!
    expect(Object.keys(patchFilesHistory[1])).toEqual([LUMINA_GIST_FILENAME]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StudySession coalesces rapid Gist auto-saves during active card grading and flushes once on session exit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const patchBodies: any[] = [];
  let simulateRateLimitOnManualPull = false;

  const initialCards: Flashcard[] = [
    {
      id: 'study-c1',
      word: 'Alacrity',
      partOfSpeech: 'noun',
      mainDefinition: 'Brisk and cheerful readiness.',
      status: FlashcardStatus.New,
      repetition: 0,
      lastReviewed: 0,
      createdAt: 1700000001000,
      updatedAt: 1700000001000,
    },
    {
      id: 'study-c2',
      word: 'Equanimity',
      partOfSpeech: 'noun',
      mainDefinition: 'Mental calmness and composure in a difficult situation.',
      status: FlashcardStatus.New,
      repetition: 0,
      lastReviewed: 0,
      createdAt: 1700000002000,
      updatedAt: 1700000002000,
    },
    {
      id: 'study-c3',
      word: 'Lucid',
      partOfSpeech: 'adjective',
      mainDefinition: 'Expressed clearly; easy to understand.',
      status: FlashcardStatus.New,
      repetition: 0,
      lastReviewed: 0,
      createdAt: 1700000003000,
      updatedAt: 1700000003000,
    },
  ];

  let latestCloudPayload: any = {
    cards: initialCards,
    studyHistory: {},
    longestStreak: 0,
    deletedCards: {},
  };

  await page.route('https://api.github.com/gists/gist-study-coalesce', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      if (simulateRateLimitOnManualPull) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          headers: {
            'Retry-After': '30',
            'X-OAuth-Scopes': 'gist',
          },
          body: JSON.stringify({
            message: 'You have exceeded a secondary rate limit. Please wait a few moments.',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: `"etag-study-${patchBodies.length}"` },
        body: JSON.stringify({
          id: 'gist-study-coalesce',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: JSON.stringify(latestCloudPayload),
            },
          },
        }),
      });
      return;
    }

    if (method === 'PATCH') {
      const body = JSON.parse(route.request().postData() || '{}');
      const content = JSON.parse(body.files?.[LUMINA_GIST_FILENAME]?.content || '{}');
      patchBodies.push(content);
      latestCloudPayload = content;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: `"etag-study-${patchBodies.length}"` },
        body: JSON.stringify({
          id: 'gist-study-coalesce',
          files: {
            [LUMINA_GIST_FILENAME]: {
              filename: LUMINA_GIST_FILENAME,
              content: JSON.stringify(content),
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.addInitScript((seededCards) => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    localStorage.setItem(
      'lumina_cloud_config',
      JSON.stringify({
        provider: 'gist',
        gistToken: 'ghp_study_coalesce_tok',
        gistId: 'gist-study-coalesce',
        pantryId: 'gist-study-coalesce',
      })
    );
    localStorage.setItem('lumina_cards_v1', JSON.stringify(seededCards));
  }, initialCards);

  await page.goto('/#/study');
  await expect(page.getByText('1 / 3')).toBeVisible();

  // Rapidly grade 2 cards back-to-back (~1.5s apart, just like real studying)
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: /Mastered/i }).click();
  await expect(page.getByText('2 / 3')).toBeVisible();

  await page.keyboard.press('Space');
  await page.getByRole('button', { name: /Mastered/i }).click();
  await expect(page.getByText('3 / 3')).toBeVisible();

  // Wait 2.2s (longer than the old 1000ms timer!) — verify NO Gist PATCH spam fired mid-study!
  await page.waitForTimeout(2200);
  expect(patchBodies.length).toBe(0);

  // Now exit the study session -> immediately flushes both graded cards in ONE single PATCH!
  await page.getByRole('button', { name: 'Exit study session' }).click();
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();
  await expect.poll(() => patchBodies.length, { timeout: 5000 }).toBe(1);

  const masteredInSingleCommit = patchBodies[0].cards.filter((c: any) => c.status === 'Mastered');
  expect(masteredInSingleCommit.length).toBe(2);

  // Also verify Data Manager shows truthful rate-limit message (NOT "invalid token") if GitHub returns 403 cooldown
  simulateRateLimitOnManualPull = true;
  await page.getByTitle('Manage Data').click();
  await page.getByRole('button', { name: 'Load from Cloud' }).click();
  await expect(
    page.getByText(/rate limit reached due to rapid updates \(your token is valid\)/i)
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/invalid or lacks/i)).toHaveCount(0);
});

