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
import { logger } from '../logger.ts';
import { readEnv } from './env.ts';
import {
  themes as builtInThemes,
  DEFAULT_THEME_NAME,
  getInvalidThemeReason,
  mergeThemes,
  type ThemeMap,
  themeSchema,
} from './themes.ts';

const CONFIG_FILE_NAME = 'config.yaml';
const DEFAULT_CONFIG_TEMPLATE = `# Application configuration
# Define optional runtime configuration here.
# Themes are available in addition to the built-in themes.
#
# Example:
# 
# settings:
#   theme: fuchsia
#   title: false
# 
# themes:
#   fuchsia:
#     light:
#       - "#eff2f5"
#       - "#fbb4b9"
#       - "#f768a1"
#       - "#c51b8a"
#       - "#7a0177"
#     dark:
#       - "#151b23"
#       - "#7a0177"
#       - "#c51b8a"
#       - "#f768a1"
#       - "#fbb4b9"

themes: {}
`;

const settingsSchema = z
  .object({
    theme: z.string().min(1).optional(),
    title: z.boolean().default(true),
  })
  .default({ title: true });

const appConfigSchema = z
  .object({
    theme: z.string().min(1).optional(),
    settings: settingsSchema,
    themes: z.record(z.string(), themeSchema).default({}),
  })
  .loose();

export type AppConfig = {
  settings: {
    theme?: string;
    title: boolean;
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
  const stats = statSync(configPath);

  return `${stats.mtimeMs}:${stats.size}`;
}

export function initConfig(): string {
  const configPath = resolveConfigPath();
  logger.trace({ configPath }, 'Resolved app config path');

  if (existsSync(configPath)) {
    logger.trace({ configPath }, 'Config file already exists');
    return configPath;
  }

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, DEFAULT_CONFIG_TEMPLATE, 'utf8');

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

    if (themeName in builtInThemes) {
      throw new Error(
        `Invalid config.yaml: themes.${themeName}: theme name conflicts with a built-in theme`,
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
        'Ignoring invalid custom theme from config.yaml',
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
      ...parsedConfig.data.settings,
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
