import { defineCachedHandler } from 'nitro/cache';
import { getQuery } from 'nitro/h3';
import {
  type CalendarColorScheme,
  type CalendarTheme,
  renderRollingYearsSvg,
} from '../year-svg.ts';

const ONE_HOUR_SECONDS = 60 * 60;

export default defineCachedHandler(
  (event) => {
    const headerValue = event.req.headers.get('Sec-CH-Prefers-Color-Scheme');

    const colorScheme: CalendarColorScheme =
      headerValue?.trim().toLowerCase() === 'dark' ? 'dark' : 'light';
    const theme: CalendarTheme =
      getQuery(event).theme === 'github' ? 'github' : 'corvus';

    event.res.headers.set('content-type', 'image/svg+xml; charset=utf-8');
    event.res.headers.set('accept-ch', 'Sec-CH-Prefers-Color-Scheme');
    event.res.headers.set('critical-ch', 'Sec-CH-Prefers-Color-Scheme');
    event.res.headers.set('vary', 'Sec-CH-Prefers-Color-Scheme');
    event.res.headers.set('permissions-policy', 'ch-prefers-color-scheme=*');
    event.res.headers.set(
      'cache-control',
      `public, max-age=${ONE_HOUR_SECONDS}`,
    );

    return renderRollingYearsSvg(1, colorScheme, theme);
  },
  {
    maxAge: ONE_HOUR_SECONDS,
    swr: true,
    name: 'year-svg',
  },
);
