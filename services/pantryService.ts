import { Flashcard, CloudData, FlashcardStatus, MeaningLanguagePreference } from '../types';

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
  languagePreference?: MeaningLanguagePreference;
  languagePreferenceUpdatedAt?: number;
  chunks: Record<number, Flashcard[]>;
  updatedAt: number;
}

interface SyncedChunkCache {
  chunkCount: number;
  manifestSignature: string;
  chunkHashes: Record<number, string>;
  chunkCardIds: Record<number, string[]>;
  chunks: Record<number, Flashcard[]>;
  updatedAt: number;
}

const PULL_CHECKPOINT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const pullCheckpoints = new Map<string, PullCheckpoint>();
const uploadedChunkHashes = new Map<string, Record<string, string>>();
const syncedChunkCaches = new Map<string, SyncedChunkCache>();

const getChunkHashesStorageKey = (cleanId: string) => `lumina_pantry_chunk_hashes_${cleanId}`;
const getPullCheckpointStorageKey = (cleanId: string) => `lumina_pantry_pull_checkpoint_${cleanId}`;
const getChunkCacheMetaStorageKey = (cleanId: string) => `lumina_pantry_chunk_cache_meta_${cleanId}`;
const getChunkCacheCardsStorageKey = (cleanId: string) => `lumina_pantry_chunk_cache_cards_${cleanId}`;

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

const loadUploadedChunkHashes = (cleanId: string): Record<string, string> => {
  const mem = uploadedChunkHashes.get(cleanId);
  if (mem) return mem;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(getChunkHashesStorageKey(cleanId));
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === 'object') {
          uploadedChunkHashes.set(cleanId, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  const empty: Record<string, string> = {};
  uploadedChunkHashes.set(cleanId, empty);
  return empty;
};

const saveUploadedChunkHashes = (cleanId: string, hashes: Record<string, string>) => {
  uploadedChunkHashes.set(cleanId, hashes);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getChunkHashesStorageKey(cleanId), JSON.stringify(hashes));
    }
  } catch {
    // ignore storage errors
  }
};

const loadSyncedChunkCache = (
  cleanId: string,
  fallbackLocalCards?: Flashcard[]
): SyncedChunkCache | null => {
  const mem = syncedChunkCaches.get(cleanId);
  if (mem) return mem;
  try {
    if (typeof localStorage !== 'undefined') {
      const rawMeta = localStorage.getItem(getChunkCacheMetaStorageKey(cleanId));
      if (!rawMeta) return null;
      const meta = JSON.parse(rawMeta) as Omit<SyncedChunkCache, 'chunks'>;
      if (!meta || typeof meta !== 'object' || typeof meta.chunkCount !== 'number') {
        return null;
      }

      let chunks: Record<number, Flashcard[]> = {};
      const rawCards = localStorage.getItem(getChunkCacheCardsStorageKey(cleanId));
      if (rawCards) {
        const parsedCards = JSON.parse(rawCards);
        if (parsedCards && typeof parsedCards === 'object') {
          chunks = parsedCards;
        }
      } else if (meta.chunkCardIds) {
        let sourceCards = fallbackLocalCards;
        if (!sourceCards || sourceCards.length === 0) {
          const rawDeck = localStorage.getItem('lumina_cards_v1');
          if (rawDeck) {
            const parsedDeck = JSON.parse(rawDeck);
            if (Array.isArray(parsedDeck)) sourceCards = parsedDeck;
          }
        }
        if (sourceCards && sourceCards.length > 0) {
          const byId = new Map<string, Flashcard>();
          for (const c of sourceCards) {
            byId.set(c.id, c);
          }
          for (const [idxStr, idList] of Object.entries(meta.chunkCardIds)) {
            if (!Array.isArray(idList)) continue;
            const reconstructed: Flashcard[] = [];
            let allFound = true;
            for (const id of idList) {
              const found = byId.get(id);
              if (!found) {
                allFound = false;
                break;
              }
              reconstructed.push(found);
            }
            if (allFound) {
              chunks[Number(idxStr)] = reconstructed;
            }
          }
        }
      }

      const full: SyncedChunkCache = {
        chunkCount: meta.chunkCount,
        manifestSignature: meta.manifestSignature || '',
        chunkHashes: meta.chunkHashes || {},
        chunkCardIds: meta.chunkCardIds || {},
        chunks,
        updatedAt: meta.updatedAt || Date.now(),
      };
      syncedChunkCaches.set(cleanId, full);
      return full;
    }
  } catch {
    // ignore storage errors
  }
  return null;
};

const saveSyncedChunkCache = (
  cleanId: string,
  data: {
    chunkCount: number;
    manifestSignature: string;
    chunkHashes: Record<number, string>;
    chunks: Record<number, Flashcard[]>;
  }
) => {
  const chunkCardIds: Record<number, string[]> = {};
  for (const [idxStr, list] of Object.entries(data.chunks)) {
    if (Array.isArray(list)) {
      chunkCardIds[Number(idxStr)] = list.map(c => c.id);
    }
  }
  const cacheObj: SyncedChunkCache = {
    chunkCount: data.chunkCount,
    manifestSignature: data.manifestSignature,
    chunkHashes: { ...data.chunkHashes },
    chunkCardIds,
    chunks: { ...data.chunks },
    updatedAt: Date.now(),
  };
  syncedChunkCaches.set(cleanId, cacheObj);
  try {
    if (typeof localStorage !== 'undefined') {
      const { chunks: _omit, ...metaOnly } = cacheObj;
      localStorage.setItem(getChunkCacheMetaStorageKey(cleanId), JSON.stringify(metaOnly));
      try {
        localStorage.setItem(getChunkCacheCardsStorageKey(cleanId), JSON.stringify(data.chunks));
      } catch {
        // If localStorage is close to quota, metaOnly + chunkCardIds is enough to reconstruct from IDB localCards
        localStorage.removeItem(getChunkCacheCardsStorageKey(cleanId));
      }
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
  syncedChunkCaches.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith('lumina_pantry_chunk_hashes_') ||
            k.startsWith('lumina_pantry_pull_checkpoint_') ||
            k.startsWith('lumina_pantry_chunk_cache_'))
        ) {
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
    if (card.translations) {
      const cleanedTranslations: Record<string, string> = {};
      for (const [lang, text] of Object.entries(card.translations)) {
        if (typeof text === 'string' && text.trim()) {
          cleanedTranslations[lang] = text.trim();
        }
      }
      if (Object.keys(cleanedTranslations).length > 0) {
        clean.translations = cleanedTranslations;
      }
    }
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

const computeCardChunkHash = (cards: Flashcard[]): string =>
  computePayloadHash(JSON.stringify({ cards: sanitizeCardsForCloud(cards) }));

const computeMainManifestSignature = (data: {
  cards?: Flashcard[];
  studyHistory?: Record<string, number>;
  longestStreak?: number;
  deletedCards?: Record<string, number>;
  languagePreference?: MeaningLanguagePreference;
  languagePreferenceUpdatedAt?: number;
  chunkCount?: number;
  chunkHashes?: Record<number, string>;
}): string =>
  computePayloadHash(
    JSON.stringify({
      cards: sanitizeCardsForCloud(Array.isArray(data.cards) ? data.cards : []),
      studyHistory: data.studyHistory || {},
      longestStreak: data.longestStreak || 0,
      deletedCards: data.deletedCards || {},
      languagePreference: data.languagePreference || 'en',
      languagePreferenceUpdatedAt: data.languagePreferenceUpdatedAt || 0,
      chunkCount: data.chunkCount || 1,
      chunkHashes: data.chunkHashes || null,
    })
  );

export const getDeck = async (
  pantryId: string,
  existingBaskets?: Array<{ name: string; ttl?: number } | string>,
  options?: {
    retries?: number;
    strict?: boolean;
    localCards?: Flashcard[];
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
  const estimateDownloadRemainingSec = (remainingChunks: number): number => {
    if (remainingChunks <= 0) return 0;
    return Math.max(1, Math.ceil((remainingChunks * defaultGetStepMs) / 1000));
  };

  try {
    // Check if there is an interrupted multi-chunk pull checkpoint we can resume from
    let checkpoint = loadPullCheckpoint(cleanId);
    let remoteChunkHashes: Record<number, string> | undefined;
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
      if (data.chunkHashes && typeof data.chunkHashes === 'object') {
        remoteChunkHashes = data.chunkHashes as Record<number, string>;
      }

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

      const currentManifestSig = computeMainManifestSignature({
        cards: chunk0Cards,
        studyHistory: data.studyHistory,
        longestStreak: data.longestStreak,
        deletedCards: data.deletedCards,
        languagePreference: data.languagePreference,
        languagePreferenceUpdatedAt: data.languagePreferenceUpdatedAt,
        chunkCount,
        chunkHashes: remoteChunkHashes,
      });

      const initialChunks: Record<number, Flashcard[]> = { 0: chunk0Cards };

      // Reuse any unchanged overflow chunks from our local SyncedChunkCache so we only download changed/new chunks!
      if (chunkCount > 1) {
        const cached = loadSyncedChunkCache(cleanId, options?.localCards);
        for (let i = 1; i < chunkCount; i++) {
          if (
            remoteChunkHashes &&
            typeof remoteChunkHashes[i] === 'string' &&
            cached?.chunkHashes?.[i] === remoteChunkHashes[i] &&
            Array.isArray(cached?.chunks?.[i])
          ) {
            initialChunks[i] = cached.chunks[i];
          } else if (
            !remoteChunkHashes &&
            cached &&
            cached.chunkCount === chunkCount &&
            cached.manifestSignature === currentManifestSig &&
            Array.isArray(cached?.chunks?.[i])
          ) {
            initialChunks[i] = cached.chunks[i];
          }
        }
      }

      checkpoint = {
        chunkCount,
        studyHistory: data.studyHistory || {},
        longestStreak: data.longestStreak || 0,
        deletedCards: data.deletedCards || {},
        ...(data.languagePreference === 'en' || data.languagePreference === 'fa' || data.languagePreference === 'both'
          ? { languagePreference: data.languagePreference }
          : {}),
        ...(typeof data.languagePreferenceUpdatedAt === 'number'
          ? { languagePreferenceUpdatedAt: data.languagePreferenceUpdatedAt }
          : {}),
        chunks: initialChunks,
        updatedAt: Date.now(),
      };

      if (chunkCount > 1 && Object.keys(initialChunks).length < chunkCount) {
        savePullCheckpoint(cleanId, checkpoint);
      }

      options?.onPartialCards?.({
        cards: assembleCheckpointCards(checkpoint),
        studyHistory: checkpoint.studyHistory,
        longestStreak: checkpoint.longestStreak,
        deletedCards: checkpoint.deletedCards,
        languagePreference: checkpoint.languagePreference,
        languagePreferenceUpdatedAt: checkpoint.languagePreferenceUpdatedAt,
        chunkCount,
        basketExists: true,
      });
    }

    const activeCheckpoint = checkpoint!;
    const { chunkCount } = activeCheckpoint;

    // Identify which overflow chunks actually need to be downloaded from Pantry
    const missingOverflowIndices: number[] = [];
    for (let i = 1; i < chunkCount; i++) {
      if (Array.isArray(activeCheckpoint.chunks[i])) {
        continue; // Already cached or downloaded in a previous attempt — skip!
      }
      if (
        basketNames &&
        !basketNames.some(name => name.toLowerCase() === `${BASKET_NAME}_${i}`.toLowerCase())
      ) {
        continue;
      }
      missingOverflowIndices.push(i);
    }

    const alreadyLoadedCount = Object.keys(activeCheckpoint.chunks).length;

    if (missingOverflowIndices.length === 0) {
      options?.onProgress?.({
        currentChunk: chunkCount,
        totalChunks: chunkCount,
        completedSteps: chunkCount,
        totalSteps: chunkCount,
        percent: 100,
        step: chunkCount > 1 ? 'All cloud chunks are up to date!' : 'Loading flashcards from Cloud...',
        estimatedRemainingSec: 0,
      });
    } else {
      options?.onProgress?.({
        currentChunk: alreadyLoadedCount,
        totalChunks: chunkCount,
        completedSteps: alreadyLoadedCount,
        totalSteps: chunkCount,
        percent: Math.round((alreadyLoadedCount / chunkCount) * 100),
        step:
          alreadyLoadedCount > 1
            ? `Resuming cloud load at chunk ${missingOverflowIndices[0] + 1} of ${chunkCount}...`
            : `Loading cloud chunk 1 of ${chunkCount}...`,
        estimatedRemainingSec: estimateDownloadRemainingSec(missingOverflowIndices.length),
      });
    }

    // Fetch only the missing/changed overflow chunks
    for (let idx = 0; idx < missingOverflowIndices.length; idx++) {
      const i = missingOverflowIndices[idx];
      const remainingToFetch = missingOverflowIndices.length - idx;
      const loadedSoFar = Object.keys(activeCheckpoint.chunks).length;
      options?.onProgress?.({
        currentChunk: i + 1,
        totalChunks: chunkCount,
        completedSteps: loadedSoFar,
        totalSteps: chunkCount,
        percent: Math.min(95, Math.round(((loadedSoFar + 0.4) / chunkCount) * 100)),
        step: `Loading cloud chunk ${i + 1} of ${chunkCount}...`,
        estimatedRemainingSec: estimateDownloadRemainingSec(remainingToFetch),
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
            completedSteps: loadedSoFar,
            totalSteps: chunkCount,
            percent: Math.min(95, Math.round(((loadedSoFar + 0.4) / chunkCount) * 100)),
            step: `Pantry rate-limit cooldown — waiting ${waitSec}s before resuming chunk ${i + 1} of ${chunkCount}...`,
            estimatedRemainingSec: waitSec + estimateDownloadRemainingSec(remainingToFetch),
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
        languagePreference: activeCheckpoint.languagePreference,
        languagePreferenceUpdatedAt: activeCheckpoint.languagePreferenceUpdatedAt,
        chunkCount,
        basketExists: true,
      });
    }

    // All chunks succeeded: clear the pull checkpoint and cache chunk hashes + cards so subsequent loads/saves skip unchanged chunks
    clearPullCheckpoint(cleanId);
    knownChunkCounts.set(cleanId, chunkCount);

    const perChunkCardHashes: Record<number, string> = {};
    for (let i = 0; i < chunkCount; i++) {
      perChunkCardHashes[i] = computeCardChunkHash(activeCheckpoint.chunks[i] || []);
    }

    const finalManifestSig = computeMainManifestSignature({
      cards: activeCheckpoint.chunks[0] || [],
      studyHistory: activeCheckpoint.studyHistory,
      longestStreak: activeCheckpoint.longestStreak,
      deletedCards: activeCheckpoint.deletedCards,
      languagePreference: activeCheckpoint.languagePreference,
      languagePreferenceUpdatedAt: activeCheckpoint.languagePreferenceUpdatedAt,
      chunkCount,
      chunkHashes: remoteChunkHashes,
    });

    saveSyncedChunkCache(cleanId, {
      chunkCount,
      manifestSignature: finalManifestSig,
      chunkHashes: perChunkCardHashes,
      chunks: activeCheckpoint.chunks,
    });

    const uploadedHashesRecord: Record<string, string> = {};
    for (let i = 0; i < chunkCount; i++) {
      uploadedHashesRecord[i] = perChunkCardHashes[i];
    }
    uploadedHashesRecord.meta = computeMetadataOnlyHash(
      activeCheckpoint.studyHistory,
      activeCheckpoint.longestStreak,
      activeCheckpoint.deletedCards,
      chunkCount,
      perChunkCardHashes,
      activeCheckpoint.languagePreference,
      activeCheckpoint.languagePreferenceUpdatedAt
    );
    saveUploadedChunkHashes(cleanId, uploadedHashesRecord);

    const allCards = assembleCheckpointCards(activeCheckpoint);

    return {
      cards: allCards,
      studyHistory: activeCheckpoint.studyHistory,
      longestStreak: activeCheckpoint.longestStreak,
      deletedCards: activeCheckpoint.deletedCards,
      languagePreference: activeCheckpoint.languagePreference,
      languagePreferenceUpdatedAt: activeCheckpoint.languagePreferenceUpdatedAt,
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

const sortRecordKeys = (rec?: Record<string, number>): Record<string, number> => {
  if (!rec) return {};
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(rec).sort()) {
    sorted[key] = rec[key];
  }
  return sorted;
};

const computeMetadataOnlyHash = (
  studyHistory: Record<string, number> | undefined,
  longestStreak: number | undefined,
  deletedCards: Record<string, number> | undefined,
  chunkCount: number,
  chunkHashes: Record<number, string>,
  languagePreference?: MeaningLanguagePreference,
  languagePreferenceUpdatedAt?: number
): string =>
  computePayloadHash(
    JSON.stringify({
      studyHistory: sortRecordKeys(studyHistory),
      longestStreak: longestStreak || 0,
      deletedCards: sortRecordKeys(deletedCards),
      languagePreference: languagePreference || 'en',
      languagePreferenceUpdatedAt: languagePreferenceUpdatedAt || 0,
      chunkCount,
      chunkHashes,
    })
  );

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

const getChunkPayloadBytes = (cards: Flashcard[]): number =>
  new Blob([JSON.stringify({ cards })]).size;

// Preserve existing card-to-chunk assignments from SyncedChunkCache so editing/reviewing a card
// in an earlier chunk never shifts chunk boundaries or forces unchanged later chunks to re-upload.
const buildStableChunks = (
  cleanId: string,
  orderedCards: Flashcard[],
  firstChunkMax: number,
  overflowChunkMax: number,
  forceFullUpload = false
): Flashcard[][] => {
  const cached = !forceFullUpload ? loadSyncedChunkCache(cleanId, orderedCards) : null;
  if (!cached || !cached.chunkCardIds || Object.keys(cached.chunkCardIds).length === 0) {
    const firstSplit = splitCardsIntoChunks(orderedCards, firstChunkMax);
    const chunk0 = firstSplit[0] || [];
    const remaining = orderedCards.slice(chunk0.length);
    const rest = remaining.length > 0 ? splitCardsIntoChunks(remaining, overflowChunkMax) : [];
    return [chunk0, ...rest];
  }

  const cardById = new Map<string, Flashcard>();
  for (const card of orderedCards) {
    cardById.set(card.id, card);
  }

  const assignedIds = new Set<string>();
  const pinnedChunks: Flashcard[][] = [];
  const maxIdx = Math.max(
    cached.chunkCount - 1,
    ...Object.keys(cached.chunkCardIds).map(Number)
  );

  for (let i = 0; i <= maxIdx; i++) {
    const ids = cached.chunkCardIds[i] || [];
    const chunkCards: Flashcard[] = [];
    for (const id of ids) {
      const card = cardById.get(id);
      if (card && !assignedIds.has(id)) {
        chunkCards.push(card);
        assignedIds.add(id);
      }
    }
    const hardLimit = i === 0 ? firstChunkMax + 1536 : overflowChunkMax + 1536;
    const splitLimit = i === 0 ? firstChunkMax : overflowChunkMax;
    if (chunkCards.length > 0 && getChunkPayloadBytes(chunkCards) > hardLimit) {
      const subChunks = splitCardsIntoChunks(chunkCards, splitLimit);
      pinnedChunks.push(...subChunks);
    } else if (i === 0 || chunkCards.length > 0) {
      pinnedChunks.push(chunkCards);
    }
  }

  if (pinnedChunks.length === 0) {
    pinnedChunks.push([]);
  }

  // Append any brand-new cards to the last chunk (or new overflow chunks if the last chunk fills up)
  const newCards = orderedCards.filter(c => !assignedIds.has(c.id));
  if (newCards.length > 0) {
    const lastIdx = pinnedChunks.length - 1;
    const lastChunk = pinnedChunks[lastIdx];
    const lastLimit = lastIdx === 0 ? firstChunkMax : overflowChunkMax;
    let currentBytes = getChunkPayloadBytes(lastChunk);

    const remainingNewCards: Flashcard[] = [];
    for (const card of newCards) {
      const cardBytes = new Blob([JSON.stringify(card)]).size + 1;
      if (
        remainingNewCards.length === 0 &&
        (lastChunk.length === 0 || currentBytes + cardBytes <= lastLimit)
      ) {
        lastChunk.push(card);
        currentBytes += cardBytes;
      } else {
        remainingNewCards.push(card);
      }
    }

    if (remainingNewCards.length > 0) {
      const extraChunks = splitCardsIntoChunks(remainingNewCards, overflowChunkMax);
      pinnedChunks.push(...extraChunks);
    }
  }

  return pinnedChunks;
};

export const getPendingCloudSyncPlan = (
  pantryId: string,
  cloudData: CloudData
): {
  hasChanges: boolean;
  dirtyChunkCount: number;
  totalChunks: number;
  isMetadataOnly: boolean;
} => {
  try {
    const cleanId = normalizePantryId(pantryId);
    const sanitizedCards = sanitizeCardsForCloud(cloudData.cards || []);
    const orderedCards = [...sanitizedCards].sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id || '').localeCompare(b.id || '')
    );
    const previousChunkCount = knownChunkCounts.get(cleanId) ?? cloudData.chunkCount ?? 1;
    const knownHashes = loadUploadedChunkHashes(cleanId);

    const metadataOverhead = new Blob([
      JSON.stringify({
        cards: [],
        studyHistory: cloudData.studyHistory,
        longestStreak: cloudData.longestStreak,
        deletedCards: cloudData.deletedCards,
        chunkCount: 99,
        lastAccessedAt: Date.now(),
      }),
    ]).size;
    const firstChunkMax = Math.max(8 * 1024, MAX_BASKET_BYTES - metadataOverhead);
    const allChunks = buildStableChunks(cleanId, orderedCards, firstChunkMax, MAX_BASKET_BYTES - 512, false);
    const staleChunksToDelete = Math.max(0, previousChunkCount - allChunks.length);

    const cardChunkHashes: Record<number, string> = {};
    let dirtyChunkCount = 0;
    for (let i = 0; i < allChunks.length; i++) {
      cardChunkHashes[i] = computeCardChunkHash(allChunks[i]);
      if (knownHashes[i] !== cardChunkHashes[i]) {
        dirtyChunkCount++;
      }
    }

    const metaHash = computeMetadataOnlyHash(
      cloudData.studyHistory,
      cloudData.longestStreak,
      cloudData.deletedCards,
      allChunks.length,
      cardChunkHashes
    );
    const metaChanged = knownHashes.meta !== metaHash;
    const hasChanges = dirtyChunkCount > 0 || metaChanged || staleChunksToDelete > 0;

    return {
      hasChanges,
      dirtyChunkCount: dirtyChunkCount + staleChunksToDelete,
      totalChunks: allChunks.length,
      isMetadataOnly: dirtyChunkCount === 0 && staleChunksToDelete === 0 && metaChanged,
    };
  } catch (err) {
    console.warn('Failed to compute cloud sync plan, falling back to full sync check:', err);
    return {
      hasChanges: true,
      dirtyChunkCount: 1,
      totalChunks: 1,
      isMetadataOnly: false,
    };
  }
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

  const singleCardChunkHash = computeCardChunkHash(orderedCards);
  const fullPayload = JSON.stringify({
    cards: orderedCards,
    studyHistory: cloudData.studyHistory,
    longestStreak: cloudData.longestStreak,
    deletedCards: cloudData.deletedCards,
    chunkCount: 1,
    chunkHashes: { 0: singleCardChunkHash },
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
    const singleMetaHash = computeMetadataOnlyHash(
      cloudData.studyHistory,
      cloudData.longestStreak,
      cloudData.deletedCards,
      1,
      { 0: singleCardChunkHash }
    );
    const knownHashes = { ...loadUploadedChunkHashes(cleanId) };

    if (
      !forceFullUpload &&
      staleChunksToDelete === 0 &&
      knownHashes[0] === singleCardChunkHash &&
      knownHashes.meta === singleMetaHash
    ) {
      onProgress?.({
        currentChunk: 1,
        totalChunks: 1,
        completedSteps: 1,
        totalSteps: 1,
        percent: 100,
        step: 'Cloud storage is already up to date!',
        estimatedRemainingSec: 0,
      });
      return;
    }

    // If only metadata (studyHistory / longestStreak / deletedCards) changed and chunk 0 cards are already on Pantry,
    // use a lightweight PUT instead of re-uploading all cards!
    if (
      !forceFullUpload &&
      staleChunksToDelete === 0 &&
      knownHashes[0] === singleCardChunkHash &&
      knownHashes.meta !== singleMetaHash
    ) {
      onProgress?.({
        currentChunk: 1,
        totalChunks: 1,
        completedSteps: 0,
        totalSteps: 1,
        percent: 50,
        step: 'Syncing study progress to Cloud...',
        estimatedRemainingSec: 1,
      });
      const putRes = await fetchWithRetry(
        `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`,
        {
          ...FETCH_OPTIONS,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studyHistory: cloudData.studyHistory,
            longestStreak: cloudData.longestStreak,
            deletedCards: cloudData.deletedCards,
            chunkCount: 1,
            chunkHashes: { 0: singleCardChunkHash },
            lastAccessedAt: now,
          }),
        },
        3,
        2200,
        immediate
      );
      if (putRes.ok) {
        knownHashes.meta = singleMetaHash;
        saveUploadedChunkHashes(cleanId, knownHashes);
        return;
      }
    }

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

    saveUploadedChunkHashes(cleanId, { 0: singleCardChunkHash, meta: singleMetaHash });
    saveSyncedChunkCache(cleanId, {
      chunkCount: 1,
      manifestSignature: computeMainManifestSignature({
        cards: orderedCards,
        studyHistory: cloudData.studyHistory,
        longestStreak: cloudData.longestStreak,
        deletedCards: cloudData.deletedCards,
        chunkCount: 1,
        chunkHashes: { 0: singleCardChunkHash },
      }),
      chunkHashes: { 0: singleCardChunkHash },
      chunks: { 0: orderedCards },
    });
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

  // Build chunks while pinning existing card-to-chunk assignments from SyncedChunkCache
  const allChunks = buildStableChunks(
    cleanId,
    orderedCards,
    firstChunkMax,
    maxBasketBytes - 512,
    forceFullUpload
  );
  const staleChunksToDelete = Math.max(0, previousChunkCount - allChunks.length);

  // Compute deterministic content hashes per chunk so we can skip unchanged or already-uploaded chunks
  const knownHashes = { ...loadUploadedChunkHashes(cleanId) };
  const cardChunkHashes: Record<number, string> = {};
  for (let i = 0; i < allChunks.length; i++) {
    cardChunkHashes[i] = computeCardChunkHash(allChunks[i]);
  }
  const metaHash = computeMetadataOnlyHash(
    cloudData.studyHistory,
    cloudData.longestStreak,
    cloudData.deletedCards,
    allChunks.length,
    cardChunkHashes
  );

  const dirtyChunkIndices: number[] = [];
  for (let i = 0; i < allChunks.length; i++) {
    if (forceFullUpload || knownHashes[i] !== cardChunkHashes[i]) {
      dirtyChunkIndices.push(i);
    }
  }
  const metaChanged = forceFullUpload || knownHashes.meta !== metaHash;

  // If every chunk and metadata is already up to date on Pantry and no stale chunks need deletion, skip uploading!
  if (dirtyChunkIndices.length === 0 && !metaChanged && staleChunksToDelete === 0) {
    onProgress?.({
      currentChunk: allChunks.length,
      totalChunks: allChunks.length,
      completedSteps: allChunks.length,
      totalSteps: allChunks.length,
      percent: 100,
      step: 'Cloud storage is already up to date!',
      estimatedRemainingSec: 0,
    });
    return;
  }

  const totalSteps = Math.max(1, dirtyChunkIndices.length + staleChunksToDelete);
  const skippedCount = allChunks.length - dirtyChunkIndices.length;
  let completedDirtySteps = 0;

  // 1. Save main basket (chunk 0 + metadata + chunkCount + chunkHashes) if chunk 0's cards changed
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
      chunkHashes: cardChunkHashes,
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
    knownHashes[0] = cardChunkHashes[0];
    knownHashes.meta = metaHash;
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
    knownHashes[i] = cardChunkHashes[i];
    saveUploadedChunkHashes(cleanId, knownHashes);
    completedDirtySteps += 1;
  }

  // If chunk 0's cards didn't change, update metadata (studyHistory, longestStreak, deletedCards, chunkCount, chunkHashes)
  // on Lumina via a lightweight ~200-byte PUT instead of re-uploading 30 KB of chunk 0 cards!
  if (!dirtyChunkIndices.includes(0) && (dirtyChunkIndices.length > 0 || metaChanged)) {
    const putRes = await fetchWithRetry(
      `${BASE_URL}/${cleanId}/basket/${BASKET_NAME}`,
      {
        ...FETCH_OPTIONS,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyHistory: cloudData.studyHistory,
          longestStreak: cloudData.longestStreak,
          deletedCards: cloudData.deletedCards,
          chunkCount: allChunks.length,
          chunkHashes: cardChunkHashes,
          lastAccessedAt: now,
        }),
      },
      2,
      2000,
      false
    ).catch(() => null);
    if (putRes && putRes.ok) {
      knownHashes.meta = metaHash;
      saveUploadedChunkHashes(cleanId, knownHashes);
    }
  }

  const chunksRecord: Record<number, Flashcard[]> = {};
  for (let i = 0; i < allChunks.length; i++) {
    chunksRecord[i] = allChunks[i];
  }
  saveSyncedChunkCache(cleanId, {
    chunkCount: allChunks.length,
    manifestSignature: computeMainManifestSignature({
      cards: allChunks[0],
      studyHistory: cloudData.studyHistory,
      longestStreak: cloudData.longestStreak,
      deletedCards: cloudData.deletedCards,
      chunkCount: allChunks.length,
      chunkHashes: cardChunkHashes,
    }),
    chunkHashes: cardChunkHashes,
    chunks: chunksRecord,
  });

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
