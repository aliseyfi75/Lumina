import type { LocalizedTranslations, WordEntry } from '../types';
import { mergeTranslations } from '../utils/languageUtils';

const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const FA_WIKTIONARY_API_URL = 'https://fa.wiktionary.org/w/api.php';

const TRANSLATION_TIMEOUT_MS = 1000;
const BATCH_SEPARATOR = '\n';

const PERSIAN_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

export interface PersianLexicalLookup {
  primaryTranslation?: string;
  allEquivalents: string[];
  byPos: Record<string, string[]>;
}

const lexicalCache = new Map<string, PersianLexicalLookup>();
const inFlightLexical = new Map<string, Promise<PersianLexicalLookup>>();
const senseTranslationCache = new Map<string, string>();
const cardMeaningCache = new Map<string, string>();

export const clearTranslationCache = () => {
  lexicalCache.clear();
  inFlightLexical.clear();
  senseTranslationCache.clear();
  cardMeaningCache.clear();
};

const fetchWithTimeout = async (url: string, timeoutMs = TRANSLATION_TIMEOUT_MS): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizePosKey = (rawPos?: string): string => {
  const cleaned = (rawPos || '').trim().toLowerCase();
  if (!cleaned) return 'general';
  if (cleaned === 'n' || cleaned.includes('noun')) return 'noun';
  if (cleaned === 'v' || cleaned.includes('verb')) return 'verb';
  if (cleaned === 'adj' || cleaned.includes('adjective') || cleaned === 'participle') return 'adjective';
  if (cleaned === 'adv' || cleaned.includes('adverb')) return 'adverb';
  return cleaned;
};

/**
 * Normalizes Arabic Yeh/Kaf variants to standard Persian Yeh/Kaf and cleans markup/noise.
 */
export const normalizePersianText = (raw: string): string => {
  if (!raw) return '';
  return raw
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh -> Persian Yeh (ی)
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf -> Persian Kaf (ک)
    .replace(/\u0649/g, '\u06CC') // Alef Maksura -> Persian Yeh
    .replace(/\s+/g, ' ')
    .trim();
};

export const cleanPersianEquivalent = (raw: string): string => {
  if (!raw) return '';
  const cleaned = normalizePersianText(
    raw
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\([^)]*[a-zA-Z][^)]*\)/g, '')
      .replace(/[«»"'[\]]/g, '')
  )
    .replace(/^[\s،,;:\-–—.]+|[\s،,;:\-–—.]+$/g, '')
    .trim();

  if (!cleaned || !PERSIAN_SCRIPT_REGEX.test(cleaned)) return '';
  if (cleaned.length > 48) return '';
  return cleaned;
};

export const cleanEnglishSenseForTranslation = (rawDefinition: string): string => {
  if (!rawDefinition) return '';
  let text = rawDefinition.trim();
  // Strip leading English grammatical/domain parentheticals like "(transitive, literary)"
  while (text.startsWith('(')) {
    const closeIdx = text.indexOf(')');
    if (closeIdx <= 1 || closeIdx > 60) break;
    const remainder = text.slice(closeIdx + 1).replace(/^[\s:;,-]+/, '').trim();
    if (!remainder) break;
    text = remainder;
  }
  // Keep first concise sentence/clause if definition is overly long (>240 chars)
  if (text.length > 240) {
    const semiIdx = text.indexOf(';');
    if (semiIdx >= 25 && semiIdx <= 200) {
      text = text.slice(0, semiIdx);
    } else {
      text = text.slice(0, 240);
    }
  }
  return text.replace(/\.$/, '').trim();
};

/**
 * Combines concise Persian word equivalents with a translated Persian sense explanation:
 * e.g. "زودگذر، ناپایدار — ماندگار برای مدت بسیار کوتاه"
 */
export const formatPersianMeaning = (
  equivalents: string[],
  senseTranslation?: string
): string => {
  const uniqueEquivalents: string[] = [];
  const seenEq = new Set<string>();

  for (const eq of equivalents) {
    const cleaned = cleanPersianEquivalent(eq);
    if (!cleaned) continue;
    const key = cleaned.replace(/\s+/g, ' ');
    if (!seenEq.has(key)) {
      seenEq.add(key);
      uniqueEquivalents.push(cleaned);
    }
    if (uniqueEquivalents.length >= 4) break;
  }

  let cleanSense = normalizePersianText(senseTranslation || '')
    .replace(/^[\s،,;:\-–—.]+|[\s،,;:\-–—.]+$/g, '')
    .trim();

  if (!PERSIAN_SCRIPT_REGEX.test(cleanSense)) {
    cleanSense = '';
  }

  const eqJoined = uniqueEquivalents.join('، ');

  if (eqJoined && cleanSense) {
    // Avoid redundant duplication when the translated sense is just one of the single-word equivalents
    if (
      cleanSense === eqJoined ||
      seenEq.has(cleanSense) ||
      (cleanSense.split(/\s+/).length <= 2 && uniqueEquivalents.some((eq) => eq.includes(cleanSense)))
    ) {
      return eqJoined;
    }
    return `${eqJoined} — ${cleanSense}`;
  }

  return eqJoined || cleanSense;
};

const fetchFaWiktionaryEquivalents = async (word: string): Promise<string[]> => {
  try {
    const url = `${FA_WIKTIONARY_API_URL}?action=parse&page=${encodeURIComponent(
      word.toLowerCase()
    )}&prop=wikitext&format=json&origin=*`;
    const res = await fetchWithTimeout(url, 1500);
    if (!res.ok) return [];
    const data = await res.json();
    const wikitext: string | undefined = data?.parse?.wikitext?.['*'];
    if (!wikitext || typeof wikitext !== 'string') return [];

    // Narrow to English section if language headers exist
    let targetSection = wikitext;
    const englishHeaderMatch = wikitext.match(/(?:==\s*انگلیسی\s*==|\{\{زبان\|en\}\})([\s\S]*?)(?:\n==[^=]|$)/);
    if (englishHeaderMatch?.[1]) {
      targetSection = englishHeaderMatch[1];
    }

    const lines = targetSection.split('\n');
    const equivalents: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Definition lines in Persian Wiktionary start with '#' (excluding '#:' examples and '#*' quotes)
      if (!trimmed.startsWith('#') || trimmed.startsWith('#:') || trimmed.startsWith('#*')) {
        continue;
      }
      const rawGloss = trimmed.replace(/^#+\s*/, '');
      const parts = rawGloss.split(/[،,؛;]/);
      for (const part of parts) {
        const cleaned = cleanPersianEquivalent(part);
        if (cleaned && cleaned.split(/\s+/).length <= 5) {
          equivalents.push(cleaned);
        }
        if (equivalents.length >= 5) break;
      }
      if (equivalents.length >= 5) break;
    }

    return equivalents;
  } catch {
    return [];
  }
};

const fetchGoogleTranslateWordData = async (word: string): Promise<PersianLexicalLookup | null> => {
  try {
    const url = `${GOOGLE_TRANSLATE_URL}?client=gtx&sl=en&tl=fa&dt=t&dt=bd&q=${encodeURIComponent(
      word.toLowerCase()
    )}`;
    const res = await fetchWithTimeout(url, TRANSLATION_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    let primaryTranslation = '';
    if (Array.isArray(data[0])) {
      primaryTranslation = normalizePersianText(
        data[0]
          .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
          .join('')
      );
      if (
        !PERSIAN_SCRIPT_REGEX.test(primaryTranslation) ||
        primaryTranslation.toLowerCase() === word.toLowerCase()
      ) {
        primaryTranslation = '';
      }
    }

    const byPos: Record<string, string[]> = {};
    const allEquivalents: string[] = [];

    // data[1] holds POS-grouped dictionary equivalents: [[posName, ["زودگذر", "ناپایدار"], ...], ...]
    if (Array.isArray(data[1])) {
      for (const posBlock of data[1]) {
        if (!Array.isArray(posBlock)) continue;
        const posKey = normalizePosKey(typeof posBlock[0] === 'string' ? posBlock[0] : '');
        const rawTerms = Array.isArray(posBlock[1]) ? posBlock[1] : [];
        const cleanedTerms = rawTerms
          .filter((t: any) => typeof t === 'string')
          .map((t: string) => cleanPersianEquivalent(t))
          .filter(Boolean);

        if (cleanedTerms.length > 0) {
          byPos[posKey] = Array.from(new Set([...(byPos[posKey] || []), ...cleanedTerms]));
          for (const t of cleanedTerms) {
            if (!allEquivalents.includes(t)) {
              allEquivalents.push(t);
            }
          }
        }
      }
    }

    if (primaryTranslation) {
      const cleanedPrimary = cleanPersianEquivalent(primaryTranslation);
      if (cleanedPrimary && !allEquivalents.includes(cleanedPrimary)) {
        allEquivalents.unshift(cleanedPrimary);
      }
    }

    return {
      primaryTranslation: primaryTranslation || undefined,
      allEquivalents,
      byPos,
    };
  } catch {
    return null;
  }
};

export const fetchPersianLexicalEquivalents = async (word: string): Promise<PersianLexicalLookup> => {
  const cleanWord = word.trim().toLowerCase();
  if (!cleanWord) return { allEquivalents: [], byPos: {} };

  const cached = lexicalCache.get(cleanWord);
  if (cached) return cached;

  const existing = inFlightLexical.get(cleanWord);
  if (existing) return existing;

  const promise = (async (): Promise<PersianLexicalLookup> => {
    const [googleData, faWikiTerms] = await Promise.all([
      fetchGoogleTranslateWordData(cleanWord),
      fetchFaWiktionaryEquivalents(cleanWord),
    ]);

    const byPos: Record<string, string[]> = { ...(googleData?.byPos || {}) };
    const mergedAll: string[] = [];

    for (const term of [...faWikiTerms, ...(googleData?.allEquivalents || [])]) {
      const cleaned = cleanPersianEquivalent(term);
      if (cleaned && !mergedAll.includes(cleaned)) {
        mergedAll.push(cleaned);
      }
    }

    const result: PersianLexicalLookup = {
      primaryTranslation: googleData?.primaryTranslation || mergedAll[0],
      allEquivalents: mergedAll,
      byPos,
    };

    if (mergedAll.length > 0 || result.primaryTranslation) {
      lexicalCache.set(cleanWord, result);
    }
    return result;
  })();

  inFlightLexical.set(cleanWord, promise);
  try {
    return await promise;
  } finally {
    inFlightLexical.delete(cleanWord);
  }
};

const translateSingleTextViaMyMemory = async (englishText: string): Promise<string> => {
  try {
    const url = `${MYMEMORY_TRANSLATE_URL}?q=${encodeURIComponent(englishText)}&langpair=en|fa`;
    const res = await fetchWithTimeout(url, TRANSLATION_TIMEOUT_MS);
    if (!res.ok) return '';
    const data = await res.json();
    const raw = data?.responseData?.translatedText;
    if (typeof raw !== 'string') return '';
    const cleaned = normalizePersianText(raw);
    if (!PERSIAN_SCRIPT_REGEX.test(cleaned)) return '';
    return cleaned;
  } catch {
    return '';
  }
};

const translateSingleTextViaGoogle = async (englishText: string): Promise<string> => {
  try {
    const url = `${GOOGLE_TRANSLATE_URL}?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(englishText)}`;
    const res = await fetchWithTimeout(url, TRANSLATION_TIMEOUT_MS);
    if (!res.ok) return '';
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
    const joined = normalizePersianText(
      data[0]
        .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
        .join('')
    );
    return PERSIAN_SCRIPT_REGEX.test(joined) ? joined : '';
  } catch {
    return '';
  }
};

/**
 * Translates an array of English sense definitions into Persian efficiently,
 * batching uncached definitions into a single request when possible.
 */
export const translateDefinitionsToPersian = async (definitions: string[]): Promise<string[]> => {
  if (definitions.length === 0) return [];

  const cleanedInputs = definitions.map(cleanEnglishSenseForTranslation);
  const outputs = new Array<string>(definitions.length).fill('');
  const uncachedIndices: number[] = [];

  cleanedInputs.forEach((text, idx) => {
    if (!text) return;
    const cached = senseTranslationCache.get(text.toLowerCase());
    if (cached !== undefined) {
      outputs[idx] = cached;
    } else {
      uncachedIndices.push(idx);
    }
  });

  if (uncachedIndices.length === 0) {
    return outputs;
  }

  // Batch up to 8 definitions in a single newline-delimited request
  const batchTexts = uncachedIndices.map((idx) => cleanedInputs[idx].replace(/\r?\n/g, ' '));
  let batchResolved = false;

  if (batchTexts.length === 1) {
    const single =
      (await translateSingleTextViaGoogle(batchTexts[0])) ||
      (await translateSingleTextViaMyMemory(batchTexts[0]));
    if (single) {
      const targetIdx = uncachedIndices[0];
      outputs[targetIdx] = single;
      senseTranslationCache.set(cleanedInputs[targetIdx].toLowerCase(), single);
    }
    return outputs;
  }

  try {
    const combinedQuery = batchTexts.join(BATCH_SEPARATOR);
    const url = `${GOOGLE_TRANSLATE_URL}?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(
      combinedQuery
    )}`;
    const res = await fetchWithTimeout(url, TRANSLATION_TIMEOUT_MS);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const fullTranslated = data[0]
          .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
          .join('');
        const lines = fullTranslated.split(/\r?\n/).map((l: string) => normalizePersianText(l));
        if (lines.length === uncachedIndices.length) {
          batchResolved = true;
          uncachedIndices.forEach((origIdx, i) => {
            const tr = PERSIAN_SCRIPT_REGEX.test(lines[i]) ? lines[i] : '';
            outputs[origIdx] = tr;
            if (tr) {
              senseTranslationCache.set(cleanedInputs[origIdx].toLowerCase(), tr);
            }
          });
        }
      }
    }
  } catch {
    // Fall through to individual fallback
  }

  if (!batchResolved) {
    await Promise.all(
      uncachedIndices.map(async (origIdx) => {
        const text = batchTexts[uncachedIndices.indexOf(origIdx)];
        const tr =
          (await translateSingleTextViaGoogle(text)) ||
          (await translateSingleTextViaMyMemory(text));
        outputs[origIdx] = tr;
        if (tr) {
          senseTranslationCache.set(cleanedInputs[origIdx].toLowerCase(), tr);
        }
      })
    );
  }

  return outputs;
};

/**
 * Extracts Persian word equivalents from a FreeDictionaryAPI `sense.translations` array.
 */
export const extractPersianFromSenseTranslations = (rawTranslations: unknown): string[] => {
  if (!Array.isArray(rawTranslations)) return [];
  const results: string[] = [];
  for (const item of rawTranslations) {
    if (!item || typeof item !== 'object') continue;
    const langCode = String((item as any).language?.code || '').toLowerCase();
    const langName = String((item as any).language?.name || '').toLowerCase();
    if (
      langCode === 'fa' ||
      langCode === 'pes' ||
      langCode === 'fas' ||
      langCode === 'per' ||
      langName.includes('persian') ||
      langName.includes('farsi')
    ) {
      const rawCandidates: string[] = [];
      if (typeof (item as any).word === 'string') {
        rawCandidates.push((item as any).word);
      }
      if (Array.isArray((item as any).words)) {
        for (const w of (item as any).words) {
          if (typeof w === 'string') rawCandidates.push(w);
        }
      }
      for (const rawWord of rawCandidates) {
        for (const part of rawWord.split(/[،,;]/)) {
          const cleaned = cleanPersianEquivalent(part);
          if (cleaned && !results.includes(cleaned)) {
            results.push(cleaned);
          }
        }
      }
    }
  }
  return results;
};

/**
 * Enriches all meanings & definitions on a WordEntry with Persian translations (`translations.fa`),
 * combining POS-matched Persian word equivalents and translated sense explanations.
 */
export const enrichWordEntryWithTranslations = async (
  entry: WordEntry,
  maxWaitMs = TRANSLATION_TIMEOUT_MS
): Promise<WordEntry> => {
  if (!entry || !entry.meanings?.length) return entry;

  const enrichTask = (async () => {
    const targets: Array<{ posKey: string; defIndex: number; meaningIndex: number; text: string }> = [];

    entry.meanings.forEach((meaning, mIdx) => {
      const posKey = normalizePosKey(meaning.partOfSpeech);
      meaning.definitions.forEach((def, dIdx) => {
        // Translate the top 6 definitions per POS (up to 12 total) for rich sense explanations
        if (dIdx < 6 && targets.length < 12) {
          targets.push({
            posKey,
            meaningIndex: mIdx,
            defIndex: dIdx,
            text: def.definition,
          });
        }
      });
    });

    const [lexical, translatedDefs] = await Promise.all([
      fetchPersianLexicalEquivalents(entry.word),
      translateDefinitionsToPersian(targets.map((t) => t.text)),
    ]);

    const senseMap = new Map<string, string>();
    targets.forEach((t, idx) => {
      if (translatedDefs[idx]) {
        senseMap.set(`${t.meaningIndex}:${t.defIndex}`, translatedDefs[idx]);
      }
    });

    const allWordFaEquivalents = new Set<string>(lexical.allEquivalents);

    entry.meanings.forEach((meaning, mIdx) => {
      const posKey = normalizePosKey(meaning.partOfSpeech);
      const posEquivalents = lexical.byPos[posKey] || lexical.allEquivalents;

      meaning.definitions.forEach((def, dIdx) => {
        const existingFa = def.translations?.fa
          ? def.translations.fa
              .split(/[،,;]/)
              .map((s) => cleanPersianEquivalent(s))
              .filter(Boolean)
          : [];
        for (const eq of existingFa) {
          allWordFaEquivalents.add(eq);
        }

        const senseTranslated = senseMap.get(`${mIdx}:${dIdx}`);
        // Combine sense-specific Wiktionary equivalents (if present) + POS equivalents + sense translation
        const combinedEquivalents =
          existingFa.length > 0
            ? [...existingFa, ...posEquivalents.slice(0, 2)]
            : dIdx === 0
              ? posEquivalents.slice(0, 3)
              : posEquivalents.slice(0, 2);

        const formattedFa = formatPersianMeaning(combinedEquivalents, senseTranslated);
        if (formattedFa) {
          def.translations = mergeTranslations(def.translations, { fa: formattedFa }, true);
        }
      });
    });

    if (allWordFaEquivalents.size > 0) {
      entry.wordTranslations = {
        ...(entry.wordTranslations || {}),
        fa: Array.from(allWordFaEquivalents).slice(0, 8),
      };
    }

    return entry;
  })();

  if (maxWaitMs > 0) {
    await Promise.race([
      enrichTask,
      new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
    ]);
  } else {
    await enrichTask;
  }

  return entry;
};

/**
 * Resolves a formatted Persian translation ("معادل‌ها — توضیح معنی") for a single flashcard or extracted book word.
 */
export const translateCardMeaningToPersian = async (params: {
  word: string;
  partOfSpeech?: string;
  mainDefinition: string;
  existingTranslations?: LocalizedTranslations;
  maxWaitMs?: number;
}): Promise<LocalizedTranslations | undefined> => {
  const { word, partOfSpeech, mainDefinition, existingTranslations, maxWaitMs = TRANSLATION_TIMEOUT_MS } = params;
  const cleanWord = word.trim();
  const cleanDef = mainDefinition.trim();
  if (!cleanWord || !cleanDef) return existingTranslations;

  // If existingTranslations.fa already contains a full formatted translation with '—' or multiple words, keep it
  if (existingTranslations?.fa && existingTranslations.fa.includes('—')) {
    return existingTranslations;
  }

  const cacheKey = `${cleanWord.toLowerCase()}::${normalizePosKey(partOfSpeech)}::${cleanDef.toLowerCase()}`;
  const cached = cardMeaningCache.get(cacheKey);
  if (cached) {
    return mergeTranslations(existingTranslations, { fa: cached }, true);
  }

  const work = (async (): Promise<LocalizedTranslations | undefined> => {
    const [lexical, senseTranslations] = await Promise.all([
      fetchPersianLexicalEquivalents(cleanWord),
      translateDefinitionsToPersian([cleanDef]),
    ]);

    const posKey = normalizePosKey(partOfSpeech);
    const posEquivalents = lexical.byPos[posKey] || lexical.allEquivalents;
    const seedEquivalents = existingTranslations?.fa
      ? [existingTranslations.fa, ...posEquivalents.slice(0, 3)]
      : posEquivalents.slice(0, 3);

    const formattedFa = formatPersianMeaning(seedEquivalents, senseTranslations[0]);
    if (!formattedFa) {
      return existingTranslations;
    }

    cardMeaningCache.set(cacheKey, formattedFa);
    return mergeTranslations(existingTranslations, { fa: formattedFa }, true);
  })();

  if (maxWaitMs > 0) {
    return Promise.race([
      work,
      new Promise<LocalizedTranslations | undefined>((resolve) =>
        setTimeout(() => resolve(existingTranslations), maxWaitMs)
      ),
    ]);
  }

  return work;
};
