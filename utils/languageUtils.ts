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

export const sanitizeTranslations = (
  translations?: LocalizedTranslations | null
): LocalizedTranslations | undefined => {
  if (!translations || typeof translations !== 'object') return undefined;
  const cleaned: LocalizedTranslations = {};
  let hasAny = false;
  for (const lang of ALL_TRANSLATION_LANGUAGES) {
    const raw = translations[lang];
    if (typeof raw === 'string' && raw.trim()) {
      cleaned[lang] = raw.trim();
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
  const cleanPersian = (translations?.fa || '').trim();

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
  return !card.translations?.fa?.trim();
};
