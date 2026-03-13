import { loadConfig } from '../config/config.ts';
import type { ThemeMap } from '../config/themes.ts';
import { buildPlotActivities } from './activity.ts';
import {
  getFixedWeekWindow,
  subtractUtcYears,
  toIsoDate,
  toUtcDateOnly,
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

async function renderDateRangeSvg(
  startDate: Date,
  endDate: Date,
  colorScheme: CalendarColorScheme | undefined,
  theme: CalendarTheme,
  availableThemes: ThemeMap,
  showTitle: boolean,
  summaryPeriodLabel?: string,
): Promise<string> {
  const normalizedStartDate = toUtcDateOnly(startDate);
  const normalizedEndDate = toUtcDateOnly(endDate);

  if (
    Number.isNaN(normalizedStartDate.getTime()) ||
    Number.isNaN(normalizedEndDate.getTime())
  ) {
    return EMPTY_SVG;
  }

  const start =
    normalizedStartDate <= normalizedEndDate
      ? normalizedStartDate
      : normalizedEndDate;
  const end =
    normalizedStartDate <= normalizedEndDate
      ? normalizedEndDate
      : normalizedStartDate;

  const startIsoDate = toIsoDate(start);
  const endIsoDate = toIsoDate(end);
  const countsByDate = await fetchCountsByDateRange(startIsoDate, endIsoDate);

  if (countsByDate.size === 0) {
    return EMPTY_SVG;
  }

  const activities = buildPlotActivities(start, end, countsByDate);
  const svgTitle = summaryPeriodLabel
    ? createSummaryTitle(
        activities.reduce((total, activity) => total + activity.count, 0),
        summaryPeriodLabel,
      )
    : undefined;

  return renderCalendarSvg(
    activities,
    colorScheme,
    theme,
    availableThemes,
    svgTitle,
    showTitle,
  );
}

export async function renderRollingYearsSvg(
  years: number,
  colorScheme: string | undefined,
  theme?: CalendarTheme,
  showTitle?: boolean,
): Promise<string> {
  if (!Number.isInteger(years) || years < 1) {
    return EMPTY_SVG;
  }

  const config = loadConfig();
  const availableThemes = config.themes;
  const defaultTheme = parseThemeName(config.settings.theme, availableThemes);
  const resolvedColorScheme = parseOptionalColorScheme(colorScheme);
  const resolvedTheme = parseThemeName(theme, availableThemes, defaultTheme);
  const resolvedShowTitle = showTitle ?? config.settings.title;

  let start: Date;
  let end: Date;

  if (years === 1) {
    const fixedYearWindow = getFixedWeekWindow(53);
    start = fixedYearWindow.start;
    end = fixedYearWindow.end;
  } else {
    const today = toUtcDateOnly(new Date());
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
    years === 1 ? 'in the last year' : undefined,
  );
}

export type { PlotActivity } from './activity.ts';
export { buildPlotActivities, getActivityLevel } from './activity.ts';
export { getFixedWeekWindow } from './date.ts';
export { renderCalendarSvg } from './svg-render.ts';
export type { CalendarColorScheme, CalendarTheme } from './svg-style.ts';
export { EMPTY_SVG } from './svg-style.ts';
