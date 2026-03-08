import { defineCachedHandler } from 'nitro/cache';
import { getQuery, getRequestURL } from 'nitro/h3';
import { getConfigCacheVersion } from '../config.ts';
import { renderRollingYearsSvg } from '../year-svg.ts';

export const ONE_HOUR_SECONDS = 60 * 60;
const COLOR_SCHEME_HEADER = 'Sec-CH-Prefers-Color-Scheme';

export default defineCachedHandler(
  async (event) => {
    const { colorScheme, theme } = getQuery(event);
    const colorSchemeHeader = event.req.headers.get(COLOR_SCHEME_HEADER);
    const colorSchemeValue =
      typeof colorScheme === 'string'
        ? colorScheme
        : (colorSchemeHeader ?? undefined);
    const themeValue = typeof theme === 'string' ? theme : undefined;

    const svg = await renderRollingYearsSvg(1, colorSchemeValue, themeValue);

    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'accept-ch': COLOR_SCHEME_HEADER,
        'critical-ch': COLOR_SCHEME_HEADER,
        vary: COLOR_SCHEME_HEADER,
        'permissions-policy': 'ch-prefers-color-scheme=*',
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
        event.req.headers.get(COLOR_SCHEME_HEADER) ?? '',
        getConfigCacheVersion(),
      ].join(':');
    },
    maxAge: ONE_HOUR_SECONDS,
    swr: true,
    name: 'year-svg',
  },
);
