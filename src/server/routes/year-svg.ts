import { defineCachedHandler } from 'nitro/cache';
import { getQuery, getRequestURL } from 'nitro/h3';
import { getConfigCacheVersion } from '../config.ts';
import { renderRollingYearsSvg } from '../year-svg.ts';

export const ONE_HOUR_SECONDS = 60 * 60;

export default defineCachedHandler(
  async (event) => {
    const { colorScheme, theme } = getQuery(event);
    const colorSchemeValue =
      typeof colorScheme === 'string' ? colorScheme : undefined;
    const themeValue = typeof theme === 'string' ? theme : undefined;

    const svg = await renderRollingYearsSvg(1, colorSchemeValue, themeValue);

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
