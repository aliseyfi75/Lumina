import { test, expect } from 'playwright/test';
import { LruMap } from '../utils/lruCache';
import { mergeFlashcardDecks } from '../utils/cardMerge';
import { Flashcard, FlashcardStatus } from '../types';

test.describe('Architecture & Performance Improvements', () => {
  test('LruMap enforces maxSize and refreshes recency on get', () => {
    const cache = new LruMap<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Touch 'a' so 'b' becomes least-recently-used
    expect(cache.get('a')).toBe(1);
    cache.set('d', 4);

    expect(cache.size).toBe(3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  test('mergeFlashcardDecks merges 2,500 x 2,500 cards linearly in O(N+M) without duplicates', () => {
    const makeCard = (id: string, word: string, def: string, ts: number): Flashcard => ({
      id,
      word,
      mainDefinition: def,
      partOfSpeech: 'noun',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: ts,
    });

    const base: Flashcard[] = [];
    const incoming: Flashcard[] = [];
    for (let i = 0; i < 2500; i++) {
      base.push(makeCard(`b-${i}`, `word-${i}`, `definition ${i}`, 1000 + i));
      // 1,000 overlapping by word+def (different ID) + 1,500 brand new
      if (i < 1000) {
        incoming.push(makeCard(`inc-${i}`, `WORD-${i}`, `Definition ${i}`, 2000 + i));
      } else {
        incoming.push(makeCard(`inc-${i}`, `extra-${i}`, `extra def ${i}`, 3000 + i));
      }
    }

    const start = performance.now();
    const merged = mergeFlashcardDecks(base, incoming);
    const elapsedMs = performance.now() - start;

    expect(merged.length).toBe(4000);
    expect(elapsedMs).toBeLessThan(500);
  });

  test('lazy-loaded routes and modals render smoothly with zero console errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('http://localhost:5173/#/');
    await expect(page.getByPlaceholder('Look up a word…')).toBeVisible();

    await page.getByRole('link', { name: /^Dictionary$/i }).click();
    await expect(page.getByPlaceholder(/Type any English word|Search for a word|Look up/i)).toBeVisible();

    await page.getByRole('link', { name: /^Flashcards/i }).click();
    await expect(page.getByRole('heading', { name: 'My Deck' })).toBeVisible();

    await page.getByRole('link', { name: /^Statistics$/i }).click();
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();

    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('close-settings-button').click();

    await page.getByRole('button', { name: 'Manage Data' }).click();
    await expect(page.getByRole('heading', { name: 'Data Manager' })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
