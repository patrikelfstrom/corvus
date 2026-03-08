import { loadIntegrationsFromConfig } from '../server/integrations-config.ts';
import { logger } from '../server/logger.ts';
import type { ResolvedIntegration } from '../server/providers/index.ts';
import type {
  Provider,
  SyncFetchFailure,
  SyncStream,
} from '../server/providers.ts';
import { fetchContributionStreamForProvider } from '../server/providers.ts';
import { parseSyncFailureError } from '../server/sync-failure.ts';
import { resolveRequestedIntegrations } from './sync-selection.ts';
import {
  ensureSyncDatabaseSchema,
  fetchIntegrationLastSuccessfulSyncStartedAt,
  persistContributions,
  persistIntegrationSyncCheckpoint,
  persistIntegrationSyncRun,
} from './sync-store.ts';

const SYNC_STREAMS = [
  'commits',
  'issues',
  'pull_requests',
] as const satisfies ReadonlyArray<SyncStream>;

interface SyncResult {
  username: string;
  contributionsFetched: number;
  contributionsStored: number;
  commitsStored: number;
  failuresCaptured: number;
  failures: Array<SyncFetchFailure>;
}

interface RunIntegrationSyncResult {
  error: string | null;
  result: SyncResult | null;
}

export interface SyncExecutionOptions {
  ignoreDateScope?: boolean;
}

interface IntegrationSyncRun {
  integrationId: string;
  provider: Provider;
  username: string;
  contributionsFetched: number;
  contributionsStored: number;
  commitsStored: number;
  failuresCaptured: number;
  failures: Array<SyncFetchFailure>;
  error: string | null;
}

export interface SyncAllIntegrationsResult {
  totalIntegrations: number;
  successfulCount: number;
  failedCount: number;
  runs: Array<IntegrationSyncRun>;
}

interface SyncStartProgressEvent {
  type: 'sync-started';
  integrationsConfigured: number;
  integrationsEnabled: number;
  integrationsDisabled: number;
}

interface IntegrationStartedProgressEvent {
  type: 'integration-started';
  integrationId: string;
  provider: Provider;
  username: string;
}

interface IntegrationFailureProgressEvent {
  type: 'integration-failure';
  integrationId: string;
  provider: Provider;
  username: string;
  failure: SyncFetchFailure;
}

interface IntegrationCompletedProgressEvent {
  type: 'integration-completed';
  integrationId: string;
  provider: Provider;
  username: string;
  contributionsFetched: number;
  contributionsStored: number;
  commitsStored: number;
  failuresCaptured: number;
  error: string | null;
}

interface SyncCompletedProgressEvent {
  type: 'sync-completed';
  totalIntegrations: number;
  successfulCount: number;
  failedCount: number;
}

export type SyncProgressEvent =
  | SyncStartProgressEvent
  | IntegrationStartedProgressEvent
  | IntegrationFailureProgressEvent
  | IntegrationCompletedProgressEvent
  | SyncCompletedProgressEvent;

export type SyncProgressReporter = (
  event: SyncProgressEvent,
) => void | Promise<void>;

type IntegrationSyncExecutor = (
  integration: ResolvedIntegration,
  options?: SyncExecutionOptions,
) => Promise<RunIntegrationSyncResult>;

export { resolveRequestedIntegrations };

async function reportSyncProgress(
  onProgress: SyncProgressReporter | undefined,
  event: SyncProgressEvent,
): Promise<void> {
  if (!onProgress) {
    return;
  }

  await onProgress(event);
}

function createPartialFailureErrorMessage(
  provider: Provider,
  failuresCaptured: number,
): string | null {
  if (failuresCaptured <= 0) {
    return null;
  }

  const label = failuresCaptured === 1 ? 'failure' : 'failures';
  return `Encountered ${failuresCaptured} ${provider} fetch ${label}`;
}

async function runIntegrationSync(
  integration: ResolvedIntegration,
  options: SyncExecutionOptions = {},
): Promise<RunIntegrationSyncResult> {
  await ensureSyncDatabaseSchema();
  const integrationId = integration.id;
  const { provider, fetchOptions } = integration;
  const failures: Array<SyncFetchFailure> = [];
  let contributionsFetched = 0;
  let contributionsStored = 0;
  let commitsStored = 0;

  try {
    const {
      username,
      match_author: matchAuthor,
      blacklist,
      url,
      path,
      depth,
    } = fetchOptions;

    logger.info(
      {
        integrationId,
        provider,
        username,
        hasUrl: url != null,
        hasPath: path != null,
        depth,
        hasCustomMatchers: matchAuthor.some(
          (matcher) =>
            matcher.trim().toLowerCase() !== username.trim().toLowerCase(),
        ),
        blacklistMatchers: blacklist.length,
        ignoreDateScope: options.ignoreDateScope === true,
      },
      'Starting contribution sync',
    );

    for (const stream of SYNC_STREAMS) {
      const lastSyncStartedAt = options.ignoreDateScope
        ? null
        : await fetchIntegrationLastSuccessfulSyncStartedAt(
            integrationId,
            stream,
          );
      const streamStartedAtIso = new Date().toISOString();

      logger.info(
        {
          integrationId,
          provider,
          stream,
          username,
          lastSyncStartedAt,
        },
        'Starting contribution stream sync',
      );

      try {
        const streamResult = await fetchContributionStreamForProvider({
          provider,
          fetchOptions,
          stream,
          since: lastSyncStartedAt ?? undefined,
        });

        if (!streamResult.supported) {
          logger.info(
            {
              integrationId,
              provider,
              stream,
            },
            'Skipping unsupported contribution stream',
          );
          continue;
        }

        const persisted = await persistContributions(
          integrationId,
          provider,
          streamResult.contributions,
        );

        contributionsFetched += streamResult.contributions.length;
        contributionsStored += persisted.contributionsStored;
        commitsStored += persisted.commitsStored;
        failures.push(...streamResult.failures);

        await persistIntegrationSyncRun(
          integrationId,
          stream,
          streamStartedAtIso,
          new Date().toISOString(),
          streamResult.contributions.length,
          persisted.contributionsStored,
          streamResult.failures.length,
        );

        if (streamResult.failures.length === 0) {
          await persistIntegrationSyncCheckpoint(
            integrationId,
            stream,
            streamStartedAtIso,
          );
        }
      } catch (error) {
        const parsedError = parseSyncFailureError(error);
        const failure: SyncFetchFailure = {
          provider,
          targetType: 'sync',
          targetName: stream,
          repositoryFullName: null,
          commitHash: parsedError.commitHash,
          statusCode: parsedError.statusCode,
          message: parsedError.message,
        };
        failures.push(failure);

        await persistIntegrationSyncRun(
          integrationId,
          stream,
          streamStartedAtIso,
          new Date().toISOString(),
          0,
          0,
          1,
        );
      }
    }

    const partialFailureError = createPartialFailureErrorMessage(
      provider,
      failures.length,
    );
    if (partialFailureError) {
      logger.warn(
        {
          integrationId,
          provider,
          username: fetchOptions.username,
          failuresCaptured: failures.length,
          sampleFailure: failures[0]?.message,
          sampleFailureTargetType: failures[0]?.targetType,
          sampleFailureTargetName: failures[0]?.targetName,
        },
        'Contribution sync completed with provider-level fetch failures',
      );
    }

    return {
      error: partialFailureError,
      result: {
        username: fetchOptions.username,
        contributionsFetched,
        contributionsStored,
        commitsStored,
        failuresCaptured: failures.length,
        failures,
      },
    };
  } catch (error) {
    logger.error(
      { integrationId, err: error },
      'Contribution sync failed unexpectedly',
    );

    return {
      error: parseSyncFailureError(error).message,
      result: {
        username: fetchOptions.username,
        contributionsFetched,
        contributionsStored,
        commitsStored,
        failuresCaptured: failures.length,
        failures,
      },
    };
  }
}

export async function runConfiguredIntegrationsSyncs(
  configuredIntegrations: Array<ResolvedIntegration>,
  runIntegration: IntegrationSyncExecutor = runIntegrationSync,
  onProgress?: SyncProgressReporter,
  options: SyncExecutionOptions = {},
): Promise<SyncAllIntegrationsResult> {
  const integrations = configuredIntegrations.filter(
    (integration) => integration.enabled,
  );
  const runs: Array<IntegrationSyncRun> = [];

  logger.info(
    {
      integrationsConfigured: configuredIntegrations.length,
      integrationsEnabled: integrations.length,
      integrationsDisabled: configuredIntegrations.length - integrations.length,
    },
    'Starting sync for enabled integrations',
  );
  await reportSyncProgress(onProgress, {
    type: 'sync-started',
    integrationsConfigured: configuredIntegrations.length,
    integrationsEnabled: integrations.length,
    integrationsDisabled: configuredIntegrations.length - integrations.length,
  });

  for (const integration of integrations) {
    await reportSyncProgress(onProgress, {
      type: 'integration-started',
      integrationId: integration.id,
      provider: integration.provider,
      username: integration.fetchOptions.username,
    });

    const syncResponse = await runIntegration(integration, options);

    const run = {
      integrationId: integration.id,
      provider: integration.provider,
      username: integration.fetchOptions.username,
      contributionsFetched: syncResponse.result?.contributionsFetched ?? 0,
      contributionsStored: syncResponse.result?.contributionsStored ?? 0,
      commitsStored: syncResponse.result?.commitsStored ?? 0,
      failuresCaptured: syncResponse.result?.failuresCaptured ?? 0,
      failures: syncResponse.result?.failures ?? [],
      error: syncResponse.error,
    } satisfies IntegrationSyncRun;
    runs.push(run);

    for (const failure of run.failures) {
      await reportSyncProgress(onProgress, {
        type: 'integration-failure',
        integrationId: run.integrationId,
        provider: run.provider,
        username: run.username,
        failure,
      });
    }

    await reportSyncProgress(onProgress, {
      type: 'integration-completed',
      integrationId: run.integrationId,
      provider: run.provider,
      username: run.username,
      contributionsFetched: run.contributionsFetched,
      contributionsStored: run.contributionsStored,
      commitsStored: run.commitsStored,
      failuresCaptured: run.failuresCaptured,
      error: run.error,
    });
  }

  const failedCount = runs.filter((run) => run.error !== null).length;

  logger.info(
    {
      totalIntegrations: runs.length,
      successfulCount: runs.length - failedCount,
      failedCount,
    },
    'Completed sync for all configured integrations',
  );
  await reportSyncProgress(onProgress, {
    type: 'sync-completed',
    totalIntegrations: runs.length,
    successfulCount: runs.length - failedCount,
    failedCount,
  });

  return {
    totalIntegrations: runs.length,
    successfulCount: runs.length - failedCount,
    failedCount,
    runs,
  };
}

export async function runAllIntegrationsSyncs(
  onProgress?: SyncProgressReporter,
  options: SyncExecutionOptions = {},
): Promise<SyncAllIntegrationsResult> {
  const configuredIntegrations = loadIntegrationsFromConfig();
  return runConfiguredIntegrationsSyncs(
    configuredIntegrations,
    runIntegrationSync,
    onProgress,
    options,
  );
}
