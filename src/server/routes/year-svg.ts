import { defineCachedHandler } from 'nitro/cache';
import { getQuery, getRequestURL } from 'nitro/h3';
import { getConfigCacheVersion } from '../config.ts';
import { renderRollingYearsSvg } from '../year-svg.ts';

const ONE_HOUR_SECONDS = 60 * 60;
const COLOR_SCHEME_HEADER = 'Sec-CH-Prefers-Color-Scheme';

export default defineCachedHandler(
  async (event) => {
    const query = getQuery(event);

    const colorSchemeQuery = query.colorScheme;
    const colorSchemeHeader = event.req.headers.get(COLOR_SCHEME_HEADER);
    const colorScheme =
      typeof colorSchemeQuery === 'string'
        ? colorSchemeQuery
        : (colorSchemeHeader ?? undefined);

    const theme = typeof query.theme === 'string' ? query.theme : undefined;

    const svg = await renderRollingYearsSvg(1, colorScheme, theme);

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
      const colorSchemeHeader =
        event.req.headers.get(COLOR_SCHEME_HEADER) ?? '';

      return [
        requestUrl.pathname,
        requestUrl.search,
        colorSchemeHeader,
        getConfigCacheVersion(),
      ].join(':');
    },
    maxAge: ONE_HOUR_SECONDS,
    swr: true,
    name: 'year-svg',
  },
);
