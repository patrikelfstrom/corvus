import { defineCachedHandler } from 'nitro/cache';
import { getQuery, getRequestURL } from 'nitro/h3';
import { renderRollingYearsSvg } from '../calendar/index.ts';
import { parseOptionalBooleanQuery } from '../calendar/theme-query.ts';
import { getConfigCacheVersion } from '../config/config.ts';

export const ONE_HOUR_SECONDS = 60 * 60;

export default defineCachedHandler(
  async (event) => {
    const { colorScheme, theme, title } = getQuery(event);
    const colorSchemeValue =
      typeof colorScheme === 'string' ? colorScheme : undefined;
    const themeValue = typeof theme === 'string' ? theme : undefined;
    const titleValue =
      typeof title === 'string' ? parseOptionalBooleanQuery(title) : undefined;

    const svg = await renderRollingYearsSvg(
      1,
      colorSchemeValue,
      themeValue,
      titleValue,
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

      return [
        requestUrl.pathname,
        requestUrl.search,
        getConfigCacheVersion(),
      ].join(':');
    },
    maxAge: ONE_HOUR_SECONDS,
    swr: true,
    name: 'year-svg',
  },
);
