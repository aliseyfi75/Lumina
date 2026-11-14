import { Flashcard, FlashcardStatus } from '../types';
import { mergeTranslations } from './languageUtils';

export interface MergeDeckOptions {
  ignoreTombstones?: boolean;
  /** Default true: when timestamps/progress tie, adopt incoming card fields. */
  preferIncoming?: boolean;
  /**
   * When true (e.g. explicit "Load from Cloud" or JSON backup import), incoming non-empty
   * content fields (definition, POS, phonetic, example, tags) take precedence even if local
   * `updatedAt` was previously bumped by a background translation backfill, while SRS review
   * status still resolves losslessly by latest review timestamp + progress.
   */
  preferIncomingContent?: boolean;
  liveDeletedMap?: ReadonlyMap<string, number>;
}

const STATUS_RANK: Record<FlashcardStatus, number> = {
  [FlashcardStatus.New]: 0,
  [FlashcardStatus.Learning]: 1,
  [FlashcardStatus.Mastered]: 2,
};

const getEffectiveStatusTimestamp = (card: Flashcard): number => {
  if (typeof card.statusUpdatedAt === 'number' && card.statusUpdatedAt > 0) {
    return card.statusUpdatedAt;
  }
  // An unreviewed 'New' card with 0 repetitions has never been studied, even if an earlier
  // background backfill bumped `updatedAt` or a legacy merge copied `lastReviewed`.
  if (card.status === FlashcardStatus.New && !(card.repetition && card.repetition > 0)) {
    return 0;
  }
  return card.lastReviewed || 0;
};

const getSrsProgressScore = (card: Flashcard): number =>
  (card.repetition ?? 0) * 10 +
  (STATUS_RANK[card.status] ?? 0) * 3 +
  Math.min(2, (card.interval ?? 0) * 0.01);

export const mergeTwoFlashcards = (
  existing: Flashcard,
  inc: Flashcard,
  targetId: string,
  options?: MergeDeckOptions
): Flashcard => {
  const preferIncoming = options?.preferIncoming ?? true;
  const preferIncomingContent = options?.preferIncomingContent ?? false;

  // 1. Resolve SRS study state independently from content/translation `updatedAt`
  const incStatusTs = getEffectiveStatusTimestamp(inc);
  const extStatusTs = getEffectiveStatusTimestamp(existing);
  const incProgress = getSrsProgressScore(inc);
  const extProgress = getSrsProgressScore(existing);

  const useIncomingSrs =
    incStatusTs !== extStatusTs
      ? incStatusTs > extStatusTs
      : incProgress !== extProgress
        ? incProgress > extProgress
        : preferIncoming;

  const srsWinner = useIncomingSrs ? inc : existing;
  const srsFallback = useIncomingSrs ? existing : inc;

  // 2. Resolve card content/metadata (definition, POS, phonetics, tags, examples)
  const incContentTs = inc.updatedAt ?? inc.createdAt ?? 0;
  const extContentTs = existing.updatedAt ?? existing.createdAt ?? 0;
  const useIncomingContent = preferIncomingContent
    ? true
    : incContentTs !== extContentTs
      ? incContentTs > extContentTs
      : preferIncoming;

  const contentWinner = useIncomingContent ? inc : existing;
  const contentFallback = useIncomingContent ? existing : inc;

  const resolvedStatus = srsWinner.status ?? FlashcardStatus.New;
  const resolvedRepetition = srsWinner.repetition ?? 0;
  const resolvedLastReviewed =
    resolvedStatus === FlashcardStatus.New && resolvedRepetition === 0 && !srsWinner.statusUpdatedAt
      ? 0
      : srsWinner.lastReviewed || srsFallback.lastReviewed || 0;
  const resolvedStatusUpdatedAt = srsWinner.statusUpdatedAt ?? srsFallback.statusUpdatedAt;

  const merged: Flashcard = {
    id: targetId,
    word: contentWinner.word || contentFallback.word,
    mainDefinition:
      contentWinner.mainDefinition && contentWinner.mainDefinition !== '—'
        ? contentWinner.mainDefinition
        : contentFallback.mainDefinition || contentWinner.mainDefinition,
    translations: mergeTranslations(
      contentFallback.translations,
      contentWinner.translations,
      true
    ),
    partOfSpeech: contentWinner.partOfSpeech || contentFallback.partOfSpeech || '',
    phonetic: contentWinner.phonetic || contentFallback.phonetic,
    audio: contentWinner.audio || contentFallback.audio,
    image: contentWinner.image || contentFallback.image,
    example: contentWinner.example || contentFallback.example,
    tags:
      contentWinner.tags && contentWinner.tags.length > 0
        ? contentWinner.tags
        : contentFallback.tags && contentFallback.tags.length > 0
          ? contentFallback.tags
          : undefined,
    synonyms:
      contentWinner.synonyms && contentWinner.synonyms.length > 0
        ? contentWinner.synonyms
        : contentFallback.synonyms && contentFallback.synonyms.length > 0
          ? contentFallback.synonyms
          : undefined,
    antonyms:
      contentWinner.antonyms && contentWinner.antonyms.length > 0
        ? contentWinner.antonyms
        : contentFallback.antonyms && contentFallback.antonyms.length > 0
          ? contentFallback.antonyms
          : undefined,
    complexityLevel: contentWinner.complexityLevel || contentFallback.complexityLevel,
    complexityScore: contentWinner.complexityScore ?? contentFallback.complexityScore,
    bookChapter: contentWinner.bookChapter || contentFallback.bookChapter,
    createdAt: Math.min(
      existing.createdAt || Date.now(),
      inc.createdAt || Date.now()
    ),
    // Atomic SRS state from srsWinner (never leaks stale `repetition` from fallback when reset to 0)
    status: resolvedStatus,
    repetition: resolvedRepetition,
    interval: srsWinner.interval,
    easinessFactor: srsWinner.easinessFactor,
    nextReviewDate: srsWinner.nextReviewDate ?? srsFallback.nextReviewDate,
    lastQuality: srsWinner.lastQuality,
    lastReviewed: resolvedLastReviewed,
    ...(resolvedStatusUpdatedAt !== undefined ? { statusUpdatedAt: resolvedStatusUpdatedAt } : {}),
    updatedAt:
      existing.updatedAt !== undefined || inc.updatedAt !== undefined
        ? Math.max(existing.updatedAt ?? 0, inc.updatedAt ?? 0)
        : undefined,
  };

  return merged;
};

export const mergeFlashcardDecks = (
  baseCards: Flashcard[],
  incoming: Flashcard[],
  tombstones: Record<string, number> = {},
  options?: MergeDeckOptions
): Flashcard[] => {
  const ignoreTombstones = options?.ignoreTombstones ?? false;
  const liveMap = options?.liveDeletedMap;

  const isDeleted = (card: Flashcard) => {
    if (ignoreTombstones) return false;
    const deletedAt = Math.max(liveMap?.get(card.id) ?? 0, tombstones[card.id] ?? 0);
    if (!deletedAt) return false;
    const cardTs = Math.max(
      card.updatedAt ?? 0,
      card.statusUpdatedAt ?? 0,
      card.lastReviewed ?? 0,
      card.createdAt ?? 0
    );
    return deletedAt >= cardTs;
  };

  const cardMap = new Map<string, Flashcard>();
  for (const c of baseCards) {
    if (!isDeleted(c)) {
      cardMap.set(c.id, c);
    }
  }

  for (const c of incoming) {
    if (isDeleted(c)) continue;

    const normWord = c.word.trim().toLowerCase();
    const normDef = c.mainDefinition.trim().toLowerCase();

    let duplicateId: string | undefined;
    if (cardMap.has(c.id)) {
      duplicateId = c.id;
    } else {
      for (const [key, existing] of cardMap.entries()) {
        if (
          existing.word.trim().toLowerCase() === normWord &&
          existing.mainDefinition.trim().toLowerCase() === normDef
        ) {
          duplicateId = key;
          break;
        }
      }
    }

    if (duplicateId) {
      const existing = cardMap.get(duplicateId)!;
      cardMap.set(duplicateId, mergeTwoFlashcards(existing, c, duplicateId, options));
    } else {
      cardMap.set(c.id, c);
    }
  }

  return Array.from(cardMap.values()).sort((a, b) => b.createdAt - a.createdAt);
};
