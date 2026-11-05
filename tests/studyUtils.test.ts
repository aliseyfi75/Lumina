import { test, expect } from 'playwright/test';
import { getLocalDateString, calculateCurrentStreak, isCardDue, getDueCards } from '../utils/studyUtils';
import { FlashcardStatus, type Flashcard } from '../types';

test('studyUtils calculates local dates, streaks, and due cards consistently across components', () => {
  const refDate = new Date(2026, 10, 5, 12, 0, 0); // 2026-11-05
  expect(getLocalDateString(refDate)).toBe('2026-11-05');

  const history = {
    '2026-11-05': 4,
    '2026-11-04': 2,
    '2026-11-03': 1,
    '2026-11-01': 10,
  };
  expect(calculateCurrentStreak(history, refDate)).toBe(3);

  // Streak still counts if today has 0 activity so far, as long as yesterday had activity
  const historyYesterday = {
    '2026-11-04': 3,
    '2026-11-03': 2,
  };
  expect(calculateCurrentStreak(historyYesterday, refDate)).toBe(2);

  const now = 1700000000000;
  const sampleCards: Flashcard[] = [
    {
      id: '1',
      word: 'a',
      mainDefinition: 'def',
      partOfSpeech: 'noun',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: now,
    },
    {
      id: '2',
      word: 'b',
      mainDefinition: 'def',
      partOfSpeech: 'noun',
      status: FlashcardStatus.Learning,
      lastReviewed: now - 1000,
      createdAt: now - 2000,
      nextReviewDate: now - 500, // due
    },
    {
      id: '3',
      word: 'c',
      mainDefinition: 'def',
      partOfSpeech: 'noun',
      status: FlashcardStatus.Learning,
      lastReviewed: now - 1000,
      createdAt: now - 2000,
      nextReviewDate: now + 50000, // future
    },
    {
      id: '4',
      word: 'd',
      mainDefinition: 'def',
      partOfSpeech: 'noun',
      status: FlashcardStatus.Mastered,
      lastReviewed: now - 1000,
      createdAt: now - 2000,
    },
  ];

  expect(isCardDue(sampleCards[0], now)).toBe(true);
  expect(isCardDue(sampleCards[1], now)).toBe(true);
  expect(isCardDue(sampleCards[2], now)).toBe(false);
  expect(isCardDue(sampleCards[3], now)).toBe(false);
  expect(getDueCards(sampleCards, now).map(c => c.id)).toEqual(['1', '2']);
});
