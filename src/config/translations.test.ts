import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getLocalizedWeekdayLabels,
  resolveAppTranslation,
} from './translations.ts';

async function withTempConfigAndTranslations(
  configContent: string,
  translations: Record<string, string>,
  callback: (directory: string) => void | Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'corvus-translations-test-'),
  );
  const previousConfigPath = process.env.CONFIG_PATH;

  writeFileSync(path.join(directory, 'config.yaml'), configContent, 'utf8');

  if (Object.keys(translations).length > 0) {
    const translationsDirectory = path.join(directory, 'translations');
    mkdirSync(translationsDirectory, { recursive: true });

    for (const [fileName, content] of Object.entries(translations)) {
      writeFileSync(
        path.join(translationsDirectory, fileName),
        content,
        'utf8',
      );
    }
  }

  process.env.CONFIG_PATH = directory;

  try {
    await callback(directory);
  } finally {
    if (previousConfigPath == null) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = previousConfigPath;
    }

    rmSync(directory, { recursive: true, force: true });
  }
}

const SWEDISH_TRANSLATION = `calendar:
  aria:
    weekday_labels: veckodagsetiketter
    month_labels: manadsetiketter
    legend: teckenforklaring
  legend:
    less: Mindre
    more: Mer
  contribution:
    none_on_date: "Inga bidrag den {date}."
    singular_on_date: "{count} bidrag den {date}."
    plural_on_date: "{count} bidrag den {date}."
  swatch:
    singular: "{count} bidrag"
    plural: "{count} bidrag"
    overflow: "{count}+ bidrag"
  summary:
    last_year_singular: "{count} bidrag det senaste aret"
    last_year_plural: "{count} bidrag det senaste aret"
`;

test('resolveAppTranslation creates and uses the default en-us translation', async () => {
  await withTempConfigAndTranslations('themes: {}\n', {}, async (directory) => {
    const translation = resolveAppTranslation({
      fallbackLanguage: 'en-us',
      language: 'auto',
    });

    assert.equal(translation.id, 'en-us');
    assert.equal(translation.messages.calendar.legend.less, 'Less');
    assert.equal(
      existsSync(path.join(directory, 'translations', 'en-us.yaml')),
      true,
    );
  });
});

test('resolveAppTranslation matches auto language selection from locale-tag file names', async () => {
  await withTempConfigAndTranslations(
    `settings:
  language: auto
  fallback_language: en-us
`,
    {
      'sv-se.yaml': SWEDISH_TRANSLATION,
    },
    () => {
      const translation = resolveAppTranslation({
        acceptLanguage: 'sv-SE,sv;q=0.9,en;q=0.8',
        fallbackLanguage: 'en-us',
        language: 'auto',
      });

      assert.equal(translation.id, 'sv-se');
      assert.equal(translation.locale, 'sv-SE');
      assert.equal(translation.messages.calendar.legend.less, 'Mindre');
      assert.equal(
        translation.messages.tasks.errors.invalid_sync_response,
        'Sync task returned an invalid response.',
      );
    },
  );
});

test('getLocalizedWeekdayLabels falls back to en-US for invalid locales', () => {
  assert.deepEqual(getLocalizedWeekdayLabels('bogus_locale'), [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
  ]);
});
