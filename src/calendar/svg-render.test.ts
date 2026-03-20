import assert from 'node:assert/strict';
import test from 'node:test';
import { themes } from '../config/themes.ts';
import {
  getDefaultAppTranslation,
  getDefaultTranslationLocale,
} from '../config/translations.ts';
import { buildPlotActivities } from './activity.ts';
import { renderCalendarSvg } from './svg-render.ts';
import { EMPTY_SVG } from './svg-style.ts';

function makeCountsByDate(
  entries: Array<[date: string, count: number]>,
): Map<string, number> {
  return new Map(entries);
}

const translation = getDefaultAppTranslation();
const locale = getDefaultTranslationLocale();

test('renderCalendarSvg returns the empty SVG for empty activity data', () => {
  assert.equal(
    renderCalendarSvg([], 'light', 'corvus', themes, translation, locale),
    EMPTY_SVG,
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

  const svg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translation,
    locale,
    '7 contributions in the last year',
  );

  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<title>7 contributions in the last year<\/title>/);
  assert.match(svg, /<title>1 contribution on January 27, 2026\.<\/title>/);
  assert.match(svg, />Jan<\/text>/);
  assert.match(svg, />Feb<\/text>/);
  assert.match(svg, />Mon<\/text>/);
  assert.match(svg, />Wed<\/text>/);
  assert.match(svg, />Fri<\/text>/);
  assert.match(svg, />Less<\/text>/);
  assert.match(svg, />More<\/text>/);
  assert.doesNotMatch(svg, />Tue<\/text>/);
  assert.doesNotMatch(svg, />Thu<\/text>/);
  assert.doesNotMatch(svg, />Sat<\/text>/);
});

test('renderCalendarSvg rotates weekday labels when the week starts on Monday', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-02-03T00:00:00Z'),
    makeCountsByDate([
      ['2026-01-27', 1],
      ['2026-02-01', 4],
      ['2026-02-03', 2],
    ]),
    'monday',
  );

  const svg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translation,
    locale,
    undefined,
    true,
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  );

  assert.match(svg, />Tue<\/text>/);
  assert.match(svg, />Thu<\/text>/);
  assert.match(svg, />Sat<\/text>/);
  assert.doesNotMatch(svg, />Mon<\/text>/);
  assert.doesNotMatch(svg, />Wed<\/text>/);
  assert.doesNotMatch(svg, />Fri<\/text>/);
});

test('renderCalendarSvg omits the summary title when none is provided', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-02-03T00:00:00Z'),
    makeCountsByDate([
      ['2026-01-27', 1],
      ['2026-02-01', 4],
      ['2026-02-03', 2],
    ]),
  );

  const svg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translation,
    locale,
  );

  assert.doesNotMatch(svg, /<title>7 contributions in the last year<\/title>/);
  assert.doesNotMatch(svg, />7 contributions in the last year<\/text>/);
});

test('renderCalendarSvg can hide the visible summary title while keeping the svg title', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-02-03T00:00:00Z'),
    makeCountsByDate([
      ['2026-01-27', 1],
      ['2026-02-01', 4],
      ['2026-02-03', 2],
    ]),
  );

  const svg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translation,
    locale,
    '7 contributions in the last year',
    false,
  );

  assert.match(svg, /<title>7 contributions in the last year<\/title>/);
  assert.doesNotMatch(svg, />7 contributions in the last year<\/text>/);
});

test('renderCalendarSvg uses prefers-color-scheme CSS when no explicit color scheme is provided', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-01-28T00:00:00Z'),
    makeCountsByDate([['2026-01-27', 7]]),
  );

  const svg = renderCalendarSvg(
    activities,
    undefined,
    'corvus',
    themes,
    translation,
    locale,
  );

  assert.match(svg, /class="calendar-root"/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(svg, /--calendar-text-color: #1f2328/);
  assert.match(svg, /--calendar-text-color: #f0f6fc/);
  assert.match(svg, /fill="var\(--calendar-level-4\)"/);
});

test('renderCalendarSvg uses the resolved theme colors for light and dark schemes', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-01-28T00:00:00Z'),
    makeCountsByDate([['2026-01-27', 7]]),
  );

  const lightSvg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translation,
    locale,
  );
  const darkSvg = renderCalendarSvg(
    activities,
    'dark',
    'corvus',
    themes,
    translation,
    locale,
  );

  assert.match(lightSvg, /--calendar-level-0: #eff2f5/);
  assert.match(lightSvg, /--calendar-level-4: #003960/);
  assert.match(lightSvg, /color-scheme:light;/);
  assert.doesNotMatch(lightSvg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(darkSvg, /--calendar-level-0: #151b23/);
  assert.match(darkSvg, /--calendar-level-4: #A5D6E4/);
  assert.match(darkSvg, /color-scheme:dark;/);
  assert.doesNotMatch(darkSvg, /@media \(prefers-color-scheme: dark\)/);
});

test('renderCalendarSvg uses translated labels and tooltip templates', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-01-28T00:00:00Z'),
    makeCountsByDate([['2026-01-27', 1]]),
  );
  const translated = {
    ...translation,
    calendar: {
      ...translation.calendar,
      aria: {
        ...translation.calendar.aria,
        legend: 'legend-sv',
      },
      contribution: {
        ...translation.calendar.contribution,
        singular_on_date: '{count} bidrag den {date}.',
      },
      legend: {
        less: 'Mindre',
        more: 'Mer',
      },
      swatch: {
        singular: '{count} bidrag',
        plural: '{count} bidrag',
        overflow: '{count}+ bidrag',
      },
    },
  };

  const svg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translated,
    locale,
  );

  assert.match(svg, /aria-label="legend-sv"/);
  assert.match(svg, />Mindre<\/text>/);
  assert.match(svg, />Mer<\/text>/);
  assert.match(svg, /<title>1 bidrag den January 27, 2026\.<\/title>/);
  assert.match(svg, /<title>1 bidrag<\/title>/);
});

test('renderCalendarSvg falls back to en when translation locale is invalid', () => {
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-02-03T00:00:00Z'),
    makeCountsByDate([
      ['2026-01-27', 1],
      ['2026-02-01', 4],
    ]),
  );
  const translated = {
    ...translation,
  };

  const svg = renderCalendarSvg(
    activities,
    'light',
    'corvus',
    themes,
    translated,
    'bogus_locale',
  );

  assert.match(svg, />Jan<\/text>/);
  assert.match(svg, />Feb<\/text>/);
  assert.match(svg, /<title>1 contribution on January 27, 2026\.<\/title>/);
});
