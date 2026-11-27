import { useState, useEffect, useRef, useCallback } from 'react';
import { MeaningLanguagePreference } from '../types';
import {
  loadLanguagePreferenceFromStorage,
  saveLanguagePreferenceToStorage,
  isValidLanguagePreference,
} from '../utils/languageUtils';

export const useLanguagePreference = () => {
  const [languagePreference, setLanguagePreference] = useState<MeaningLanguagePreference>(
    () => loadLanguagePreferenceFromStorage().preference
  );
  const [languagePreferenceUpdatedAt, setLanguagePreferenceUpdatedAt] = useState<number>(
    () => loadLanguagePreferenceFromStorage().updatedAt
  );
  const languagePreferenceRef = useRef<MeaningLanguagePreference>(languagePreference);
  const languagePreferenceUpdatedAtRef = useRef<number>(languagePreferenceUpdatedAt);

  useEffect(() => {
    languagePreferenceRef.current = languagePreference;
  }, [languagePreference]);

  useEffect(() => {
    languagePreferenceUpdatedAtRef.current = languagePreferenceUpdatedAt;
  }, [languagePreferenceUpdatedAt]);

  const handleChangeLanguagePreference = useCallback((nextPref: MeaningLanguagePreference) => {
    const now = Date.now();
    languagePreferenceRef.current = nextPref;
    languagePreferenceUpdatedAtRef.current = now;
    setLanguagePreference(nextPref);
    setLanguagePreferenceUpdatedAt(now);
    saveLanguagePreferenceToStorage(nextPref, now);
  }, []);

  const applyIncomingLanguagePreference = useCallback(
    (incomingPref?: MeaningLanguagePreference, incomingUpdatedAt?: number) => {
      if (!isValidLanguagePreference(incomingPref)) return;
      const incTs =
        typeof incomingUpdatedAt === 'number' && Number.isFinite(incomingUpdatedAt)
          ? incomingUpdatedAt
          : 0;
      const curTs = languagePreferenceUpdatedAtRef.current;
      const shouldAdopt =
        (curTs === 0 && (incTs > 0 || incomingPref !== 'en')) ||
        (incTs > 0 && incTs > curTs);
      if (shouldAdopt) {
        const resolvedTs = Math.max(incTs, curTs);
        languagePreferenceRef.current = incomingPref;
        languagePreferenceUpdatedAtRef.current = resolvedTs;
        setLanguagePreference(incomingPref);
        setLanguagePreferenceUpdatedAt(resolvedTs);
        saveLanguagePreferenceToStorage(incomingPref, resolvedTs);
      }
    },
    []
  );

  const resolveMergedLanguagePreference = useCallback(
    (
      ...sources: Array<
        | {
            languagePreference?: MeaningLanguagePreference;
            languagePreferenceUpdatedAt?: number;
          }
        | undefined
      >
    ): { preference: MeaningLanguagePreference; updatedAt: number } => {
      let bestPref = languagePreferenceRef.current;
      let bestTs = languagePreferenceUpdatedAtRef.current;
      for (const src of sources) {
        if (!src || !isValidLanguagePreference(src.languagePreference)) continue;
        const ts =
          typeof src.languagePreferenceUpdatedAt === 'number' &&
          Number.isFinite(src.languagePreferenceUpdatedAt)
            ? src.languagePreferenceUpdatedAt
            : 0;
        if (
          (bestTs === 0 && (ts > 0 || src.languagePreference !== 'en')) ||
          (ts > 0 && ts > bestTs)
        ) {
          bestPref = src.languagePreference;
          bestTs = Math.max(ts, bestTs);
        }
      }
      return { preference: bestPref, updatedAt: bestTs };
    },
    []
  );

  const setResolvedLanguagePreference = useCallback(
    (preference: MeaningLanguagePreference, updatedAt: number) => {
      languagePreferenceRef.current = preference;
      languagePreferenceUpdatedAtRef.current = updatedAt;
      setLanguagePreference(preference);
      setLanguagePreferenceUpdatedAt(updatedAt);
      saveLanguagePreferenceToStorage(preference, updatedAt);
    },
    []
  );

  return {
    languagePreference,
    languagePreferenceUpdatedAt,
    languagePreferenceRef,
    languagePreferenceUpdatedAtRef,
    handleChangeLanguagePreference,
    applyIncomingLanguagePreference,
    resolveMergedLanguagePreference,
    setResolvedLanguagePreference,
  };
};
