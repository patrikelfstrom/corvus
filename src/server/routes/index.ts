import { defineEventHandler } from 'h3';

const SVG_LINKS = ['/year.svg'];

function renderIndexHtml(): string {
  const links = SVG_LINKS.map(
    (href) => `<li><a href="${href}">${href}</a></li>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Corvus</title>
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
  event.res.headers.set('content-type', 'text/html; charset=utf-8');
  return renderIndexHtml();
});
