import { Flashcard, CloudData, FlashcardStatus } from '../types';
import { ChunkProgressInfo } from './pantryService';

const GIST_API_BASE = 'https://api.github.com/gists';
export const LUMINA_GIST_FILENAME = 'lumina_flashcards_backup.json';
export const LUMINA_GIST_PART_PREFIX = 'lumina_flashcards_part_';
const GIST_FILENAME = LUMINA_GIST_FILENAME;
const LEGACY_GIST_FILENAMES = ['lumina_flashcards_backup.json', 'lumina-deck.json', 'lumina_backup.json'];
const GIST_DESCRIPTION = 'Lumina Vocabulary & Flashcards Cloud Sync';

// Keep each Gist file comfortably below GitHub's 1 MB (1,000,000-byte) inline truncation threshold
// so GET /gists/{id} returns full file contents inline in 1 request without needing raw_url.
export const MAX_GIST_PART_BYTES = 750 * 1024;

interface GistSyncCacheState {
  etag?: string;
  payloadHash: string;
  partCount?: number;
  cachedData?: CloudData;
  updatedAt: number;
}

const gistSyncMemoryCache = new Map<string, GistSyncCacheState>();

const getGistCacheStorageKey = (gistId: string) => `lumina_gist_sync_cache_${gistId.trim()}`;

export const clearGistSyncCacheForTests = () => {
  gistSyncMemoryCache.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('lumina_gist_sync_cache_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    }
  } catch {
    // ignore storage errors
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const gistFetch = async (
  url: string,
  init: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
): Promise<Response> => {
  const retries = options?.retries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 25_000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller && timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      const res = await fetch(url, {
        ...init,
        ...(controller && !init.signal ? { signal: controller.signal } : {}),
      });
      if (timer) clearTimeout(timer);

      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err: any) {
      if (timer) clearTimeout(timer);

      if (attempt < retries) {
        await sleep(350 * (attempt + 1));
        continue;
      }

      const isNetworkErr =
        err instanceof TypeError ||
        err?.name === 'AbortError' ||
        /failed to fetch|load failed|networkerror|fetch failed/i.test(err?.message || '');

      if (isNetworkErr) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new Error(
            'You appear to be offline. Please check your internet connection and try again.'
          );
        }
        throw new Error(
          'Unable to reach GitHub Gist due to a network error. Please check your internet connection (or VPN/content blocker) and try again.'
        );
      }
      throw err;
    }
  }

  throw new Error('Unable to reach GitHub Gist after multiple attempts.');
};

const computeFastHash = (payload: string): string => {
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

const sanitizeCardsForGist = (cards: Flashcard[]): Flashcard[] =>
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
    if (card.statusUpdatedAt) clean.statusUpdatedAt = card.statusUpdatedAt;
    if (card.updatedAt) clean.updatedAt = card.updatedAt;
    return clean;
  });

const normalizeCardsFromGist = (cards: Flashcard[]): Flashcard[] =>
  cards.map(card => ({
    ...card,
    partOfSpeech: card.partOfSpeech ?? '',
    status: card.status ?? FlashcardStatus.New,
    repetition: card.repetition ?? 0,
    lastReviewed: card.lastReviewed ?? 0,
    createdAt: card.createdAt ?? Date.now(),
  }));

const sortRecordKeys = (rec?: Record<string, number>): Record<string, number> => {
  if (!rec) return {};
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(rec).sort()) {
    sorted[key] = rec[key];
  }
  return sorted;
};

export const computeGistPayloadHash = (cloudData: CloudData): string => {
  const orderedCards = [...sanitizeCardsForGist(cloudData.cards || [])].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id || '').localeCompare(b.id || '')
  );
  return computeFastHash(
    JSON.stringify({
      cards: orderedCards,
      studyHistory: sortRecordKeys(cloudData.studyHistory),
      longestStreak: cloudData.longestStreak || 0,
      deletedCards: sortRecordKeys(cloudData.deletedCards),
      languagePreference: cloudData.languagePreference || 'en',
      languagePreferenceUpdatedAt: cloudData.languagePreferenceUpdatedAt || 0,
    })
  );
};

const loadGistSyncCache = (gistId: string): GistSyncCacheState | null => {
  const cleanId = gistId.trim();
  if (!cleanId) return null;
  const mem = gistSyncMemoryCache.get(cleanId);
  if (mem) return mem;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(getGistCacheStorageKey(cleanId));
      if (raw) {
        const parsed = JSON.parse(raw) as GistSyncCacheState;
        if (parsed && typeof parsed === 'object' && typeof parsed.payloadHash === 'string') {
          gistSyncMemoryCache.set(cleanId, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return null;
};

const saveGistSyncCache = (gistId: string, state: GistSyncCacheState) => {
  const cleanId = gistId.trim();
  if (!cleanId) return;
  gistSyncMemoryCache.set(cleanId, state);
  try {
    if (typeof localStorage !== 'undefined') {
      // Persist only lightweight hash + etag + partCount in localStorage so we never hit quota
      const { cachedData: _omit, ...lightweight } = state;
      localStorage.setItem(getGistCacheStorageKey(cleanId), JSON.stringify(lightweight));
    }
  } catch {
    // ignore storage errors
  }
};

export const hasPendingGistSyncChanges = (gistId: string, cloudData: CloudData): boolean => {
  try {
    const cleanId = gistId.trim();
    if (!cleanId) return true;
    const cached = loadGistSyncCache(cleanId);
    if (!cached) return true;
    const currentHash = computeGistPayloadHash(cloudData);
    return cached.payloadHash !== currentHash;
  } catch {
    return true;
  }
};

const buildHeaders = (token: string, extra?: Record<string, string>): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token.trim()}`,
  'X-GitHub-Api-Version': '2022-11-28',
  ...extra,
});

export const normalizeGistId = (rawInput?: string): string => {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return '';
  // Allow full gist URLs like https://gist.github.com/username/abcdef123456
  const urlMatch = trimmed.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]{10,64})/i);
  if (urlMatch) return urlMatch[1];
  return trimmed;
};

interface GitHubGistFile {
  filename?: string;
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

interface GitHubGistResponse {
  id: string;
  description?: string;
  html_url?: string;
  files?: Record<string, GitHubGistFile>;
}

const getPartFilename = (partNumber: number) => `${LUMINA_GIST_PART_PREFIX}${partNumber}.json`;

/**
 * Downloads full text of a Gist file even when GitHub's >1 MB inline content truncation triggers.
 * IMPORTANT: `gist.githubusercontent.com` serves raw Gist files (including Secret Gists via their
 * unguessable commit-SHA URL) with `Access-Control-Allow-Origin: *` ONLY for CORS simple GET requests.
 * Sending an `Authorization` header to `gist.githubusercontent.com` triggers a CORS OPTIONS preflight
 * that GitHub's raw CDN rejects, causing browsers to throw `TypeError: Failed to fetch`!
 */
const downloadFullGistFileContent = async (
  file: GitHubGistFile,
  token: string
): Promise<string> => {
  const inlineContent = file.content || '';
  if (!file.truncated && inlineContent) {
    return inlineContent;
  }

  if (!file.raw_url) {
    return inlineContent;
  }

  let isGitHubApiHost = false;
  try {
    isGitHubApiHost = new URL(file.raw_url).hostname.toLowerCase() === 'api.github.com';
  } catch {
    isGitHubApiHost = false;
  }

  const rawRes = await gistFetch(
    file.raw_url,
    isGitHubApiHost
      ? {
          method: 'GET',
          cache: 'no-store',
          headers: buildHeaders(token, { Accept: 'application/vnd.github.raw+json' }),
        }
      : {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
        }
  );

  if (!rawRes.ok) {
    throw new Error(`Failed to download full Gist file content (${rawRes.status}).`);
  }
  return await rawRes.text();
};

const splitCardsForGistParts = (
  cards: Flashcard[],
  firstFileMaxCardBytes: number,
  overflowFileMaxCardBytes: number
): Flashcard[][] => {
  if (cards.length === 0) return [[]];
  const parts: Flashcard[][] = [];
  let currentPart: Flashcard[] = [];
  let currentBytes = 16;
  let currentLimit = firstFileMaxCardBytes;

  for (const card of cards) {
    const cardBytes = new Blob([JSON.stringify(card)]).size + 1;
    if (currentPart.length > 0 && currentBytes + cardBytes > currentLimit) {
      parts.push(currentPart);
      currentPart = [card];
      currentBytes = 16 + cardBytes;
      currentLimit = overflowFileMaxCardBytes;
    } else {
      currentPart.push(card);
      currentBytes += cardBytes;
    }
  }

  if (currentPart.length > 0) {
    parts.push(currentPart);
  }
  return parts;
};

const extractDeckFromGistObject = async (
  gist: GitHubGistResponse,
  token: string
): Promise<{ cloudData: CloudData; partCount: number }> => {
  const files = gist.files || {};
  let targetFile: GitHubGistFile | undefined;

  for (const candidate of LEGACY_GIST_FILENAMES) {
    if (files[candidate]) {
      targetFile = files[candidate];
      break;
    }
  }
  if (!targetFile) {
    const firstJsonKey = Object.keys(files).find(
      k => k.toLowerCase().endsWith('.json') && !k.startsWith(LUMINA_GIST_PART_PREFIX)
    );
    if (firstJsonKey) targetFile = files[firstJsonKey];
  }

  if (!targetFile) {
    return {
      cloudData: { cards: [], chunkCount: 1, basketExists: false },
      partCount: 1,
    };
  }

  const rawJsonText = await downloadFullGistFileContent(targetFile, token);

  if (!rawJsonText.trim()) {
    return {
      cloudData: { cards: [], chunkCount: 1, basketExists: false },
      partCount: 1,
    };
  }

  const parsed = JSON.parse(rawJsonText);
  let rawCards: Flashcard[] = Array.isArray(parsed.cards) ? [...parsed.cards] : [];

  const declaredPartCount =
    typeof parsed.partCount === 'number' && parsed.partCount > 1 ? Math.floor(parsed.partCount) : 1;

  if (declaredPartCount > 1) {
    for (let partNum = 2; partNum <= declaredPartCount; partNum++) {
      const partFile = files[getPartFilename(partNum)];
      if (!partFile) continue;
      const partText = await downloadFullGistFileContent(partFile, token);
      if (!partText.trim()) continue;
      const parsedPart = JSON.parse(partText);
      if (Array.isArray(parsedPart.cards)) {
        rawCards = rawCards.concat(parsedPart.cards);
      }
    }
  }

  const cards = normalizeCardsFromGist(rawCards);
  return {
    partCount: declaredPartCount,
    cloudData: {
      cards,
      studyHistory: parsed.studyHistory && typeof parsed.studyHistory === 'object' ? parsed.studyHistory : {},
      longestStreak: typeof parsed.longestStreak === 'number' ? parsed.longestStreak : 0,
      deletedCards: parsed.deletedCards && typeof parsed.deletedCards === 'object' ? parsed.deletedCards : {},
      ...(parsed.languagePreference === 'en' ||
      parsed.languagePreference === 'fa' ||
      parsed.languagePreference === 'both'
        ? { languagePreference: parsed.languagePreference }
        : {}),
      ...(typeof parsed.languagePreferenceUpdatedAt === 'number'
        ? { languagePreferenceUpdatedAt: parsed.languagePreferenceUpdatedAt }
        : {}),
      chunkCount: declaredPartCount,
      basketExists: true,
    },
  };
};

/**
 * Finds an existing Lumina Gist on the user's GitHub account (or validates a provided Gist ID),
 * or creates a brand-new Secret Gist if none exists yet.
 */
export const findOrCreateLuminaGist = async (
  token: string,
  preferredGistId?: string,
  onProgress?: (info: ChunkProgressInfo) => void
): Promise<{ gistId: string; created: boolean; createdNewGist: boolean; existingData: CloudData }> => {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('GitHub Personal Access Token is required.');
  }

  const cleanPreferredId = normalizeGistId(preferredGistId);

  // 1. If user specified a Gist ID, fetch it directly
  if (cleanPreferredId) {
    onProgress?.({
      currentChunk: 1,
      totalChunks: 1,
      percent: 25,
      step: 'Verifying GitHub Gist...',
      estimatedRemainingSec: 1,
    });
    const res = await gistFetch(`${GIST_API_BASE}/${cleanPreferredId}`, {
      method: 'GET',
      cache: 'no-store',
      headers: buildHeaders(cleanToken),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid GitHub token or missing "gist" permission.');
    }
    if (res.status === 404) {
      throw new Error(`Gist ID "${cleanPreferredId}" was not found. Leave Gist ID blank to auto-detect or create a new one.`);
    }
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
    }
    const etag = res.headers.get('etag') || undefined;
    const gist = (await res.json()) as GitHubGistResponse;
    const { cloudData: existingData, partCount } = await extractDeckFromGistObject(gist, cleanToken);
    saveGistSyncCache(gist.id, {
      etag,
      payloadHash: computeGistPayloadHash(existingData),
      partCount,
      cachedData: existingData,
      updatedAt: Date.now(),
    });
    return { gistId: gist.id, created: false, createdNewGist: false, existingData };
  }

  // 2. Otherwise auto-discover an existing Lumina Gist on the user's GitHub account
  onProgress?.({
    currentChunk: 1,
    totalChunks: 1,
    percent: 20,
    step: 'Checking GitHub account for existing Lumina Gist...',
    estimatedRemainingSec: 1,
  });

  const listRes = await gistFetch(`${GIST_API_BASE}?per_page=100`, {
    method: 'GET',
    cache: 'no-store',
    headers: buildHeaders(cleanToken),
  });

  if (listRes.status === 401 || listRes.status === 403) {
    throw new Error('Invalid GitHub token or missing "gist" permission. Please generate a token with the "gist" scope.');
  }
  if (!listRes.ok) {
    throw new Error(`Unable to reach GitHub Gist API (${listRes.status}).`);
  }

  const gists = (await listRes.json()) as GitHubGistResponse[];
  const matchedSummary = Array.isArray(gists)
    ? gists.find(g => {
        const files = g.files || {};
        if (LEGACY_GIST_FILENAMES.some(name => Boolean(files[name]))) return true;
        return (g.description || '').toLowerCase().includes('lumina vocabulary');
      })
    : undefined;

  if (matchedSummary?.id) {
    onProgress?.({
      currentChunk: 1,
      totalChunks: 1,
      percent: 45,
      step: 'Found existing Lumina Gist! Loading flashcards...',
      estimatedRemainingSec: 1,
    });
    const existingData = await getGistDeck(cleanToken, matchedSummary.id, { forceRefresh: true });
    return { gistId: matchedSummary.id, created: false, createdNewGist: false, existingData };
  }

  // 3. Create a new Secret Gist if none exists yet
  onProgress?.({
    currentChunk: 1,
    totalChunks: 1,
    percent: 45,
    step: 'Creating new Secret Gist on GitHub...',
    estimatedRemainingSec: 1,
  });

  const initialPayload = JSON.stringify({
    cards: [],
    studyHistory: {},
    longestStreak: 0,
    deletedCards: {},
    updatedAt: Date.now(),
  });

  const createRes = await gistFetch(GIST_API_BASE, {
    method: 'POST',
    headers: buildHeaders(cleanToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: initialPayload,
        },
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`Failed to create GitHub Gist (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as GitHubGistResponse;
  const emptyDeck: CloudData = { cards: [], chunkCount: 1, basketExists: true };
  saveGistSyncCache(created.id, {
    etag: createRes.headers.get('etag') || undefined,
    payloadHash: computeGistPayloadHash(emptyDeck),
    partCount: 1,
    cachedData: emptyDeck,
    updatedAt: Date.now(),
  });
  return {
    gistId: created.id,
    created: true,
    createdNewGist: true,
    existingData: emptyDeck,
  };
};

/**
 * Loads the complete flashcard deck from a GitHub Gist in a single HTTP request.
 * Uses HTTP ETag conditional requests when available so unchanged decks return 304 immediately.
 */
export const getGistDeck = async (
  token: string,
  gistId: string,
  options?: {
    forceRefresh?: boolean;
    maxBytesPerPart?: number;
    onProgress?: (info: ChunkProgressInfo) => void;
  }
): Promise<CloudData> => {
  const cleanToken = token.trim();
  const cleanId = normalizeGistId(gistId);
  if (!cleanToken || !cleanId) {
    throw new Error('GitHub token and Gist ID are required.');
  }

  options?.onProgress?.({
    currentChunk: 1,
    totalChunks: 1,
    completedSteps: 0,
    totalSteps: 1,
    percent: 35,
    step: 'Loading flashcards from GitHub Gist...',
    estimatedRemainingSec: 1,
  });

  const cached = loadGistSyncCache(cleanId);
  const extraHeaders: Record<string, string> = {};
  if (!options?.forceRefresh && cached?.etag && cached?.cachedData) {
    extraHeaders['If-None-Match'] = cached.etag;
  }

  const res = await gistFetch(`${GIST_API_BASE}/${cleanId}`, {
    method: 'GET',
    cache: 'no-store',
    headers: buildHeaders(cleanToken, extraHeaders),
  });

  if (res.status === 304 && cached?.cachedData) {
    options?.onProgress?.({
      currentChunk: 1,
      totalChunks: 1,
      completedSteps: 1,
      totalSteps: 1,
      percent: 100,
      step: 'Cloud deck is already up to date!',
      estimatedRemainingSec: 0,
    });
    return cached.cachedData;
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('GitHub token is invalid or lacks "gist" permission.');
  }
  if (res.status === 404) {
    throw new Error(`GitHub Gist "${cleanId}" not found.`);
  }
  if (!res.ok) {
    throw new Error(`Failed to load from GitHub Gist (${res.status}): ${res.statusText}`);
  }

  const etag = res.headers.get('etag') || undefined;
  const gist = (await res.json()) as GitHubGistResponse;
  const { cloudData, partCount } = await extractDeckFromGistObject(gist, cleanToken);

  saveGistSyncCache(cleanId, {
    etag,
    payloadHash: computeGistPayloadHash(cloudData),
    partCount,
    cachedData: cloudData,
    updatedAt: Date.now(),
  });

  options?.onProgress?.({
    currentChunk: 1,
    totalChunks: 1,
    completedSteps: 1,
    totalSteps: 1,
    percent: 100,
    step: 'Loaded flashcards from GitHub Gist!',
    estimatedRemainingSec: 0,
  });

  return cloudData;
};

/**
 * Saves the complete flashcard deck to a GitHub Gist in a single PATCH request (< 1s).
 * Automatically uses compact JSON and splits >750 KB decks across multi-part files within the same Gist
 * so no file ever crosses GitHub's 1 MB inline truncation threshold.
 */
export const updateGistDeck = async (
  token: string,
  gistId: string,
  cloudData: CloudData,
  options?: {
    immediate?: boolean;
    force?: boolean;
    maxBytesPerPart?: number;
    onProgress?: (info: ChunkProgressInfo) => void;
  }
): Promise<{ skippedUnchanged: boolean }> => {
  const cleanToken = token.trim();
  const cleanId = normalizeGistId(gistId);
  if (!cleanToken || !cleanId) {
    throw new Error('GitHub token and Gist ID are required.');
  }

  const payloadHash = computeGistPayloadHash(cloudData);
  const cached = loadGistSyncCache(cleanId);
  if (!options?.force && cached && cached.payloadHash === payloadHash) {
    options?.onProgress?.({
      currentChunk: 1,
      totalChunks: 1,
      completedSteps: 1,
      totalSteps: 1,
      percent: 100,
      step: 'All flashcards already synced to GitHub Gist!',
      estimatedRemainingSec: 0,
    });
    return { skippedUnchanged: true };
  }

  const sanitizedCards = sanitizeCardsForGist(cloudData.cards || []);
  const orderedCards = [...sanitizedCards].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id || '').localeCompare(b.id || '')
  );

  options?.onProgress?.({
    currentChunk: 1,
    totalChunks: 1,
    completedSteps: 0,
    totalSteps: 1,
    percent: 45,
    step: `Saving ${orderedCards.length} flashcards to GitHub Gist...`,
    estimatedRemainingSec: 1,
  });

  const maxPartBytes = options?.maxBytesPerPart ?? MAX_GIST_PART_BYTES;
  const now = Date.now();
  const metadataEnvelopeBytes =
    new Blob([
      JSON.stringify({
        cards: [],
        studyHistory: cloudData.studyHistory || {},
        longestStreak: cloudData.longestStreak || 0,
        deletedCards: cloudData.deletedCards || {},
        languagePreference: cloudData.languagePreference,
        languagePreferenceUpdatedAt: cloudData.languagePreferenceUpdatedAt,
        partCount: 99,
        updatedAt: now,
      }),
    ]).size + 128;

  const firstFileMaxCardBytes = Math.max(4 * 1024, maxPartBytes - metadataEnvelopeBytes);
  const overflowFileMaxCardBytes = Math.max(4 * 1024, maxPartBytes - 256);
  const cardParts = splitCardsForGistParts(orderedCards, firstFileMaxCardBytes, overflowFileMaxCardBytes);
  const partCount = cardParts.length;

  const mainFileContent = JSON.stringify({
    cards: cardParts[0] || [],
    studyHistory: cloudData.studyHistory || {},
    longestStreak: cloudData.longestStreak || 0,
    deletedCards: cloudData.deletedCards || {},
    ...(cloudData.languagePreference ? { languagePreference: cloudData.languagePreference } : {}),
    ...(cloudData.languagePreferenceUpdatedAt
      ? { languagePreferenceUpdatedAt: cloudData.languagePreferenceUpdatedAt }
      : {}),
    ...(partCount > 1 ? { partCount } : {}),
    updatedAt: now,
  });

  const gistFilesPayload: Record<string, { content: string } | null> = {
    [GIST_FILENAME]: {
      content: mainFileContent,
    },
  };

  for (let i = 1; i < partCount; i++) {
    gistFilesPayload[getPartFilename(i + 1)] = {
      content: JSON.stringify({
        partIndex: i + 1,
        cards: cardParts[i],
        updatedAt: now,
      }),
    };
  }

  // Delete any obsolete higher-numbered overflow part files from a previously larger deck
  const previousPartCount = Math.max(cached?.partCount ?? 1, cloudData.chunkCount ?? 1);
  for (let obsoletePart = partCount + 1; obsoletePart <= previousPartCount; obsoletePart++) {
    gistFilesPayload[getPartFilename(obsoletePart)] = null;
  }

  const res = await gistFetch(`${GIST_API_BASE}/${cleanId}`, {
    method: 'PATCH',
    headers: buildHeaders(cleanToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      files: gistFilesPayload,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('GitHub token is invalid or lacks "gist" permission.');
  }
  if (res.status === 404) {
    throw new Error(`GitHub Gist "${cleanId}" not found.`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to save to GitHub Gist (${res.status}): ${errText}`);
  }

  const etag = res.headers.get('etag') || undefined;
  saveGistSyncCache(cleanId, {
    etag,
    payloadHash,
    partCount,
    cachedData: {
      cards: orderedCards,
      studyHistory: cloudData.studyHistory || {},
      longestStreak: cloudData.longestStreak || 0,
      deletedCards: cloudData.deletedCards || {},
      ...(cloudData.languagePreference ? { languagePreference: cloudData.languagePreference } : {}),
      ...(cloudData.languagePreferenceUpdatedAt
        ? { languagePreferenceUpdatedAt: cloudData.languagePreferenceUpdatedAt }
        : {}),
      chunkCount: partCount,
      basketExists: true,
    },
    updatedAt: Date.now(),
  });

  options?.onProgress?.({
    currentChunk: partCount,
    totalChunks: partCount,
    completedSteps: 1,
    totalSteps: 1,
    percent: 100,
    step: 'Saved to GitHub Gist!',
    estimatedRemainingSec: 0,
  });
  return { skippedUnchanged: false };
};
