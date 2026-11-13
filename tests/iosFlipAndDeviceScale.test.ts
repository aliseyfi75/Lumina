import { test, expect } from 'playwright/test';

const SAMPLE_CARDS = [
  {
    id: 'ios-flip-1',
    word: 'Perspicacious',
    phonetic: '/ˌpərspəˈkāSHəs/',
    partOfSpeech: 'adjective',
    mainDefinition: 'Having a ready insight into and understanding of things.',
    example: 'She offered a perspicacious critique of the manuscript.',
    tags: ['Book: Classic Literature / Chapter 1'],
    complexity: 'advanced',
    status: 'New',
    lastReviewed: 0,
    createdAt: Date.now() - 2000,
  },
  {
    id: 'ios-flip-2',
    word: 'Sesquipedalianism',
    phonetic: '/ˌseskwəpəˈdālyənizəm/',
    partOfSpeech: 'noun',
    mainDefinition: 'The practice of using very long, multi-syllabic words in speech or writing.',
    example: 'His sesquipedalianism amused the entire lecture hall.',
    status: 'New',
    lastReviewed: 0,
    createdAt: Date.now() - 1000,
  },
];

async function seedDeck(page: import('playwright/test').Page) {
  await page.evaluate(async (seedCards) => {
    localStorage.setItem('lumina_cards_v1', JSON.stringify(seedCards));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lumina_db', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('app_data')) {
          db.createObjectStore('app_data');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('app_data', 'readwrite');
        tx.objectStore('app_data').put(
          { cards: seedCards, studyHistory: { '2026-01-01': 5 }, longestStreak: 3, deletedCards: {} },
          'appData'
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, SAMPLE_CARDS);
}

test.describe('iOS 3D Flashcard Flip Isolation & Device-Adaptive Scaling', () => {
  test('completely culls front face when flipped in Study Session, Deck Grid, and Home Preview (no mirrored bleed-through)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:5173/#/');
    await seedDeck(page);

    // 1. Verify Study Session 3D card flip
    await page.goto('http://localhost:5173/#/study');
    await page.reload();

    await expect(page.getByText('1 / 2')).toBeVisible();
    const frontPlane = page.getByTestId('study-card-front');
    const backPlane = page.getByTestId('study-card-back');

    await expect(frontPlane).toHaveAttribute('aria-hidden', 'false');
    await expect(backPlane).toHaveAttribute('aria-hidden', 'true');

    const beforeFlipState = await page.evaluate(() => {
      const front = document.querySelector('[data-testid="study-card-front"]') as HTMLElement;
      const back = document.querySelector('[data-testid="study-card-back"]') as HTMLElement;
      const frontInner = front.firstElementChild as HTMLElement;
      const backInner = back.firstElementChild as HTMLElement;
      return {
        frontPointer: getComputedStyle(front).pointerEvents,
        backPointer: getComputedStyle(back).pointerEvents,
        frontOpacity: getComputedStyle(frontInner).opacity,
        frontVisibility: getComputedStyle(frontInner).visibility,
        backOpacity: getComputedStyle(backInner).opacity,
        backVisibility: getComputedStyle(backInner).visibility,
        frontTransform: front.style.transform,
        backTransform: back.style.transform,
      };
    });

    expect(beforeFlipState.frontPointer).toBe('auto');
    expect(beforeFlipState.backPointer).toBe('none');
    expect(beforeFlipState.frontOpacity).toBe('1');
    expect(beforeFlipState.frontVisibility).toBe('visible');
    expect(beforeFlipState.backOpacity).toBe('0');
    expect(beforeFlipState.backVisibility).toBe('hidden');
    expect(beforeFlipState.frontTransform).toContain('translateZ(1px)');
    expect(beforeFlipState.backTransform).toContain('rotateY(180deg) translateZ(1px)');

    // Click card to flip to back
    await frontPlane.click();
    await page.waitForTimeout(700);

    await expect(frontPlane).toHaveAttribute('aria-hidden', 'true');
    await expect(backPlane).toHaveAttribute('aria-hidden', 'false');

    const afterFlipState = await page.evaluate(() => {
      const front = document.querySelector('[data-testid="study-card-front"]') as HTMLElement;
      const back = document.querySelector('[data-testid="study-card-back"]') as HTMLElement;
      const frontInner = front.firstElementChild as HTMLElement;
      const backInner = back.firstElementChild as HTMLElement;
      const rect = back.getBoundingClientRect();
      const centerHit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        frontPointer: getComputedStyle(front).pointerEvents,
        backPointer: getComputedStyle(back).pointerEvents,
        frontOpacity: getComputedStyle(frontInner).opacity,
        frontVisibility: getComputedStyle(frontInner).visibility,
        backOpacity: getComputedStyle(backInner).opacity,
        backVisibility: getComputedStyle(backInner).visibility,
        hitInsideBack: Boolean(centerHit && back.contains(centerHit)),
        hitInsideFront: Boolean(centerHit && front.contains(centerHit)),
      };
    });

    expect(afterFlipState.frontPointer).toBe('none');
    expect(afterFlipState.backPointer).toBe('auto');
    expect(afterFlipState.frontOpacity).toBe('0');
    expect(afterFlipState.frontVisibility).toBe('hidden');
    expect(afterFlipState.backOpacity).toBe('1');
    expect(afterFlipState.backVisibility).toBe('visible');
    expect(afterFlipState.hitInsideBack).toBe(true);
    expect(afterFlipState.hitInsideFront).toBe(false);

    // Grade card and test Undo resets flip cleanly to front
    await backPlane.getByRole('button', { name: /Mastered/i }).click();
    await expect(page.getByText('2 / 2')).toBeVisible();

    await page.getByRole('button', { name: 'Undo last review' }).click();
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(frontPlane).toHaveAttribute('aria-hidden', 'false');
    await expect(backPlane).toHaveAttribute('aria-hidden', 'true');

    // 2. Verify Flashcards deck grid card flip
    await page.goto('http://localhost:5173/#/flashcards');
    const deckFront = page.getByTestId('deck-card-front').first();
    const deckBack = page.getByTestId('deck-card-back').first();
    await expect(deckFront).toBeVisible();
    await deckFront.click();
    await page.waitForTimeout(700);
    await expect(deckFront).toHaveAttribute('aria-hidden', 'true');
    await expect(deckBack).toHaveAttribute('aria-hidden', 'false');

    const deckFlippedVisibility = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="deck-card-front"]')?.firstElementChild as HTMLElement;
      const b = document.querySelector('[data-testid="deck-card-back"]')?.firstElementChild as HTMLElement;
      return {
        frontVisibility: getComputedStyle(f).visibility,
        backVisibility: getComputedStyle(b).visibility,
      };
    });
    expect(deckFlippedVisibility.frontVisibility).toBe('hidden');
    expect(deckFlippedVisibility.backVisibility).toBe('visible');

    // 3. Verify Home Dashboard inline card preview flip
    await page.goto('http://localhost:5173/#/');
    await page.getByRole('button', { name: /Sesquipedalianism/i }).click();
    const dashFront = page.getByTestId('dashboard-card-front');
    const dashBack = page.getByTestId('dashboard-card-back');
    await expect(dashFront).toBeVisible();
    await dashFront.click();
    await page.waitForTimeout(700);
    await expect(dashFront).toHaveAttribute('aria-hidden', 'true');
    await expect(dashBack).toHaveAttribute('aria-hidden', 'false');
  });

  test('adapts root font-size and dimensions to device viewport and neutralizes oversized OS font inflation without horizontal overflow', async ({ page }) => {
    // Verify proportional scaling across device classes
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('http://localhost:5173/#/');
    await seedDeck(page);
    await page.reload();

    const compactRootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(compactRootPx).toBeGreaterThanOrEqual(13);
    expect(compactRootPx).toBeLessThanOrEqual(13.6);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const phoneRootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(phoneRootPx).toBeCloseTo(15, 1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(100);
    const desktopRootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(desktopRootPx).toBeCloseTo(16, 1);

    // Simulate an OS / browser environment that inflates explicit px font sizes by 1.35x (e.g., 135% system font size)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(100);

    const compensatedResult = await page.evaluate(() => {
      const root = document.documentElement;
      const origGetComputedStyle = window.getComputedStyle.bind(window);
      const inflationFactor = 1.35;

      window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
        const style = origGetComputedStyle(el, pseudo);
        if (el === root) {
          const rawInline = parseFloat(root.style.fontSize || '16');
          return new Proxy(style, {
            get(target, prop, receiver) {
              if (prop === 'fontSize') {
                return `${rawInline * inflationFactor}px`;
              }
              const val = Reflect.get(target, prop, receiver);
              return typeof val === 'function' ? val.bind(target) : val;
            },
          });
        }
        return style;
      }) as typeof window.getComputedStyle;

      try {
        window.dispatchEvent(new Event('resize'));
        return new Promise<{ targetPx: number; compensatedInlinePx: number; effectiveRenderedPx: number }>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const targetPx = parseFloat(root.dataset.targetRootPx || '0');
              const compensatedInlinePx = parseFloat(root.style.fontSize || '0');
              const effectiveRenderedPx = parseFloat(window.getComputedStyle(root).fontSize);
              resolve({ targetPx, compensatedInlinePx, effectiveRenderedPx });
            });
          });
        });
      } finally {
        // Restore after rafs settle via microtask delay
        setTimeout(() => {
          window.getComputedStyle = origGetComputedStyle;
          window.dispatchEvent(new Event('resize'));
        }, 60);
      }
    });

    expect(compensatedResult.compensatedInlinePx).toBeLessThan(compensatedResult.targetPx);
    expect(compensatedResult.effectiveRenderedPx).toBeCloseTo(compensatedResult.targetPx, 0);

    await page.waitForTimeout(120);

    // Check zero horizontal overflow on a compact Display-Zoomed mobile screen (320x568) across all main routes
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(100);

    for (const route of ['#/', '#/dictionary', '#/flashcards', '#/study', '#/statistics']) {
      await page.goto(`http://localhost:5173/${route}`);
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth, `Horizontal overflow on ${route}`).toBeLessThanOrEqual(overflow.innerWidth + 1);
    }
  });
});
