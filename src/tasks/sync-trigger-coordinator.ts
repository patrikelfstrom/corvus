import { loadConfig } from '../config/config.ts';
import { loadIntegrationsFromConfig } from '../config/integrations-config.ts';
import { resolveAppTranslation } from '../config/translations.ts';
import { logger } from '../logger.ts';
import {
  resolveRequestedIntegrations,
  runAllIntegrationsSyncs,
  runConfiguredIntegrationsSyncs,
  type SyncAllIntegrationsResult,
} from '../sync/index.ts';
import type { SyncIntegrationsTaskPayload } from './sync-integrations-payload.ts';

export type SyncTriggerSource = 'manual' | 'scheduled';

export interface SyncTriggerResult {
  status: 'started' | 'busy';
  message: string;
}

interface TriggerIntegrationsSyncOptions extends SyncIntegrationsTaskPayload {
  source: SyncTriggerSource;
  executeSync?: SyncExecutor;
}

type SyncExecutor = (
  payload: SyncIntegrationsTaskPayload,
) => Promise<SyncAllIntegrationsResult>;

let activeSyncRun: Promise<SyncAllIntegrationsResult> | null = null;

function getSyncMessages() {
  const config = loadConfig();

  return resolveAppTranslation({
    fallbackLanguage: config.settings.fallbackLanguage,
    language: config.settings.language,
  }).messages.tasks.sync;
}

export function getManualSyncBusyMessage(): string {
  return getSyncMessages().manual_busy;
}

export function getScheduledSyncBusyMessage(): string {
  return getSyncMessages().scheduled_busy;
}

export function getSyncStartedMessage(): string {
  return getSyncMessages().started;
}

async function executeSync(
  payload: SyncIntegrationsTaskPayload,
): Promise<SyncAllIntegrationsResult> {
  const { integrationIds, ignoreDateScope } = payload;

  return integrationIds
    ? runConfiguredIntegrationsSyncs(
        resolveRequestedIntegrations(
          loadIntegrationsFromConfig(),
          integrationIds,
        ),
        undefined,
        undefined,
        { ignoreDateScope },
      )
    : runAllIntegrationsSyncs(undefined, { ignoreDateScope });
}

function startSyncRun(
  source: SyncTriggerSource,
  payload: SyncIntegrationsTaskPayload,
  runSync: SyncExecutor,
): void {
  const startedAt = Date.now();

  logger.info(
    {
      source,
      integrationIds: payload.integrationIds,
      ignoreDateScope: payload.ignoreDateScope === true,
    },
    'Starting integrations sync',
  );

  const inFlightRun = Promise.resolve()
    .then(() => runSync(payload))
    .then((summary) => {
      logger.info(
        {
          source,
          totalIntegrations: summary.totalIntegrations,
          successfulCount: summary.successfulCount,
          failedCount: summary.failedCount,
          durationMs: Date.now() - startedAt,
        },
        'Integrations sync finished',
      );
      return summary;
    })
    .catch((error) => {
      logger.error(
        {
          source,
          durationMs: Date.now() - startedAt,
          err: error,
        },
        'Integrations sync failed unexpectedly',
      );
      throw error;
    })
    .finally(() => {
      activeSyncRun = null;
    });

  activeSyncRun = inFlightRun;
  void inFlightRun.catch(() => {
    // The failure has already been logged above.
  });
}

export async function triggerIntegrationsSync(
  options: TriggerIntegrationsSyncOptions,
): Promise<SyncTriggerResult> {
  const { source, executeSync: executeSyncOverride, ...payload } = options;
  const runSync = executeSyncOverride ?? executeSync;

  if (activeSyncRun) {
    if (source === 'scheduled') {
      const scheduledBusyMessage = getScheduledSyncBusyMessage();
      logger.warn(scheduledBusyMessage);
      return {
        status: 'busy',
        message: scheduledBusyMessage,
      };
    }

    return {
      status: 'busy',
      message: getManualSyncBusyMessage(),
    };
  }

  startSyncRun(source, payload, runSync);

  return {
    status: 'started',
    message: getSyncStartedMessage(),
  };
}

export function resetSyncTriggerCoordinatorForTests(): void {
  activeSyncRun = null;
}

export function isSyncActive(): boolean {
  return activeSyncRun !== null;
}
