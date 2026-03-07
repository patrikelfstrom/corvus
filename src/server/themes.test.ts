import assert from 'node:assert/strict';
import test from 'node:test';

import { getInvalidThemeReason, parseColorScheme, parseThemeName } from './themes.ts';

test('parseThemeName accepts exact configured theme names', () => {
  const theme = parseThemeName('fuchsia', {
    corvus: {
      light: ['#eff2f5', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
      dark: ['#151b23', '#003960', '#006699', '#52A3C3', '#A5D6E4'],
    },
    fuchsia: {
      light: ['#eff2f5', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177'],
      dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
    },
  });

  assert.equal(theme, 'fuchsia');
});

test('parseColorScheme falls back to the default for invalid values', () => {
  assert.equal(parseColorScheme('DARK'), 'light');
});

test('parseThemeName defaults to corvus when theme query is missing', () => {
  const theme = parseThemeName(undefined, {
    corvus: {
      light: ['#eff2f5', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
      dark: ['#151b23', '#003960', '#006699', '#52A3C3', '#A5D6E4'],
    },
    fuchsia: {
      light: ['#eff2f5', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177'],
      dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
    },
  });

  assert.equal(theme, 'corvus');
});

test('parseThemeName falls back to the default for invalid values', () => {
  const theme = parseThemeName('Fuchsia', {
    corvus: {
      light: ['#eff2f5', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
      dark: ['#151b23', '#003960', '#006699', '#52A3C3', '#A5D6E4'],
    },
    fuchsia: {
      light: ['#eff2f5', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177'],
      dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
    },
  });

  assert.equal(theme, 'corvus');
});

test('parseThemeName falls back to a provided default theme', () => {
  const theme = parseThemeName(
    'unknown-theme',
    {
      corvus: {
        light: ['#eff2f5', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
        dark: ['#151b23', '#003960', '#006699', '#52A3C3', '#A5D6E4'],
      },
      fuchsia: {
        light: ['#eff2f5', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177'],
        dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
      },
    },
    'fuchsia',
  );

  assert.equal(theme, 'fuchsia');
});

test('getInvalidThemeReason rejects color scales that are not 5 colors long', () => {
  const invalidReason = getInvalidThemeReason({
    light: ['#eff2f5', '#fbb4b9'],
    dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
  });

  assert.equal(invalidReason, 'light must contain exactly 5 colors, 2 passed');
});
