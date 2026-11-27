import { useState, useCallback } from 'react';

export const DAILY_GOAL_OPTIONS = [5, 10, 20, 30] as const;
export type DailyGoalOption = (typeof DAILY_GOAL_OPTIONS)[number];

const DAILY_GOAL_KEY = 'lumina_daily_goal_v1';

const normalizeGoal = (raw: unknown): number => {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 200) {
    return Math.round(n);
  }
  return 10;
};

export const useDailyGoal = () => {
  const [dailyGoal, setDailyGoalState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(DAILY_GOAL_KEY);
      if (saved) return normalizeGoal(saved);
    } catch {
      // ignore storage errors
    }
    return 10;
  });

  const setDailyGoal = useCallback((nextGoal: number) => {
    const normalized = normalizeGoal(nextGoal);
    setDailyGoalState(normalized);
    try {
      localStorage.setItem(DAILY_GOAL_KEY, String(normalized));
    } catch {
      // ignore storage errors
    }
  }, []);

  return { dailyGoal, setDailyGoal };
};
