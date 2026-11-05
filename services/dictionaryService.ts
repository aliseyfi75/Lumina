import type { WordEntry, Meaning } from "../types";

const PRIMARY_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const DATAMUSE_API_URL = "https://api.datamuse.com/words";

const PRIMARY_TIMEOUT_MS = 2000;
const DATAMUSE_TIMEOUT_MS = 2500;
const IMAGE_TIMEOUT_MS = 2000;

interface DatamuseEntry {
  word: string;
  score: number;
  defs?: string[];
  tags?: string[];
}

// In-memory caches and in-flight request deduplication for instant lookups
const wordCache = new Map<string, WordEntry>();
const inFlightLookups = new Map<string, Promise<WordEntry | null>>();
const imageCache = new Map<string, string | null>();
const inFlightImages = new Map<string, Promise<string | null>>();

export const clearDictionaryCache = () => {
  wordCache.clear();
  inFlightLookups.clear();
  imageCache.clear();
  inFlightImages.clear();
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const lookupPrimary = async (word: string): Promise<WordEntry | null> => {
  try {
    const response = await fetchWithTimeout(
      `${PRIMARY_API_URL}/${encodeURIComponent(word)}`,
      PRIMARY_TIMEOUT_MS
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];

    const wordEntry: WordEntry = {
      word: entry.word,
      phonetic: entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text,
      audio: entry.phonetics?.find((p: any) => p.audio)?.audio,
      origin: entry.origin || undefined,
      meanings: entry.meanings.map((m: any) => {
        const mergedSyns = Array.from(
          new Set<string>([
            ...(Array.isArray(m.synonyms) ? m.synonyms : []),
            ...(Array.isArray(m.definitions)
              ? m.definitions.flatMap((d: any) => (Array.isArray(d.synonyms) ? d.synonyms : []))
              : []),
          ].map((s: string) => String(s).trim()).filter(Boolean))
        ).slice(0, 10);

        const mergedAnts = Array.from(
          new Set<string>([
            ...(Array.isArray(m.antonyms) ? m.antonyms : []),
            ...(Array.isArray(m.definitions)
              ? m.definitions.flatMap((d: any) => (Array.isArray(d.antonyms) ? d.antonyms : []))
              : []),
          ].map((s: string) => String(s).trim()).filter(Boolean))
        ).slice(0, 10);

        return {
          partOfSpeech: m.partOfSpeech,
          synonyms: mergedSyns.length > 0 ? mergedSyns : undefined,
          antonyms: mergedAnts.length > 0 ? mergedAnts : undefined,
          definitions: m.definitions.map((d: any) => ({
            definition: d.definition,
            example: d.example,
            synonyms: Array.isArray(d.synonyms) && d.synonyms.length > 0 ? d.synonyms.slice(0, 6) : undefined,
            antonyms: Array.isArray(d.antonyms) && d.antonyms.length > 0 ? d.antonyms.slice(0, 6) : undefined,
          })),
        };
      }),
    };

    return wordEntry;
  } catch {
    return null;
  }
};

const lookupDatamuse = async (word: string): Promise<WordEntry | null> => {
  try {
    // md=d (definitions), md=r (pronunciation), ipa=1 (IPA pronunciation)
    const response = await fetchWithTimeout(
      `${DATAMUSE_API_URL}?sp=${encodeURIComponent(word)}&md=dr&ipa=1&max=1`,
      DATAMUSE_TIMEOUT_MS
    );

    if (!response.ok) return null;

    const data: DatamuseEntry[] = await response.json();

    if (!Array.isArray(data) || data.length === 0 || !data[0].defs) return null;

    const entry = data[0];

    // Only accept exact case-insensitive match so typos still trigger "Did you mean...?"
    if (entry.word.toLowerCase() !== word.toLowerCase()) return null;

    // Extract phonetic from tags (e.g., "pron:/ˈæpəl/")
    let phonetic: string | undefined;
    if (entry.tags) {
      const pronTag = entry.tags.find(t => t.startsWith('pron:'));
      if (pronTag) {
        phonetic = pronTag.replace('pron:', '').trim();
      }
    }

    // Group definitions by part of speech
    const meaningsMap = new Map<string, { definition: string; example?: string }[]>();

    entry.defs.forEach(defStr => {
      // Format: "n\tDefinition text"
      const tabIndex = defStr.indexOf('\t');
      if (tabIndex === -1) return;

      const posCode = defStr.substring(0, tabIndex);
      const definition = defStr.substring(tabIndex + 1);

      let partOfSpeech = posCode;
      switch (posCode) {
        case 'n': partOfSpeech = 'noun'; break;
        case 'v': partOfSpeech = 'verb'; break;
        case 'adj': partOfSpeech = 'adjective'; break;
        case 'adv': partOfSpeech = 'adverb'; break;
      }

      if (!meaningsMap.has(partOfSpeech)) {
        meaningsMap.set(partOfSpeech, []);
      }

      meaningsMap.get(partOfSpeech)?.push({ definition });
    });

    const meanings: Meaning[] = Array.from(meaningsMap.entries()).map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions
    }));

    if (meanings.length === 0) return null;

    return {
      word: entry.word,
      phonetic,
      meanings
    };
  } catch {
    return null;
  }
};

export const fetchImageForWord = async (word: string): Promise<string | null> => {
  const cleanWord = word.trim();
  if (!cleanWord) return null;
  const cacheKey = cleanWord.toLowerCase();

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey) ?? null;
  }

  const existing = inFlightImages.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const wikiResponse = await fetchWithTimeout(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanWord)}`,
        IMAGE_TIMEOUT_MS
      );
      if (wikiResponse.ok) {
        const wikiData = await wikiResponse.json();
        const img = wikiData.thumbnail?.source || wikiData.originalimage?.source || null;
        imageCache.set(cacheKey, img);
        const cachedWord = wordCache.get(cacheKey);
        if (cachedWord && img) {
          cachedWord.image = img;
        }
        return img;
      }
    } catch {
      // Ignore image fetch timeouts/errors so they never block word lookup
    }
    imageCache.set(cacheKey, null);
    return null;
  })();

  inFlightImages.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightImages.delete(cacheKey);
  }
};

export const lookupWord = async (word: string): Promise<WordEntry | null> => {
  const cleanWord = word.trim();
  if (!cleanWord) return null;
  const cacheKey = cleanWord.toLowerCase();

  const cached = wordCache.get(cacheKey);
  if (cached) {
    const cachedImage = imageCache.get(cacheKey);
    return {
      ...cached,
      ...(cachedImage ? { image: cachedImage } : {}),
    };
  }

  const inFlight = inFlightLookups.get(cacheKey);
  if (inFlight) return inFlight;

  const lookupPromise = (async (): Promise<WordEntry | null> => {
    // Start Primary API, Fallback API (Datamuse), and image lookup in parallel
    // so we never wait sequentially when Primary is slow or 404s.
    const primaryPromise = lookupPrimary(cleanWord);
    const datamusePromise = lookupDatamuse(cleanWord);
    const imagePromise = fetchImageForWord(cleanWord);

    let result = await primaryPromise;
    if (!result) {
      result = await datamusePromise;
    } else if (!result.phonetic) {
      const dm = await datamusePromise;
      if (dm?.phonetic) {
        result.phonetic = dm.phonetic;
      }
    }

    if (!result) {
      return null;
    }

    const resultKey = result.word.toLowerCase();
    // Attach image immediately if it already resolved, otherwise don't block definition display
    const quickImage = await Promise.race([
      imagePromise,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 150)),
    ]);
    if (quickImage) {
      result.image = quickImage;
    } else if (imageCache.get(resultKey)) {
      result.image = imageCache.get(resultKey)!;
    }

    wordCache.set(cacheKey, result);
    wordCache.set(resultKey, result);
    return { ...result };
  })();

  inFlightLookups.set(cacheKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    inFlightLookups.delete(cacheKey);
  }
};

export const prefetchWord = (word: string): void => {
  const clean = word?.trim();
  if (!clean || clean.length < 2) return;
  lookupWord(clean).catch(() => {});
};

export const getSpellingSuggestions = async (word: string): Promise<string[]> => {
  const cleanWord = word.trim();
  if (!cleanWord) return [];
  try {
    // sp = spelled like (handles typos)
    const response = await fetchWithTimeout(
      `${DATAMUSE_API_URL}?sp=${encodeURIComponent(cleanWord)}&max=5`,
      DATAMUSE_TIMEOUT_MS
    );

    if (!response.ok) return [];

    const data: DatamuseEntry[] = await response.json();

    return data
      .map(entry => entry.word)
      .filter(w => w.toLowerCase() !== cleanWord.toLowerCase());

  } catch (error) {
    console.error("Error fetching spelling suggestions:", error);
    return [];
  }
};
