import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { readEnv } from '../env.ts';

const DEFAULT_DB_FILE = 'database.sqlite';
const LEGACY_DB_FILE = 'commits.sqlite';
const PROJECT_ROOT = process.cwd();

function isSpecialSqlitePath(dbPath: string): boolean {
  return dbPath === ':memory:' || dbPath.startsWith('file:');
}

function isLikelySqliteFilePath(targetPath: string): boolean {
  const extension = path.extname(targetPath).toLowerCase();
  return (
    extension === '.sqlite' || extension === '.sqlite3' || extension === '.db'
  );
}

export function resolveSqlitePath(configuredPath = readEnv().DB_PATH): string {
  if (isSpecialSqlitePath(configuredPath)) {
    return configuredPath;
  }

  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(PROJECT_ROOT, configuredPath);

  if (isLikelySqliteFilePath(absolutePath)) {
    return absolutePath;
  }

  return path.join(absolutePath, DEFAULT_DB_FILE);
}

export function ensureWritableSqlitePath(
  configuredPath = readEnv().DB_PATH,
): string {
  const dbPath = resolveSqlitePath(configuredPath);

  if (!isSpecialSqlitePath(dbPath)) {
    mkdirSync(path.dirname(dbPath), { recursive: true });

    if (!isLikelySqliteFilePath(configuredPath)) {
      const absoluteDirectory = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(PROJECT_ROOT, configuredPath);
      const legacyDbPath = path.join(absoluteDirectory, LEGACY_DB_FILE);

      if (!existsSync(dbPath) && existsSync(legacyDbPath)) {
        renameSync(legacyDbPath, dbPath);
      }
    }
  }

  return dbPath;
}
