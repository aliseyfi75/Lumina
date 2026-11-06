import { test, expect } from 'playwright/test';
import {
  getLocalDateString,
  calculateCurrentStreak,
  isCardDue,
  getDueCards,
  sortStudySessionCards,
  getCardComplexityLevel,
  getCardComplexityRank,
  getCardComplexityScore,
  isBookFlashcard,
} from '../utils/studyUtils';
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

test('sortStudySessionCards orders book words from easier to harder within same due date and criteria', () => {
  const sameDayMorning = new Date(2026, 10, 5, 9, 0, 0).getTime();
  const sameDayAfternoon = new Date(2026, 10, 5, 16, 0, 0).getTime();
  const earlierDay = new Date(2026, 10, 4, 12, 0, 0).getTime();

  const cards: Flashcard[] = [
    // New book cards with same due date (no nextReviewDate -> 'new') in reverse difficulty order
    {
      id: 'new-adv-high',
      word: 'perspicacious',
      mainDefinition: 'having a ready insight into and understanding of things',
      partOfSpeech: 'adjective',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: 1000,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'advanced',
      complexityScore: 78,
    },
    {
      id: 'new-int',
      word: 'melancholy',
      mainDefinition: 'a feeling of pensive sadness',
      partOfSpeech: 'noun',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: 900,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'intermediate',
      complexityScore: 48,
    },
    {
      id: 'new-beg-harder',
      word: 'whisper',
      mainDefinition: 'speak very softly',
      partOfSpeech: 'verb',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: 800,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'beginner',
      complexityScore: 26,
    },
    {
      id: 'new-beg-easier',
      word: 'calm',
      mainDefinition: 'not showing or feeling nervousness',
      partOfSpeech: 'adjective',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: 1200,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'beginner',
      complexityScore: 14,
    },
    {
      id: 'new-adv-low',
      word: 'inexorable',
      mainDefinition: 'impossible to stop or prevent',
      partOfSpeech: 'adjective',
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: 1100,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'advanced',
      complexityScore: 66,
    },
    // Learning book cards with same local due date (2026-11-05) and same repetition count (2)
    {
      id: 'learn-same-day-adv',
      word: 'omnipotent',
      mainDefinition: 'having unlimited power',
      partOfSpeech: 'adjective',
      status: FlashcardStatus.Learning,
      lastReviewed: sameDayMorning - 86400000,
      nextReviewDate: sameDayMorning,
      repetition: 2,
      createdAt: 500,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'advanced',
      complexityScore: 72,
    },
    {
      id: 'learn-same-day-beg',
      word: 'spark',
      mainDefinition: 'a small fiery particle',
      partOfSpeech: 'noun',
      status: FlashcardStatus.Learning,
      lastReviewed: sameDayAfternoon - 86400000,
      nextReviewDate: sameDayAfternoon,
      repetition: 2,
      createdAt: 600,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'beginner',
      complexityScore: 18,
    },
    {
      id: 'learn-same-day-int',
      word: 'desolate',
      mainDefinition: 'deserted of people and in a state of bleak emptiness',
      partOfSpeech: 'adjective',
      status: FlashcardStatus.Learning,
      lastReviewed: sameDayMorning - 86400000,
      nextReviewDate: sameDayMorning,
      repetition: 2,
      createdAt: 550,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'intermediate',
      complexityScore: 46,
    },
    // Learning book card with an EARLIER due date (2026-11-04) - must come before 2026-11-05 learning cards even if advanced
    {
      id: 'learn-earlier-day-adv',
      word: 'cataclysm',
      mainDefinition: 'a large-scale and violent event',
      partOfSpeech: 'noun',
      status: FlashcardStatus.Learning,
      lastReviewed: earlierDay - 86400000,
      nextReviewDate: earlierDay,
      repetition: 5,
      createdAt: 400,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'advanced',
      complexityScore: 80,
    },
    // Learning book card on 2026-11-05 with fewer repetition (1 < 2) - other criteria (repetition) respected before level tie-break
    {
      id: 'learn-same-day-fewer-reviews',
      word: 'abyss',
      mainDefinition: 'a deep or seemingly bottomless chasm',
      partOfSpeech: 'noun',
      status: FlashcardStatus.Learning,
      lastReviewed: sameDayMorning - 86400000,
      nextReviewDate: sameDayMorning,
      repetition: 1,
      createdAt: 700,
      tags: ['Book: Frankenstein'],
      complexityLevel: 'intermediate',
      complexityScore: 52,
    },
  ];

  expect(isBookFlashcard(cards[0])).toBe(true);
  expect(getCardComplexityLevel(cards[0])).toBe('advanced');
  expect(getCardComplexityRank(cards[0])).toBe(2);
  expect(getCardComplexityScore(cards[0])).toBe(78);

  const sorted = sortStudySessionCards(cards, { isBookSession: true });
  expect(sorted.map(c => c.id)).toEqual([
    // 1. New cards first, ordered beginner (score 14 -> 26) -> intermediate (48) -> advanced (66 -> 78)
    'new-beg-easier',
    'new-beg-harder',
    'new-int',
    'new-adv-low',
    'new-adv-high',
    // 2. Learning cards ordered by due date first (2026-11-04 before 2026-11-05)
    'learn-earlier-day-adv',
    // 3. Within 2026-11-05 due date, lower reviewCount (1) before higher reviewCount (2)
    'learn-same-day-fewer-reviews',
    // 4. Within 2026-11-05 due date and reviewCount=2, easier first: beginner -> intermediate -> advanced
    'learn-same-day-beg',
    'learn-same-day-int',
    'learn-same-day-adv',
  ]);
});

