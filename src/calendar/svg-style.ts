import type { Theme } from '../config/themes.ts';
import {
  type AppTranslation,
  formatTranslation,
  resolveTranslationLocale,
} from '../config/translations.ts';

export type CalendarColorScheme = 'light' | 'dark';
export type CalendarTheme = string;

export const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"></svg>';

export const CELL_STEP = 13;
export const CELL_INSET = 1.5;
export const CELL_RADIUS = 2;
export const CELL_BORDER = 'rgba(31, 35, 40, 0.05)';
export const CELL_BORDER_WIDTH = 0.5;
export const LEFT_MARGIN = 28;
export const RIGHT_MARGIN = 0;
export const TOP_MARGIN = 20;
export const BOTTOM_MARGIN = 8;
export const LABEL_GAP = 5;
export const LEGEND_HEIGHT = 28;
export const LEGEND_LABEL_GAP = 4;
export const LEGEND_RIGHT_PADDING = 16;
export const LEGEND_LABEL_WIDTH = 28;
export const FONT_SIZE = 12;
export const SUMMARY_TITLE_X = 0;
export const SUMMARY_TITLE_Y = 0;
export const SUMMARY_TITLE_FONT_SIZE = 16;
export const SUMMARY_TITLE_HEIGHT = 20;
export const FONT_STACK =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

export const TEXT_COLORS: Record<CalendarColorScheme, string> = {
  light: '#1f2328',
  dark: '#f0f6fc',
};

export const VISIBLE_WEEKDAY_INDICES = new Set([1, 3, 5]);

export function createMonthFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(resolveTranslationLocale(locale), {
    month: 'short',
    timeZone: 'UTC',
  });
}

export function createContributionTitle(
  count: number,
  date: string,
  translation: AppTranslation,
): string {
  if (count === 0) {
    return formatTranslation(translation.calendar.contribution.none_on_date, {
      date,
    });
  }
  if (count === 1) {
    return formatTranslation(
      translation.calendar.contribution.singular_on_date,
      {
        count,
        date,
      },
    );
  }

  return formatTranslation(translation.calendar.contribution.plural_on_date, {
    count,
    date,
  });
}

export function createSwatchTitle(
  index: number,
  translation: AppTranslation,
): string {
  if (index === 1) {
    return formatTranslation(translation.calendar.swatch.singular, {
      count: index,
    });
  }
  if (index >= 4) {
    return formatTranslation(translation.calendar.swatch.overflow, {
      count: index,
    });
  }

  return formatTranslation(translation.calendar.swatch.plural, {
    count: index,
  });
}

export function createSummaryTitle(
  count: number,
  translation: AppTranslation,
): string {
  if (count === 1) {
    return formatTranslation(translation.calendar.summary.last_year_singular, {
      count,
    });
  }

  return formatTranslation(translation.calendar.summary.last_year_plural, {
    count,
  });
}

export function createThemeCssVariables(
  theme: Theme,
  colorScheme: CalendarColorScheme,
): string {
  return [
    `--calendar-text-color: ${TEXT_COLORS[colorScheme]}`,
    ...theme[colorScheme].map(
      (fill, index) => `--calendar-level-${index}: ${fill}`,
    ),
  ].join(';');
}

export function appendThemeStyles(
  svg: SVGElement,
  document: Document,
  theme: Theme,
  colorScheme: CalendarColorScheme | undefined,
): void {
  const style = document.createElementNS(SVG_NAMESPACE, 'style');
  const lightVariables = createThemeCssVariables(theme, 'light');
  const darkVariables = createThemeCssVariables(theme, 'dark');

  style.setAttribute('type', 'text/css');
  style.textContent =
    colorScheme == null
      ? `.calendar-root{color-scheme:light dark;${lightVariables}}@media (prefers-color-scheme: dark){.calendar-root{${darkVariables}}}`
      : `.calendar-root{color-scheme:${colorScheme};${createThemeCssVariables(theme, colorScheme)}}`;

  svg.prepend(style);
}

export function getThemeFill(index: number): string {
  return `var(--calendar-level-${index})`;
}
