/**
 * Security & privacy helpers for sanitizing untrusted HTML and media URLs.
 */

const SAFE_IMAGE_DATA_URL_REGEX =
  /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Validates that a media URL (image or audio) uses a safe protocol.
 * Blocks `javascript:`, `vbscript:`, `data:text/html`, `data:image/svg+xml`, etc.
 */
export const sanitizeMediaUrl = (
  raw?: string | null,
  options?: { allowDataImage?: boolean }
): string | undefined => {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Strip ASCII control characters that can smuggle protocol schemes
  const normalized = trimmed.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!normalized) return undefined;

  if (options?.allowDataImage && SAFE_IMAGE_DATA_URL_REGEX.test(normalized)) {
    return normalized;
  }

  // Allow safe relative paths (e.g., ./icons/foo.png or /assets/foo.png) but not protocol-relative //evil.com
  if ((normalized.startsWith('./') || normalized.startsWith('/')) && !normalized.startsWith('//')) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

/**
 * Strips HTML markup into plain text using an inert DOMParser document so
 * inline event handlers (e.g. `<img src=x onerror=...>`) and external
 * resource fetches are never executed.
 */
export const stripHtmlSafely = (html: string): string => {
  if (!html || typeof html !== 'string') return '';

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((el) => {
        el.remove();
      });
      return (doc.body?.textContent ?? '').replace(/\u00A0/g, ' ').trim();
    } catch {
      // Fall through to regex fallback
    }
  }

  return html
    .replace(/<(script|style|noscript|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
};
