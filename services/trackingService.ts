// services/trackingService.ts

// Define the global gtag function type
declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

// Event Categories
export const TRACKING_CATEGORY = {
  ENGAGEMENT: 'engagement',
  DATA: 'data_management',
  CLOUD: 'cloud_sync',
  DICTIONARY: 'dictionary',
  FLASHCARDS: 'flashcards',
};

// Event Actions
export const TRACKING_ACTION = {
  VIEW_TAB: 'view_tab',
  SEARCH: 'search_word',
  ADD_CARD: 'add_card',
  DELETE_CARD: 'delete_card',
  UPDATE_STATUS: 'update_card_status',
  CONNECT_CLOUD: 'connect_cloud',
  DISCONNECT_CLOUD: 'disconnect_cloud',
  CONNECT_FILE: 'connect_file',
  IMPORT_CSV: 'import_csv',
  EXPORT_CSV: 'export_csv',
  MANUAL_SAVE: 'manual_save',
  CLOUD_PULL: 'cloud_pull',
  CLOUD_PUSH: 'cloud_push',
};

// Human-readable page titles for GA reports
export const PAGE_TITLES: Record<string, string> = {
  '/': 'Home – Dashboard',
  '/dictionary': 'Dictionary',
  '/flashcards': 'Flashcards',
  '/study': 'Study Session',
  '/statistics': 'Statistics',
};

const ANONYMOUS_ID_KEY = 'lumina_anonymous_id';
const TRACKING_HASH_SALT = 'lumina-ga-uid-v1:';
const GA_MEASUREMENT_ID = 'G-YTM3MZZPYK';

const getOrCreateAnonymousId = (): string => {
  try {
    let anonId = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!anonId) {
      try {
        anonId = crypto.randomUUID();
      } catch {
        anonId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
      localStorage.setItem(ANONYMOUS_ID_KEY, anonId);
    }
    return anonId;
  } catch {
    return 'lumina_anon';
  }
};

/**
 * Produces a one-way pseudonymous hash of an identifier (e.g. Pantry ID or Gist ID)
 * so raw cloud credentials / secret Gist IDs are never transmitted to third-party analytics.
 */
export const hashTrackingIdentifier = async (rawId: string): Promise<string> => {
  const clean = rawId.trim();
  if (!clean) return getOrCreateAnonymousId();

  const salted = `${TRACKING_HASH_SALT}${clean}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(salted);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `lumina_h_${hex.slice(0, 24)}`;
    }
  } catch {
    // Fall through to deterministic non-reversible hash fallback
  }

  // Fallback for non-secure contexts without crypto.subtle: dual FNV-1a 32-bit digest
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < salted.length; i++) {
    const ch = salted.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ ((i * 31) & 0xff);
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  return `lumina_h_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
};

const applyGtagUserId = (hashedOrAnonId: string) => {
  if (typeof window.gtag !== 'function') return;
  window.gtag('config', GA_MEASUREMENT_ID, {
    user_id: hashedOrAnonId,
  });
};

/**
 * Initializes tracking by setting up a privacy-safe user ID (anonymous UUID or hashed sync ID).
 */
export const initializeTracking = async (userId?: string): Promise<void> => {
  if (typeof window.gtag !== 'function') {
    console.warn('Google Analytics (gtag) is not loaded.');
    return;
  }

  const safeUserId = userId && userId.trim()
    ? await hashTrackingIdentifier(userId)
    : getOrCreateAnonymousId();

  applyGtagUserId(safeUserId);
};

/**
 * Updates the User ID (e.g., after cloud connection) using a one-way hash.
 */
export const setTrackingUserId = async (userId: string): Promise<void> => {
  if (typeof window.gtag !== 'function') return;
  const safeUserId = await hashTrackingIdentifier(userId);
  applyGtagUserId(safeUserId);
};

/**
 * Tracks a generic event.
 * @param action The event action (e.g., 'search', 'click').
 * @param category The event category.
 * @param label Optional label for additional info.
 * @param value Optional numeric value.
 */
export const trackEvent = (
  action: string,
  category: string,
  label?: string,
  value?: number
) => {
  if (typeof window.gtag !== 'function') return;

  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value: value,
  });
};

/**
 * Tracks a page view when the route changes.
 * Strips query parameters so tokens or sensitive URL params are never leaked to analytics.
 * @param path  The route path, e.g. '/flashcards'
 * @param title Human-readable page title for GA reports
 */
export const trackPageView = (path: string, title: string) => {
  if (typeof window.gtag !== 'function') return;

  const cleanPath = path.split('?')[0] || '/';
  const safeLocation = `${window.location.origin}${window.location.pathname}#${cleanPath}`;

  window.gtag('event', 'page_view', {
    page_path: cleanPath,
    page_title: title,
    page_location: safeLocation,
  });
};
