import { LocalizedTranslations, MeaningLanguagePreference, TranslationLanguageCode } from '../types';

export const LANGUAGE_PREF_STORAGE_KEY = 'lumina_language_pref';
export const LANGUAGE_PREF_UPDATED_AT_KEY = 'lumina_language_pref_updated_at';

export const ALL_TRANSLATION_LANGUAGES: TranslationLanguageCode[] = ['fa'];

export interface LanguagePreferenceOption {
  value: MeaningLanguagePreference;
  label: string;
  shortBadge: string;
  nativeSubtitle: string;
  description: string;
}

export const LANGUAGE_PREFERENCE_OPTIONS: LanguagePreferenceOption[] = [
  {
    value: 'en',
    label: 'English',
    shortBadge: 'EN',
    nativeSubtitle: 'English Only',
    description: 'Show word definitions in English only.',
  },
  {
    value: 'fa',
    label: 'Persian (Farsi)',
    shortBadge: 'FA',
    nativeSubtitle: 'فقط فارسی',
    description: 'Show word meanings in Persian (falls back to English until translated).',
  },
  {
    value: 'both',
    label: 'Both (English + Persian)',
    shortBadge: 'EN+FA',
    nativeSubtitle: 'انگلیسی + فارسی',
    description: 'Show the English meaning first, followed by the Persian translation.',
  },
];

export const isValidLanguagePreference = (val: unknown): val is MeaningLanguagePreference =>
  val === 'en' || val === 'fa' || val === 'both';

export const normalizeLanguagePreference = (val: unknown): MeaningLanguagePreference =>
  isValidLanguagePreference(val) ? val : 'en';

export const loadLanguagePreferenceFromStorage = (): {
  preference: MeaningLanguagePreference;
  updatedAt: number;
} => {
  try {
    if (typeof localStorage !== 'undefined') {
      const rawPref = localStorage.getItem(LANGUAGE_PREF_STORAGE_KEY);
      const rawTs = Number(localStorage.getItem(LANGUAGE_PREF_UPDATED_AT_KEY) || '0');
      if (isValidLanguagePreference(rawPref)) {
        return {
          preference: rawPref,
          updatedAt: Number.isFinite(rawTs) && rawTs > 0 ? rawTs : 0,
        };
      }
    }
  } catch {
    // ignore storage access issues
  }
  return { preference: 'en', updatedAt: 0 };
};

export const saveLanguagePreferenceToStorage = (
  preference: MeaningLanguagePreference,
  updatedAt: number
): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LANGUAGE_PREF_STORAGE_KEY, preference);
      if (updatedAt > 0) {
        localStorage.setItem(LANGUAGE_PREF_UPDATED_AT_KEY, String(updatedAt));
      }
    }
  } catch {
    // ignore storage access issues
  }
};

const PERSIAN_SCRIPT_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

const normalizeBasicPersianScript = (raw: string): string =>
  raw
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh -> Persian Yeh (ی)
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf -> Persian Kaf (ک)
    .replace(/\u0649/g, '\u06CC') // Alef Maksura -> Persian Yeh
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[https?:\/\/[^\]]*\]/gi, ' ')
    .replace(/\[\[\s*(?:رده|Category|پرونده|File|Image|[a-z]{2,3})\s*:[^\]]*\]\]/gi, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Meta/wiki/citation/API-error phrases that must NEVER be accepted or displayed as a word's Persian meaning
const INVALID_PERSIAN_SUBSTRING_PATTERNS: RegExp[] = [
  /ویکی\s*واژه/, // e.g. "ویکی‌واژه انگلیسی", "برگرفته از ویکی‌واژه انگلیسی", "مشارکت‌کنندگان ویکی‌واژه"
  /ویکیواژه/,
  /ویکی\s*پدیا/, // e.g. "ویکی‌پدیای انگلیسی"
  /ویکیپدیا/,
  /ویکی\s*نسک/,
  /ویکی\s*نبشته/,
  /مدیا\s*ویکی/,
  /دانشنامه\s*آزاد/,
  /مشارکت\s*کنندگان/,
  /یادکرد/,
  /پیوند\s*به\s*بیرون/,
  /جستارهای\s*وابسته/,
  /تغییر\s*مسیر/,
  /ابهام\s*زدایی/,
  /https?:\/\//i,
  /\bwiktionary\b/i,
  /\bwikipedia\b/i,
  /\bwikimedia\b/i,
  /\bmymemory\b/i,
  /query\s+length\s+limit/i,
];

const INVALID_STANDALONE_PERSIAN_LABELS = new Set([
  'منابع',
  'منبع',
  'مراجع',
  'پانویس',
  'بن مایه',
  'ریشه شناسی',
  'واژه شناسی',
  'تلفظ',
  'آوایش',
  'برگردان',
  'برگردان ها',
  'رده ها',
  'فرهنگ لغت انگلیسی',
  'فرهنگ انگلیسی به فارسی',
  'انگلیسی',
  'فارسی',
]);

export const isInvalidPersianTranslationFragment = (raw?: string | null): boolean => {
  if (!raw) return true;
  const cleaned = normalizeBasicPersianScript(raw)
    .replace(/^[\s،,؛;:\-–—.()«»"'[\]]+|[\s،,؛;:\-–—.()«»"'[\]]+$/g, '')
    .trim();
  if (!cleaned || !PERSIAN_SCRIPT_CHAR_REGEX.test(cleaned)) return true;

  // Normalize ZWNJ (\u200C) to space so "ویکی‌واژه" and "ویکی واژه" match identically
  const zwnjNormalized = cleaned.replace(/\u200C+/g, ' ').replace(/\s+/g, ' ').trim();
  if (INVALID_STANDALONE_PERSIAN_LABELS.has(zwnjNormalized)) {
    return true;
  }
  return INVALID_PERSIAN_SUBSTRING_PATTERNS.some(rx => rx.test(zwnjNormalized));
};

/**
 * Cleans a Persian translation string, stripping Wiktionary/citation artifacts (such as "ویکی‌واژه انگلیسی")
 * both when they appear as the entire string AND when they appear inside a comma-separated list of equivalents.
 */
export const sanitizePersianTranslation = (raw?: string | null): string => {
  if (!raw || typeof raw !== 'string') return '';
  const normalized = normalizeBasicPersianScript(raw);
  if (!normalized || !PERSIAN_SCRIPT_CHAR_REGEX.test(normalized)) return '';

  const splitAndCleanTerms = (segment: string): string[] => {
    const seen = new Set<string>();
    const valid: string[] = [];
    for (const part of segment.split(/[،,؛;]/)) {
      const trimmed = part.replace(/^[\s\-–—.]+|[\s\-–—.]+$/g, '').trim();
      if (!trimmed || isInvalidPersianTranslationFragment(trimmed)) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        valid.push(trimmed);
      }
    }
    return valid;
  };

  if (normalized.includes('—')) {
    const [leftRaw, ...rightParts] = normalized.split('—');
    const validEquivalents = splitAndCleanTerms(leftRaw || '');
    const rightRaw = rightParts.join(' — ').replace(/^[\s،,؛;:\-–—.]+|[\s،,؛;:\-–—.]+$/g, '').trim();
    const validSense = rightRaw && !isInvalidPersianTranslationFragment(rightRaw) ? rightRaw : '';

    if (validEquivalents.length > 0 && validSense) {
      return `${validEquivalents.join('، ')} — ${validSense}`;
    }
    if (validEquivalents.length > 0) {
      return validEquivalents.join('، ');
    }
    return validSense;
  }

  // Single-clause or comma-separated equivalents without '—'
  if (/[،,؛;]/.test(normalized)) {
    return splitAndCleanTerms(normalized).join('، ');
  }

  const trimmedSingle = normalized.replace(/^[\s\-–—.]+|[\s\-–—.]+$/g, '').trim();
  return isInvalidPersianTranslationFragment(trimmedSingle) ? '' : trimmedSingle;
};

export const sanitizeTranslations = (
  translations?: LocalizedTranslations | null
): LocalizedTranslations | undefined => {
  if (!translations || typeof translations !== 'object') return undefined;
  const cleaned: LocalizedTranslations = {};
  let hasAny = false;
  for (const lang of ALL_TRANSLATION_LANGUAGES) {
    const raw = translations[lang];
    if (typeof raw !== 'string') continue;
    const sanitizedVal = lang === 'fa' ? sanitizePersianTranslation(raw) : raw.trim();
    if (sanitizedVal) {
      cleaned[lang] = sanitizedVal;
      hasAny = true;
    }
  }
  return hasAny ? cleaned : undefined;
};

export const mergeTranslations = (
  base?: LocalizedTranslations | null,
  incoming?: LocalizedTranslations | null,
  preferIncoming = true
): LocalizedTranslations | undefined => {
  const cleanBase = sanitizeTranslations(base);
  const cleanIncoming = sanitizeTranslations(incoming);
  if (!cleanBase && !cleanIncoming) return undefined;
  if (!cleanBase) return cleanIncoming;
  if (!cleanIncoming) return cleanBase;

  const merged: LocalizedTranslations = { ...cleanBase };
  for (const lang of ALL_TRANSLATION_LANGUAGES) {
    const incVal = cleanIncoming[lang];
    const baseVal = cleanBase[lang];
    if (incVal && (preferIncoming || !baseVal)) {
      merged[lang] = incVal;
    }
  }
  return sanitizeTranslations(merged);
};

export interface ResolvedMeaningDisplay {
  showEnglish: boolean;
  englishText: string;
  showPersian: boolean;
  persianText: string;
  isFallbackToEnglish: boolean;
}

/**
 * Resolves which language(s) to display for a definition/card given the user's preference:
 * - 'en'   -> English only
 * - 'fa'   -> Persian only (cleanly falls back to English if Persian translation is not ready yet)
 * - 'both' -> English first, and then Persian right below
 */
export const resolveMeaningDisplay = (
  englishText: string,
  translations: LocalizedTranslations | undefined,
  preference: MeaningLanguagePreference
): ResolvedMeaningDisplay => {
  const cleanEnglish = (englishText || '').trim();
  const cleanPersian = sanitizePersianTranslation(translations?.fa);

  if (preference === 'en') {
    return {
      showEnglish: true,
      englishText: cleanEnglish,
      showPersian: false,
      persianText: '',
      isFallbackToEnglish: false,
    };
  }

  if (preference === 'fa') {
    if (cleanPersian) {
      return {
        showEnglish: false,
        englishText: cleanEnglish,
        showPersian: true,
        persianText: cleanPersian,
        isFallbackToEnglish: false,
      };
    }
    return {
      showEnglish: true,
      englishText: cleanEnglish,
      showPersian: false,
      persianText: '',
      isFallbackToEnglish: true,
    };
  }

  // 'both' -> English first, then Persian
  return {
    showEnglish: true,
    englishText: cleanEnglish,
    showPersian: Boolean(cleanPersian),
    persianText: cleanPersian,
    isFallbackToEnglish: false,
  };
};

export const cardNeedsPersianBackfill = (card: {
  word?: string;
  mainDefinition?: string;
  translations?: LocalizedTranslations;
}): boolean => {
  if (!card.word?.trim() || !card.mainDefinition?.trim()) return false;
  const rawFa = card.translations?.fa?.trim() || '';
  if (!rawFa) return true;
  const sanitizedFa = sanitizePersianTranslation(rawFa);
  if (!sanitizedFa) return true;
  // If rawFa contained invalid wiki noise that removed all equivalents before '—', re-backfill to restore equivalents
  if (rawFa.includes('—') && !sanitizedFa.includes('—')) return true;
  return false;
};
