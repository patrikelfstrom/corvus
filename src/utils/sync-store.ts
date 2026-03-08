import { createHash } from 'node:crypto';
import { getDatabase, initDatabaseSchema } from '../server/db/index.ts';
import { logger } from '../server/logger.ts';
import type {
  NormalisedContribution,
  Provider,
  SyncStream,
} from '../server/providers.ts';

const INSERT_BATCH_SIZE = 100;
type SQLResult<T> = {
  rows?: T[] | undefined;
};
type SQLWriteResult = {
  changes?: number | undefined;
};

type SQLExecutor = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: Array<unknown>
) => Promise<T>;

interface IntegrationSyncCheckpointRow {
  last_successful_sync_started_at: string;
}

interface ContributionPersistenceDatabase {
  sql: SQLExecutor;
}

interface PersistedContributionRow {
  integrationId: string;
  provider: Provider;
  category: string;
  contributionType: string;
  occurredAt: string;
  dedupeKey: string;
  commitProjectionKey: string | null;
}

export async function ensureSyncDatabaseSchema(): Promise<void> {
  await initDatabaseSchema();
}

function getDatabaseConnection(): ReturnType<typeof getDatabase> {
  return getDatabase();
}

function toChangedRowCount(writeResult: SQLWriteResult): number {
  const value = writeResult.changes;
  if (typeof value !== 'number') {
    return 0;
  }

  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}

function chunkRows<T>(rows: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function hashContributionDedupeKey(
  provider: Provider,
  contributionType: string,
  dedupeKeyInput: string,
): string {
  const isCommitContribution = contributionType.startsWith('commit.');

  return createHash('sha256')
    .update(
      isCommitContribution
        ? [contributionType.trim(), dedupeKeyInput.trim()].join('\u001f')
        : [
            provider.trim(),
            contributionType.trim(),
            dedupeKeyInput.trim(),
          ].join('\u001f'),
    )
    .digest('hex');
}

function toPersistedContributionRows(
  integrationId: string,
  provider: Provider,
  contributions: Array<NormalisedContribution>,
): Array<PersistedContributionRow> {
  return contributions.map((contribution) => ({
    integrationId,
    provider,
    category: contribution.category,
    contributionType: contribution.contributionType,
    occurredAt: contribution.occurredAt,
    dedupeKey: hashContributionDedupeKey(
      provider,
      contribution.contributionType,
      contribution.dedupeKeyInput,
    ),
    commitProjectionKey:
      contribution.contributionType === 'commit.authored'
        ? contribution.dedupeKeyInput
        : null,
  }));
}

async function withTransaction<T>(
  db: ContributionPersistenceDatabase,
  work: () => Promise<T>,
): Promise<T> {
  let transactionOpen = false;

  await db.sql`BEGIN`;
  transactionOpen = true;

  try {
    const result = await work();
    await db.sql`COMMIT`;
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await db.sql`ROLLBACK`;
      } catch (rollbackError) {
        logger.error(
          { err: rollbackError },
          'Failed to rollback sync persistence transaction',
        );
      }
    }

    throw error;
  }
}

export async function fetchIntegrationLastSuccessfulSyncStartedAt(
  integrationId: string,
  stream: SyncStream,
): Promise<string | null> {
  await ensureSyncDatabaseSchema();
  const db = getDatabaseConnection();

  const result = await db.sql<SQLResult<IntegrationSyncCheckpointRow>>`
    SELECT last_successful_sync_started_at
    FROM integration_sync_checkpoints
    WHERE
      integration_id = ${integrationId}
      AND stream = ${stream}
    LIMIT 1
  `;

  return (result.rows ?? [])[0]?.last_successful_sync_started_at ?? null;
}

export async function persistIntegrationSyncCheckpoint(
  integrationId: string,
  stream: SyncStream,
  syncStartedAt: string,
): Promise<void> {
  await ensureSyncDatabaseSchema();
  const db = getDatabaseConnection();

  await db.sql`
    INSERT INTO integration_sync_checkpoints
      (
        integration_id,
        stream,
        last_successful_sync_started_at,
        updated_at
      )
    VALUES
      (
        ${integrationId},
        ${stream},
        ${syncStartedAt},
        datetime('now')
      )
    ON CONFLICT(integration_id, stream)
    DO UPDATE SET
      last_successful_sync_started_at = excluded.last_successful_sync_started_at,
      updated_at = excluded.updated_at
  `;
}

export async function persistIntegrationSyncRun(
  integrationId: string,
  stream: SyncStream,
  syncStartedAt: string,
  syncFinishedAt: string,
  fetchedCount: number,
  storedCount: number,
  failuresCaptured: number,
): Promise<void> {
  await ensureSyncDatabaseSchema();
  const db = getDatabaseConnection();

  await db.sql`
    INSERT INTO integration_sync_runs
      (
        integration_id,
        stream,
        sync_started_at,
        sync_finished_at,
        fetched_count,
        stored_count,
        failures_captured
      )
    VALUES
      (
        ${integrationId},
        ${stream},
        ${syncStartedAt},
        ${syncFinishedAt},
        ${fetchedCount},
        ${storedCount},
        ${failuresCaptured}
      )
  `;
}

export async function persistContributions(
  integrationId: string,
  provider: Provider,
  contributions: Array<NormalisedContribution>,
): Promise<{ contributionsStored: number; commitsStored: number }> {
  if (contributions.length === 0) {
    return {
      contributionsStored: 0,
      commitsStored: 0,
    };
  }

  await ensureSyncDatabaseSchema();
  const db = getDatabaseConnection();
  return persistContributionsWithDatabase(
    integrationId,
    provider,
    contributions,
    db as ContributionPersistenceDatabase,
  );
}

export async function persistContributionsWithDatabase(
  integrationId: string,
  provider: Provider,
  contributions: Array<NormalisedContribution>,
  db: ContributionPersistenceDatabase,
): Promise<{ contributionsStored: number; commitsStored: number }> {
  if (contributions.length === 0) {
    return {
      contributionsStored: 0,
      commitsStored: 0,
    };
  }

  const rows = toPersistedContributionRows(
    integrationId,
    provider,
    contributions,
  );
  const batches = chunkRows(rows, INSERT_BATCH_SIZE);

  logger.trace(
    {
      contributionsToPersist: rows.length,
      insertBatchSize: INSERT_BATCH_SIZE,
    },
    'Persisting contributions to sqlite',
  );

  return withTransaction(db, async () => {
    let contributionsStored = 0;
    let commitsStored = 0;

    for (const batch of batches) {
      for (const row of batch) {
        const contributionWriteResult = await db.sql<SQLWriteResult>`
          INSERT OR IGNORE INTO contributions
            (
              integration_id,
              provider,
              category,
              contribution_type,
              occurred_at,
              dedupe_key
            )
          VALUES
            (
              ${row.integrationId},
              ${row.provider},
              ${row.category},
              ${row.contributionType},
              ${row.occurredAt},
              ${row.dedupeKey}
            )
        `;
        const contributionInserted = toChangedRowCount(contributionWriteResult);
        contributionsStored += contributionInserted;

        if (row.contributionType !== 'commit.authored') {
          continue;
        }

        const commitWriteResult = await db.sql<SQLWriteResult>`
          INSERT OR IGNORE INTO commits
            (dedupe_key, authored_at)
          VALUES
            (${row.commitProjectionKey}, ${row.occurredAt})
        `;
        commitsStored += toChangedRowCount(commitWriteResult);
      }
    }

    logger.trace(
      {
        contributionsAttempted: rows.length,
        contributionsStored,
        commitsStored,
      },
      'Finished contribution persistence',
    );

    return {
      contributionsStored,
      commitsStored,
    };
  });
}
