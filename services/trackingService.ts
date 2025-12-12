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

const ANONYMOUS_ID_KEY = 'lumina_anonymous_id';

/**
 * Initializes tracking by setting up the user ID (anonymous or real).
 */
export const initializeTracking = (userId?: string) => {
  if (typeof window.gtag !== 'function') {
    console.warn('Google Analytics (gtag) is not loaded.');
    return;
  }

  let finalUserId = userId;

  if (!finalUserId) {
    // Check for existing anonymous ID or create one
    let anonId = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!anonId) {
      try {
        anonId = crypto.randomUUID();
      } catch (e) {
        // Fallback for non-secure contexts where crypto.randomUUID is not available
        anonId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
      localStorage.setItem(ANONYMOUS_ID_KEY, anonId);
    }
    finalUserId = anonId;
  }

  // Set the User ID in GA
  window.gtag('config', 'G-YTM3MZZPYK', {
    'user_id': finalUserId
  });
};

/**
 * Updates the User ID (e.g., after cloud connection).
 */
export const setTrackingUserId = (userId: string) => {
  if (typeof window.gtag !== 'function') return;
  window.gtag('config', 'G-YTM3MZZPYK', {
    'user_id': userId
  });
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
