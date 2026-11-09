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
let rateLimitDelayMs = 1800;
let adaptiveExtraDelayMs = 0;
const knownChunkCounts = new Map<string, number>();

interface PullCheckpoint {
  chunkCount: number;
  studyHistory: Record<string, number>;
  longestStreak: number;
  deletedCards: Record<string, number>;
  chunks: Record<number, Flashcard[]>;
  updatedAt: number;
}

const PULL_CHECKPOINT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const pullCheckpoints = new Map<string, PullCheckpoint>();
const uploadedChunkHashes = new Map<string, Record<number, string>>();

const getChunkHashesStorageKey = (cleanId: string) => `lumina_pantry_chunk_hashes_${cleanId}`;
const getPullCheckpointStorageKey = (cleanId: string) => `lumina_pantry_pull_checkpoint_${cleanId}`;

// Fast deterministic FNV-1a 64-bit-style string hash (as hex + length) for chunk payloads
const computePayloadHash = (payload: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${payload.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
};

const loadUploadedChunkHashes = (cleanId: string): Record<number, string> => {
  const mem = uploadedChunkHashes.get(cleanId);
  if (mem) return mem;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(getChunkHashesStorageKey(cleanId));
      if (raw) {
        const parsed = JSON.parse(raw) as Record<number, string>;
        if (parsed && typeof parsed === 'object') {
          uploadedChunkHashes.set(cleanId, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  const empty: Record<number, string> = {};
  uploadedChunkHashes.set(cleanId, empty);
  return empty;
};

const saveUploadedChunkHashes = (cleanId: string, hashes: Record<number, string>) => {
  uploadedChunkHashes.set(cleanId, hashes);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getChunkHashesStorageKey(cleanId), JSON.stringify(hashes));
    }
  } catch {
    // ignore storage errors
  }
};

const loadPullCheckpoint = (cleanId: string): PullCheckpoint | null => {
  const now = Date.now();
  const mem = pullCheckpoints.get(cleanId);
  if (mem) {
    if (now - mem.updatedAt <= PULL_CHECKPOINT_TTL_MS) return mem;
    pullCheckpoints.delete(cleanId);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(getPullCheckpointStorageKey(cleanId));
      if (raw) {
        const parsed = JSON.parse(raw) as PullCheckpoint;
        if (parsed && typeof parsed === 'object' && now - parsed.updatedAt <= PULL_CHECKPOINT_TTL_MS) {
          pullCheckpoints.set(cleanId, parsed);
          return parsed;
        }
        localStorage.removeItem(getPullCheckpointStorageKey(cleanId));
      }
    }
  } catch {
    // ignore storage errors
  }
  return null;
};

const savePullCheckpoint = (cleanId: string, checkpoint: PullCheckpoint) => {
  pullCheckpoints.set(cleanId, checkpoint);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getPullCheckpointStorageKey(cleanId), JSON.stringify(checkpoint));
    }
  } catch {
    // ignore storage errors
  }
};

const clearPullCheckpoint = (cleanId: string) => {
  pullCheckpoints.delete(cleanId);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(getPullCheckpointStorageKey(cleanId));
    }
  } catch {
    // ignore storage errors
  }
};

export const clearPantryCheckpointsForTests = () => {
  pullCheckpoints.clear();
  uploadedChunkHashes.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('lumina_pantry_chunk_hashes_') || k.startsWith('lumina_pantry_pull_checkpoint_'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    }
  } catch {
    // ignore
  }
};

export const setPantryRateLimitDelayForTests = (ms: number) => {
  rateLimitDelayMs = ms;
  adaptiveExtraDelayMs = 0;
  lastRequestCompletedAt = 0;
  clearPantryCheckpointsForTests();
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

// Strictly serialize all Pantry requests and enforce (rateLimitDelayMs + adaptiveExtraDelayMs)
// between the COMPLETION of one request and the START of the next.
const enqueuePantryRequest = <T>(fn: () => Promise<T>, immediate = false): Promise<T> => {
  const run = async (): Promise<T> => {
    const effectiveDelay = rateLimitDelayMs > 0 ? rateLimitDelayMs + adaptiveExtraDelayMs : 0;
    const now = Date.now();
    const elapsed = now - lastRequestCompletedAt;
    if (!immediate && lastRequestCompletedAt > 0 && elapsed < effectiveDelay) {
      await sleep(effectiveDelay - elapsed);
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

const COOLDOWN_SCHEDULE_MS = [3500, 6000, 10000, 15000, 20000, 25000, 30000];

const computeCooldownWaitMs = (attempt: number, baseDelayMs: number): number => {
  if (rateLimitDelayMs === 0) {
    return 5;
  }
  const scheduled = COOLDOWN_SCHEDULE_MS[Math.min(attempt, COOLDOWN_SCHEDULE_MS.length - 1)];
  return Math.max(scheduled, baseDelayMs * (attempt + 1));
};

const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  retries = 6,
  baseDelayMs = 3500,
  immediate = false,
  onCooldownWait?: (waitSec: number, attempt: number, maxRetries: number) => void
): Promise<Response> => {
  // Run the entire retry + cooldown loop inside enqueuePantryRequest so no other Pantry request
  // can cut in line and reset Pantry's rate-limit window while we are sleeping!
  return enqueuePantryRequest(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Append a fresh timestamp on retries to bypass any cached 502/CORS error response
        const attemptUrl =
          attempt > 0 && url.includes('?t=')
            ? url.replace(/\?t=\d+/, `?t=${Date.now()}_${attempt}`)
            : url;
        const response = await fetchWithTimeout(attemptUrl, options);
        // Retry on rate-limit (429) or transient gateway/server errors (500, 502, 503, 504)
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          if (rateLimitDelayMs > 0) {
            adaptiveExtraDelayMs = Math.min(2200, adaptiveExtraDelayMs + 800);
          }
          const waitTime = computeCooldownWaitMs(attempt, baseDelayMs);
          onCooldownWait?.(Math.max(1, Math.ceil(waitTime / 1000)), attempt + 1, retries);
          await sleep(waitTime);
          continue;
        }
        if (response.ok && adaptiveExtraDelayMs > 0) {
          adaptiveExtraDelayMs = Math.max(0, adaptiveExtraDelayMs - 200);
        }
        return response;
      } catch (err: any) {
        // In browsers, Cloudflare 502s or 429 rate-limit drops without CORS headers throw TypeError("Failed to fetch" / "Load failed")
        if (attempt < retries) {
          if (rateLimitDelayMs > 0) {
            adaptiveExtraDelayMs = Math.min(2200, adaptiveExtraDelayMs + 800);
          }
          const waitTime = computeCooldownWaitMs(attempt, baseDelayMs);
          onCooldownWait?.(Math.max(1, Math.ceil(waitTime / 1000)), attempt + 1, retries);
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
  }, immediate);
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

const assembleCheckpointCards = (checkpoint: PullCheckpoint): Flashcard[] => {
  const orderedIndices = Object.keys(checkpoint.chunks)
    .map(Number)
    .sort((a, b) => a - b);
  let combined: Flashcard[] = [];
  for (const idx of orderedIndices) {
    const list = checkpoint.chunks[idx];
    if (Array.isArray(list)) {
      combined = combined.concat(list);
    }
  }
  return normalizeCardsFromCloud(combined);
};

export const getDeck = async (
  pantryId: string,
  existingBaskets?: Array<{ name: string; ttl?: number } | string>,
  options?: {
    retries?: number;
    strict?: boolean;
    onProgress?: (info: ChunkProgressInfo) => void;
    onPartialCards?: (partialData: CloudData) => void;
  }
): Promise<CloudData> => {
  const cleanId = normalizePantryId(pantryId);
  const retries = options?.retries ?? 6;
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

  const defaultGetStepMs = Math.max(1200, rateLimitDelayMs + adaptiveExtraDelayMs + 700);
  const estimateDownloadRemainingSec = (completedChunks: number, totalChunksCount: number): number => {
    const remaining = Math.max(0, totalChunksCount - completedChunks);
    if (remaining === 0) return 0;
    return Math.max(1, Math.ceil((remaining * defaultGetStepMs) / 1000));
  };

  try {
    // Check if there is an interrupted multi-chunk pull checkpoint we can resume from
    let checkpoint = loadPullCheckpoint(cleanId);
    const hasResumableCheckpoint =
      checkpoint &&
      checkpoint.chunkCount > 1 &&
      Array.isArray(checkpoint.chunks[0]) &&
      Object.keys(checkpoint.chunks).length < checkpoint.chunkCount;

    if (!hasResumableCheckpoint) {
      const response = await fetchWithRetry(
        `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}?t=${Date.now()}`,
        {
          ...FETCH_OPTIONS,
          method: 'GET',
        },
        retries,
        3500,
        false,
        (waitSec) => {
          options?.onProgress?.({
            currentChunk: 1,
            totalChunks: 1,
            completedSteps: 0,
            totalSteps: 1,
            percent: 15,
            step: `Pantry rate-limit cooldown — waiting ${waitSec}s and retrying automatically...`,
            estimatedRemainingSec: waitSec + 2,
          });
        }
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
      const chunk0Cards: Flashcard[] = Array.isArray(data.cards) ? data.cards : [];

      // Determine how many chunks exist: use data.chunkCount if present, or infer from existingBaskets
      let chunkCount = typeof data.chunkCount === 'number' && data.chunkCount > 1 ? data.chunkCount : 1;
      if (typeof data.chunkCount !== 'number' && basketNames) {
        for (const name of basketNames) {
          const match = name.match(new RegExp(`^${BASKET_NAME}_(\\d+)$`, 'i'));
          if (match) {
            chunkCount = Math.max(chunkCount, parseInt(match[1], 10) + 1);
          }
        }
      }

      checkpoint = {
        chunkCount,
        studyHistory: data.studyHistory || {},
        longestStreak: data.longestStreak || 0,
        deletedCards: data.deletedCards || {},
        chunks: { 0: chunk0Cards },
        updatedAt: Date.now(),
      };

      if (chunkCount > 1) {
        savePullCheckpoint(cleanId, checkpoint);
      }

      options?.onPartialCards?.({
        cards: assembleCheckpointCards(checkpoint),
        studyHistory: checkpoint.studyHistory,
        longestStreak: checkpoint.longestStreak,
        deletedCards: checkpoint.deletedCards,
        chunkCount,
        basketExists: true,
      });
    }

    const activeCheckpoint = checkpoint!;
    const { chunkCount } = activeCheckpoint;
    const alreadyLoadedCount = Object.keys(activeCheckpoint.chunks).length;

    options?.onProgress?.({
      currentChunk: alreadyLoadedCount,
      totalChunks: chunkCount,
      completedSteps: chunkCount === 1 ? 0 : alreadyLoadedCount,
      totalSteps: chunkCount,
      percent: chunkCount === 1 ? 85 : Math.round((alreadyLoadedCount / chunkCount) * 100),
      step:
        chunkCount > 1
          ? alreadyLoadedCount > 1
            ? `Resuming cloud load at chunk ${alreadyLoadedCount + 1} of ${chunkCount}...`
            : `Loading cloud chunk 1 of ${chunkCount}...`
          : 'Loading flashcards from Cloud...',
      estimatedRemainingSec:
        chunkCount === 1 ? 1 : estimateDownloadRemainingSec(alreadyLoadedCount, chunkCount),
    });

    // Fetch additional card chunks if the deck was split across multiple baskets,
    // skipping any chunks already downloaded in our checkpoint!
    for (let i = 1; i < chunkCount; i++) {
      if (Array.isArray(activeCheckpoint.chunks[i])) {
        continue; // Already downloaded in a previous attempt — skip!
      }
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
        retries,
        3500,
        false,
        (waitSec) => {
          options?.onProgress?.({
            currentChunk: i + 1,
            totalChunks: chunkCount,
            completedSteps: i,
            totalSteps: chunkCount,
            percent: Math.min(95, Math.round(((i + 0.4) / chunkCount) * 100)),
            step: `Pantry rate-limit cooldown — waiting ${waitSec}s before resuming chunk ${i + 1} of ${chunkCount}...`,
            estimatedRemainingSec: waitSec + estimateDownloadRemainingSec(i, chunkCount),
          });
        }
      );
      if (!chunkRes.ok) {
        if (strict || hasKnownMainBasket || chunkCount > 1) {
          throw new Error(
            `Failed to load deck chunk ${i} from Pantry (${chunkRes.status}). Aborting to prevent losing cloud cards.`
          );
        }
        continue;
      }
      const chunkData = await chunkRes.json();
      activeCheckpoint.chunks[i] = Array.isArray(chunkData.cards) ? chunkData.cards : [];
      activeCheckpoint.updatedAt = Date.now();
      savePullCheckpoint(cleanId, activeCheckpoint);

      options?.onPartialCards?.({
        cards: assembleCheckpointCards(activeCheckpoint),
        studyHistory: activeCheckpoint.studyHistory,
        longestStreak: activeCheckpoint.longestStreak,
        deletedCards: activeCheckpoint.deletedCards,
        chunkCount,
        basketExists: true,
      });
    }

    // All chunks succeeded: clear the pull checkpoint and record chunk hashes so subsequent saves skip unchanged chunks
    clearPullCheckpoint(cleanId);
    knownChunkCounts.set(cleanId, chunkCount);

    const downloadedHashes: Record<number, string> = {};
    const sanitizedChunk0 = sanitizeCardsForCloud(activeCheckpoint.chunks[0] || []);
    downloadedHashes[0] = computePayloadHash(
      JSON.stringify({
        cards: sanitizedChunk0,
        studyHistory: activeCheckpoint.studyHistory || {},
        longestStreak: activeCheckpoint.longestStreak || 0,
        deletedCards: activeCheckpoint.deletedCards || {},
        chunkCount,
      })
    );
    for (let i = 1; i < chunkCount; i++) {
      const sanitizedChunkI = sanitizeCardsForCloud(activeCheckpoint.chunks[i] || []);
      downloadedHashes[i] = computePayloadHash(JSON.stringify({ cards: sanitizedChunkI }));
    }
    saveUploadedChunkHashes(cleanId, downloadedHashes);

    const allCards = assembleCheckpointCards(activeCheckpoint);

    return {
      cards: allCards,
      studyHistory: activeCheckpoint.studyHistory,
      longestStreak: activeCheckpoint.longestStreak,
      deletedCards: activeCheckpoint.deletedCards,
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
  const knownHashes = { ...loadUploadedChunkHashes(cleanId) };
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
    delete knownHashes[i];
    saveUploadedChunkHashes(cleanId, knownHashes);
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
  immediate = false,
  forceFullUpload = false
) => {
  // Sort cards oldest-first so existing chunk boundaries stay stable as new flashcards are added
  const orderedCards = [...sanitizedCards].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id)
  );

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
    cards: orderedCards,
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
          : orderedCards.length > 0
            ? `Uploading ${orderedCards.length} flashcards...`
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
    const singleHash = computePayloadHash(
      JSON.stringify({
        cards: orderedCards,
        studyHistory: cloudData.studyHistory || {},
        longestStreak: cloudData.longestStreak || 0,
        deletedCards: cloudData.deletedCards || {},
        chunkCount: 1,
      })
    );
    saveUploadedChunkHashes(cleanId, { 0: singleHash });
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
  const firstSplit = splitCardsIntoChunks(orderedCards, firstChunkMax);
  const chunk0 = firstSplit[0] || [];
  const remainingCards = orderedCards.slice(chunk0.length);
  const restChunks =
    remainingCards.length > 0 ? splitCardsIntoChunks(remainingCards, maxBasketBytes - 512) : [];
  const allChunks = [chunk0, ...restChunks];
  const staleChunksToDelete = Math.max(0, previousChunkCount - allChunks.length);

  // Compute deterministic content hashes per chunk so we can skip unchanged or already-uploaded chunks
  const knownHashes = { ...loadUploadedChunkHashes(cleanId) };
  const targetHashes: Record<number, string> = {};
  targetHashes[0] = computePayloadHash(
    JSON.stringify({
      cards: allChunks[0],
      studyHistory: cloudData.studyHistory || {},
      longestStreak: cloudData.longestStreak || 0,
      deletedCards: cloudData.deletedCards || {},
      chunkCount: allChunks.length,
    })
  );
  for (let i = 1; i < allChunks.length; i++) {
    targetHashes[i] = computePayloadHash(JSON.stringify({ cards: allChunks[i] }));
  }

  const dirtyChunkIndices: number[] = [];
  for (let i = 0; i < allChunks.length; i++) {
    if (forceFullUpload || knownHashes[i] !== targetHashes[i]) {
      dirtyChunkIndices.push(i);
    }
  }
  // If every chunk is already up to date on Pantry, only touch chunk 0 to refresh lastAccessedAt
  if (dirtyChunkIndices.length === 0) {
    dirtyChunkIndices.push(0);
  }

  const totalSteps = dirtyChunkIndices.length + staleChunksToDelete;
  const skippedCount = allChunks.length - dirtyChunkIndices.length;
  let completedDirtySteps = 0;

  // 1. Save main basket (chunk 0 + metadata + chunkCount) if dirty
  if (dirtyChunkIndices.includes(0)) {
    onProgress?.({
      currentChunk: 1,
      totalChunks: allChunks.length,
      completedSteps: 0,
      totalSteps,
      percent: Math.max(8, Math.round((0.4 / Math.max(1, totalSteps)) * 100)),
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
      6,
      3500,
      immediate,
      (waitSec) => {
        onProgress?.({
          currentChunk: 1,
          totalChunks: allChunks.length,
          completedSteps: 0,
          totalSteps,
          percent: Math.max(8, Math.round((0.4 / Math.max(1, totalSteps)) * 100)),
          step: `Pantry rate-limit cooldown — waiting ${waitSec}s before resuming chunk 1 of ${allChunks.length}...`,
          estimatedRemainingSec: waitSec + computeRemainingSec(0, totalSteps),
        });
      }
    );

    if (!mainRes.ok) {
      const errorText = await mainRes.text().catch(() => mainRes.statusText);
      throw new Error(`Failed to update Pantry storage (${mainRes.status}): ${errorText}`);
    }

    // Immediately checkpoint chunk 0 so if a later chunk fails, chunk 0 won't need re-uploading
    knownHashes[0] = targetHashes[0];
    saveUploadedChunkHashes(cleanId, knownHashes);
    completedDirtySteps += 1;
  }

  // 2. Save overflow chunks sequentially, skipping any chunk whose hash is already uploaded on Pantry
  for (let i = 1; i < allChunks.length; i++) {
    if (!dirtyChunkIndices.includes(i)) {
      continue;
    }
    onProgress?.({
      currentChunk: i + 1,
      totalChunks: allChunks.length,
      completedSteps: completedDirtySteps,
      totalSteps,
      percent: Math.min(95, Math.round(((completedDirtySteps + 0.4) / Math.max(1, totalSteps)) * 100)),
      step:
        skippedCount > 0 && completedDirtySteps === 0
          ? `Resuming upload at chunk ${i + 1} of ${allChunks.length}...`
          : `Uploading chunk ${i + 1} of ${allChunks.length}...`,
      estimatedRemainingSec: computeRemainingSec(completedDirtySteps, totalSteps),
    });
    const chunkRes = await fetchWithRetry(
      `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}_${i}`,
      {
        ...FETCH_OPTIONS,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: allChunks[i], lastAccessedAt: now }),
      },
      6,
      3500,
      immediate && completedDirtySteps === 0,
      (waitSec) => {
        onProgress?.({
          currentChunk: i + 1,
          totalChunks: allChunks.length,
          completedSteps: completedDirtySteps,
          totalSteps,
          percent: Math.min(95, Math.round(((completedDirtySteps + 0.4) / Math.max(1, totalSteps)) * 100)),
          step: `Pantry rate-limit cooldown — waiting ${waitSec}s before resuming chunk ${i + 1} of ${allChunks.length}...`,
          estimatedRemainingSec: waitSec + computeRemainingSec(completedDirtySteps, totalSteps),
        });
      }
    );

    if (!chunkRes.ok) {
      const errorText = await chunkRes.text().catch(() => chunkRes.statusText);
      throw new Error(`Failed to update Pantry chunk ${i} (${chunkRes.status}): ${errorText}`);
    }

    // Immediately checkpoint chunk i so an interruption never loses progress on already-uploaded chunks
    knownHashes[i] = targetHashes[i];
    saveUploadedChunkHashes(cleanId, knownHashes);
    completedDirtySteps += 1;
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
  options?: {
    onProgress?: (info: ChunkProgressInfo) => void;
    immediate?: boolean;
    forceFullUpload?: boolean;
  }
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
      options?.immediate,
      options?.forceFullUpload
    );
  } catch (err: any) {
    // Only fall back to smaller 14 KB chunks if chunk 0 itself failed (not when a later overflow chunk was interrupted mid-save)
    const isOverflowChunkError = /Failed to update Pantry chunk \d+/i.test(err?.message || '');
    if (
      !isOverflowChunkError &&
      sanitizedCards.length > 20 &&
      /413|502|CORS|Failed to update Pantry storage/i.test(err?.message || '') &&
      !/not found/i.test(err?.message || '')
    ) {
      await sleep(3000);
      await pushDeckWithChunkLimit(
        cleanId,
        sanitizedCards,
        cloudData,
        FALLBACK_BASKET_BYTES,
        options?.onProgress,
        false,
        options?.forceFullUpload
      );
      return;
    }
    throw err;
  }
};
