import type { Flashcard, CloudData } from '../types';

const BASE_URL = 'https://getpantry.cloud/apiv1/pantry';
const BASKET_NAME = 'Lumina';
const REQUEST_TIMEOUT_MS = 15000;

// Standard options to avoid CORS/Referrer issues in sensitive browser environments
const FETCH_OPTIONS: RequestInit = {
  referrerPolicy: 'no-referrer',
  mode: 'cors',
  credentials: 'omit'
};

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getDetails = async (pantryId: string) => {
  const response = await fetchWithTimeout(`${BASE_URL}/${pantryId}`, {
    ...FETCH_OPTIONS,
    method: 'GET'
  });

  if (!response.ok) {
    let details = '';
    try {
      const errJson = await response.json();
      details = errJson.details || errJson.error || '';
    } catch {
      details = response.statusText;
    }
    if (details.toLowerCase().includes('not found')) {
      throw new Error(`Pantry ID not found on server (Pantry deletes inactive IDs after ~30 days). Please create a new Pantry ID.`);
    }
    throw new Error(`Invalid Pantry ID or network error (${response.status}): ${details}`);
  }
  return await response.json();
};

export const getDeck = async (pantryId: string): Promise<CloudData> => {
  try {
    const response = await fetchWithTimeout(`${BASE_URL}/${pantryId}/basket/${BASKET_NAME}`, {
      ...FETCH_OPTIONS,
      method: 'GET'
    });

    if (!response.ok) {
      // If 400/404, it likely means the basket doesn't exist yet, which is fine.
      // We treat it as a new empty deck.
      return { cards: [] };
    }

    const data = await response.json();
    return {
      cards: Array.isArray(data.cards) ? data.cards : [],
      studyHistory: data.studyHistory || {},
      longestStreak: data.longestStreak || 0,
      deletedCards: data.deletedCards || {}
    };
  } catch (error) {
    console.warn("Could not fetch deck from Pantry (might be new):", error);
    return { cards: [] };
  }
};

export const updateDeck = async (pantryId: string, cloudData: CloudData) => {
  const url = `${BASE_URL}/${pantryId}/basket/${BASKET_NAME}`;
  const options: RequestInit = {
    ...FETCH_OPTIONS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cloudData),
  };

  let response = await fetchWithTimeout(url, options);

  // Retry once after a short delay if rate-limited by Pantry (HTTP 429)
  if (response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    response = await fetchWithTimeout(url, options);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to update Pantry storage: ${errorText}`);
  }
};