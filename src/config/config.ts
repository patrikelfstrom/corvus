import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { weekStartSchema } from '../calendar/week-start.ts';
import { logger } from '../logger.ts';
import { getDefaultConfigTemplate } from './default-templates.ts';
import { readEnv } from './env.ts';
import {
  DEFAULT_THEME_NAME,
  getInvalidThemeReason,
  mergeThemes,
  type ThemeMap,
  themeSchema,
} from './themes.ts';
import {
  getTranslationsCacheVersion,
  initTranslations,
} from './translations.ts';

const CONFIG_FILE_NAME = 'config.yaml';

const settingsSchema = z
  .object({
    fallback_language: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.toLowerCase())
      .default('en'),
    language: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.toLowerCase())
      .default('auto'),
    theme: z.string().min(1).optional(),
    title: z.boolean().default(true),
    week_start: weekStartSchema,
  })
  .default({
    fallback_language: 'en',
    language: 'auto',
    title: true,
    week_start: 'sunday',
  });

const appConfigSchema = z
  .object({
    theme: z.string().min(1).optional(),
    settings: settingsSchema,
    themes: z.record(z.string(), themeSchema).default({}),
  })
  .loose();

export type AppConfig = {
  settings: {
    fallbackLanguage: string;
    language: string;
    theme?: string;
    title: boolean;
    weekStart: z.infer<typeof weekStartSchema>;
  };
  themes: ThemeMap;
};

function resolveConfigPath(configPath = readEnv().CONFIG_PATH): string {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  const configDirectory =
    absolutePath.endsWith('.yaml') || absolutePath.endsWith('.yml')
      ? path.dirname(absolutePath)
      : absolutePath;

  return path.join(configDirectory, CONFIG_FILE_NAME);
}

export function getConfigCacheVersion(): string {
  const configPath = initConfig();
  initTranslations();
  const stats = statSync(configPath);

  return `${stats.mtimeMs}:${stats.size}|${getTranslationsCacheVersion()}`;
}

export function initConfig(): string {
  const configPath = resolveConfigPath();
  logger.trace({ configPath }, 'Resolved app config path');

  if (existsSync(configPath)) {
    logger.trace({ configPath }, 'Config file already exists');
    return configPath;
  }

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, getDefaultConfigTemplate(), 'utf8');

  logger.info({ configPath }, 'Created default config file');

  return configPath;
}

function createIssuePathLabel(issuePath: Array<PropertyKey>): string {
  if (issuePath.length === 0) {
    return '';
  }

  const formattedPath = issuePath.map((segment) =>
    typeof segment === 'symbol'
      ? (segment.description ?? 'symbol')
      : String(segment),
  );

  return `${formattedPath.join('.')}: `;
}

function validateConfiguredThemes(configuredThemes: ThemeMap): void {
  for (const [themeName, theme] of Object.entries(configuredThemes)) {
    if (themeName.length === 0) {
      throw new Error(
        'Invalid config.yaml: themes: theme names must not be empty',
      );
    }

    void theme;
  }
}

function sanitizeConfiguredThemes(
  configuredThemes: ThemeMap,
  configPath: string,
): ThemeMap {
  const sanitizedThemes: ThemeMap = {};

  for (const [themeName, theme] of Object.entries(configuredThemes)) {
    const invalidReason = getInvalidThemeReason(theme);

    if (invalidReason) {
      logger.warn(
        {
          configPath,
          themeName,
          invalidReason,
        },
        'Ignoring invalid theme from config.yaml',
      );
      continue;
    }

    sanitizedThemes[themeName] = theme;
  }

  return sanitizedThemes;
}

function normalizeConfiguredDefaultTheme(
  themeName: string | undefined,
  availableThemes: ThemeMap,
  configPath: string,
): string | undefined {
  if (themeName == null) {
    return undefined;
  }

  if (themeName in availableThemes) {
    return themeName;
  }

  logger.warn(
    {
      configPath,
      themeName,
      fallbackThemeName: DEFAULT_THEME_NAME,
    },
    'Ignoring unknown default theme from config.yaml',
  );

  return undefined;
}

export function loadConfig(): AppConfig {
  const configPath = initConfig();
  const content = readFileSync(configPath, 'utf8');
  logger.trace(
    {
      configPath,
      bytesRead: Buffer.byteLength(content, 'utf8'),
    },
    'Read config file',
  );

  let parsedYaml: unknown;

  try {
    parsedYaml = parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in config.yaml: ${message}`);
  }

  const parsedConfig = appConfigSchema.safeParse(parsedYaml ?? {});
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const pathLabel = createIssuePathLabel(issue?.path ?? []);
    throw new Error(
      `Invalid config.yaml: ${pathLabel}${issue?.message ?? 'Invalid configuration'}`,
    );
  }

  validateConfiguredThemes(parsedConfig.data.themes);
  const customThemes = sanitizeConfiguredThemes(
    parsedConfig.data.themes,
    configPath,
  );
  const availableThemes = mergeThemes(customThemes);
  const config: AppConfig = {
    settings: {
      fallbackLanguage: parsedConfig.data.settings.fallback_language,
      language: parsedConfig.data.settings.language,
      title: parsedConfig.data.settings.title,
      weekStart: parsedConfig.data.settings.week_start,
      theme: normalizeConfiguredDefaultTheme(
        parsedConfig.data.settings.theme ?? parsedConfig.data.theme,
        availableThemes,
        configPath,
      ),
    },
    themes: availableThemes,
  };

  logger.info(
    {
      configPath,
      configuredThemes: Object.keys(customThemes).length,
    },
    'Loaded config',
  );

  return config;
}

export function loadThemesFromConfig(): ThemeMap {
  return loadConfig().themes;
}
