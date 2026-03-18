import { stringify as stringifyYaml } from 'yaml';
import { DEFAULT_THEME_NAME, themes } from './themes.ts';

const DEFAULT_CONFIG_TEMPLATE_CONTENT = {
  settings: {
    fallback_language: 'en',
    language: 'auto',
    theme: DEFAULT_THEME_NAME,
    title: true,
    week_start: 'sunday',
  },
  themes,
};

const DEFAULT_INTEGRATIONS_TEMPLATE = `# Integration configuration
# Populate this file with one or more integrations.
#
# Supported providers: \${SUPPORTED_PROVIDERS}
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

const DEFAULT_TRANSLATION_TEMPLATE = `# Translation strings

calendar:
  aria:
    weekday_labels: weekday labels
    month_labels: month labels
    legend: legend
  legend:
    less: Less
    more: More
  contribution:
    none_on_date: "No contributions on {date}."
    singular_on_date: "{count} contribution on {date}."
    plural_on_date: "{count} contributions on {date}."
  swatch:
    singular: "{count} contribution"
    plural: "{count} contributions"
    overflow: "{count}+ contributions"
  summary:
    last_year_singular: "{count} contribution in the last year"
    last_year_plural: "{count} contributions in the last year"
`;

export function getDefaultConfigTemplate(): string {
  return stringifyYaml(DEFAULT_CONFIG_TEMPLATE_CONTENT);
}

export function getDefaultIntegrationsTemplate(
  supportedProviders: string,
): string {
  return DEFAULT_INTEGRATIONS_TEMPLATE.replace(
    /\$\{SUPPORTED_PROVIDERS\}/,
    supportedProviders,
  );
}

export function getDefaultTranslationTemplate(): string {
  return DEFAULT_TRANSLATION_TEMPLATE;
}
