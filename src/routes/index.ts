import { defineEventHandler } from 'h3';
import { loadConfig } from '../config/config.ts';
import { resolveAppTranslation } from '../config/translations.ts';

const SVG_LINKS = ['/year.svg'];
const APP_NAME = 'Corvus';

function renderIndexHtml(title: string, locale: string): string {
  const links = SVG_LINKS.map(
    (href) => `<li><a href="${href}">${href}</a></li>`,
  ).join('');

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>

      :root {
        --color: #f0f6fc;
        --color-muted: #9198a1;
        --cell-empty: #151b23;
        --background: #0d1117;

        @media (prefers-color-scheme: light) {
          --color: #1f2328;
          --color-muted: #59636e;
          --cell-empty: #eff2f5;
          --background: #ffffff;
        }
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
        background: var(--background);
        color: var(--color);
      }

      ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0.75rem;
        text-align: center;
      }

      a {
        color: #0b7285;
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <main>
      <ul>${links}</ul>
    </main>
  </body>
</html>`;
}

export default defineEventHandler((event) => {
  const config = loadConfig();
  const translation = resolveAppTranslation({
    acceptLanguage: event.req.headers.get('accept-language'),
    fallbackLanguage: config.settings.fallbackLanguage,
    language: config.settings.language,
  });

  event.res.headers.set('content-type', 'text/html; charset=utf-8');
  return renderIndexHtml(APP_NAME, translation.locale);
});
