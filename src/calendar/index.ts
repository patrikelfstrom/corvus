import { loadConfig } from '../config/config.ts';
import type { ThemeMap } from '../config/themes.ts';
import {
  type AppTranslation,
  getLocalizedWeekdayLabels,
  type ResolvedAppTranslation,
  resolveAppTranslation,
} from '../config/translations.ts';
import { buildPlotActivities } from './activity.ts';
import {
  clampUtcDateRangeToToday,
  getFixedWeekWindow,
  subtractUtcYears,
  toIsoDate,
} from './date.ts';
import { fetchCountsByDateRange } from './repository.ts';
import { renderCalendarSvg } from './svg-render.ts';
import {
  type CalendarColorScheme,
  type CalendarTheme,
  createSummaryTitle,
  EMPTY_SVG,
} from './svg-style.ts';
import { parseOptionalColorScheme, parseThemeName } from './theme-query.ts';
import { getWeekdayLabels, type WeekStart } from './week-start.ts';

async function renderDateRangeSvg(
  startDate: Date,
  endDate: Date,
  colorScheme: CalendarColorScheme | undefined,
  theme: CalendarTheme,
  availableThemes: ThemeMap,
  showTitle: boolean,
  weekStart: WeekStart,
  translation: AppTranslation,
  locale: string,
  includeLastYearSummary = false,
): Promise<string> {
  const clampedRange = clampUtcDateRangeToToday(startDate, endDate);

  if (!clampedRange) {
    return EMPTY_SVG;
  }

  const { start, end } = clampedRange;

  const startIsoDate = toIsoDate(start);
  const endIsoDate = toIsoDate(end);
  const countsByDate = await fetchCountsByDateRange(startIsoDate, endIsoDate);

  if (countsByDate.size === 0) {
    return EMPTY_SVG;
  }

  const activities = buildPlotActivities(start, end, countsByDate, weekStart);
  const weekdayLabels = getWeekdayLabels(
    weekStart,
    getLocalizedWeekdayLabels(locale),
  );
  const svgTitle = includeLastYearSummary
    ? createSummaryTitle(
        activities.reduce((total, activity) => total + activity.count, 0),
        translation,
      )
    : undefined;

  return renderCalendarSvg(
    activities,
    colorScheme,
    theme,
    availableThemes,
    translation,
    locale,
    svgTitle,
    showTitle,
    weekdayLabels,
  );
}

export async function renderRollingYearsSvg(
  years: number,
  colorScheme: string | undefined,
  theme?: CalendarTheme,
  showTitle?: boolean,
  weekStart?: WeekStart,
  translationOverride?: ResolvedAppTranslation,
): Promise<string> {
  if (!Number.isInteger(years) || years < 1) {
    return EMPTY_SVG;
  }

  const config = loadConfig();
  const translation =
    translationOverride ??
    resolveAppTranslation({
      fallbackLanguage: config.settings.fallbackLanguage,
      language: config.settings.language,
    });
  const availableThemes = config.themes;
  const defaultTheme = parseThemeName(config.settings.theme, availableThemes);
  const resolvedColorScheme = parseOptionalColorScheme(colorScheme);
  const resolvedTheme = parseThemeName(theme, availableThemes, defaultTheme);
  const resolvedShowTitle = showTitle ?? config.settings.title;
  const resolvedWeekStart = weekStart ?? config.settings.weekStart;

  let start: Date;
  let end: Date;

  if (years === 1) {
    const fixedYearWindow = getFixedWeekWindow(53, resolvedWeekStart);
    start = fixedYearWindow.start;
    end = fixedYearWindow.end;
  } else {
    const today = new Date();
    start = subtractUtcYears(today, years);
    end = today;
  }

  return renderDateRangeSvg(
    start,
    end,
    resolvedColorScheme,
    resolvedTheme,
    availableThemes,
    resolvedShowTitle,
    resolvedWeekStart,
    translation.messages,
    translation.locale,
    years === 1,
  );
}

export type { PlotActivity } from './activity.ts';
export { buildPlotActivities, getActivityLevel } from './activity.ts';
export { getFixedWeekWindow } from './date.ts';
export { renderCalendarSvg } from './svg-render.ts';
export type { CalendarColorScheme, CalendarTheme } from './svg-style.ts';
export { EMPTY_SVG } from './svg-style.ts';
