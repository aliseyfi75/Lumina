import { Flashcard, CloudData, FlashcardStatus } from '../types';
import { ChunkProgressInfo } from './pantryService';

const GIST_API_BASE = 'https://api.github.com/gists';
export const LUMINA_GIST_FILENAME = 'lumina_flashcards_backup.json';
const GIST_FILENAME = LUMINA_GIST_FILENAME;
const LEGACY_GIST_FILENAMES = ['lumina_flashcards_backup.json', 'lumina-deck.json', 'lumina_backup.json'];
const GIST_DESCRIPTION = 'Lumina Vocabulary & Flashcards Cloud Sync';

interface GistSyncCacheState {
  etag?: string;
  payloadHash: string;
  cachedData?: CloudData;
  updatedAt: number;
}

const gistSyncMemoryCache = new Map<string, GistSyncCacheState>();

const getGistCacheStorageKey = (gistId: string) => `lumina_gist_sync_cache_${gistId.trim()}`;

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
    if (card.updatedAt) clean.updatedAt = card.updatedAt;
    return clean;
  });

const normalizeCardsFromGist = (cards: Flashcard[]): Flashcard[] =>
  cards.map(card => ({
    ...card,
    partOfSpeech: card.partOfSpeech ?? '',
    status: card.status ?? FlashcardStatus.New,
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
      // Persist only lightweight hash + etag in localStorage so we never hit quota
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

const extractDeckFromGistObject = async (
  gist: GitHubGistResponse,
  token: string
): Promise<CloudData> => {
  const files = gist.files || {};
  let targetFile: GitHubGistFile | undefined;

  for (const candidate of LEGACY_GIST_FILENAMES) {
    if (files[candidate]) {
      targetFile = files[candidate];
      break;
    }
  }
  if (!targetFile) {
    const firstJsonKey = Object.keys(files).find(k => k.toLowerCase().endsWith('.json'));
    if (firstJsonKey) targetFile = files[firstJsonKey];
  }

  if (!targetFile) {
    return { cards: [], chunkCount: 1, basketExists: false };
  }

  let rawJsonText = targetFile.content || '';
  if ((targetFile.truncated || !rawJsonText) && targetFile.raw_url) {
    const rawRes = await fetch(targetFile.raw_url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
      },
    });
    if (!rawRes.ok) {
      throw new Error(`Failed to download full Gist file content (${rawRes.status}).`);
    }
    rawJsonText = await rawRes.text();
  }

  if (!rawJsonText.trim()) {
    return { cards: [], chunkCount: 1, basketExists: false };
  }

  const parsed = JSON.parse(rawJsonText);
  const cards = Array.isArray(parsed.cards) ? normalizeCardsFromGist(parsed.cards) : [];
  return {
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
    chunkCount: 1,
    basketExists: true,
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
    const res = await fetch(`${GIST_API_BASE}/${cleanPreferredId}`, {
      method: 'GET',
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
    const gist = (await res.json()) as GitHubGistResponse;
    const existingData = await extractDeckFromGistObject(gist, cleanToken);
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

  const listRes = await fetch(`${GIST_API_BASE}?per_page=100`, {
    method: 'GET',
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

  const initialPayload = JSON.stringify(
    {
      cards: [],
      studyHistory: {},
      longestStreak: 0,
      deletedCards: {},
      updatedAt: Date.now(),
    },
    null,
    2
  );

  const createRes = await fetch(GIST_API_BASE, {
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
  return {
    gistId: created.id,
    created: true,
    createdNewGist: true,
    existingData: { cards: [], chunkCount: 1, basketExists: true },
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

  const res = await fetch(`${GIST_API_BASE}/${cleanId}`, {
    method: 'GET',
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
  const cloudData = await extractDeckFromGistObject(gist, cleanToken);

  saveGistSyncCache(cleanId, {
    etag,
    payloadHash: computeGistPayloadHash(cloudData),
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
 */
export const updateGistDeck = async (
  token: string,
  gistId: string,
  cloudData: CloudData,
  options?: {
    immediate?: boolean;
    force?: boolean;
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

  const fileContent = JSON.stringify(
    {
      cards: orderedCards,
      studyHistory: cloudData.studyHistory || {},
      longestStreak: cloudData.longestStreak || 0,
      deletedCards: cloudData.deletedCards || {},
      ...(cloudData.languagePreference ? { languagePreference: cloudData.languagePreference } : {}),
      ...(cloudData.languagePreferenceUpdatedAt
        ? { languagePreferenceUpdatedAt: cloudData.languagePreferenceUpdatedAt }
        : {}),
      updatedAt: Date.now(),
    },
    null,
    2
  );

  const res = await fetch(`${GIST_API_BASE}/${cleanId}`, {
    method: 'PATCH',
    headers: buildHeaders(cleanToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      files: {
        [GIST_FILENAME]: {
          content: fileContent,
        },
      },
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
    cachedData: {
      cards: orderedCards,
      studyHistory: cloudData.studyHistory || {},
      longestStreak: cloudData.longestStreak || 0,
      deletedCards: cloudData.deletedCards || {},
      ...(cloudData.languagePreference ? { languagePreference: cloudData.languagePreference } : {}),
      ...(cloudData.languagePreferenceUpdatedAt
        ? { languagePreferenceUpdatedAt: cloudData.languagePreferenceUpdatedAt }
        : {}),
      chunkCount: 1,
      basketExists: true,
    },
    updatedAt: Date.now(),
  });

  options?.onProgress?.({
    currentChunk: 1,
    totalChunks: 1,
    completedSteps: 1,
    totalSteps: 1,
    percent: 100,
    step: 'Saved to GitHub Gist!',
    estimatedRemainingSec: 0,
  });
  return { skippedUnchanged: false };
};
