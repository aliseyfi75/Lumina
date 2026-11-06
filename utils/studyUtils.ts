import { Flashcard, FlashcardStatus, WordComplexityLevel } from '../types';

const LITERARY_COMPLEX_AFFIXES = [
  'ious', 'eous', 'acity', 'itude', 'escence', 'escent', 'ulent', 'animous', 'loqu', 'choly',
  'ignom', 'ostens', 'lugub', 'ephem', 'ubiq', 'persp', 'recalc', 'fastid', 'sagac', 'capric',
  'tacit', 'alacr', 'obseq', 'inex', 'unac', 'malev', 'benev', 'melan', 'parox', 'conje',
  'perv', 'omin', 'trepid', 'audac', 'indefat', 'inscrut', 'inveter', 'magnanim', 'munific',
  'perfunct', 'nicety', 'propens', 'solicitud', 'viciss', 'countenance', 'physiognomy', 'antipathy',
  'avarice', 'dogmatism', 'importun', 'imputed', 'incessant', 'indolence', 'ineffable', 'infallible',
  'insuperable', 'intrepid', 'irrevocable', 'languor', 'listless', 'manifold', 'odious', 'palpable',
  'panegyric', 'penury', 'perdition', 'pernicious', 'placid', 'portentous', 'precipice', 'precursor',
  'predilection', 'presentiment', 'prodigious', 'profligate', 'propitious', 'puerile', 'quell',
  'remorse', 'repugnance', 'reverie', 'satiate', 'scruple', 'semblance', 'solace', 'squalid',
  'subjugate', 'supercilious', 'supplication', 'surmise', 'sycophant', 'temerity', 'torpor',
  'tranquil', 'tumult', 'unappeasable', 'unbridled', 'uncouth', 'undaunted', 'unfeigned',
  'ungainly', 'unhallowed', 'unmitigated', 'unremitting', 'untoward', 'upbraid', 'usurp',
  'venerable', 'veneration', 'veracity', 'vestige', 'vexation', 'vigilance', 'vindicate',
  'virulent', 'visage', 'voracious', 'wanton', 'wretched', 'zealous', 'hypochondriacal', 'circumambulate',
];

export const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const calculateCurrentStreak = (
  history: Record<string, number>,
  referenceDate: Date = new Date()
): number => {
  let streak = 0;
  const currentDate = new Date(referenceDate.getTime());
  const todayStr = getLocalDateString(currentDate);

  if (!history[todayStr] || history[todayStr] === 0) {
    currentDate.setDate(currentDate.getDate() - 1);
    const yesterdayStr = getLocalDateString(currentDate);
    if (!history[yesterdayStr] || history[yesterdayStr] === 0) {
      return 0;
    }
  }

  while ((history[getLocalDateString(currentDate)] ?? 0) > 0) {
    streak++;
    currentDate.setDate(currentDate.getDate() - 1);
  }
  return streak;
};

export const isCardDue = (card: Flashcard, now: number = Date.now()): boolean => {
  if (card.status === FlashcardStatus.Mastered) return false;
  if (card.status === FlashcardStatus.New) return true;
  return (card.nextReviewDate ?? 0) <= now;
};

export const getDueCards = (cards: Flashcard[], now: number = Date.now()): Flashcard[] => {
  return cards.filter(card => isCardDue(card, now));
};

export const isBookFlashcard = (card: Flashcard): boolean => {
  return Boolean(card.tags?.some(t => /^(?:book\s*:|books\s*\/)/i.test(t.trim())));
};

export const computeWordComplexityScore = (word: string): number => {
  const lower = (word || '').trim().toLowerCase();
  if (!lower) return 0;
  let score = Math.min(lower.length, 14);
  for (const affix of LITERARY_COMPLEX_AFFIXES) {
    if (lower.includes(affix)) {
      score += 8;
      break;
    }
  }
  if (/(?:ph|ch|qu|sc|gn|ps|rh|mn|ct|pt|xt)/.test(lower)) {
    score += 3;
  }
  if (/(?:ious|eous|acity|itude|escence|escent|ulent|animous|ology|cracy|phobia|isis|osis)$/.test(lower)) {
    score += 5;
  }
  return score;
};

export const getCardComplexityLevel = (card: Flashcard): WordComplexityLevel => {
  if (
    card.complexityLevel === 'beginner' ||
    card.complexityLevel === 'intermediate' ||
    card.complexityLevel === 'advanced'
  ) {
    return card.complexityLevel;
  }

  for (const rawTag of card.tags || []) {
    const match = rawTag.trim().match(/^(?:level\s*:\s*)?(beginner|intermediate|advanced)$/i);
    if (match && match[1]) {
      return match[1].toLowerCase() as WordComplexityLevel;
    }
  }

  const score = card.complexityScore ?? computeWordComplexityScore(card.word);
  if (score >= 16) return 'advanced';
  if (score >= 11) return 'intermediate';
  return 'beginner';
};

const COMPLEXITY_LEVEL_RANK: Record<WordComplexityLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

export const getCardComplexityRank = (card: Flashcard): number => {
  return COMPLEXITY_LEVEL_RANK[getCardComplexityLevel(card)];
};

export const getCardComplexityScore = (card: Flashcard): number => {
  if (typeof card.complexityScore === 'number' && !Number.isNaN(card.complexityScore)) {
    return card.complexityScore;
  }
  return computeWordComplexityScore(card.word);
};

export const getCardDueDateKey = (card: Flashcard): string => {
  if (card.status === FlashcardStatus.New || !card.nextReviewDate) {
    return '0000-00-00';
  }
  return getLocalDateString(new Date(card.nextReviewDate));
};

/**
 * Sorts study session cards:
 * 1. Status (New cards before Learning cards)
 * 2. Due date (earlier due date first; New cards share '0000-00-00')
 * 3. For book sessions / book cards with the same status & due date (and same review count):
 *    sorts by word complexity level from easier to harder (beginner -> intermediate -> advanced,
 *    then ascending complexityScore), before falling back to lastReviewed timestamp.
 */
export const sortStudySessionCards = (
  cards: Flashcard[],
  options?: { isBookSession?: boolean }
): Flashcard[] => {
  const forceBookSort = Boolean(options?.isBookSession);

  return [...cards].sort((a, b) => {
    const statusA = a.status === FlashcardStatus.New ? 0 : 1;
    const statusB = b.status === FlashcardStatus.New ? 0 : 1;
    if (statusA !== statusB) return statusA - statusB;

    const dueKeyA = getCardDueDateKey(a);
    const dueKeyB = getCardDueDateKey(b);
    if (dueKeyA !== dueKeyB) return dueKeyA.localeCompare(dueKeyB);

    const useBookLevelSort =
      forceBookSort ||
      isBookFlashcard(a) ||
      isBookFlashcard(b) ||
      a.complexityLevel !== undefined ||
      b.complexityLevel !== undefined;

    if (useBookLevelSort) {
      const repA = a.repetition ?? 0;
      const repB = b.repetition ?? 0;
      if (repA !== repB) return repA - repB;

      const lastRevDayA = a.lastReviewed ? getLocalDateString(new Date(a.lastReviewed)) : '0000-00-00';
      const lastRevDayB = b.lastReviewed ? getLocalDateString(new Date(b.lastReviewed)) : '0000-00-00';
      if (lastRevDayA !== lastRevDayB) return lastRevDayA.localeCompare(lastRevDayB);

      const rankA = getCardComplexityRank(a);
      const rankB = getCardComplexityRank(b);
      if (rankA !== rankB) return rankA - rankB;

      const scoreA = getCardComplexityScore(a);
      const scoreB = getCardComplexityScore(b);
      if (scoreA !== scoreB) return scoreA - scoreB;
    }

    return (a.lastReviewed || 0) - (b.lastReviewed || 0);
  });
};

