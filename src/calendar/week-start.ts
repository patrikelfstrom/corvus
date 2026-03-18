import z from 'zod';

export const weekStarts = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type WeekStart = (typeof weekStarts)[number];

const BASE_WEEKDAY_LABELS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

const weekStartBaseSchema = z.enum(weekStarts);

export const weekStartSchema = weekStartBaseSchema.default('sunday');

export function getWeekStartDayIndex(weekStart: WeekStart): number {
  return weekStarts.indexOf(weekStart);
}

export function getWeekdayIndex(
  value: Date,
  weekStart: WeekStart = 'sunday',
): number {
  return (value.getUTCDay() - getWeekStartDayIndex(weekStart) + 7) % 7;
}

export function getWeekdayLabels(
  weekStart: WeekStart = 'sunday',
  baseWeekdayLabels: Array<string> = Array.from(BASE_WEEKDAY_LABELS),
): Array<string> {
  const startIndex = getWeekStartDayIndex(weekStart);

  return Array.from({ length: baseWeekdayLabels.length }, (_, index) => {
    return baseWeekdayLabels[(startIndex + index) % baseWeekdayLabels.length];
  });
}

export function parseOptionalWeekStart(
  value: string | undefined,
): WeekStart | undefined {
  if (value == null) {
    return undefined;
  }

  const result = weekStartBaseSchema.safeParse(value.trim().toLowerCase());

  return result.success ? result.data : undefined;
}
