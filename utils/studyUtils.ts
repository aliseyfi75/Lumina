import { Flashcard, FlashcardStatus } from '../types';

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
