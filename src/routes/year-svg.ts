import { defineCachedHandler } from 'nitro/cache';
import { getQuery, getRequestURL } from 'nitro/h3';
import { renderRollingYearsSvg } from '../calendar/index.ts';
import {
  parseOptionalBooleanQuery,
  parseOptionalDarkModeQuery,
  parseOptionalWeekStart,
} from '../calendar/theme-query.ts';
import { getConfigCacheVersion, loadConfig } from '../config/config.ts';
import { resolveAppTranslation } from '../config/translations.ts';

export const ONE_HOUR_SECONDS = 60 * 60;

export default defineCachedHandler(
  async (event) => {
    const {
      dark_mode: darkMode,
      theme,
      title,
      week_start: weekStart,
    } = getQuery(event);
    const colorSchemeValue =
      typeof darkMode === 'string'
        ? parseOptionalDarkModeQuery(darkMode)
        : undefined;
    const themeValue = typeof theme === 'string' ? theme : undefined;
    const titleValue =
      typeof title === 'string' ? parseOptionalBooleanQuery(title) : undefined;
    const weekStartValue =
      typeof weekStart === 'string'
        ? parseOptionalWeekStart(weekStart)
        : undefined;
    const config = loadConfig();
    const translation = resolveAppTranslation({
      acceptLanguage: event.req.headers.get('accept-language'),
      fallbackLanguage: config.settings.fallbackLanguage,
      language: config.settings.language,
    });

    const svg = await renderRollingYearsSvg(
      1,
      colorSchemeValue,
      themeValue,
      titleValue,
      weekStartValue,
      translation,
    );

    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, no-cache',
      },
    });
  },
  {
    getKey: (event) => {
      const requestUrl = getRequestURL(event);
      const config = loadConfig();
      const translation = resolveAppTranslation({
        acceptLanguage: event.req.headers.get('accept-language'),
        fallbackLanguage: config.settings.fallbackLanguage,
        language: config.settings.language,
      });

      return [
        requestUrl.pathname,
        requestUrl.search,
        translation.id,
        getConfigCacheVersion(),
      ].join(':');
    },
    maxAge: ONE_HOUR_SECONDS,
    swr: true,
    name: 'year-svg',
  },
);
