import { test, expect } from 'playwright/test';
import {
  findOrCreateLuminaGist,
  getGistDeck,
  updateGistDeck,
  hasPendingGistSyncChanges,
  LUMINA_GIST_FILENAME,
} from '../services/gistService';
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

  // Take a screenshot of the Pantry -> GitHub Gist migration drawer before submitting
  await page.screenshot({
    path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/gist_migration_drawer.png',
  });

  // Click "Migrate Pantry to GitHub Gist"
  await page.getByTestId('confirm-pantry-to-gist-btn').click();

  // Verify migration completes and switches active provider to GitHub Gist
  await expect(page.getByTestId('gist-active-badge')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('connected-gist-id')).toContainText('gist-abc123456789');
  await expect(page.getByText(/Migrated to GitHub Gist!/i)).toBeVisible();

  // Take a screenshot of the active GitHub Gist state in Data Manager
  await page.screenshot({
    path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/gist_connected_active.png',
  });

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
