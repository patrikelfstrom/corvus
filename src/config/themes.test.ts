import assert from 'node:assert/strict';
import test from 'node:test';
import { getInvalidThemeReason } from './themes.ts';

test('getInvalidThemeReason rejects color scales that are not 5 colors long', () => {
  const invalidReason = getInvalidThemeReason({
    light: ['#eff2f5', '#fbb4b9'],
    dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
  });

  assert.equal(invalidReason, 'light must contain exactly 5 colors, 2 passed');
});
