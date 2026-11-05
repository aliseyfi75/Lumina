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
    path: '/Users/aliseyfi/.gemini/antigravity/brain/a96b9d77-0d1a-4784-ac20-758650393c58/scratch/pantry_connect_progress.png',
  });

  // Release upload and verify completion
  releaseUpload?.();

  await expect(page.getByText(/Connected & merged 1 local \+ 1 cloud cards/i)).toBeVisible({ timeout: 8000 });
  await expect(progressContainer).toBeHidden();
});
