import type { TaskPayload } from 'nitro/types';
import { z } from 'zod';
import type { SyncExecutionOptions } from '../sync/index.ts';

const syncIntegrationsTaskPayloadSchema = z
  .object({
    integrationIds: z.array(z.string().trim().min(1)).optional(),
    ignoreDateScope: z.boolean().optional(),
  })
  .loose();

export interface SyncIntegrationsTaskPayload extends SyncExecutionOptions {
  integrationIds?: Array<string>;
}

export function parseSyncIntegrationsTaskPayload(
  payload: TaskPayload | null | undefined,
): SyncIntegrationsTaskPayload {
  const parsedPayload = syncIntegrationsTaskPayloadSchema.safeParse(
    payload ?? {},
  );

  if (!parsedPayload.success) {
    const issue = parsedPayload.error.issues[0];
    const pathLabel =
      issue != null && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';

    throw new Error(
      `Invalid sync task payload: ${pathLabel}${issue?.message ?? 'Invalid payload'}`,
    );
  }

  const integrationIds =
    parsedPayload.data.integrationIds?.filter((id) => id.length > 0) ?? [];
  const hasIgnoreDateScope = Object.hasOwn(
    parsedPayload.data,
    'ignoreDateScope',
  );

  return {
    ...(integrationIds.length > 0 ? { integrationIds } : {}),
    ...(hasIgnoreDateScope
      ? { ignoreDateScope: parsedPayload.data.ignoreDateScope }
      : {}),
  };
}
