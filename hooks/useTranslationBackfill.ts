import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Flashcard, LocalizedTranslations, MeaningLanguagePreference } from '../types';
import { cardNeedsPersianBackfill, mergeTranslations } from '../utils/languageUtils';
import { translateCardMeaningToPersian } from '../services/translationService';

interface UseTranslationBackfillParams {
  cards: Flashcard[];
  cardsRef: React.MutableRefObject<Flashcard[]>;
  setCards: React.Dispatch<React.SetStateAction<Flashcard[]>>;
  isDataLoaded: boolean;
  languagePreference: MeaningLanguagePreference;
}

export interface BatchTranslationItem {
  id: string;
  word: string;
  def: string;
  pos?: string;
}

export const useTranslationBackfill = ({
  cards,
  cardsRef,
  setCards,
  isDataLoaded,
  languagePreference,
}: UseTranslationBackfillParams) => {
  const [isBackfillingTranslations, setIsBackfillingTranslations] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const isBackfillingRef = useRef(false);
  const autoAttemptedBackfillIdsRef = useRef<Set<string>>(new Set());

  // NOTE: Do NOT mutate `updatedAt` on automatic background translation enrichment so we never
  // overshadow user edits or cross-device study timestamps; cloud hash functions hash `translations` directly.
  const populateSingleCardTranslationAsync = useCallback(
    (cardId: string, word: string, mainDefinition: string, partOfSpeech?: string) => {
      if (!word.trim() || !mainDefinition.trim()) return;
      translateCardMeaningToPersian({ word, mainDefinition, partOfSpeech })
        .then((resolved) => {
          if (!resolved?.fa) return;
          setCards((prev) => {
            let changed = false;
            const next = prev.map((c) => {
              if (c.id !== cardId) return c;
              const merged = mergeTranslations(c.translations, resolved, false);
              if (merged?.fa === c.translations?.fa) return c;
              changed = true;
              return { ...c, translations: merged };
            });
            if (changed) {
              cardsRef.current = next;
            }
            return changed ? next : prev;
          });
        })
        .catch(() => {
          // Non-fatal: background backfill or manual retry can translate later
        });
    },
    [cardsRef, setCards]
  );

  const populateBatchCardTranslationsAsync = useCallback(
    async (items: BatchTranslationItem[]) => {
      if (items.length === 0) return;
      const BATCH_SIZE = 4;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (item) => {
            try {
              const resolved = await translateCardMeaningToPersian({
                word: item.word,
                mainDefinition: item.def,
                partOfSpeech: item.pos,
              });
              return { id: item.id, resolved };
            } catch {
              return { id: item.id, resolved: undefined };
            }
          })
        );

        const resolvedMap = new Map<string, LocalizedTranslations>();
        for (const r of results) {
          if (r.resolved?.fa) {
            resolvedMap.set(r.id, r.resolved);
          }
        }

        if (resolvedMap.size > 0) {
          setCards((prev) => {
            let changed = false;
            const next = prev.map((card) => {
              const incoming = resolvedMap.get(card.id);
              if (!incoming) return card;
              const merged = mergeTranslations(card.translations, incoming, false);
              if (merged?.fa === card.translations?.fa) return card;
              changed = true;
              return { ...card, translations: merged };
            });
            if (changed) {
              cardsRef.current = next;
            }
            return changed ? next : prev;
          });
        }
      }
    },
    [cardsRef, setCards]
  );

  const runPersianBackfill = useCallback(
    async (forceRetryAll = false) => {
      if (isBackfillingRef.current) return;

      const candidates = cardsRef.current.filter(
        (c) =>
          cardNeedsPersianBackfill(c) &&
          (forceRetryAll || !autoAttemptedBackfillIdsRef.current.has(c.id))
      );
      if (candidates.length === 0) return;

      isBackfillingRef.current = true;
      setIsBackfillingTranslations(true);
      setBackfillProgress({ completed: 0, total: candidates.length });

      try {
        const BATCH_SIZE = 4;
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
          const batch = candidates.slice(i, i + BATCH_SIZE);
          batch.forEach((c) => autoAttemptedBackfillIdsRef.current.add(c.id));

          const results = await Promise.all(
            batch.map(async (card) => {
              try {
                const resolved = await translateCardMeaningToPersian({
                  word: card.word,
                  mainDefinition: card.mainDefinition,
                  partOfSpeech: card.partOfSpeech,
                  existingTranslations: card.translations,
                  maxWaitMs: 5000,
                });
                return { id: card.id, resolved };
              } catch {
                return { id: card.id, resolved: undefined };
              }
            })
          );

          const resolvedMap = new Map<string, LocalizedTranslations>();
          for (const r of results) {
            if (r.resolved?.fa) {
              resolvedMap.set(r.id, r.resolved);
            }
          }

          if (resolvedMap.size > 0) {
            setCards((prev) => {
              let changed = false;
              const next = prev.map((card) => {
                const incoming = resolvedMap.get(card.id);
                if (!incoming) return card;
                const merged = mergeTranslations(card.translations, incoming, true);
                if (merged?.fa === card.translations?.fa) return card;
                changed = true;
                return { ...card, translations: merged };
              });
              if (changed) {
                cardsRef.current = next;
              }
              return changed ? next : prev;
            });
          }

          setBackfillProgress({
            completed: Math.min(i + batch.length, candidates.length),
            total: candidates.length,
          });
        }
      } finally {
        isBackfillingRef.current = false;
        setIsBackfillingTranslations(false);
        setBackfillProgress(null);
      }
    },
    [cardsRef, setCards]
  );

  // Automatically backfill legacy cards in the background when user selects Persian or Both
  useEffect(() => {
    if (!isDataLoaded) return;
    if (languagePreference !== 'fa' && languagePreference !== 'both') return;
    if (isBackfillingRef.current) return;

    const hasUntriedMissing = cards.some(
      (c) => cardNeedsPersianBackfill(c) && !autoAttemptedBackfillIdsRef.current.has(c.id)
    );
    if (!hasUntriedMissing) return;

    const timer = setTimeout(() => {
      void runPersianBackfill(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [isDataLoaded, languagePreference, cards, runPersianBackfill]);

  return {
    isBackfillingTranslations,
    backfillProgress,
    populateSingleCardTranslationAsync,
    populateBatchCardTranslationsAsync,
    runPersianBackfill,
  };
};
