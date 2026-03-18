import {
  defineEventHandler,
  getRouterParam,
  HTTPError,
  readBody,
  setResponseStatus,
} from 'h3';
import { runTask } from 'nitro/task';
import type { TaskPayload } from 'nitro/types';
import { z } from 'zod';
import { loadConfig } from '../config/config.ts';
import { readEnv } from '../config/env.ts';
import { loadIntegrationsFromConfig } from '../config/integrations-config.ts';
import {
  formatTranslation,
  resolveAppTranslation,
} from '../config/translations.ts';
import { resolveRequestedIntegrations } from '../sync/index.ts';
import { parseSyncIntegrationsTaskPayload } from '../tasks/sync-integrations-payload.ts';
import {
  getSyncStartedMessage,
  type SyncTriggerResult,
} from '../tasks/sync-trigger-coordinator.ts';
import { createSyncTaskResponse as buildSyncTaskResponse } from './internal-task-sync-response.ts';

const taskNameSchema = z.string().trim().min(1);
const taskPayloadSchema = z.record(z.string(), z.unknown());
const syncTriggerResultSchema = z.object({
  status: z.enum(['started', 'busy']),
  message: z.string().trim().min(1),
});

function isLoopbackAddress(address: string): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function parseSyncTriggerResult(taskResult: unknown): SyncTriggerResult {
  const config = loadConfig();
  const translation = resolveAppTranslation({
    fallbackLanguage: config.settings.fallbackLanguage,
    language: config.settings.language,
  });
  const parsed = z
    .object({
      result: syncTriggerResultSchema,
    })
    .safeParse(taskResult);

  if (!parsed.success) {
    throw new HTTPError({
      status: 500,
      message: translation.messages.tasks.errors.invalid_sync_response,
    });
  }

  return parsed.data.result;
}

export default defineEventHandler(async (event) => {
  const config = loadConfig();
  const translation = resolveAppTranslation({
    fallbackLanguage: config.settings.fallbackLanguage,
    language: config.settings.language,
  });
  const taskErrors = translation.messages.tasks.errors;
  const syncMessages = translation.messages.tasks.sync;
  const remoteAddress = event.req.ip;

  if (!remoteAddress || !isLoopbackAddress(remoteAddress)) {
    throw new HTTPError({
      status: 403,
      message: taskErrors.forbidden,
    });
  }

  const expectedToken = readEnv().CORVUS_TASK_TOKEN;

  if (expectedToken) {
    if (event.req.headers.get('x-corvus-token') !== expectedToken) {
      throw new HTTPError({
        status: 401,
        message: taskErrors.invalid_token,
      });
    }
  }

  const rawTaskName = getRouterParam(event, 'name');
  if (rawTaskName == null) {
    throw new HTTPError({
      status: 400,
      message: taskErrors.task_name_required,
    });
  }

  let decodedTaskName = rawTaskName;

  try {
    decodedTaskName = decodeURIComponent(rawTaskName);
  } catch {
    throw new HTTPError({
      status: 400,
      message: taskErrors.task_name_invalid,
    });
  }

  const parsedTaskName = taskNameSchema.safeParse(decodedTaskName);
  if (!parsedTaskName.success) {
    throw new HTTPError({
      status: 400,
      message:
        decodedTaskName.trim().length === 0
          ? taskErrors.task_name_required
          : taskErrors.task_name_invalid,
    });
  }

  const parsedPayload = taskPayloadSchema.safeParse(await readBody(event));
  if (!parsedPayload.success) {
    throw new HTTPError({
      status: 400,
      message: taskErrors.payload_must_be_object,
    });
  }

  const payload: TaskPayload = parsedPayload.data;

  if (parsedTaskName.data === 'sync:integrations') {
    let startedMessage = getSyncStartedMessage();

    try {
      const { integrationIds, ignoreDateScope } =
        parseSyncIntegrationsTaskPayload(payload);
      const triggerLabel =
        ignoreDateScope === true
          ? syncMessages.selection.full_history_label
          : ignoreDateScope === false
            ? syncMessages.selection.partial_label
            : syncMessages.selection.generic_label;

      if (integrationIds) {
        const selectedIntegrations = resolveRequestedIntegrations(
          loadIntegrationsFromConfig(),
          integrationIds,
        );
        const integrationLabel =
          selectedIntegrations.length === 1
            ? syncMessages.selection.integration_singular
            : syncMessages.selection.integration_plural;
        const selectedIds = selectedIntegrations
          .map((integration) => integration.id)
          .join(', ');

        startedMessage = formatTranslation(
          syncMessages.selection.triggered_for_selection,
          {
            count: selectedIntegrations.length,
            integrationLabel,
            selectedIds,
            triggerLabel,
          },
        );
      } else if (ignoreDateScope === true) {
        startedMessage = syncMessages.all_enabled_full_history;
      } else if (ignoreDateScope === false) {
        startedMessage = syncMessages.all_enabled_partial;
      }
    } catch (error) {
      throw new HTTPError({
        status: 400,
        message:
          error instanceof Error ? error.message : taskErrors.payload_invalid,
      });
    }

    const taskRunResult = await runTask(parsedTaskName.data, {
      payload,
      context: {
        trigger: 'corvus-cli',
      },
    });
    const triggerResult = parseSyncTriggerResult(taskRunResult);
    const response = buildSyncTaskResponse(
      parsedTaskName.data,
      startedMessage,
      triggerResult,
    );

    setResponseStatus(event, response.statusCode);
    return response.body;
  }

  return runTask(parsedTaskName.data, {
    payload,
    context: {
      trigger: 'corvus-cli',
    },
  });
});
