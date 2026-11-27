import { test, expect } from 'playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('PR 4: UI/UX, Accessibility & Visual Polish', () => {
  test('viewport meta allows pinch-zoom and root font scaling uses percentage', async ({ page }) => {
    await page.goto(`${BASE_URL}/#/`);
    const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportContent).toBeTruthy();
    expect(viewportContent).not.toContain('user-scalable=no');
    expect(viewportContent).not.toContain('maximum-scale=1');

    const rootFontSize = await page.evaluate(() => document.documentElement.style.fontSize);
    expect(rootFontSize.endsWith('%')).toBe(true);
  });

  test('first-time user sees Welcome to Lumina and Quick-Start Onboarding Card', async ({ page }) => {
    await page.goto(`${BASE_URL}/#/`);
    await expect(page.getByRole('heading', { name: /Welcome to Lumina/i })).toBeVisible();
    await expect(page.getByTestId('ftue-onboarding-card')).toBeVisible();
    await expect(page.getByRole('button', { name: /Explore Dictionary/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Prepare for a Book/i }).first()).toBeVisible();
  });

  test('modals expose role=dialog aria-modal=true and close on Escape key', async ({ page }) => {
    await page.goto(`${BASE_URL}/#/`);

    // Settings Modal
    await page.getByRole('button', { name: 'Open settings' }).click();
    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);

    // Data Manager Modal + segmented tabs
    await page.getByRole('button', { name: 'Manage Data' }).click();
    const dataDialog = page.getByRole('dialog');
    await expect(dataDialog).toBeVisible();
    await expect(dataDialog).toHaveAttribute('aria-modal', 'true');

    await page.getByTestId('data-manager-tab-import').click();
    await expect(dataDialog.getByText('Import from Anki')).toBeVisible();
    await expect(dataDialog.getByTestId('gist-cloud-section')).toHaveCount(0);

    await page.getByTestId('data-manager-tab-all').click();
    await expect(dataDialog.getByTestId('gist-cloud-section')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dataDialog).toHaveCount(0);
  });

  test('mobile viewport shows labeled bottom tab bar and hides desktop nav', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/#/`);

    const mobileNav = page.getByTestId('mobile-bottom-nav');
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: /^Home$/i })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: /^Dictionary$/i })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: /^Flashcards/i })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: /^Statistics$/i })).toBeVisible();

    await mobileNav.getByRole('link', { name: /^Dictionary$/i }).click();
    await expect(page).toHaveURL(/#\/dictionary$/);
    await expect(page.getByRole('heading', { name: /^Dictionary$/i })).toBeVisible();
  });

  test('StudySession shows dynamic next-interval copy and Return to Dashboard navigates home', async ({ page }) => {
    await page.addInitScript(() => {
      const now = Date.now();
      const cards = [
        {
          id: 'c-rep-2',
          word: 'Sagacious',
          phonetic: '/səˈɡeɪʃəs/',
          partOfSpeech: 'adjective',
          mainDefinition: 'Having keen mental discernment and good judgment.',
          example: 'The sagacious mentor offered timely advice.',
          status: 'Learning',
          interval: 7,
          repetition: 2,
          easinessFactor: 2.5,
          nextReviewDate: now - 1000,
          createdAt: now - 10000,
        },
      ];
      localStorage.setItem('lumina_cards_v1', JSON.stringify(cards));
    });
    await page.goto(`${BASE_URL}/#/`);

    await page.getByRole('button', { name: /Start Study Session/i }).click();
    await page.getByRole('button', { name: /Start Full Session/i }).click();
    await expect(page).toHaveURL(/#\/study$/);

    // Flip card
    await page.getByTestId('study-card-front').click();
    await expect(page.getByTestId('study-learned-interval')).toHaveText('14 days');

    // Rate Learned -> completes session
    await page.getByTestId('study-learned-btn').click();
    await expect(page.getByRole('heading', { name: /Session Complete/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Back to My Deck/i })).toBeVisible();

    // Return to Dashboard actually goes to '/'
    await page.getByRole('button', { name: /Return to Dashboard/i }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('Flashcards supports Undo single-card delete and Bulk Selection actions', async ({ page }) => {
    await page.addInitScript(() => {
      const now = Date.now();
      const cards = [
        {
          id: 'card-alpha',
          word: 'Alacrity',
          partOfSpeech: 'noun',
          mainDefinition: 'Brisk and cheerful readiness.',
          status: 'New',
          interval: 0,
          repetition: 0,
          easinessFactor: 2.5,
          createdAt: now - 2000,
        },
        {
          id: 'card-beta',
          word: 'Brevity',
          partOfSpeech: 'noun',
          mainDefinition: 'Concise and exact use of words.',
          status: 'New',
          interval: 0,
          repetition: 0,
          easinessFactor: 2.5,
          createdAt: now - 1000,
        },
      ];
      localStorage.setItem('lumina_cards_v1', JSON.stringify(cards));
    });
    await page.goto(`${BASE_URL}/#/flashcards`);
    await expect(page.getByText('Alacrity')).toBeVisible();

    // 1. Delete single card -> Undo snackbar appears -> Undo restores card
    await page.getByText('Alacrity').click();
    await page.getByRole('button', { name: 'Delete Card' }).first().click();
    await expect(page.getByTestId('undo-delete-snackbar')).toBeVisible();
    await expect(page.getByText('Alacrity', { exact: true })).toHaveCount(0);

    await page.getByTestId('undo-delete-card-btn').click();
    await expect(page.getByText('Alacrity')).toBeVisible();

    // 2. Bulk selection -> Mark Mastered
    await page.getByTestId('toggle-bulk-select-btn').click();
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible();
    await page.getByTestId('select-card-alacrity').click();
    await page.getByTestId('select-card-brevity').click();
    await expect(page.getByTestId('bulk-action-bar')).toContainText('2 selected');

    await page.getByTestId('bulk-mark-mastered-btn').click();
    await expect(page.getByTestId('status-filter-mastered')).toContainText('2');
  });

  test('Statistics heatmap cells are tap-inspectable and Reminders chart clarifies New cards', async ({ page }) => {
    await page.addInitScript(() => {
      const now = Date.now();
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      localStorage.setItem('lumina_cards_v1', JSON.stringify([
        {
          id: 'stat-1',
          word: 'Lucid',
          partOfSpeech: 'adjective',
          mainDefinition: 'Expressed clearly; easy to understand.',
          status: 'New',
          interval: 0,
          repetition: 0,
          easinessFactor: 2.5,
          createdAt: now,
        },
      ]));
      localStorage.setItem('lumina_study_history', JSON.stringify({ [dateStr]: 12 }));
    });
    await page.goto(`${BASE_URL}/#/statistics`);

    // Click a heatmap button -> selected day readout updates
    const lastSquare = page.locator('button[title*="12 interactions"]').first();
    await lastSquare.click();
    await expect(page.getByTestId('heatmap-selected-day')).toContainText('12 reviews');

    // Reminders tab clarifies New cards ready anytime
    await page.getByRole('button', { name: /Reminders/i }).click();
    await expect(page.getByText(/1 New card ready anytime/i)).toBeVisible();
  });

  test('SessionConfigModal adapts slider for <5 due cards and disables Start button when 0 due in selected chapter', async ({ page }) => {
    await page.addInitScript(() => {
      const now = Date.now();
      localStorage.setItem('lumina_cards_v1', JSON.stringify([
        {
          id: 'due-1',
          word: 'Veracity',
          partOfSpeech: 'noun',
          mainDefinition: 'Conformity to facts; accuracy.',
          status: 'New',
          tags: ['Book: Odyssey / Chapter 1'],
          interval: 0,
          repetition: 0,
          easinessFactor: 2.5,
          createdAt: now,
        },
        {
          id: 'due-2',
          word: 'Tenacity',
          partOfSpeech: 'noun',
          mainDefinition: 'The quality of being very determined.',
          status: 'New',
          tags: ['Book: Odyssey / Chapter 1'],
          interval: 0,
          repetition: 0,
          easinessFactor: 2.5,
          createdAt: now,
        },
        {
          id: 'mastered-1',
          word: 'DoneWord',
          partOfSpeech: 'noun',
          mainDefinition: 'Already mastered word.',
          status: 'Mastered',
          tags: ['Book: Odyssey / Chapter 2'],
          interval: 30,
          repetition: 5,
          easinessFactor: 2.5,
          createdAt: now,
        },
      ]));
    });
    await page.goto(`${BASE_URL}/#/flashcards`);

    await page.getByRole('button', { name: /Start Study Session/i }).click();
    // Switch to Short Burst to verify slider adapts to 2 due cards (min=1, max=2)
    await page.getByText('Short Burst').click();
    const slider = page.getByRole('slider', { name: 'Number of cards' });
    await expect(slider).toHaveAttribute('min', '1');
    await expect(slider).toHaveAttribute('max', '2');

    // Filter to Book: Odyssey and select mastered Chapter 2 -> 0 due -> button disabled
    const tagSelect = page.getByLabel('Study tag filter');
    await tagSelect.selectOption('Book: Odyssey');
    await page.getByRole('button', { name: /Chapter 2/i }).click();
    await expect(page.getByRole('button', { name: /No Cards Due/i })).toBeDisabled();
  });
});
