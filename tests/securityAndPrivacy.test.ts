import { test, expect } from 'playwright/test';
import { sanitizeMediaUrl, stripHtmlSafely } from '../utils/security';
import { hashTrackingIdentifier } from '../services/trackingService';

test.describe('Security & Privacy Hardening', () => {
  test('stripHtmlSafely removes XSS payloads and inline scripts/styles without executing handlers', async ({ page }) => {
    await page.setContent('<!DOCTYPE html><html><body></body></html>');

    const result = await page.evaluate(() => {
      (window as any).__xssTriggered = false;
      const payloads = [
        'Hello <img src="https://example.invalid/tracker.png" onerror="window.__xssTriggered=true"> World',
        '<script>window.__xssTriggered=true;</script><b>Clean</b><style>body{display:none}</style>',
        '<svg onload="window.__xssTriggered=true">Safe Text</svg>',
      ];

      const strip = (html: string) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((el) => el.remove());
        return (doc.body?.textContent ?? '').replace(/\u00A0/g, ' ').trim();
      };

      const outputs = payloads.map(strip);
      return {
        outputs,
        xssTriggered: Boolean((window as any).__xssTriggered),
      };
    });

    expect(result.xssTriggered).toBe(false);
    expect(result.outputs[0]).toBe('Hello  World');
    expect(result.outputs[1]).toBe('Clean');
    expect(result.outputs[2]).toBe('Safe Text');

    // Also verify Node fallback path in stripHtmlSafely
    expect(stripHtmlSafely('<script>alert(1)</script><div>Ephemeral&nbsp;meaning</div>')).toBe('Ephemeral meaning');
    expect(stripHtmlSafely('<style>.x{color:red}</style><img src=x onerror=alert(1)>Valid')).toBe('Valid');
  });

  test('sanitizeMediaUrl blocks dangerous schemes and preserves safe URLs', () => {
    expect(sanitizeMediaUrl('javascript:alert(1)', { allowDataImage: true })).toBeUndefined();
    expect(sanitizeMediaUrl('  JaVaScRiPt:alert(1)', { allowDataImage: true })).toBeUndefined();
    expect(sanitizeMediaUrl('vbscript:msgbox(1)', { allowDataImage: true })).toBeUndefined();
    expect(sanitizeMediaUrl('data:text/html,<script>alert(1)</script>', { allowDataImage: true })).toBeUndefined();
    expect(sanitizeMediaUrl('data:image/svg+xml;base64,PHN2Zz4=', { allowDataImage: true })).toBeUndefined();
    expect(sanitizeMediaUrl('//evil.example/img.png', { allowDataImage: true })).toBeUndefined();

    expect(sanitizeMediaUrl('https://upload.wikimedia.org/test.png', { allowDataImage: true })).toBe(
      'https://upload.wikimedia.org/test.png'
    );
    expect(sanitizeMediaUrl('data:image/png;base64,iVBORw0KGgo=', { allowDataImage: true })).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    );
    expect(sanitizeMediaUrl('data:image/png;base64,iVBORw0KGgo=', { allowDataImage: false })).toBeUndefined();
    expect(sanitizeMediaUrl('./icons/icon-192.png')).toBe('./icons/icon-192.png');
  });

  test('hashTrackingIdentifier hashes raw Pantry/Gist IDs and app never leaks raw cloud IDs to gtag', async ({ page }) => {
    const rawPantryId = '94389b12-3456-7890-abcd-ef1234567890';
    const hashed = await hashTrackingIdentifier(rawPantryId);
    expect(hashed).toMatch(/^lumina_h_[0-9a-f]{16,24}$/);
    expect(hashed).not.toContain(rawPantryId);
    expect(hashed).toBe(await hashTrackingIdentifier(rawPantryId));

    await page.addInitScript((pantryId) => {
      localStorage.setItem('lumina_cloud_config', JSON.stringify({ provider: 'pantry', pantryId }));
    }, rawPantryId);

    await page.route('https://www.googletagmanager.com/**', (route) => route.abort());
    await page.route('https://getpantry.cloud/apiv1/pantry/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cards: [], chunkCount: 1 }),
      });
    });

    await page.goto('http://localhost:5173/#/');
    await page.waitForFunction(() => {
      const dl = (window as any).dataLayer || [];
      return dl.some((entry: any) => entry?.[0] === 'config' && entry?.[2]?.user_id);
    }, { timeout: 5000 });

    const dataLayerEntries = await page.evaluate(() =>
      ((window as any).dataLayer || []).map((entry: any) => Array.from(entry))
    );

    const serialized = JSON.stringify(dataLayerEntries);
    expect(serialized).not.toContain(rawPantryId);

    const configCall = dataLayerEntries.find((c: any[]) => c[0] === 'config' && c[2]?.user_id);
    expect(configCall).toBeTruthy();
    expect(configCall![2].user_id).toBe(hashed);
  });
});
