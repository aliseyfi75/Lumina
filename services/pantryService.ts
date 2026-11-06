import { Flashcard, CloudData, FlashcardStatus } from '../types';

const BASE_URL = 'https://getpantry.cloud/apiv1/pantry';
const BASKET_NAME = 'Lumina';
const REQUEST_TIMEOUT_MS = 20000;

// Keep each basket POST <= 30 KB (~60-75 cards) so reverse proxies and Express never 502/413,
// while a 143-card deck only requires 2 sequential POSTs.
const MAX_BASKET_BYTES = 30 * 1024;
const FALLBACK_BASKET_BYTES = 14 * 1024;
// Pantry's total storage quota per Pantry ID is 1.44 MB.
const MAX_PANTRY_BYTES = Math.floor(1.4 * 1024 * 1024);
// True quiet time AFTER one Pantry request finishes before the next one starts.
let rateLimitDelayMs = 1400;
const knownChunkCounts = new Map<string, number>();

export const setPantryRateLimitDelayForTests = (ms: number) => {
  rateLimitDelayMs = ms;
  lastRequestCompletedAt = 0;
};

export const getKnownChunkCount = (pantryId: string): number => {
  return knownChunkCounts.get(normalizePantryId(pantryId)) ?? 1;
};

// Standard options to avoid CORS/Referrer issues in sensitive browser environments
const FETCH_OPTIONS: RequestInit = {
  referrerPolicy: 'no-referrer',
  mode: 'cors',
  credentials: 'omit',
  cache: 'no-store',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestCompletedAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

// Strictly serialize all Pantry requests and enforce rateLimitDelayMs
// between the COMPLETION of one request and the START of the next.
const enqueuePantryRequest = <T>(fn: () => Promise<T>, immediate = false): Promise<T> => {
  const run = async (): Promise<T> => {
    const now = Date.now();
    const elapsed = now - lastRequestCompletedAt;
    if (!immediate && lastRequestCompletedAt > 0 && elapsed < rateLimitDelayMs) {
      await sleep(rateLimitDelayMs - elapsed);
    }
    try {
      return await fn();
    } finally {
      lastRequestCompletedAt = Date.now();
    }
  };

  const next = requestQueue.then(run, run);
  requestQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
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
  baseDelayMs = 2200,
  immediate = false
): Promise<Response> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await enqueuePantryRequest(
        () => fetchWithTimeout(url, options),
        immediate && attempt === 0
      );
      // Retry on rate-limit (429) or transient gateway/server errors (500, 502, 503, 504)
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const waitTime = baseDelayMs * Math.pow(2, attempt);
        await sleep(waitTime);
        continue;
      }
      return response;
    } catch (err: any) {
      // In browsers, Cloudflare 502s or 429 rate-limit drops without CORS headers throw TypeError("Failed to fetch" / "Load failed")
      if (attempt < retries) {
        const waitTime = baseDelayMs * Math.pow(2, attempt);
        await sleep(waitTime);
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

// Strip empty/default fields and any inline data: URIs so the JSON payload is compact
const sanitizeCardsForCloud = (cards: Flashcard[]): Flashcard[] =>
  cards.map(card => {
    const clean: Flashcard = {
      id: card.id,
      word: card.word,
      mainDefinition: card.mainDefinition,
      partOfSpeech: card.partOfSpeech || '',
      status: card.status || FlashcardStatus.New,
      lastReviewed: card.lastReviewed || 0,
      createdAt: card.createdAt || Date.now(),
    };
    if (card.phonetic) clean.phonetic = card.phonetic;
    if (card.audio && !card.audio.startsWith('data:')) clean.audio = card.audio;
    if (card.image && !card.image.startsWith('data:')) clean.image = card.image;
    if (card.example) clean.example = card.example;
    if (card.tags && card.tags.length > 0) clean.tags = card.tags;
    if (card.synonyms && card.synonyms.length > 0) clean.synonyms = card.synonyms;
    if (card.antonyms && card.antonyms.length > 0) clean.antonyms = card.antonyms;
    if (card.complexityLevel) clean.complexityLevel = card.complexityLevel;
    if (card.complexityScore !== undefined) clean.complexityScore = card.complexityScore;
    if (card.bookChapter) clean.bookChapter = card.bookChapter;
    if (card.interval) clean.interval = card.interval;
    if (card.repetition) clean.repetition = card.repetition;
    if (card.easinessFactor && card.easinessFactor !== 2.5) clean.easinessFactor = card.easinessFactor;
    if (card.nextReviewDate) clean.nextReviewDate = card.nextReviewDate;
    if (card.lastQuality) clean.lastQuality = card.lastQuality;
    if (card.updatedAt) clean.updatedAt = card.updatedAt;
    return clean;
  });

const normalizeCardsFromCloud = (cards: Flashcard[]): Flashcard[] =>
  cards.map(card => ({
    ...card,
    partOfSpeech: card.partOfSpeech ?? '',
    status: card.status ?? FlashcardStatus.New,
    lastReviewed: card.lastReviewed ?? 0,
    createdAt: card.createdAt ?? Date.now(),
  }));

export interface PantryDetails {
  name: string;
  description?: string;
  percentFull?: number;
  baskets?: Array<{ name: string; ttl?: number } | string>;
}

export interface CloudSyncProgress {
  percent: number;
  step: string;
  estimatedRemainingSec?: number;
}

export interface ChunkProgressInfo {
  currentChunk: number;
  totalChunks: number;
  completedSteps?: number;
  totalSteps?: number;
  percent?: number;
  step?: string;
  estimatedRemainingSec?: number;
}

const getBasketName = (b: { name?: string } | string): string =>
  typeof b === 'string' ? b : b?.name ?? '';

export const getDetails = async (pantryId: string): Promise<PantryDetails> => {
  const cleanId = normalizePantryId(pantryId);
  const response = await fetchWithRetry(`${BASE_URL}/${cleanId}?t=${Date.now()}`, {
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
  existingBaskets?: Array<{ name: string; ttl?: number } | string>,
  options?: {
    retries?: number;
    strict?: boolean;
    onProgress?: (info: ChunkProgressInfo) => void;
  }
): Promise<CloudData> => {
  const cleanId = normalizePantryId(pantryId);
  const retries = options?.retries ?? 3;
  const strict = options?.strict ?? false;

  const basketNames = Array.isArray(existingBaskets)
    ? existingBaskets.map(getBasketName).filter(Boolean)
    : null;
  const hasKnownMainBasket = basketNames
    ? basketNames.some(name => name.toLowerCase() === BASKET_NAME.toLowerCase())
    : false;

  // If caller already fetched Pantry details and confirmed the Pantry has no Lumina basket yet, skip GET
  if (basketNames && !hasKnownMainBasket) {
    return { cards: [], chunkCount: 1, basketExists: false };
  }

  try {
    const response = await fetchWithRetry(
      `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}?t=${Date.now()}`,
      {
        ...FETCH_OPTIONS,
        method: 'GET',
      },
      retries
    );

    if (!response.ok) {
      // Only treat 400/404 as "basket does not exist yet" when we don't already know the basket exists
      if ((response.status === 400 || response.status === 404) && !hasKnownMainBasket) {
        return { cards: [], chunkCount: 1, basketExists: false };
      }
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch existing deck from Pantry (${response.status}): ${errText}`);
    }

    const data = await response.json();
    let allCards: Flashcard[] = Array.isArray(data.cards) ? data.cards : [];

    // Determine how many chunks exist: use data.chunkCount if present, or infer from existingBaskets
    // (e.g., if the Chrome extension updated the main basket without preserving chunkCount)
    let chunkCount = typeof data.chunkCount === 'number' && data.chunkCount > 1 ? data.chunkCount : 1;
    if (typeof data.chunkCount !== 'number' && basketNames) {
      for (const name of basketNames) {
        const match = name.match(new RegExp(`^${BASKET_NAME}_(\\d+)$`, 'i'));
        if (match) {
          chunkCount = Math.max(chunkCount, parseInt(match[1], 10) + 1);
        }
      }
    }

    const defaultGetStepMs = Math.max(1200, rateLimitDelayMs + 700);
    const estimateDownloadRemainingSec = (completedChunks: number, totalChunksCount: number): number => {
      const remaining = Math.max(0, totalChunksCount - completedChunks);
      if (remaining === 0) return 0;
      return Math.max(1, Math.ceil((remaining * defaultGetStepMs) / 1000));
    };

    options?.onProgress?.({
      currentChunk: 1,
      totalChunks: chunkCount,
      completedSteps: chunkCount === 1 ? 0 : 1,
      totalSteps: chunkCount,
      percent: chunkCount === 1 ? 85 : Math.round((1 / chunkCount) * 100),
      step:
        chunkCount > 1
          ? `Loading cloud chunk 1 of ${chunkCount}...`
          : 'Loading flashcards from Cloud...',
      estimatedRemainingSec: chunkCount === 1 ? 1 : estimateDownloadRemainingSec(1, chunkCount),
    });

    // Fetch additional card chunks if the deck was split across multiple baskets
    for (let i = 1; i < chunkCount; i++) {
      if (
        basketNames &&
        !basketNames.some(name => name.toLowerCase() === `${BASKET_NAME}_${i}`.toLowerCase())
      ) {
        continue;
      }
      options?.onProgress?.({
        currentChunk: i + 1,
        totalChunks: chunkCount,
        completedSteps: i,
        totalSteps: chunkCount,
        percent: Math.min(95, Math.round(((i + 0.4) / chunkCount) * 100)),
        step: `Loading cloud chunk ${i + 1} of ${chunkCount}...`,
        estimatedRemainingSec: estimateDownloadRemainingSec(i, chunkCount),
      });
      const chunkRes = await fetchWithRetry(
        `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}?t=${Date.now()}`,
        {
          ...FETCH_OPTIONS,
          method: 'GET',
        },
        retries
      );
      if (!chunkRes.ok) {
        if (strict || hasKnownMainBasket) {
          throw new Error(
            `Failed to load deck chunk ${i} from Pantry (${chunkRes.status}). Aborting to prevent losing cloud cards.`
          );
        }
        continue;
      }
      const chunkData = await chunkRes.json();
      if (Array.isArray(chunkData.cards)) {
        allCards = allCards.concat(chunkData.cards);
      }
    }

    knownChunkCounts.set(cleanId, chunkCount);

    return {
      cards: normalizeCardsFromCloud(allCards),
      studyHistory: data.studyHistory || {},
      longestStreak: data.longestStreak || 0,
      deletedCards: data.deletedCards || {},
      chunkCount,
      basketExists: true,
    };
  } catch (error) {
    if (strict || hasKnownMainBasket) {
      throw error;
    }
    console.warn('Could not fetch deck from Pantry (might be new):', error);
    return { cards: [], chunkCount: 1, basketExists: false };
  }
};

/**
 * Sends a lightweight PUT request to Pantry to refresh the 30-day inactivity TTL
 * on the main basket (and any overflow chunk baskets) every time the user opens the app,
 * even if no flashcard status has changed.
 */
export const keepAlivePantry = async (pantryId: string, chunkCount?: number): Promise<boolean> => {
  const cleanId = normalizePantryId(pantryId);
  if (!cleanId) return false;

  try {
    const now = Date.now();
    const res = await fetchWithRetry(
      `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`,
      {
        ...FETCH_OPTIONS,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastAccessedAt: now }),
      },
      1
    );

    if (!res.ok) {
      return false;
    }

    let effectiveChunkCount = chunkCount ?? knownChunkCounts.get(cleanId) ?? 1;
    const updatedMain = await res.json().catch(() => null);
    if (typeof updatedMain?.chunkCount === 'number' && updatedMain.chunkCount > effectiveChunkCount) {
      effectiveChunkCount = updatedMain.chunkCount;
    }
    knownChunkCounts.set(cleanId, effectiveChunkCount);

    for (let i = 1; i < effectiveChunkCount; i++) {
      await fetchWithRetry(
        `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}`,
        {
          ...FETCH_OPTIONS,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastAccessedAt: now }),
        },
        1
      ).catch(() => {});
    }

    return true;
  } catch (err) {
    console.warn('Pantry keep-alive ping failed:', err);
    return false;
  }
};

const cleanupStaleOverflowChunks = async (
  cleanId: string,
  previousChunkCount: number,
  newChunkCount: number,
  onProgress?: (info: ChunkProgressInfo) => void,
  totalStepsCount?: number,
  computeRemainingSec?: (completedSteps: number, totalSteps: number) => number
) => {
  const startChunk = Math.max(1, newChunkCount);
  const totalSteps = totalStepsCount ?? previousChunkCount;
  for (let i = startChunk; i < previousChunkCount; i++) {
    const stepIndex = i + 1; // 1-based step index across all upload + cleanup steps
    onProgress?.({
      currentChunk: newChunkCount,
      totalChunks: newChunkCount,
      completedSteps: i,
      totalSteps,
      percent: Math.min(96, Math.round(((i + 0.4) / Math.max(1, totalSteps)) * 100)),
      step: `Cleaning old cloud data (${stepIndex}/${totalSteps})...`,
      estimatedRemainingSec: computeRemainingSec ? computeRemainingSec(i, totalSteps) : Math.max(1, (totalSteps - i) * 2),
    });
    await fetchWithRetry(
      `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}`,
      {
        ...FETCH_OPTIONS,
        method: 'DELETE',
      },
      1
    ).catch(() => {});
  }
};

const splitCardsIntoChunks = (cards: Flashcard[], maxChunkBytes: number): Flashcard[][] => {
  if (cards.length === 0) return [[]];
  const chunks: Flashcard[][] = [];
  let currentChunk: Flashcard[] = [];
  let currentBytes = 32; // overhead for {"cards":[]}

  for (const card of cards) {
    const cardBytes = new Blob([JSON.stringify(card)]).size + 1;
    if (currentChunk.length > 0 && currentBytes + cardBytes > maxChunkBytes) {
      chunks.push(currentChunk);
      currentChunk = [card];
      currentBytes = 32 + cardBytes;
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

const pushDeckWithChunkLimit = async (
  cleanId: string,
  sanitizedCards: Flashcard[],
  cloudData: CloudData,
  maxBasketBytes: number,
  onProgress?: (info: ChunkProgressInfo) => void,
  immediate = false
) => {
  const previousChunkCount = knownChunkCounts.get(cleanId) ?? cloudData.chunkCount ?? 1;
  const now = Date.now();
  const syncStartTime = Date.now();

  const computeRemainingSec = (completedSteps: number, totalSteps: number): number => {
    const remainingSteps = Math.max(0, totalSteps - completedSteps);
    if (remainingSteps === 0) return 0;
    const defaultStepMs = Math.max(1200, rateLimitDelayMs + 750);
    if (completedSteps > 0) {
      const elapsedMs = Date.now() - syncStartTime;
      const avgStepMs = Math.max(1000, Math.min(4000, elapsedMs / completedSteps));
      return Math.max(1, Math.ceil((remainingSteps * avgStepMs) / 1000));
    }
    const firstStepMs = immediate ? 1200 : defaultStepMs;
    const totalMs = firstStepMs + Math.max(0, remainingSteps - 1) * defaultStepMs;
    return Math.max(1, Math.ceil(totalMs / 1000));
  };

  const fullPayload = JSON.stringify({
    cards: sanitizedCards,
    studyHistory: cloudData.studyHistory,
    longestStreak: cloudData.longestStreak,
    deletedCards: cloudData.deletedCards,
    chunkCount: 1,
    lastAccessedAt: now,
  });
  const totalBytes = new Blob([fullPayload]).size;

  if (totalBytes > MAX_PANTRY_BYTES) {
    const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Your deck (${sizeMb} MB) exceeds Pantry's 1.44 MB free storage limit. Please use Local File Auto-Save or Export JSON for large decks.`
    );
  }

  // Fast path: fits in a single basket under maxBasketBytes
  if (totalBytes <= maxBasketBytes) {
    const staleChunksToDelete = Math.max(0, previousChunkCount - 1);
    const totalSteps = 1 + staleChunksToDelete;
    onProgress?.({
      currentChunk: 1,
      totalChunks: 1,
      completedSteps: 0,
      totalSteps,
      percent: totalSteps === 1 ? 25 : Math.max(10, Math.round((0.4 / totalSteps) * 100)),
      step:
        totalSteps > 1
          ? `Uploading flashcards (1/${totalSteps})...`
          : sanitizedCards.length > 0
            ? `Uploading ${sanitizedCards.length} flashcards...`
            : 'Updating cloud storage...',
      estimatedRemainingSec: computeRemainingSec(0, totalSteps),
    });
    const response = await fetchWithRetry(
      `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`,
      {
        ...FETCH_OPTIONS,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: fullPayload,
      },
      3,
      2200,
      immediate
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to update Pantry storage (${response.status}): ${errorText}`);
    }
    knownChunkCounts.set(cleanId, 1);
    if (previousChunkCount > 1) {
      await cleanupStaleOverflowChunks(
        cleanId,
        previousChunkCount,
        1,
        onProgress,
        totalSteps,
        computeRemainingSec
      );
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
      lastAccessedAt: now,
    }),
  ]).size;

  const firstChunkMax = Math.max(8 * 1024, maxBasketBytes - metadataOverhead);

  // Build chunk 0 with room for metadata, then chunk the remainder
  const firstSplit = splitCardsIntoChunks(sanitizedCards, firstChunkMax);
  const chunk0 = firstSplit[0] || [];
  const remainingCards = sanitizedCards.slice(chunk0.length);
  const restChunks =
    remainingCards.length > 0 ? splitCardsIntoChunks(remainingCards, maxBasketBytes - 512) : [];
  const allChunks = [chunk0, ...restChunks];
  const staleChunksToDelete = Math.max(0, previousChunkCount - allChunks.length);
  const totalSteps = allChunks.length + staleChunksToDelete;

  // 1. Save main basket (chunk 0 + metadata + chunkCount)
  onProgress?.({
    currentChunk: 1,
    totalChunks: allChunks.length,
    completedSteps: 0,
    totalSteps,
    percent: Math.max(8, Math.round((0.4 / totalSteps) * 100)),
    step: `Uploading chunk 1 of ${allChunks.length}...`,
    estimatedRemainingSec: computeRemainingSec(0, totalSteps),
  });
  const mainBody = JSON.stringify({
    cards: allChunks[0],
    studyHistory: cloudData.studyHistory,
    longestStreak: cloudData.longestStreak,
    deletedCards: cloudData.deletedCards,
    chunkCount: allChunks.length,
    lastAccessedAt: now,
  });

  const mainRes = await fetchWithRetry(
    `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`,
    {
      ...FETCH_OPTIONS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: mainBody,
    },
    3,
    2200,
    immediate
  );

  if (!mainRes.ok) {
    const errorText = await mainRes.text().catch(() => mainRes.statusText);
    throw new Error(`Failed to update Pantry storage (${mainRes.status}): ${errorText}`);
  }

  // 2. Save overflow chunks sequentially with rate-limit spacing
  for (let i = 1; i < allChunks.length; i++) {
    onProgress?.({
      currentChunk: i + 1,
      totalChunks: allChunks.length,
      completedSteps: i,
      totalSteps,
      percent: Math.min(95, Math.round(((i + 0.4) / totalSteps) * 100)),
      step: `Uploading chunk ${i + 1} of ${allChunks.length}...`,
      estimatedRemainingSec: computeRemainingSec(i, totalSteps),
    });
    const chunkRes = await fetchWithRetry(`${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}`, {
      ...FETCH_OPTIONS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: allChunks[i], lastAccessedAt: now }),
    });

    if (!chunkRes.ok) {
      const errorText = await chunkRes.text().catch(() => chunkRes.statusText);
      throw new Error(`Failed to update Pantry chunk ${i} (${chunkRes.status}): ${errorText}`);
    }
  }

  knownChunkCounts.set(cleanId, allChunks.length);
  if (previousChunkCount > allChunks.length) {
    await cleanupStaleOverflowChunks(
      cleanId,
      previousChunkCount,
      allChunks.length,
      onProgress,
      totalSteps,
      computeRemainingSec
    );
  }
};

export const updateDeck = async (
  pantryId: string,
  cloudData: CloudData,
  options?: { onProgress?: (info: ChunkProgressInfo) => void; immediate?: boolean }
) => {
  const cleanId = normalizePantryId(pantryId);
  const sanitizedCards = sanitizeCardsForCloud(cloudData.cards || []);

  try {
    await pushDeckWithChunkLimit(
      cleanId,
      sanitizedCards,
      cloudData,
      MAX_BASKET_BYTES,
      options?.onProgress,
      options?.immediate
    );
  } catch (err: any) {
    // If a 30 KB basket POST still hit a gateway/payload limit, automatically retry with smaller 14 KB chunks
    if (
      sanitizedCards.length > 20 &&
      /502|CORS|rate-limiting|Failed to update Pantry/i.test(err?.message || '') &&
      !/not found/i.test(err?.message || '')
    ) {
      await sleep(3000);
      await pushDeckWithChunkLimit(cleanId, sanitizedCards, cloudData, FALLBACK_BASKET_BYTES, options?.onProgress);
      return;
    }
    throw err;
  }
};
