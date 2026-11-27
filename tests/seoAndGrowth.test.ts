import { test, expect } from 'playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('PR 6: SEO, Social Previews & First-Visit Value Prop', () => {
  test('index.html exposes SEO, Open Graph, Twitter Card, canonical, and valid JSON-LD WebApplication metadata', async ({ page }) => {
    await page.goto(`${BASE_URL}/#/`);

    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toBeTruthy();
    expect(description).toContain('spaced repetition');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe('https://aliseyfi75.github.io/Lumina/');

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content');
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    const ogType = await page.locator('meta[property="og:type"]').getAttribute('content');
    expect(ogType).toBe('website');
    expect(ogTitle).toContain('Lumina');
    expect(ogDesc).toBeTruthy();
    expect(ogImage).toBe('https://aliseyfi75.github.io/Lumina/og-preview.png');

    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    const twitterImage = await page.locator('meta[name="twitter:image"]').getAttribute('content');
    expect(twitterCard).toBe('summary_large_image');
    expect(twitterImage).toBe('https://aliseyfi75.github.io/Lumina/og-preview.png');

    const jsonLdRaw = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLdRaw).toBeTruthy();
    const jsonLd = JSON.parse(jsonLdRaw!);
    expect(jsonLd['@type']).toBe('WebApplication');
    expect(jsonLd.name).toBe('Lumina');
    expect(jsonLd.applicationCategory).toBe('EducationalApplication');
    expect(jsonLd.offers?.price).toBe('0');
    expect(Array.isArray(jsonLd.featureList)).toBe(true);
    expect(jsonLd.featureList.length).toBeGreaterThanOrEqual(4);
  });

  test('public/og-preview.png is served as a valid PNG image', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/og-preview.png`);
    expect(res.ok()).toBe(true);
    const buf = await res.body();
    // PNG magic bytes: 89 50 4E 47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
    expect(buf.length).toBeGreaterThan(10_000);
  });

  test('first-time visitors see a dismissible hero value-proposition strip that remembers dismissal', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify([]));
    });

    await page.goto(`${BASE_URL}/#/`);
    const strip = page.getByTestId('hero-value-prop-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(/free, private, works offline/i);

    await page.getByTestId('dismiss-value-prop-btn').click();
    await expect(strip).toHaveCount(0);

    // Persists across reload
    await page.reload();
    await expect(page.getByTestId('hero-value-prop-strip')).toHaveCount(0);
  });
});
