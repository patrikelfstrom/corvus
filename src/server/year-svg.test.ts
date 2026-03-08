import assert from 'node:assert/strict';
import test from 'node:test';
import { themes } from './themes.ts';
import {
  buildPlotActivities,
  getActivityLevel,
  getFixedWeekWindow,
  renderCalendarSvg,
  renderRollingYearsSvg,
} from './year-svg.ts';

function makeCountsByDate(
  entries: Array<[date: string, count: number]>,
): Map<string, number> {
  return new Map(entries);
}

test('renderRollingYearsSvg returns the empty SVG for invalid year input', async () => {
  assert.equal(
    await renderRollingYearsSvg(0),
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"></svg>',
  );
});

test('renderCalendarSvg returns the empty SVG for empty activity data', () => {
  assert.equal(
    renderCalendarSvg([], 'light', 'corvus', themes),
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"></svg>',
  );
});

test('getFixedWeekWindow returns a Monday-first 53-week window', () => {
  const { start, end } = getFixedWeekWindow(53);

  assert.equal(start.getUTCDay(), 1);
  assert.equal(end.getUTCDay(), 0);
  assert.equal((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000), 370);
});

test('getActivityLevel preserves the existing contribution buckets', () => {
  assert.equal(getActivityLevel(0), 0);
  assert.equal(getActivityLevel(1), 1);
  assert.equal(getActivityLevel(3), 2);
  assert.equal(getActivityLevel(6), 3);
  assert.equal(getActivityLevel(7), 4);
});

test('buildPlotActivities emits week and weekday coordinates for a Monday-first grid', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-02-03T00:00:00Z'),
    makeCountsByDate([
      ['2026-01-27', 1],
      ['2026-02-01', 4],
      ['2026-02-03', 2],
    ]),
  );

  assert.deepEqual(
    activities.map((activity) => ({
      date: activity.date,
      count: activity.count,
      level: activity.level,
      weekIndex: activity.weekIndex,
      weekdayIndex: activity.weekdayIndex,
      weekdayLabel: activity.weekdayLabel,
      monthTick: activity.monthTick,
    })),
    [
      {
        date: '2026-01-26',
        count: 0,
        level: 0,
        weekIndex: 0,
        weekdayIndex: 0,
        weekdayLabel: 'Mon',
        monthTick: true,
      },
      {
        date: '2026-01-27',
        count: 1,
        level: 1,
        weekIndex: 0,
        weekdayIndex: 1,
        weekdayLabel: 'Tue',
        monthTick: false,
      },
      {
        date: '2026-01-28',
        count: 0,
        level: 0,
        weekIndex: 0,
        weekdayIndex: 2,
        weekdayLabel: 'Wed',
        monthTick: false,
      },
      {
        date: '2026-01-29',
        count: 0,
        level: 0,
        weekIndex: 0,
        weekdayIndex: 3,
        weekdayLabel: 'Thu',
        monthTick: false,
      },
      {
        date: '2026-01-30',
        count: 0,
        level: 0,
        weekIndex: 0,
        weekdayIndex: 4,
        weekdayLabel: 'Fri',
        monthTick: false,
      },
      {
        date: '2026-01-31',
        count: 0,
        level: 0,
        weekIndex: 0,
        weekdayIndex: 5,
        weekdayLabel: 'Sat',
        monthTick: false,
      },
      {
        date: '2026-02-01',
        count: 4,
        level: 3,
        weekIndex: 0,
        weekdayIndex: 6,
        weekdayLabel: 'Sun',
        monthTick: true,
      },
      {
        date: '2026-02-02',
        count: 0,
        level: 0,
        weekIndex: 1,
        weekdayIndex: 0,
        weekdayLabel: 'Mon',
        monthTick: false,
      },
      {
        date: '2026-02-03',
        count: 2,
        level: 2,
        weekIndex: 1,
        weekdayIndex: 1,
        weekdayLabel: 'Tue',
        monthTick: false,
      },
    ],
  );
});

test('renderCalendarSvg returns SVG with month labels, weekday labels, and tooltips', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-02-03T00:00:00Z'),
    makeCountsByDate([
      ['2026-01-27', 1],
      ['2026-02-01', 4],
      ['2026-02-03', 2],
    ]),
  );

  const svg = renderCalendarSvg(activities, 'light', 'corvus', themes);

  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<title>2026-01-27: 1 activities<\/title>/);
  assert.match(svg, />Jan<\/text>/);
  assert.match(svg, />Feb<\/text>/);
  assert.match(svg, />Tue<\/text>/);
  assert.match(svg, />Thu<\/text>/);
  assert.match(svg, />Sat<\/text>/);
  assert.match(svg, />Less<\/text>/);
  assert.match(svg, />More<\/text>/);
  assert.doesNotMatch(svg, />Mon<\/text>/);
  assert.doesNotMatch(svg, />Wed<\/text>/);
  assert.doesNotMatch(svg, />Fri<\/text>/);
});

test('renderCalendarSvg uses the resolved theme colors for light and dark schemes', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-01-28T00:00:00Z'),
    makeCountsByDate([['2026-01-27', 7]]),
  );

  const lightSvg = renderCalendarSvg(activities, 'light', 'corvus', themes);
  const darkSvg = renderCalendarSvg(activities, 'dark', 'corvus', themes);

  assert.match(lightSvg, /fill="#eff2f5"/);
  assert.match(lightSvg, /fill="#003960"/);
  assert.match(darkSvg, /fill="#151b23"/);
  assert.match(darkSvg, /fill="#A5D6E4"/);
});
