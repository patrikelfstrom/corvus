import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDefaultAppTranslation,
  getDefaultTranslationLocale,
} from '../config/translations.ts';
import { buildPlotActivities } from './activity.ts';
import { renderRollingYearsSvg } from './index.ts';
import { renderCalendarSvg } from './svg-render.ts';

function makeCountsByDate(
  entries: Array<[date: string, count: number]>,
): Map<string, number> {
  return new Map(entries);
}

test('renderRollingYearsSvg returns the empty SVG for invalid year input', async () => {
  assert.equal(
    await renderRollingYearsSvg(0, undefined),
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"></svg>',
  );
});

test('renderRollingYearsSvg falls back to automatic CSS theming for invalid color schemes', async () => {
  const translation = getDefaultAppTranslation();
  const locale = getDefaultTranslationLocale();
  const activities = buildPlotActivities(
    new Date('2026-01-26T00:00:00Z'),
    new Date('2026-01-28T00:00:00Z'),
    makeCountsByDate([['2026-01-27', 7]]),
  );
  const svg = renderCalendarSvg(
    activities,
    undefined,
    'corvus',
    {
      corvus: {
        light: ['#eff2f5', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
        dark: ['#151b23', '#003960', '#006699', '#52A3C3', '#A5D6E4'],
      },
    },
    translation,
    locale,
  );

  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(svg, /color-scheme:light dark;/);
});
