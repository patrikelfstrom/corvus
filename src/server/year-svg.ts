import * as Plot from '@observablehq/plot';
import { utcMonth } from 'd3';
import { Window } from 'happy-dom';
import { loadConfig } from './config.ts';
import { getDatabase, initDatabaseSchema } from './db/index.ts';
import {
  DEFAULT_THEME_NAME,
  parseOptionalColorScheme,
  parseThemeName,
  type Theme,
  type ThemeMap,
} from './themes.ts';

export type CalendarColorScheme = 'light' | 'dark';
export type CalendarTheme = string;

type SQLResult<T> = {
  lastInsertRowid?: number | undefined;
  changes?: number | undefined;
  error?: string | undefined;
  rows?: T[] | undefined;
  success?: boolean | undefined;
};

interface ActivityPoint {
  date: string;
  count: number;
}

type PlotBandScale = {
  apply: (value: number) => number;
  bandwidth: number;
};

type PlotSvgElement = SVGSVGElement & {
  scale: (name: string) => PlotBandScale | undefined;
};

export interface PlotActivity {
  date: string;
  count: number;
  level: number;
  weekIndex: number;
  weekdayIndex: number;
  weekdayLabel: string;
  monthTick: boolean;
}

const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"></svg>';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const CELL_STEP = 13;
const CELL_INSET = 1.5;
const CELL_RADIUS = 2;
const CELL_BORDER = 'rgba(31, 35, 40, 0.05)';
const CELL_BORDER_WIDTH = 0.5;
const LEFT_MARGIN = 28;
const RIGHT_MARGIN = 0;
const TOP_MARGIN = 15;
const BOTTOM_MARGIN = 8;
const LABEL_GAP = 5;
const LEGEND_HEIGHT = 28;
const LEGEND_LABEL_GAP = 4;
const LEGEND_RIGHT_PADDING = 16;
const LEGEND_LABEL_WIDTH = 28;
const FONT_SIZE = 12;
const LEGEND_LABELS = {
  less: 'Less',
  more: 'More',
} as const;
const FONT_STACK =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif';
const TEXT_COLORS: Record<CalendarColorScheme, string> = {
  light: '#1f2328',
  dark: '#f0f6fc',
};
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VISIBLE_WEEKDAY_INDICES = new Set([1, 3, 5]);
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toUtcDateOnly(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function getMondayFirstWeekdayIndex(value: Date): number {
  return (value.getUTCDay() + 6) % 7;
}

function getUtcDayDifference(startDate: Date, endDate: Date): number {
  return Math.round(
    (toUtcDateOnly(endDate).getTime() - toUtcDateOnly(startDate).getTime()) /
      DAY_IN_MS,
  );
}

function subtractUtcYears(value: Date, years: number): Date {
  const source = toUtcDateOnly(value);
  const targetYear = source.getUTCFullYear() - years;
  const targetMonth = source.getUTCMonth();
  const day = source.getUTCDate();
  const maxDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, maxDay);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

function createPlotDocument(): Document {
  // Plot is typed against the standard DOM lib, while happy-dom exposes its
  // own compatible classes. Cast once at the integration boundary.
  return new Window().document as unknown as Document;
}

function createThemeCssVariables(
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

function appendThemeStyles(
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

function getThemeFill(index: number): string {
  return `var(--calendar-level-${index})`;
}

export function getFixedWeekWindow(totalWeeks: number): {
  start: Date;
  end: Date;
} {
  const weeks = Math.max(1, totalWeeks);
  const totalDays = weeks * 7;

  const todayUtc = toUtcDateOnly(new Date());
  const daysSinceMonday = getMondayFirstWeekdayIndex(todayUtc);

  const currentWeekMonday = new Date(todayUtc);
  currentWeekMonday.setUTCDate(todayUtc.getUTCDate() - daysSinceMonday);

  const end = new Date(currentWeekMonday);
  end.setUTCDate(currentWeekMonday.getUTCDate() + 6);

  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (totalDays - 1));

  return { start, end };
}

async function fetchCountsByDateRange(
  startIsoDate: string,
  endIsoDate: string,
): Promise<Map<string, number>> {
  await initDatabaseSchema();
  const db = getDatabase();

  const result = await db.sql<SQLResult<ActivityPoint>>`
    SELECT
      substr(authored_at, 1, 10) AS date,
      COUNT(*) AS count
    FROM commits
    WHERE
      length(authored_at) >= 10
      AND substr(authored_at, 1, 10) >= ${startIsoDate}
      AND substr(authored_at, 1, 10) <= ${endIsoDate}
    GROUP BY date
    ORDER BY date ASC
  `;

  const rows = result.rows ?? [];
  const countsByDate = new Map<string, number>();

  for (const row of rows) {
    countsByDate.set(row.date, row.count);
  }

  return countsByDate;
}

export function getActivityLevel(count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (count <= 1) {
    return 1;
  }
  if (count <= 3) {
    return 2;
  }
  if (count <= 6) {
    return 3;
  }
  return 4;
}

export function buildPlotActivities(
  startDate: Date,
  endDate: Date,
  countsByDate: Map<string, number>,
): Array<PlotActivity> {
  const normalizedStartDate = toUtcDateOnly(startDate);
  const normalizedEndDate = toUtcDateOnly(endDate);
  const start =
    normalizedStartDate <= normalizedEndDate
      ? normalizedStartDate
      : normalizedEndDate;
  const end =
    normalizedStartDate <= normalizedEndDate
      ? normalizedEndDate
      : normalizedStartDate;
  const calendarStart = addUtcDays(start, -getMondayFirstWeekdayIndex(start));

  const activities: Array<PlotActivity> = [];

  for (
    let currentDate = start;
    currentDate <= end;
    currentDate = addUtcDays(currentDate, 1)
  ) {
    const date = toIsoDate(currentDate);
    const count = countsByDate.get(date) ?? 0;
    const previousActivity = activities[activities.length - 1];
    const weekdayIndex = getMondayFirstWeekdayIndex(currentDate);

    activities.push({
      date,
      count,
      level: getActivityLevel(count),
      weekIndex: Math.floor(
        getUtcDayDifference(calendarStart, currentDate) / 7,
      ),
      weekdayIndex,
      weekdayLabel: WEEKDAY_LABELS[weekdayIndex] ?? '',
      monthTick:
        previousActivity == null ||
        previousActivity.date.slice(0, 7) !== date.slice(0, 7),
    });
  }

  return activities;
}

function appendSvgText(
  document: Document,
  parent: SVGElement,
  attributes: Record<string, string>,
  content: string,
): void {
  const text = document.createElementNS(SVG_NAMESPACE, 'text');

  for (const [name, value] of Object.entries(attributes)) {
    text.setAttribute(name, value);
  }

  text.textContent = content;
  parent.append(text);
}

function appendWeekdayLabels(
  svg: PlotSvgElement,
  document: Document,
  textColor: string,
): void {
  const yScale = svg.scale('y');

  if (!yScale) {
    return;
  }

  const labelsGroup = document.createElementNS(SVG_NAMESPACE, 'g');
  labelsGroup.setAttribute('aria-label', 'weekday labels');
  labelsGroup.setAttribute('fill', textColor);

  for (const weekdayIndex of VISIBLE_WEEKDAY_INDICES) {
    const weekdayLabel = WEEKDAY_LABELS[weekdayIndex];

    if (!weekdayLabel) {
      continue;
    }

    appendSvgText(
      document,
      labelsGroup,
      {
        x: String(LEFT_MARGIN + CELL_INSET - LABEL_GAP),
        y: String(yScale.apply(weekdayIndex) + yScale.bandwidth / 2 + 4),
        'text-anchor': 'end',
      },
      weekdayLabel,
    );
  }

  svg.append(labelsGroup);
}

function appendMonthLabels(
  svg: PlotSvgElement,
  document: Document,
  activities: Array<PlotActivity>,
  textColor: string,
): void {
  const xScale = svg.scale('x');

  if (!xScale) {
    return;
  }

  const labelsGroup = document.createElementNS(SVG_NAMESPACE, 'g');
  labelsGroup.setAttribute('aria-label', 'month labels');
  labelsGroup.setAttribute('fill', textColor);

  for (const activity of activities) {
    if (!activity.monthTick) {
      continue;
    }

    const monthDate = utcMonth.floor(new Date(`${activity.date}T00:00:00Z`));

    appendSvgText(
      document,
      labelsGroup,
      {
        x: String(xScale.apply(activity.weekIndex) + CELL_INSET),
        y: String(TOP_MARGIN + CELL_INSET - LABEL_GAP),
        // 'dominant-baseline': 'text-after-edge',
        'text-anchor': 'start',
      },
      monthFormatter.format(monthDate),
    );
  }

  svg.append(labelsGroup);
}

export function renderCalendarSvg(
  activities: Array<PlotActivity>,
  colorScheme: CalendarColorScheme | undefined,
  theme: CalendarTheme,
  availableThemes: ThemeMap,
): string {
  const resolvedTheme =
    availableThemes[theme] ?? availableThemes[DEFAULT_THEME_NAME];

  if (activities.length === 0 || !resolvedTheme) {
    return EMPTY_SVG;
  }

  const document = createPlotDocument();
  const resolvedColorScheme = colorScheme ?? 'light';
  const weekCount =
    Math.max(...activities.map((activity) => activity.weekIndex)) + 1;
  const textColor = 'var(--calendar-text-color)';
  const svgWidth = LEFT_MARGIN + RIGHT_MARGIN + weekCount * CELL_STEP;
  const plotHeight =
    TOP_MARGIN + BOTTOM_MARGIN + WEEKDAY_LABELS.length * CELL_STEP;
  const svgHeight = plotHeight + LEGEND_HEIGHT;
  const svg = Plot.plot({
    document,
    width: svgWidth,
    height: plotHeight,
    marginTop: TOP_MARGIN,
    marginRight: RIGHT_MARGIN,
    marginBottom: BOTTOM_MARGIN,
    marginLeft: LEFT_MARGIN,
    style: {
      background: 'transparent',
      color: textColor,
      fontFamily: FONT_STACK,
      fontSize: '12px',
    },
    x: {
      axis: null,
      domain: Array.from({ length: weekCount }, (_, index) => index),
      padding: 0,
      round: true,
    },
    y: {
      axis: null,
      domain: Array.from(WEEKDAY_LABELS, (_, index) => index),
      padding: 0,
      round: true,
    },
    color: {
      type: 'ordinal',
      domain: [0, 1, 2, 3, 4],
      range: Array.from({ length: 5 }, (_, index) => getThemeFill(index)),
      legend: false,
    },
    marks: [
      Plot.cell(activities, {
        x: 'weekIndex',
        y: 'weekdayIndex',
        fill: 'level',
        stroke: CELL_BORDER,
        strokeWidth: CELL_BORDER_WIDTH,
        inset: CELL_INSET,
        rx: CELL_RADIUS,
        ry: CELL_RADIUS,
        title: (activity) => `${activity.date}: ${activity.count} activities`,
      }),
    ],
  }) as PlotSvgElement;

  svg.setAttribute('xmlns', SVG_NAMESPACE);
  svg.setAttribute('xmlns:xlink', XLINK_NAMESPACE);
  svg.setAttribute('class', 'calendar-root');
  svg.setAttribute('fill', textColor);
  svg.setAttribute('font-family', FONT_STACK);
  svg.setAttribute('font-size', String(FONT_SIZE));
  svg.setAttribute('height', String(svgHeight));
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  svg.style.setProperty('background', 'transparent');
  svg.style.setProperty('color', textColor);
  svg.style.setProperty('font-family', FONT_STACK);
  svg.style.setProperty('font-size', `${FONT_SIZE}px`);

  appendThemeStyles(svg, document, resolvedTheme, colorScheme);
  appendMonthLabels(svg, document, activities, textColor);
  appendWeekdayLabels(svg, document, textColor);

  const legendGroup = document.createElementNS(SVG_NAMESPACE, 'g');
  const legendSwatchWidth = 5 * 10 + 4 * 3;
  const legendMoreX = svgWidth - RIGHT_MARGIN - LEGEND_RIGHT_PADDING;
  const legendSwatchStartX =
    legendMoreX - LEGEND_LABEL_WIDTH - LEGEND_LABEL_GAP - legendSwatchWidth;
  const legendY = plotHeight + 4;

  legendGroup.setAttribute('aria-label', 'legend');
  legendGroup.setAttribute('fill', textColor);

  appendSvgText(
    document,
    legendGroup,
    {
      x: String(legendSwatchStartX - LEGEND_LABEL_GAP),
      y: String(legendY + 9),
      'text-anchor': 'end',
    },
    LEGEND_LABELS.less,
  );

  resolvedTheme[resolvedColorScheme].forEach((_fill, index) => {
    const swatch = document.createElementNS(SVG_NAMESPACE, 'rect');

    swatch.setAttribute('x', String(legendSwatchStartX + index * CELL_STEP));
    swatch.setAttribute('y', String(legendY));
    swatch.setAttribute('width', '10');
    swatch.setAttribute('height', '10');
    swatch.setAttribute('rx', String(CELL_RADIUS));
    swatch.setAttribute('ry', String(CELL_RADIUS));
    swatch.setAttribute('fill', getThemeFill(index));
    swatch.setAttribute('stroke', CELL_BORDER);
    swatch.setAttribute('stroke-width', String(CELL_BORDER_WIDTH));
    legendGroup.append(swatch);
  });

  appendSvgText(
    document,
    legendGroup,
    {
      x: String(legendMoreX),
      y: String(legendY + 9),
      'text-anchor': 'end',
    },
    LEGEND_LABELS.more,
  );

  svg.append(legendGroup);

  return svg.outerHTML;
}

async function renderDateRangeSvg(
  startDate: Date,
  endDate: Date,
  colorScheme: CalendarColorScheme | undefined,
  theme: CalendarTheme,
  availableThemes: ThemeMap,
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

  return renderCalendarSvg(
    buildPlotActivities(start, end, countsByDate),
    colorScheme,
    theme,
    availableThemes,
  );
}

export async function renderRollingYearsSvg(
  years: number,
  colorScheme: string | undefined,
  theme: CalendarTheme = DEFAULT_THEME_NAME,
): Promise<string> {
  if (!Number.isInteger(years) || years < 1) {
    return EMPTY_SVG;
  }

  const config = loadConfig();
  const availableThemes = config.themes;
  const defaultTheme = parseThemeName(config.theme, availableThemes);
  const resolvedColorScheme = parseOptionalColorScheme(colorScheme);
  const resolvedTheme = parseThemeName(theme, availableThemes, defaultTheme);

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
  );
}
