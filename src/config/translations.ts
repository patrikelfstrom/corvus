import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { logger } from '../logger.ts';
import { getDefaultTranslationTemplate } from './default-templates.ts';
import { readEnv } from './env.ts';

const TRANSLATIONS_DIRECTORY_NAME = 'translations';
const DEFAULT_TRANSLATION_ID = 'en-us';
const DEFAULT_TRANSLATION_FILE_NAME = `${DEFAULT_TRANSLATION_ID}.yaml`;

const nonEmptyStringSchema = z.string().trim().min(1);

const translationSchema = z.object({
  calendar: z.object({
    aria: z.object({
      weekday_labels: nonEmptyStringSchema,
      month_labels: nonEmptyStringSchema,
      legend: nonEmptyStringSchema,
    }),
    legend: z.object({
      less: nonEmptyStringSchema,
      more: nonEmptyStringSchema,
    }),
    contribution: z.object({
      none_on_date: nonEmptyStringSchema,
      singular_on_date: nonEmptyStringSchema,
      plural_on_date: nonEmptyStringSchema,
    }),
    swatch: z.object({
      singular: nonEmptyStringSchema,
      plural: nonEmptyStringSchema,
      overflow: nonEmptyStringSchema,
    }),
    summary: z.object({
      last_year_singular: nonEmptyStringSchema,
      last_year_plural: nonEmptyStringSchema,
    }),
  }),
  tasks: z.object({
    errors: z.object({
      invalid_sync_response: nonEmptyStringSchema,
      forbidden: nonEmptyStringSchema,
      invalid_token: nonEmptyStringSchema,
      task_name_required: nonEmptyStringSchema,
      task_name_invalid: nonEmptyStringSchema,
      payload_must_be_object: nonEmptyStringSchema,
      payload_invalid: nonEmptyStringSchema,
    }),
    sync: z.object({
      started: nonEmptyStringSchema,
      manual_busy: nonEmptyStringSchema,
      scheduled_busy: nonEmptyStringSchema,
      all_enabled_full_history: nonEmptyStringSchema,
      all_enabled_partial: nonEmptyStringSchema,
      selection: z.object({
        full_history_label: nonEmptyStringSchema,
        partial_label: nonEmptyStringSchema,
        generic_label: nonEmptyStringSchema,
        integration_singular: nonEmptyStringSchema,
        integration_plural: nonEmptyStringSchema,
        triggered_for_selection: nonEmptyStringSchema,
      }),
    }),
  }),
  cli: z.object({
    usage: nonEmptyStringSchema,
    default_sync_started: nonEmptyStringSchema,
    failed_to_trigger: nonEmptyStringSchema,
    failed_to_contact: nonEmptyStringSchema,
    ensure_running: nonEmptyStringSchema,
  }),
});

const translationOverrideSchema = z
  .object({
    calendar: z
      .object({
        aria: z
          .object({
            weekday_labels: nonEmptyStringSchema.optional(),
            month_labels: nonEmptyStringSchema.optional(),
            legend: nonEmptyStringSchema.optional(),
          })
          .optional(),
        legend: z
          .object({
            less: nonEmptyStringSchema.optional(),
            more: nonEmptyStringSchema.optional(),
          })
          .optional(),
        contribution: z
          .object({
            none_on_date: nonEmptyStringSchema.optional(),
            singular_on_date: nonEmptyStringSchema.optional(),
            plural_on_date: nonEmptyStringSchema.optional(),
          })
          .optional(),
        swatch: z
          .object({
            singular: nonEmptyStringSchema.optional(),
            plural: nonEmptyStringSchema.optional(),
            overflow: nonEmptyStringSchema.optional(),
          })
          .optional(),
        summary: z
          .object({
            last_year_singular: nonEmptyStringSchema.optional(),
            last_year_plural: nonEmptyStringSchema.optional(),
          })
          .optional(),
      })
      .optional(),
    tasks: z
      .object({
        errors: z
          .object({
            invalid_sync_response: nonEmptyStringSchema.optional(),
            forbidden: nonEmptyStringSchema.optional(),
            invalid_token: nonEmptyStringSchema.optional(),
            task_name_required: nonEmptyStringSchema.optional(),
            task_name_invalid: nonEmptyStringSchema.optional(),
            payload_must_be_object: nonEmptyStringSchema.optional(),
            payload_invalid: nonEmptyStringSchema.optional(),
          })
          .optional(),
        sync: z
          .object({
            started: nonEmptyStringSchema.optional(),
            manual_busy: nonEmptyStringSchema.optional(),
            scheduled_busy: nonEmptyStringSchema.optional(),
            all_enabled_full_history: nonEmptyStringSchema.optional(),
            all_enabled_partial: nonEmptyStringSchema.optional(),
            selection: z
              .object({
                full_history_label: nonEmptyStringSchema.optional(),
                partial_label: nonEmptyStringSchema.optional(),
                generic_label: nonEmptyStringSchema.optional(),
                integration_singular: nonEmptyStringSchema.optional(),
                integration_plural: nonEmptyStringSchema.optional(),
                triggered_for_selection: nonEmptyStringSchema.optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    cli: z
      .object({
        usage: nonEmptyStringSchema.optional(),
        default_sync_started: nonEmptyStringSchema.optional(),
        failed_to_trigger: nonEmptyStringSchema.optional(),
        failed_to_contact: nonEmptyStringSchema.optional(),
        ensure_running: nonEmptyStringSchema.optional(),
      })
      .optional(),
  })
  .loose();

type TranslationEntry = {
  filePath: string;
  id: string;
  keys: Set<string>;
  locale: string;
  messages: AppTranslation;
};

export type AppTranslation = z.infer<typeof translationSchema>;
type TranslationOverride = z.infer<typeof translationOverrideSchema>;

export interface ResolvedAppTranslation {
  id: string;
  locale: string;
  messages: AppTranslation;
}

const resolvedLocaleCache = new Map<string, string>();
const DEFAULT_TRANSLATION_LOCALE = 'en';

const DEFAULT_TRANSLATION_MESSAGES: AppTranslation = {
  calendar: {
    aria: {
      weekday_labels: 'weekday labels',
      month_labels: 'month labels',
      legend: 'legend',
    },
    legend: {
      less: 'Less',
      more: 'More',
    },
    contribution: {
      none_on_date: 'No contributions on {date}.',
      singular_on_date: '{count} contribution on {date}.',
      plural_on_date: '{count} contributions on {date}.',
    },
    swatch: {
      singular: '{count} contribution',
      plural: '{count} contributions',
      overflow: '{count}+ contributions',
    },
    summary: {
      last_year_singular: '{count} contribution in the last year',
      last_year_plural: '{count} contributions in the last year',
    },
  },
  tasks: {
    errors: {
      invalid_sync_response: 'Sync task returned an invalid response.',
      forbidden: 'Forbidden',
      invalid_token: 'Invalid task token',
      task_name_required: 'Task name is required',
      task_name_invalid: 'Task name is invalid',
      payload_must_be_object: 'Task payload must be an object',
      payload_invalid: 'Task payload is invalid',
    },
    sync: {
      started: 'Sync triggered. Check server logs for progress and result.',
      manual_busy: 'Sync is currently active.',
      scheduled_busy:
        'Could not initiate scheduled sync. Sync is already running.',
      all_enabled_full_history:
        'Full-history sync triggered for all enabled integrations. Check server logs for progress and result.',
      all_enabled_partial:
        'Partial sync triggered for all enabled integrations. Check server logs for progress and result.',
      selection: {
        full_history_label: 'Full-history sync',
        partial_label: 'Partial sync',
        generic_label: 'Sync',
        integration_singular: 'integration',
        integration_plural: 'integrations',
        triggered_for_selection:
          '{triggerLabel} triggered for {count} {integrationLabel} (ids: {selectedIds}). Check server logs for progress and result.',
      },
    },
  },
  cli: {
    usage: 'Usage: corvus sync [--partial] [integration-id ...]',
    default_sync_started:
      'Sync triggered. Check server logs for progress and result.',
    failed_to_trigger:
      'Failed to trigger {taskName} ({statusCode} {statusText}){suffix}',
    failed_to_contact: 'Failed to contact running Corvus server: {message}',
    ensure_running:
      'Make sure the app container is running before using corvus sync.',
  },
};

function createIssuePathLabel(issuePath: Array<PropertyKey>): string {
  if (issuePath.length === 0) {
    return '';
  }

  return `${issuePath.map(String).join('.')}: `;
}

function normalizeLanguageKey(value: string): string {
  return value.trim().toLowerCase();
}

function resolveConfigDirectory(configPath = readEnv().CONFIG_PATH): string {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  return absolutePath.endsWith('.yaml') || absolutePath.endsWith('.yml')
    ? path.dirname(absolutePath)
    : absolutePath;
}

function resolveTranslationsDirectory(): string {
  return path.join(resolveConfigDirectory(), TRANSLATIONS_DIRECTORY_NAME);
}

function createDefaultTranslationBase(): AppTranslation {
  return {
    ...DEFAULT_TRANSLATION_MESSAGES,
  };
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override == null) {
    return base;
  }

  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as T;
  }

  if (
    typeof base === 'object' &&
    base !== null &&
    typeof override === 'object' &&
    override !== null
  ) {
    const merged: Record<string, unknown> = {
      ...(base as Record<string, unknown>),
    };

    for (const [key, value] of Object.entries(override)) {
      merged[key] =
        key in merged ? deepMerge(merged[key], value) : (value as unknown);
    }

    return merged as T;
  }

  return override as T;
}

function parseTranslationOverride(
  content: string,
  fileLabel: string,
): TranslationOverride {
  let parsedYaml: unknown;

  try {
    parsedYaml = parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in ${fileLabel}: ${message}`);
  }

  const parsedTranslation = translationOverrideSchema.safeParse(
    parsedYaml ?? {},
  );
  if (!parsedTranslation.success) {
    const issue = parsedTranslation.error.issues[0];
    const pathLabel = createIssuePathLabel(issue?.path ?? []);
    throw new Error(
      `Invalid translation file ${fileLabel}: ${pathLabel}${issue?.message ?? 'Invalid configuration'}`,
    );
  }

  return parsedTranslation.data;
}

function resolveTranslationMessages(
  override: TranslationOverride,
  fileLabel: string,
): AppTranslation {
  const merged = deepMerge(createDefaultTranslationBase(), override);
  const parsedTranslation = translationSchema.safeParse(merged);

  if (!parsedTranslation.success) {
    const issue = parsedTranslation.error.issues[0];
    const pathLabel = createIssuePathLabel(issue?.path ?? []);
    throw new Error(
      `Invalid translation file ${fileLabel}: ${pathLabel}${issue?.message ?? 'Invalid configuration'}`,
    );
  }

  return parsedTranslation.data;
}

function resolveTranslationFileLocale(id: string, fileLabel: string): string {
  try {
    return new Intl.DateTimeFormat(id).resolvedOptions().locale;
  } catch {
    throw new Error(
      `Invalid translation file ${fileLabel}: file name must be a valid locale tag`,
    );
  }
}

function createTranslationKeys(id: string, locale: string): Set<string> {
  const keys = new Set<string>();
  const normalizedId = normalizeLanguageKey(id);
  const primaryTag = normalizedId.split('-')[0];

  keys.add(normalizedId);
  keys.add(normalizeLanguageKey(locale));

  if (primaryTag) {
    keys.add(primaryTag);
  }

  return keys;
}

function listTranslationFilePaths(directoryPath: string): Array<string> {
  return readdirSync(directoryPath)
    .filter((entry) => /\.ya?ml$/i.test(entry))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join(directoryPath, entry));
}

function loadTranslationEntries(): Array<TranslationEntry> {
  const directoryPath = initTranslations();
  const entries: Array<TranslationEntry> = [];
  const seenIds = new Set<string>();

  for (const filePath of listTranslationFilePaths(directoryPath)) {
    const fileName = path.basename(filePath);
    const id = normalizeLanguageKey(path.parse(fileName).name);

    if (seenIds.has(id)) {
      throw new Error(
        `Invalid translation setup: duplicate language id "${id}" in ${TRANSLATIONS_DIRECTORY_NAME}`,
      );
    }

    const content = readFileSync(filePath, 'utf8');
    const override = parseTranslationOverride(content, fileName);
    const locale = resolveTranslationFileLocale(id, fileName);
    const messages = resolveTranslationMessages(override, fileName);

    entries.push({
      filePath,
      id,
      keys: createTranslationKeys(id, locale),
      locale,
      messages,
    });
    seenIds.add(id);
  }

  return entries;
}

function findTranslationEntry(
  entries: Array<TranslationEntry>,
  language: string,
): TranslationEntry | undefined {
  const normalizedLanguage = normalizeLanguageKey(language);

  return entries.find((entry) => entry.keys.has(normalizedLanguage));
}

function parseAcceptLanguageHeader(
  header: string | null | undefined,
): Array<string> {
  if (!header) {
    return [];
  }

  return header
    .split(',')
    .map((part, index) => {
      const [rawTag = '', ...rawParams] = part.split(';');
      const tag = normalizeLanguageKey(rawTag);
      const qParam = rawParams.find((param) => param.trim().startsWith('q='));
      const quality = Number(qParam?.split('=')[1] ?? '1');

      return {
        index,
        quality: Number.isFinite(quality) ? quality : 0,
        tag,
      };
    })
    .filter((candidate) => candidate.tag.length > 0)
    .sort((left, right) => {
      if (right.quality === left.quality) {
        return left.index - right.index;
      }

      return right.quality - left.quality;
    })
    .flatMap((candidate) => {
      const primaryTag = candidate.tag.split('-')[0];
      return primaryTag && primaryTag !== candidate.tag
        ? [candidate.tag, primaryTag]
        : [candidate.tag];
    });
}

function resolveFallbackTranslation(
  entries: Array<TranslationEntry>,
  fallbackLanguage: string,
): TranslationEntry {
  const configuredFallback = findTranslationEntry(entries, fallbackLanguage);

  if (configuredFallback) {
    return configuredFallback;
  }

  const defaultFallback = findTranslationEntry(entries, DEFAULT_TRANSLATION_ID);

  if (defaultFallback) {
    logger.warn(
      {
        fallbackLanguage,
        resolvedFallbackLanguage: defaultFallback.id,
      },
      'Falling back to default translation',
    );
    return defaultFallback;
  }

  const firstEntry = entries[0];
  if (!firstEntry) {
    throw new Error('No translation files are available.');
  }

  logger.warn(
    {
      fallbackLanguage,
      resolvedFallbackLanguage: firstEntry.id,
    },
    'Falling back to first available translation',
  );

  return firstEntry;
}

export function initTranslations(): string {
  const directoryPath = resolveTranslationsDirectory();
  const defaultTranslationPath = path.join(
    directoryPath,
    DEFAULT_TRANSLATION_FILE_NAME,
  );

  mkdirSync(directoryPath, { recursive: true });

  if (!existsSync(defaultTranslationPath)) {
    writeFileSync(
      defaultTranslationPath,
      getDefaultTranslationTemplate(),
      'utf8',
    );
    logger.info(
      { translationPath: defaultTranslationPath },
      'Created default translation file',
    );
  }

  return directoryPath;
}

export function getTranslationsCacheVersion(): string {
  const entries = loadTranslationEntries();

  return entries
    .map((entry) => {
      const stats = statSync(entry.filePath);
      return `${entry.id}:${stats.mtimeMs}:${stats.size}`;
    })
    .join('|');
}

export function resolveAppTranslation(options: {
  acceptLanguage?: string | null;
  fallbackLanguage: string;
  language: string;
}): ResolvedAppTranslation {
  const entries = loadTranslationEntries();
  const fallbackEntry = resolveFallbackTranslation(
    entries,
    options.fallbackLanguage,
  );
  const configuredLanguage = normalizeLanguageKey(options.language);

  if (configuredLanguage !== 'auto') {
    const configuredEntry = findTranslationEntry(entries, configuredLanguage);

    if (!configuredEntry) {
      logger.warn(
        {
          language: options.language,
          fallbackLanguage: fallbackEntry.id,
        },
        'Configured translation was not found; using fallback translation',
      );
      return {
        id: fallbackEntry.id,
        locale: fallbackEntry.locale,
        messages: fallbackEntry.messages,
      };
    }

    return {
      id: configuredEntry.id,
      locale: configuredEntry.locale,
      messages: configuredEntry.messages,
    };
  }

  for (const acceptedLanguage of parseAcceptLanguageHeader(
    options.acceptLanguage,
  )) {
    const matchingEntry = findTranslationEntry(entries, acceptedLanguage);

    if (matchingEntry) {
      return {
        id: matchingEntry.id,
        locale: matchingEntry.locale,
        messages: matchingEntry.messages,
      };
    }
  }

  return {
    id: fallbackEntry.id,
    locale: fallbackEntry.locale,
    messages: fallbackEntry.messages,
  };
}

export function formatTranslation(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  return template.replaceAll(/\{(\w+)\}/g, (_match, key: string) => {
    return String(values[key] ?? '');
  });
}

export function getDefaultAppTranslation(): AppTranslation {
  return DEFAULT_TRANSLATION_MESSAGES;
}

export function getDefaultTranslationLocale(): string {
  return DEFAULT_TRANSLATION_LOCALE;
}

export function resolveTranslationLocale(locale: string): string {
  const cachedLocale = resolvedLocaleCache.get(locale);
  if (cachedLocale) {
    return cachedLocale;
  }

  try {
    const resolvedLocale = new Intl.DateTimeFormat(locale).resolvedOptions()
      .locale;
    resolvedLocaleCache.set(locale, resolvedLocale);
    return resolvedLocale;
  } catch {
    const fallbackLocale = DEFAULT_TRANSLATION_LOCALE;
    logger.warn(
      {
        fallbackLocale,
        locale,
      },
      'Translation locale is invalid; using fallback locale',
    );
    resolvedLocaleCache.set(locale, fallbackLocale);
    return fallbackLocale;
  }
}

export function getLocalizedWeekdayLabels(locale: string): Array<string> {
  const formatter = new Intl.DateTimeFormat(resolveTranslationLocale(locale), {
    timeZone: 'UTC',
    weekday: 'short',
  });

  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2023, 0, 1 + index))),
  );
}
