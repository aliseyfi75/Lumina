import { test, expect } from 'playwright/test';

test('displays step-by-step progress bar when connecting and migrating Pantry IDs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  let holdUploadResolve: (() => void) | null = null;
  const uploadStartedPromise = new Promise<void>((resolve) => {
    holdUploadResolve = resolve;
  });
  let releaseUpload: (() => void) | null = null;
  const releaseUploadPromise = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });

  // Mock Pantry API endpoints
  await page.route('https://getpantry.cloud/apiv1/pantry/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (!url.includes('/basket/') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Lumina Test Pantry',
          baskets: [{ name: 'Lumina', ttl: 2592000 }],
        }),
      });
      return;
    }

    if (url.includes('/basket/Lumina') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cards: [
            {
              id: 'cloud-1',
              word: 'Sagacious',
              partOfSpeech: 'adjective',
              mainDefinition: 'Having or showing keen mental discernment and good judgment.',
              status: 'New',
              lastReviewed: 0,
              createdAt: Date.now() - 20000,
            },
          ],
          chunkCount: 1,
        }),
      });
      return;
    }

    if (url.includes('/basket/Lumina') && method === 'POST') {
      holdUploadResolve?.();
      await releaseUploadPromise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.addInitScript(() => {
    const initialCards = [
      {
        id: 'local-1',
        word: 'Perspicacious',
        partOfSpeech: 'adjective',
        mainDefinition: 'Having a ready insight into and understanding of things.',
        status: 'New',
        lastReviewed: 0,
        createdAt: Date.now() - 10000,
        repetition: 0,
        nextReviewDate: Date.now() - 1000,
      },
    ];
    localStorage.setItem('lumina_cards_v1', JSON.stringify(initialCards));
  });

  await page.goto('/#/flashcards');
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  // Open Data Manager modal
  await page.getByTitle('Manage Data').click();
  await expect(page.getByRole('heading', { name: 'Data Manager' })).toBeVisible();

  // Enter Pantry ID and click Connect & Sync Storage
  const pantryInput = page.getByPlaceholder('New or Existing Pantry ID');
  await pantryInput.fill('11111111-2222-3333-4444-555555555555');
  await page.getByRole('button', { name: 'Connect & Sync Storage' }).click();

  // Wait until upload stage is reached and verify progress bar is visible with step text & percentage
  await uploadStartedPromise;

  const progressContainer = page.getByTestId('pantry-progress-bar');
  await expect(progressContainer).toBeVisible();
  await expect(progressContainer).toContainText(/Uploading 2 flashcards to Pantry/i);

  const progressBar = progressContainer.getByRole('progressbar', { name: 'Pantry sync progress' });
  await expect(progressBar).toBeVisible();
  const valueNow = Number(await progressBar.getAttribute('aria-valuenow'));
  expect(valueNow).toBeGreaterThanOrEqual(70);

  await page.waitForTimeout(250);
  await page.screenshot({
    path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/pantry_connect_progress.png',
  });

  // Release upload and verify completion
  releaseUpload?.();

  await expect(page.getByText(/Connected & merged 1 local \+ 1 cloud cards/i)).toBeVisible({ timeout: 8000 });
  await expect(progressContainer).toBeHidden();

  // Simulate localStorage eviction of lumina_cloud_config and reload the page — IndexedDB must restore the Pantry connection
  await page.evaluate(() => {
    localStorage.removeItem('lumina_cloud_config');
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

  await page.getByTitle('Manage Data').click();
  await expect(page.getByText('11111111-2222-3333-4444-555555555555')).toBeVisible();
});

test('Load from Cloud preserves already-downloaded chunks when interrupted mid-load and resumes from the remaining chunk on retry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const requestedGetBaskets: string[] = [];
  let failChunk1 = false;

  await page.route('https://getpantry.cloud/apiv1/pantry/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'GET' && url.includes('/basket/')) {
      const match = url.match(/\/basket\/([^?]+)/);
      const basketName = match ? match[1] : url;
      requestedGetBaskets.push(basketName);

      if (basketName === 'Lumina') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cards: [
              {
                id: 'chunk0-card',
                word: 'Ephemeral',
                partOfSpeech: 'adjective',
                mainDefinition: 'Lasting for a very short time.',
                status: 'New',
                lastReviewed: 0,
                createdAt: 1700000000000,
              },
            ],
            chunkCount: 2,
          }),
        });
        return;
      }

      if (basketName === 'Lumina_1') {
        if (failChunk1) {
          await route.fulfill({
            status: 400,
            contentType: 'text/plain',
            body: 'Simulated interruption on chunk 2',
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cards: [
              {
                id: 'chunk1-card',
                word: 'Magnanimous',
                partOfSpeech: 'adjective',
                mainDefinition: 'Generous or forgiving.',
                status: 'New',
                lastReviewed: 0,
                createdAt: 1700000010000,
              },
            ],
          }),
        });
        return;
      }
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Seed connected Pantry config; failChunk1 = true during initial load so chunk 1 succeeds and chunk 2 is interrupted
  failChunk1 = true;
  await page.addInitScript(() => {
    localStorage.setItem(
      'lumina_cloud_config',
      JSON.stringify({ pantryId: '22222222-3333-4444-5555-666666666666' })
    );
    localStorage.setItem('lumina_cards_v1', JSON.stringify([]));
  });

  await page.goto('/#/flashcards');

  // Wait for the initial startup pull to fetch Lumina (chunk 1) and fail on Lumina_1 (chunk 2)
  await expect.poll(() => requestedGetBaskets.includes('Lumina_1'), { timeout: 5000 }).toBe(true);
  // Even though chunk 2 failed during startup, chunk 1 ('Ephemeral') was already progressively merged!
  await expect(page.getByText('Ephemeral')).toBeVisible();

  // Open Data Manager and click "Load from Cloud" to resume from chunk 2 (Lumina_1)
  await page.getByTitle('Manage Data').click();
  await expect(page.getByRole('heading', { name: 'Data Manager' })).toBeVisible();

  // Clear tracked baskets, allow chunk 2 (Lumina_1) to succeed now, and click "Load from Cloud"
  requestedGetBaskets.length = 0;
  failChunk1 = false;
  await page.getByRole('button', { name: /Load from Cloud/i }).click();

  await expect(page.getByText('Flashcards loaded from Cloud!')).toBeVisible({ timeout: 8000 });

  // Verify it resumed directly at Lumina_1 without re-fetching Lumina!
  expect(requestedGetBaskets).toEqual(['Lumina_1']);

  // Now click "Load from Cloud" a second time right away when nothing has changed in the cloud:
  // It should only check the main 'Lumina' manifest and skip re-downloading 'Lumina_1'!
  requestedGetBaskets.length = 0;
  await page.getByRole('button', { name: /Load from Cloud/i }).click();
  await expect(page.getByRole('button', { name: /Load from Cloud/i })).toBeEnabled({ timeout: 8000 });
  expect(requestedGetBaskets).toEqual(['Lumina']);

  await page.screenshot({
    path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/pantry_resumed_cloud_pull.png',
  });

  // Close modal and verify both chunks' cards ('Ephemeral' and 'Magnanimous') are in the deck
  await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first().click();
  await expect(page.getByText('2 cards total')).toBeVisible();
  await expect(page.getByText('Ephemeral')).toBeVisible();
  await expect(page.getByText('Magnanimous')).toBeVisible();
});

test('Load from Cloud automatically sleeps and retries when Pantry returns 502 mid-load without showing an error', async ({ page }) => {
  let chunk1Calls = 0;

  await page.route('https://getpantry.cloud/apiv1/pantry/**', async route => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const basketMatch = url.match(/\/basket\/([^?]+)/);
    const basketName = basketMatch ? basketMatch[1] : null;

    if (method === 'GET') {
      if (!basketName) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'Lumina',
            baskets: [{ name: 'Lumina' }, { name: 'Lumina_1' }],
          }),
        });
        return;
      }

      if (basketName === 'Lumina') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cards: [
              {
                id: 'c0',
                word: 'Serendipity',
                partOfSpeech: 'noun',
                mainDefinition: 'Happy accident.',
                status: 'New',
                lastReviewed: 0,
                createdAt: Date.now() - 30000,
              },
            ],
            chunkCount: 2,
          }),
        });
        return;
      }

      if (basketName === 'Lumina_1') {
        chunk1Calls++;
        if (chunk1Calls === 1) {
          // Simulate a transient 502 error mid-load on the first try
          await route.fulfill({
            status: 502,
            contentType: 'text/plain',
            body: 'Bad Gateway',
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cards: [
              {
                id: 'c1',
                word: 'Perspicacious',
                partOfSpeech: 'adjective',
                mainDefinition: 'Having a ready insight into things.',
                status: 'New',
                lastReviewed: 0,
                createdAt: Date.now() - 20000,
              },
            ],
          }),
        });
        return;
      }
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'lumina_cloud_config',
      JSON.stringify({ pantryId: '77777777-3333-4444-5555-666666666666' })
    );
    localStorage.setItem('lumina_cards_v1', JSON.stringify([]));
  });

  await page.goto('/#/flashcards');

  // Wait for automatic sleep + retry to finish loading both chunks without error
  await expect(page.getByText('Serendipity')).toBeVisible({ timeout: 12000 });
  await expect(page.getByText('Perspicacious')).toBeVisible({ timeout: 12000 });
  expect(chunk1Calls).toBeGreaterThanOrEqual(2);
});

