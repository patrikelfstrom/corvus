import { cloneElement, createElement } from 'react';
import type { Activity, DayName } from 'react-activity-calendar';
import { ActivityCalendar } from 'react-activity-calendar';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDatabase, initDatabaseSchema } from './db/index.ts';

export type CalendarColorScheme = 'light' | 'dark';
export type CalendarTheme = 'corvus' | 'github';

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

const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"></svg>';

const themes = {
  corvus: {
    light: ['#F7FCFD', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
    dark: ['#003960', '#006699', '#52A3C3', '#A5D6E4', '#F7FCFD'],
  },
  github: {
    light: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'],
    dark: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'],
  },
};
const WEEKDAY_LABELS: Array<DayName> = ['tue', 'thu', 'sat'];
const SVG_TEXT_STYLE = `<style><![CDATA[
  text {
    font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
    font-size: 12px;

    color: #f0f6fc;

    @media (prefers-color-scheme: light) {
      color: #1f2328;
    }
  }
]]></style>`;

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

function getFixedWeekWindow(totalWeeks: number): { start: Date; end: Date } {
  const weeks = Math.max(1, totalWeeks);
  const totalDays = weeks * 7;

  const todayUtc = toUtcDateOnly(new Date());
  const daysSinceMonday = (todayUtc.getUTCDay() + 6) % 7;

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

function getActivityLevel(count: number): number {
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

function buildActivities(
  startDate: Date,
  endDate: Date,
  countsByDate: Map<string, number>,
): Array<Activity> {
  const activities: Array<Activity> = [];

  for (
    let currentDate = startDate;
    currentDate <= endDate;
    currentDate = addUtcDays(currentDate, 1)
  ) {
    const date = toIsoDate(currentDate);
    const count = countsByDate.get(date) ?? 0;

    activities.push({
      date,
      count,
      level: getActivityLevel(count),
    });
  }

  return activities;
}

function extractCalendarSvg(markup: string): string | null {
  const match = markup.match(/<svg[\s\S]*?<\/svg>/);
  return match ? match[0] : null;
}

function toStandaloneSvg(svg: string): string {
  const hasXmlNs = /<svg[^>]*\sxmlns=/.test(svg);
  const withNamespace = hasXmlNs
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');

  const widthMatch = withNamespace.match(/\swidth="([^"]+)"/);
  const heightMatch = withNamespace.match(/\sheight="([^"]+)"/);

  if (!widthMatch || !heightMatch) {
    return withNamespace.replace(/(<svg[^>]*>)/, `$1${SVG_TEXT_STYLE}`);
  }

  const background = `<rect x="0" y="0" width="${widthMatch[1]}" height="${heightMatch[1]}" fill="none"/>`;
  return withNamespace.replace(
    /(<svg[^>]*>)/,
    `$1${SVG_TEXT_STYLE}${background}`,
  );
}

function renderCalendarSvg(
  startDate: Date,
  endDate: Date,
  countsByDate: Map<string, number>,
  colorScheme: CalendarColorScheme,
  theme: CalendarTheme,
): string {
  const activities = buildActivities(startDate, endDate, countsByDate);

  if (activities.length === 0) {
    return EMPTY_SVG;
  }

  const markup = renderToStaticMarkup(
    createElement(ActivityCalendar, {
      data: activities,
      weekStart: 1,
      blockSize: 12,
      blockMargin: 4,
      blockRadius: 2,
      fontSize: 12,
      colorScheme,
      theme: themes[theme],
      showWeekdayLabels: WEEKDAY_LABELS,
      showTotalCount: false,
      showColorLegend: false,
      renderBlock: (block, activity) =>
        cloneElement(
          block,
          undefined,
          createElement(
            'title',
            undefined,
            `${activity.date}: ${activity.count} activities`,
          ),
        ),
    }),
  );

  const svg = extractCalendarSvg(markup);
  if (!svg) {
    return EMPTY_SVG;
  }

  return toStandaloneSvg(svg);
}

async function renderDateRangeSvg(
  startDate: Date,
  endDate: Date,
  colorScheme: CalendarColorScheme,
  theme: CalendarTheme,
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

  return renderCalendarSvg(start, end, countsByDate, colorScheme, theme);
}

export async function renderRollingYearsSvg(
  years: number,
  colorScheme: CalendarColorScheme = 'light',
  theme: CalendarTheme = 'corvus',
): Promise<string> {
  if (!Number.isInteger(years) || years < 1) {
    return EMPTY_SVG;
  }

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

  return renderDateRangeSvg(start, end, colorScheme, theme);
}
