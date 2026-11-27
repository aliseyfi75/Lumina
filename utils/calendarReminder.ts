const pad2 = (n: number): string => String(n).padStart(2, '0');

export interface DailyReminderOptions {
  /** 24h time string in "HH:MM" format, e.g. "20:00" */
  time: string;
  dailyGoal?: number;
  appUrl?: string;
}

/**
 * Generates an RFC 5545 recurring daily calendar reminder (.ics) for Lumina study sessions.
 */
export const generateDailyReminderIcs = ({
  time,
  dailyGoal = 10,
  appUrl = 'https://aliseyfi75.github.io/Lumina/#/study',
}: DailyReminderOptions): string => {
  const match = String(time || '20:00').match(/^(\d{1,2}):(\d{2})$/);
  const hours = match ? Math.min(23, Math.max(0, parseInt(match[1], 10))) : 20;
  const minutes = match ? Math.min(59, Math.max(0, parseInt(match[2], 10))) : 0;

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
  if (start.getTime() <= now.getTime()) {
    start.setDate(start.getDate() + 1);
  }
  const end = new Date(start.getTime() + 15 * 60 * 1000);

  const formatLocal = (d: Date) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
  const formatUtc = (d: Date) =>
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;

  const uid = `lumina-daily-study-${start.getTime()}@lumina.app`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lumina Vocabulary//Daily Study Reminder//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatLocal(start)}`,
    `DTEND:${formatLocal(end)}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:Lumina Vocabulary Study (${dailyGoal} cards)`,
    `DESCRIPTION:Keep your streak alive! Review your daily ${dailyGoal}-card vocabulary goal in Lumina: ${appUrl}`,
    `URL:${appUrl}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT5M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Time for your daily Lumina vocabulary review!',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
};

export const downloadDailyReminderIcs = (options: DailyReminderOptions): void => {
  const ics = generateDailyReminderIcs(options);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lumina-daily-study-reminder.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
