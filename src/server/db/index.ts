import { useDatabase } from 'nitro/database';
import { logger } from '../logger.ts';
import { ensureWritableSqlitePath, resolveSqlitePath } from './sqlite-path.ts';

const databasePath = resolveSqlitePath();

let schemaReady = false;

type SQLResult<T> = {
  rows?: T[] | undefined;
};

interface TableInfoRow {
  name: string;
}

export function getDatabase() {
  return useDatabase();
}

async function listTableColumns(
  database: ReturnType<typeof getDatabase>,
  tableName: string,
): Promise<Set<string>> {
  const tableInfo = await database.sql<SQLResult<TableInfoRow>>`
    SELECT name
    FROM pragma_table_info(${tableName})
  `;

  return new Set((tableInfo.rows ?? []).map((row) => row.name));
}

async function migrateCommitsTable(
  database: ReturnType<typeof getDatabase>,
): Promise<void> {
  const existingColumns = await listTableColumns(database, 'commits');

  if (existingColumns.size === 0) {
    await database.sql`
      CREATE TABLE IF NOT EXISTS commits (
        dedupe_key TEXT NOT NULL PRIMARY KEY,
        authored_at TEXT NOT NULL
      )
    `;
    return;
  }

  if (
    existingColumns.has('dedupe_key') &&
    existingColumns.has('authored_at') &&
    existingColumns.size === 2
  ) {
    return;
  }

  await database.sql`DROP TABLE IF EXISTS commits_migrated`;
  await database.sql`
    CREATE TABLE commits_migrated (
      dedupe_key TEXT NOT NULL PRIMARY KEY,
      authored_at TEXT NOT NULL
    )
  `;

  if (existingColumns.has('dedupe_key') && existingColumns.has('authored_at')) {
    await database.sql`
      INSERT OR IGNORE INTO commits_migrated (dedupe_key, authored_at)
      SELECT dedupe_key, authored_at
      FROM commits
    `;
  } else if (existingColumns.has('sha') && existingColumns.has('authored_at')) {
    await database.sql`
      INSERT OR IGNORE INTO commits_migrated (dedupe_key, authored_at)
      SELECT sha, authored_at
      FROM commits
    `;
  }

  await database.sql`DROP TABLE IF EXISTS commits`;
  await database.sql`ALTER TABLE commits_migrated RENAME TO commits`;
}

async function ensureContributionsTable(
  database: ReturnType<typeof getDatabase>,
): Promise<void> {
  await database.sql`
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      contribution_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  await database.sql`
    CREATE INDEX IF NOT EXISTS contributions_integration_occurred_at_idx
    ON contributions (integration_id, occurred_at)
  `;

  await database.sql`
    CREATE INDEX IF NOT EXISTS contributions_category_occurred_at_idx
    ON contributions (category, occurred_at)
  `;
}

async function ensureIntegrationSyncCheckpointsTable(
  database: ReturnType<typeof getDatabase>,
): Promise<void> {
  await database.sql`
    CREATE TABLE IF NOT EXISTS integration_sync_checkpoints (
      integration_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      last_successful_sync_started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (integration_id, stream)
    )
  `;
}

async function ensureIntegrationSyncRunsTable(
  database: ReturnType<typeof getDatabase>,
): Promise<void> {
  const existingColumns = await listTableColumns(
    database,
    'integration_sync_runs',
  );

  if (
    existingColumns.size > 0 &&
    (!existingColumns.has('stream') || !existingColumns.has('fetched_count'))
  ) {
    await database.sql`DROP TABLE IF EXISTS integration_sync_runs_migrated`;
    await database.sql`
      CREATE TABLE integration_sync_runs_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration_id TEXT NOT NULL,
        stream TEXT NOT NULL,
        sync_started_at TEXT NOT NULL,
        sync_finished_at TEXT NOT NULL,
        fetched_count INTEGER NOT NULL,
        stored_count INTEGER NOT NULL,
        failures_captured INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `;

    if (
      existingColumns.has('integration_id') &&
      existingColumns.has('sync_started_at') &&
      existingColumns.has('sync_finished_at') &&
      existingColumns.has('commits_synced') &&
      existingColumns.has('failures_captured')
    ) {
      await database.sql`
        INSERT INTO integration_sync_runs_migrated
          (
            integration_id,
            stream,
            sync_started_at,
            sync_finished_at,
            fetched_count,
            stored_count,
            failures_captured
          )
        SELECT
          integration_id,
          'commits',
          sync_started_at,
          sync_finished_at,
          commits_synced,
          commits_synced,
          failures_captured
        FROM integration_sync_runs
      `;

      await database.sql`
        INSERT INTO integration_sync_checkpoints
          (
            integration_id,
            stream,
            last_successful_sync_started_at,
            updated_at
          )
        SELECT
          integration_id,
          'commits',
          MAX(sync_started_at),
          datetime('now')
        FROM integration_sync_runs
        WHERE failures_captured = 0
        GROUP BY integration_id
        ON CONFLICT(integration_id, stream)
        DO UPDATE SET
          last_successful_sync_started_at = excluded.last_successful_sync_started_at,
          updated_at = excluded.updated_at
      `;
    }

    await database.sql`DROP TABLE IF EXISTS integration_sync_runs`;
    await database.sql`
      ALTER TABLE integration_sync_runs_migrated RENAME TO integration_sync_runs
    `;
  }

  await database.sql`
    CREATE TABLE IF NOT EXISTS integration_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      stream TEXT NOT NULL,
      sync_started_at TEXT NOT NULL,
      sync_finished_at TEXT NOT NULL,
      fetched_count INTEGER NOT NULL,
      stored_count INTEGER NOT NULL,
      failures_captured INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  await database.sql`
    CREATE INDEX IF NOT EXISTS integration_sync_runs_latest_idx
    ON integration_sync_runs (
      integration_id,
      stream,
      sync_started_at DESC,
      id DESC
    )
  `;

  await database.sql`
    CREATE INDEX IF NOT EXISTS integration_sync_runs_started_at_idx
    ON integration_sync_runs (sync_started_at DESC, id DESC)
  `;
}

export async function initDatabaseSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  ensureWritableSqlitePath();

  const database = getDatabase();

  await migrateCommitsTable(database);

  await database.sql`
    CREATE INDEX IF NOT EXISTS commits_authored_at_idx
    ON commits (authored_at)
  `;

  await ensureContributionsTable(database);
  await ensureIntegrationSyncCheckpointsTable(database);
  await ensureIntegrationSyncRunsTable(database);

  schemaReady = true;
  logger.info({ databasePath }, 'Initialized database schema');
}
