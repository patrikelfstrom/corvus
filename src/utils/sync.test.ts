import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ResolvedIntegration } from '../server/providers/index.ts';
import {
  resolveRequestedIntegrations,
  runAllIntegrationsSyncs,
  runConfiguredIntegrationsSyncs,
  type SyncProgressEvent,
} from './sync.ts';

async function withTempConfig(
  content: string,
  callback: (configPath: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'corvus-sync-test-'));
  const configPath = path.join(directory, 'integrations.yaml');
  const previousConfigPath = process.env.CONFIG_PATH;

  writeFileSync(configPath, content, 'utf8');
  process.env.CONFIG_PATH = configPath;

  try {
    await callback(configPath);
  } finally {
    if (previousConfigPath == null) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = previousConfigPath;
    }

    rmSync(directory, { recursive: true, force: true });
  }
}

test('runAllIntegrationsSyncs skips integrations where enabled is false', async () => {
  await withTempConfig(
    `integrations:
  - id: disabled-integration
    provider: github
    enabled: false
    auth:
      username: disabled-user
      token: token-disabled
`,
    async () => {
      const summary = await runAllIntegrationsSyncs();

      assert.deepEqual(summary, {
        totalIntegrations: 0,
        successfulCount: 0,
        failedCount: 0,
        runs: [],
      });
    },
  );
});

test('runAllIntegrationsSyncs reloads config on each run', async () => {
  await withTempConfig(
    `integrations:
  - id: initially-disabled
    provider: github
    enabled: false
    auth:
      username: initial-disabled-user
      token: token-initial
`,
    async (configPath) => {
      const firstSummary = await runAllIntegrationsSyncs();
      assert.deepEqual(firstSummary, {
        totalIntegrations: 0,
        successfulCount: 0,
        failedCount: 0,
        runs: [],
      });

      writeFileSync(
        configPath,
        `integrations:
  - id: invalid-token
    provider: github
    auth:
      username: enabled-user
      token: "   "
`,
        'utf8',
      );

      await assert.rejects(runAllIntegrationsSyncs(), {
        message: /token/i,
      });
    },
  );
});

function makeIntegration(id: string, enabled: boolean): ResolvedIntegration {
  return {
    id,
    provider: 'github',
    enabled,
    fetchOptions: {
      username: `${id}-user`,
      token: `${id}-token`,
      match_author: [`${id}-user`],
      blacklist: [],
    },
  };
}

test('resolveRequestedIntegrations returns requested enabled integrations in request order', () => {
  const configuredIntegrations = [
    makeIntegration('github-main', true),
    makeIntegration('gitlab-main', true),
    makeIntegration('other', true),
  ];

  const selectedIntegrations = resolveRequestedIntegrations(
    configuredIntegrations,
    ['gitlab-main', 'github-main', 'gitlab-main'],
  );

  assert.deepEqual(
    selectedIntegrations.map((integration) => integration.id),
    ['gitlab-main', 'github-main'],
  );
});

test('resolveRequestedIntegrations rejects unknown and disabled integrations', () => {
  const configuredIntegrations = [
    makeIntegration('github-main', true),
    makeIntegration('gitlab-main', false),
  ];

  assert.throws(
    () =>
      resolveRequestedIntegrations(configuredIntegrations, [
        'github-main',
        'gitlab-main',
        'missing',
      ]),
    {
      message:
        /Cannot sync requested integrations; unknown integration ids: missing; disabled integration ids: gitlab-main/i,
    },
  );
});

test('resolveRequestedIntegrations rejects duplicate configured ids for requested integrations', () => {
  const configuredIntegrations = [
    makeIntegration('github-main', true),
    makeIntegration('github-main', true),
  ];

  assert.throws(() =>
    resolveRequestedIntegrations(configuredIntegrations, ['github-main']),
  );
});

test('runConfiguredIntegrationsSyncs counts partial provider failures as failed runs', async () => {
  const configuredIntegrations = [
    makeIntegration('healthy', true),
    makeIntegration('partial-failure', true),
    makeIntegration('disabled', false),
  ];

  const summary = await runConfiguredIntegrationsSyncs(
    configuredIntegrations,
    async (integration) => {
      if (integration.id === 'healthy') {
        return {
          error: null,
          result: {
            username: integration.fetchOptions.username,
            contributionsFetched: 6,
            contributionsStored: 6,
            commitsStored: 4,
            failuresCaptured: 0,
            failures: [],
          },
        };
      }

      if (integration.id === 'partial-failure') {
        return {
          error: 'Encountered 2 github fetch failures',
          result: {
            username: integration.fetchOptions.username,
            contributionsFetched: 10,
            contributionsStored: 8,
            commitsStored: 5,
            failuresCaptured: 2,
            failures: [
              {
                provider: 'github',
                targetType: 'repository',
                targetName: 'owner/repo-a',
                repositoryFullName: 'owner/repo-a',
                commitHash: null,
                statusCode: 403,
                message: 'Rate limited',
              },
              {
                provider: 'github',
                targetType: 'repository',
                targetName: 'owner/repo-b',
                repositoryFullName: 'owner/repo-b',
                commitHash: 'abc123',
                statusCode: 404,
                message: 'Not found',
              },
            ],
          },
        };
      }

      return {
        error: null,
        result: null,
      };
    },
  );

  assert.deepEqual(summary, {
    totalIntegrations: 2,
    successfulCount: 1,
    failedCount: 1,
    runs: [
      {
        integrationId: 'healthy',
        provider: 'github',
        username: 'healthy-user',
        contributionsFetched: 6,
        contributionsStored: 6,
        commitsStored: 4,
        failuresCaptured: 0,
        failures: [],
        error: null,
      },
      {
        integrationId: 'partial-failure',
        provider: 'github',
        username: 'partial-failure-user',
        contributionsFetched: 10,
        contributionsStored: 8,
        commitsStored: 5,
        failuresCaptured: 2,
        failures: [
          {
            provider: 'github',
            targetType: 'repository',
            targetName: 'owner/repo-a',
            repositoryFullName: 'owner/repo-a',
            commitHash: null,
            statusCode: 403,
            message: 'Rate limited',
          },
          {
            provider: 'github',
            targetType: 'repository',
            targetName: 'owner/repo-b',
            repositoryFullName: 'owner/repo-b',
            commitHash: 'abc123',
            statusCode: 404,
            message: 'Not found',
          },
        ],
        error: 'Encountered 2 github fetch failures',
      },
    ],
  });
});

test('runConfiguredIntegrationsSyncs emits progress events while syncing', async () => {
  const configuredIntegrations = [
    makeIntegration('healthy', true),
    makeIntegration('partial-failure', true),
    makeIntegration('disabled', false),
  ];

  const events: Array<SyncProgressEvent> = [];

  await runConfiguredIntegrationsSyncs(
    configuredIntegrations,
    async (integration) => {
      if (integration.id === 'healthy') {
        return {
          error: null,
          result: {
            username: integration.fetchOptions.username,
            contributionsFetched: 6,
            contributionsStored: 6,
            commitsStored: 4,
            failuresCaptured: 0,
            failures: [],
          },
        };
      }

      return {
        error: 'Encountered 1 github fetch failure',
        result: {
          username: integration.fetchOptions.username,
          contributionsFetched: 3,
          contributionsStored: 2,
          commitsStored: 1,
          failuresCaptured: 1,
          failures: [
            {
              provider: 'github',
              targetType: 'repository',
              targetName: 'owner/repo-a',
              repositoryFullName: 'owner/repo-a',
              commitHash: null,
              statusCode: 403,
              message: 'Rate limited',
            },
          ],
        },
      };
    },
    (event) => {
      events.push(event);
    },
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'sync-started',
      'integration-started',
      'integration-completed',
      'integration-started',
      'integration-failure',
      'integration-completed',
      'sync-completed',
    ],
  );
});

test('runConfiguredIntegrationsSyncs forwards ignoreDateScope to each integration run', async () => {
  const configuredIntegrations = [
    makeIntegration('github-main', true),
    makeIntegration('disabled', false),
  ];
  const receivedOptions: Array<boolean> = [];

  const summary = await runConfiguredIntegrationsSyncs(
    configuredIntegrations,
    async (integration, options) => {
      receivedOptions.push(options?.ignoreDateScope === true);

      return {
        error: null,
        result: {
          username: integration.fetchOptions.username,
          contributionsFetched: 2,
          contributionsStored: 2,
          commitsStored: 1,
          failuresCaptured: 0,
          failures: [],
        },
      };
    },
    undefined,
    { ignoreDateScope: true },
  );

  assert.equal(summary.totalIntegrations, 1);
  assert.deepEqual(receivedOptions, [true]);
});
