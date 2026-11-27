import { test, expect } from 'playwright/test';
import { calculateStreakSummary, buildClozePrompt, isHardestCard, getLocalDateString } from '../utils/studyUtils';
import { generateDailyReminderIcs } from '../utils/calendarReminder';
import { Flashcard, FlashcardStatus } from '../types';

const APP_URL = 'http://localhost:5173/#/';

const makeCard = (overrides: Partial<Flashcard> & { id: string; word: string }): Flashcard => ({
  id: overrides.id,
  word: overrides.word,
  partOfSpeech: overrides.partOfSpeech ?? 'adjective',
  mainDefinition: overrides.mainDefinition ?? `Definition of ${overrides.word}`,
  example: overrides.example ?? `We noticed the ${overrides.word} glow across the valley.`,
  status: overrides.status ?? FlashcardStatus.New,
  lastReviewed: overrides.lastReviewed ?? 0,
  createdAt: overrides.createdAt ?? Date.now() - 10_000,
  repetition: overrides.repetition ?? 0,
  nextReviewDate: overrides.nextReviewDate ?? Date.now() - 1_000,
  ...overrides,
});

const dateDaysAgo = (daysAgo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return getLocalDateString(d);
};

test.describe('Engagement & Retention Features (PR 5)', () => {
  test('unit: calculateStreakSummary grants Streak Freeze after 5+ active days and bridges 1 missed day', () => {
    // 6 active days (daysAgo: 6, 5, 4, 3, 2, 0 — missed yesterday = day 1)
    const history: Record<string, number> = {
      [dateDaysAgo(0)]: 3,
      [dateDaysAgo(2)]: 5,
      [dateDaysAgo(3)]: 4,
      [dateDaysAgo(4)]: 2,
      [dateDaysAgo(5)]: 6,
      [dateDaysAgo(6)]: 3,
    };

    const summary = calculateStreakSummary(history);
    expect(summary.currentStreak).toBe(6);
    expect(summary.freezeProtected).toBe(true);
    expect(summary.freezesEarned).toBeGreaterThanOrEqual(1);
    expect(summary.freezesAvailable).toBe(Math.min(2, summary.freezesEarned) - 1);

    // Without enough active days (<5), a missed day breaks the streak
    const shortHistory: Record<string, number> = {
      [dateDaysAgo(0)]: 2,
      [dateDaysAgo(2)]: 2,
      [dateDaysAgo(3)]: 2,
    };
    const shortSummary = calculateStreakSummary(shortHistory);
    expect(shortSummary.currentStreak).toBe(1);
    expect(shortSummary.freezeProtected).toBe(false);
  });

  test('unit: buildClozePrompt blanks target word and isHardestCard identifies missed cards', () => {
    const card = makeCard({
      id: 'c-cloze',
      word: 'ephemeral',
      example: 'The ephemeral blossoms faded before sunset.',
      missCount: 2,
    });
    const cloze = buildClozePrompt(card.word, card.example);
    expect(cloze.hasSentenceMatch).toBe(true);
    expect(cloze.maskedSentence).toContain('_____');
    expect(cloze.maskedSentence.toLowerCase()).not.toContain('ephemeral');
    expect(cloze.answer).toBe('ephemeral');
    expect(isHardestCard(card)).toBe(true);

    const easyCard = makeCard({ id: 'c-easy', word: 'lucid', lastQuality: 3, missCount: 0 });
    expect(isHardestCard(easyCard)).toBe(false);
  });

  test('unit: generateDailyReminderIcs generates valid RFC 5545 recurring daily calendar event', () => {
    const ics = generateDailyReminderIcs({ time: '19:30', dailyGoal: 15 });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('T193000');
    expect(ics).toContain('SUMMARY:Lumina Vocabulary Study (15 cards)');
    expect(ics).toContain('END:VCALENDAR');
  });

  test('Dashboard shows Daily Goal ring, Streak Freeze badge, clickable stat tiles, interactive WOTD, and Quick 1-Card Warmup', async ({ page }) => {
    const cards: Flashcard[] = [
      makeCard({ id: 'w1', word: 'luminous', status: FlashcardStatus.New }),
      makeCard({ id: 'w2', word: 'serene', status: FlashcardStatus.Mastered }),
      makeCard({ id: 'w3', word: 'vivid', status: FlashcardStatus.Learning, missCount: 2 }),
    ];
    const studyHistory: Record<string, number> = {
      [dateDaysAgo(0)]: 2,
      [dateDaysAgo(2)]: 4,
      [dateDaysAgo(3)]: 5,
      [dateDaysAgo(4)]: 3,
      [dateDaysAgo(5)]: 6,
      [dateDaysAgo(6)]: 2,
    };

    await page.addInitScript(
      ({ seededCards, seededHistory }) => {
        localStorage.setItem('lumina_cards_v1', JSON.stringify(seededCards));
        localStorage.setItem('lumina_study_history', JSON.stringify(seededHistory));
        localStorage.setItem('lumina_daily_goal_v1', '5');
      },
      { seededCards: cards, seededHistory: studyHistory }
    );

    await page.goto(APP_URL);

    // 1. Daily Goal Ring & Streak Freeze Badge
    const goalRing = page.getByTestId('daily-goal-ring');
    await expect(goalRing).toBeVisible();
    await expect(goalRing).toContainText('2 / 5');
    await expect(page.getByTestId('streak-freeze-badge')).toBeVisible();

    // 2. Quick 1-Card Warmup updates daily progress inline
    const warmup = page.getByTestId('quick-warmup-card');
    await expect(warmup).toBeVisible();
    await page.getByTestId('warmup-reveal-btn').click();
    await page.getByTestId('warmup-rate-learned').click();
    await expect(goalRing).toContainText('3 / 5');

    // 3. Changing Daily Goal in SettingsModal updates ring target
    await goalRing.click();
    await expect(page.getByTestId('settings-daily-goal-section')).toBeVisible();
    await expect(page.getByTestId('settings-daily-reminder-section')).toBeVisible();
    await expect(page.getByTestId('download-calendar-reminder-btn')).toBeVisible();
    await page.getByTestId('daily-goal-option-20').click();
    await page.getByTestId('close-settings-button').click();
    await expect(goalRing).toContainText('3 / 20');

    // 4. Interactive WOTD: Flip Card opens preview modal
    await page.getByTestId('wotd-flip-preview-btn').click();
    await expect(page.getByTestId('dashboard-card-front')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dashboard-card-front')).toBeHidden();

    // 5. Clickable Mastered stat tile navigates to /flashcards filtered to Mastered
    await page.getByTestId('dashboard-stat-mastered').click();
    await expect(page).toHaveURL(/#\/flashcards/);
    await expect(page.getByText('serene')).toBeVisible();
  });

  test('StudySession supports Cloze (Fill-in-the-Blank), Listening Recall, and Hardest Words filter', async ({ page }) => {
    const cards: Flashcard[] = [
      makeCard({
        id: 'h1',
        word: 'ephemeral',
        partOfSpeech: 'adjective',
        mainDefinition: 'Lasting for a very short time.',
        example: 'The ephemeral rainbow vanished in moments.',
        status: FlashcardStatus.Learning,
        missCount: 3,
      }),
      makeCard({
        id: 'h2',
        word: 'lucid',
        partOfSpeech: 'adjective',
        mainDefinition: 'Expressed clearly and easy to understand.',
        example: 'She gave a lucid explanation of the theory.',
        status: FlashcardStatus.New,
      }),
      makeCard({
        id: 'h3',
        word: 'candid',
        partOfSpeech: 'adjective',
        mainDefinition: 'Truthful and straightforward.',
        example: 'He offered a candid assessment.',
        status: FlashcardStatus.New,
      }),
      makeCard({
        id: 'h4',
        word: 'tranquil',
        partOfSpeech: 'adjective',
        mainDefinition: 'Free from disturbance and calm.',
        example: 'The tranquil lake reflected the pines.',
        status: FlashcardStatus.New,
      }),
    ];

    await page.addInitScript((seededCards) => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify(seededCards));
    }, cards);

    await page.goto(APP_URL);

    // 1. Cloze mode + Focus on Hardest Words Only
    await page.getByTestId('dashboard-stat-due-today').click();
    await expect(page.getByTestId('session-mode-cloze')).toBeVisible();
    await expect(page.getByTestId('session-mode-listening')).toBeVisible();
    await page.getByTestId('session-hardest-toggle').click();
    await page.getByTestId('session-mode-cloze').click();
    await page.getByRole('button', { name: /Start Fill-in-the-Blank/i }).click();

    await expect(page.getByTestId('cloze-study-card')).toBeVisible();
    await expect(page.getByTestId('cloze-masked-sentence')).toContainText('_____');
    await page.getByTestId('cloze-answer-input').fill('ephemeral');
    await page.getByTestId('cloze-check-btn').click();
    await expect(page.getByTestId('cloze-feedback')).toContainText(/Correct/i);
    await page.getByTestId('cloze-next-btn').click();
    await expect(page.getByText(/Session Complete/i)).toBeVisible();

    // 2. Listening Recall mode hides spelling on front
    await page.getByRole('button', { name: /Return to Dashboard/i }).click();
    await page.getByTestId('dashboard-stat-due-today').click();
    await page.getByTestId('session-mode-listening').click();
    await page.getByRole('button', { name: /Start Listening Session/i }).click();
    await expect(page.getByTestId('listening-front-prompt')).toBeVisible();
  });

  test('Milestone celebration modal triggers when mastering the 25th word and offers share card download', async ({ page }) => {
    const cards: Flashcard[] = [
      ...Array.from({ length: 24 }, (_, idx) =>
        makeCard({
          id: `m-${idx}`,
          word: `masteredword${idx}`,
          status: FlashcardStatus.Mastered,
        })
      ),
      makeCard({
        id: 'target-25',
        word: 'zenith',
        mainDefinition: 'The highest point or peak.',
        status: FlashcardStatus.New,
      }),
    ];

    await page.addInitScript((seededCards) => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify(seededCards));
    }, cards);

    await page.goto(APP_URL);

    // Master the 25th card via Quick 1-Card Warmup on Dashboard
    await expect(page.getByTestId('quick-warmup-card')).toContainText('zenith');
    await page.getByTestId('warmup-reveal-btn').click();
    await page.getByTestId('warmup-rate-mastered').click();

    const modal = page.getByTestId('milestone-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('25 Words Mastered');
    await expect(page.getByTestId('download-milestone-card-btn')).toBeVisible();
  });

  test('PwaInstallBanner stays hidden when unengaged and displays iOS Safari guide when engaged on iPhone', async ({ browser }) => {
    // 1. Unengaged (0 cards, empty history) on iOS Safari -> banner hidden
    const iosContext1 = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page1 = await iosContext1.newPage();
    await page1.addInitScript(() => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify([]));
    });
    await page1.goto(APP_URL);
    await expect(page1.getByTestId('ios-pwa-install-banner')).toHaveCount(0);
    await iosContext1.close();

    // 2. Engaged (2+ cards) on iOS Safari -> iOS guide visible
    const iosContext2 = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page2 = await iosContext2.newPage();
    await page2.addInitScript((seededCards) => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify(seededCards));
    }, [
      makeCard({ id: 'ios-1', word: 'aurora' }),
      makeCard({ id: 'ios-2', word: 'solstice' }),
    ]);
    await page2.goto(APP_URL);
    await expect(page2.getByTestId('ios-pwa-install-banner')).toBeVisible();
    await expect(page2.getByTestId('ios-pwa-install-banner')).toContainText(/Add to Home Screen/i);
    await iosContext2.close();
  });
});
