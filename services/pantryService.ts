import type { Flashcard, CloudData } from '../types';

const BASE_URL = 'https://getpantry.cloud/apiv1/pantry';
const BASKET_NAME = 'Lumina';
const REQUEST_TIMEOUT_MS = 15000;

// Express body-parser default limit is 100 KB; keep each basket POST safely below 85 KB.
const MAX_BASKET_BYTES = 85 * 1024;
// Pantry's total storage quota per Pantry ID is 1.44 MB.
const MAX_PANTRY_BYTES = Math.floor(1.4 * 1024 * 1024);
// Minimum delay between sequential Pantry API calls to respect ~2 req/sec rate limit.
const RATE_LIMIT_DELAY_MS = 650;

// Standard options to avoid CORS/Referrer issues in sensitive browser environments
const FETCH_OPTIONS: RequestInit = {
  referrerPolicy: 'no-referrer',
  mode: 'cors',
  credentials: 'omit',
  cache: 'no-store',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestTime = 0;

// Ensure sequential Pantry requests are spaced out by at least RATE_LIMIT_DELAY_MS
const throttlePantryRequest = async () => {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (lastRequestTime > 0 && elapsed < RATE_LIMIT_DELAY_MS) {
    await sleep(RATE_LIMIT_DELAY_MS - elapsed);
  }
  lastRequestTime = Date.now();
};

const normalizePantryId = (raw: string): string => {
  const trimmed = raw.trim();
  const match = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : trimmed;
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> => {
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

const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  retries = 3,
  delayMs = 900
): Promise<Response> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttlePantryRequest();
      const response = await fetchWithTimeout(url, options);
      // Retry on rate-limit (429) or transient gateway/server errors (500, 502, 503, 504)
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const waitTime = response.status === 429 ? Math.max(2000, delayMs * Math.pow(2, attempt)) : delayMs * Math.pow(2, attempt);
        await sleep(waitTime);
        continue;
      }
      return response;
    } catch (err: any) {
      // In Safari/WebKit, Cloudflare 502s or rate-limit drops without CORS headers throw TypeError("Load failed")
      if (attempt < retries) {
        await sleep(delayMs * Math.pow(2, attempt));
        continue;
      }
      const isGenericNetworkErr =
        err instanceof TypeError ||
        err?.name === 'AbortError' ||
        /load failed|failed to fetch|networkerror/i.test(err?.message || '');
      if (isGenericNetworkErr) {
        throw new Error(
          'Unable to reach Pantry (getpantry.cloud returned a 502/CORS error or is rate-limiting requests). Please wait a few seconds and try again.'
        );
      }
      throw err;
    }
  }
  throw new Error('Unable to reach Pantry after multiple attempts.');
};

export interface PantryDetails {
  name: string;
  description?: string;
  percentFull?: number;
  baskets?: Array<{ name: string; ttl?: number }>;
}

export const getDetails = async (pantryId: string): Promise<PantryDetails> => {
  const cleanId = normalizePantryId(pantryId);
  const response = await fetchWithRetry(`${BASE_URL}/${cleanId}`, {
    ...FETCH_OPTIONS,
    method: 'GET',
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
      throw new Error(
        'Pantry ID not found on server (Pantry deletes inactive IDs after ~30 days). Please create a new Pantry ID.'
      );
    }
    throw new Error(`Invalid Pantry ID or network error (${response.status}): ${details}`);
  }
  return await response.json();
};

export const getDeck = async (
  pantryId: string,
  existingBaskets?: Array<{ name: string }>
): Promise<CloudData> => {
  const cleanId = normalizePantryId(pantryId);

  // If caller already fetched Pantry details, skip the GET call if the basket doesn't exist yet
  if (existingBaskets) {
    const hasMainBasket = existingBaskets.some(b => b.name === BASKET_NAME);
    if (!hasMainBasket) {
      return { cards: [] };
    }
  }

  try {
    const response = await fetchWithRetry(`${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`, {
      ...FETCH_OPTIONS,
      method: 'GET',
    });

    if (!response.ok) {
      // If 400/404, it likely means the basket doesn't exist yet, which is fine.
      return { cards: [] };
    }

    const data = await response.json();
    let allCards: Flashcard[] = Array.isArray(data.cards) ? data.cards : [];
    const chunkCount = typeof data.chunkCount === 'number' ? data.chunkCount : 1;

    // Fetch additional card chunks if the deck was split across multiple baskets
    for (let i = 1; i < chunkCount; i++) {
      const chunkRes = await fetchWithRetry(`${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}`, {
        ...FETCH_OPTIONS,
        method: 'GET',
      });
      if (chunkRes.ok) {
        const chunkData = await chunkRes.json();
        if (Array.isArray(chunkData.cards)) {
          allCards = allCards.concat(chunkData.cards);
        }
      }
    }

    return {
      cards: allCards,
      studyHistory: data.studyHistory || {},
      longestStreak: data.longestStreak || 0,
      deletedCards: data.deletedCards || {},
    };
  } catch (error) {
    console.warn('Could not fetch deck from Pantry (might be new):', error);
    return { cards: [] };
  }
};

const splitCardsIntoChunks = (cards: Flashcard[], maxChunkBytes: number): Flashcard[][] => {
  if (cards.length === 0) return [[]];
  const chunks: Flashcard[][] = [];
  let currentChunk: Flashcard[] = [];
  let currentBytes = 20; // overhead for {"cards":[]}

  for (const card of cards) {
    const cardBytes = new Blob([JSON.stringify(card)]).size + 1;
    if (currentChunk.length > 0 && currentBytes + cardBytes > maxChunkBytes) {
      chunks.push(currentChunk);
      currentChunk = [card];
      currentBytes = 20 + cardBytes;
    } else {
      currentChunk.push(card);
      currentBytes += cardBytes;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
};

export const updateDeck = async (pantryId: string, cloudData: CloudData) => {
  const cleanId = normalizePantryId(pantryId);
  const fullPayload = JSON.stringify({ ...cloudData, chunkCount: 1 });
  const totalBytes = new Blob([fullPayload]).size;

  if (totalBytes > MAX_PANTRY_BYTES) {
    const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Your deck (${sizeMb} MB) exceeds Pantry's 1.44 MB free storage limit. Please use Local File Auto-Save or Export JSON for large decks.`
    );
  }

  // Fast path: fits in a single basket under Express's 100 KB body-parser limit
  if (totalBytes <= MAX_BASKET_BYTES) {
    const response = await fetchWithRetry(`${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`, {
      ...FETCH_OPTIONS,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: fullPayload,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to update Pantry storage (${response.status}): ${errorText}`);
    }
    return;
  }

  // Multi-basket path: split cards across Lumina, Lumina_1, Lumina_2, ...
  const metadataOverhead = new Blob([
    JSON.stringify({
      cards: [],
      studyHistory: cloudData.studyHistory,
      longestStreak: cloudData.longestStreak,
      deletedCards: cloudData.deletedCards,
      chunkCount: 99,
    }),
  ]).size;

  const firstChunkMax = Math.max(20 * 1024, MAX_BASKET_BYTES - metadataOverhead);
  const allCards = cloudData.cards || [];

  // Build chunk 0 with room for metadata, then chunk the remainder
  const firstSplit = splitCardsIntoChunks(allCards, firstChunkMax);
  const chunk0 = firstSplit[0] || [];
  const remainingCards = allCards.slice(chunk0.length);
  const restChunks = remainingCards.length > 0 ? splitCardsIntoChunks(remainingCards, MAX_BASKET_BYTES - 1024) : [];
  const allChunks = [chunk0, ...restChunks];

  // 1. Save main basket (chunk 0 + metadata + chunkCount)
  const mainBody = JSON.stringify({
    cards: allChunks[0],
    studyHistory: cloudData.studyHistory,
    longestStreak: cloudData.longestStreak,
    deletedCards: cloudData.deletedCards,
    chunkCount: allChunks.length,
  });

  const mainRes = await fetchWithRetry(`${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`, {
    ...FETCH_OPTIONS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: mainBody,
  });

  if (!mainRes.ok) {
    const errorText = await mainRes.text().catch(() => mainRes.statusText);
    throw new Error(`Failed to update Pantry storage (${mainRes.status}): ${errorText}`);
  }

  // 2. Save overflow chunks sequentially with rate-limit spacing
  for (let i = 1; i < allChunks.length; i++) {
    const chunkRes = await fetchWithRetry(`${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}`, {
      ...FETCH_OPTIONS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: allChunks[i] }),
    });

    if (!chunkRes.ok) {
      const errorText = await chunkRes.text().catch(() => chunkRes.statusText);
      throw new Error(`Failed to update Pantry chunk ${i} (${chunkRes.status}): ${errorText}`);
    }
  }
};
