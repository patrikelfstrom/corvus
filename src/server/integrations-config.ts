import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { readEnv } from './env.ts';
import { logger } from './logger.ts';
import {
  getProviderManifestById,
  PROVIDERS,
  type ResolvedIntegration,
} from './providers/index.ts';

const CONFIG_FILE_NAME = 'integrations.yaml';
const SUPPORTED_PROVIDERS = PROVIDERS.join(', ');
const DEFAULT_INTEGRATIONS_CONFIG_TEMPLATE = `# Integration configuration
# Populate this file with one or more integrations.
#
# Supported providers: ${SUPPORTED_PROVIDERS}
#
# Example:
# integrations:
#   - id: github-main
#     provider: github
#     enabled: true
#     auth:
#       username: octocat
#       token: ghp_xxx
#     source:
#       base_url: https://api.github.com
#     filters:
#       author_include:
#         - octocat
#         - octo@example.com
#       repository_exclude:
#         - experimental
#   - id: local-work
#     provider: filepath
#     enabled: true
#     source:
#       path: /Users/example/projects
#       depth: 2
#     filters:
#       author_include:
#         - your.name@example.com
#       repository_exclude:
#         - archive

integrations: []
`;

const integrationDefinitionShellSchema = z
  .object({
    id: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    enabled: z.boolean().default(true),
  })
  .passthrough();

const integrationsConfigShellSchema = z
  .object({
    integrations: z.array(integrationDefinitionShellSchema).default([]),
  })
  .passthrough();

type ParsedIntegrationDefinitionShell = {
  id: string;
  provider: string;
  enabled: boolean;
  options: unknown;
};

function resolveConfigPath(configPath = readEnv().CONFIG_PATH): string {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  if (absolutePath.endsWith('.yaml') || absolutePath.endsWith('.yml')) {
    return absolutePath;
  }

  return path.join(absolutePath, CONFIG_FILE_NAME);
}

export function initIntegrationsConfig(): string {
  const configPath = resolveConfigPath();
  logger.trace({ configPath }, 'Resolved integrations config path');

  if (existsSync(configPath)) {
    logger.trace({ configPath }, 'Integrations config file already exists');
    return configPath;
  }

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, DEFAULT_INTEGRATIONS_CONFIG_TEMPLATE, 'utf8');

  logger.info({ configPath }, 'Created default integrations config file');

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

function parseConfigShell(
  content: string,
): Array<ParsedIntegrationDefinitionShell> {
  let parsedYaml: unknown;

  try {
    parsedYaml = parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in integrations.yaml: ${message}`);
  }

  const parsedConfig = integrationsConfigShellSchema.safeParse(
    parsedYaml ?? {},
  );
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const pathLabel = createIssuePathLabel(issue?.path ?? []);
    throw new Error(
      `Invalid integrations.yaml: ${pathLabel}${issue?.message ?? 'Invalid configuration'}`,
    );
  }

  return parsedConfig.data.integrations.map((integration) => {
    const { id, provider, enabled, ...options } = integration;

    return {
      id,
      provider,
      enabled,
      options,
    };
  });
}

function validateNoDuplicateIntegrationIds(
  rows: Array<ParsedIntegrationDefinitionShell>,
): void {
  const seenIds = new Set<string>();
  const duplicates = new Set<string>();

  for (const row of rows) {
    if (seenIds.has(row.id)) {
      duplicates.add(row.id);
      continue;
    }

    seenIds.add(row.id);
  }

  if (duplicates.size > 0) {
    const duplicateLabel = Array.from(duplicates).join(', ');
    throw new Error(
      `Invalid integrations.yaml: duplicate integration ids: ${duplicateLabel}`,
    );
  }
}

function normalizeIntegration(
  row: ParsedIntegrationDefinitionShell,
  rowIndex: number,
): ResolvedIntegration {
  const manifest = getProviderManifestById(row.provider);
  if (!manifest) {
    throw new Error(
      `Invalid integrations.yaml: integrations.${rowIndex}.provider: unknown provider "${row.provider}" (supported: ${SUPPORTED_PROVIDERS})`,
    );
  }

  const parsedOptions = manifest.optionsSchema.safeParse(row.options);
  if (!parsedOptions.success) {
    const issue = parsedOptions.error.issues[0];
    const optionPath =
      issue != null && issue.path.length > 0 ? `.${issue.path.join('.')}` : '';

    throw new Error(
      `Invalid integrations.yaml: integrations.${rowIndex}${optionPath}: ${issue?.message ?? 'Invalid options'}`,
    );
  }

  return manifest.normalizeIntegration({
    id: row.id,
    enabled: row.enabled,
    options: parsedOptions.data,
  });
}

export function loadIntegrationsFromConfig(): Array<ResolvedIntegration> {
  const configPath = initIntegrationsConfig();
  const content = readFileSync(configPath, 'utf8');
  logger.trace(
    {
      configPath,
      bytesRead: Buffer.byteLength(content, 'utf8'),
    },
    'Read integrations config file',
  );

  const rows = parseConfigShell(content);
  validateNoDuplicateIntegrationIds(rows);

  const integrations = rows.map((row, rowIndex) =>
    normalizeIntegration(row, rowIndex),
  );

  logger.info(
    {
      configPath,
      integrationsConfigured: integrations.length,
    },
    'Loaded integrations config',
  );

  return integrations;
}
