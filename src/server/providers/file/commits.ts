import { spawn } from 'node:child_process';
import { logger } from '../../logger.ts';
import type { ProviderFailure } from '../types.ts';
import type { DiscoveredGitRepository } from './scan.ts';

const FIELD_SEPARATOR = '\u001f';
const RECORD_SEPARATOR = '\u001e';
const GIT_LOG_FORMAT = `%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`;

export interface LocalRepositoryCommit {
  sha: string;
  repositoryFullName: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  message: string;
}

export type GitCommandRunner = (
  repositoryPath: string,
  args: Array<string>,
) => Promise<string>;

export interface FetchLocalRepositoryCommitsOptions {
  repositories: Array<DiscoveredGitRepository>;
  since?: string;
  onFailure?(failure: ProviderFailure): void;
  runGitCommand?: GitCommandRunner;
}

function emitFailure(
  onFailure: ((failure: ProviderFailure) => void) | undefined,
  failure: ProviderFailure,
): void {
  logger.warn(
    {
      targetName: failure.targetName,
      repositoryFullName: failure.repositoryFullName,
      message: failure.message,
    },
    'Local repository commit fetch failure',
  );
  onFailure?.(failure);
}

let gitAvailabilityPromise: Promise<void> | null = null;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return String(error);
}

export function buildGitLogArgs(since?: string): Array<string> {
  const args = ['log', '--all', `--format=${GIT_LOG_FORMAT}`];

  if (since) {
    args.push(`--since=${since}`);
  }

  return args;
}

export function parseGitLogOutput(
  output: string,
  repositoryFullName: string,
): Array<LocalRepositoryCommit> {
  const commits: Array<LocalRepositoryCommit> = [];
  const seenShas = new Set<string>();

  for (const rawRecord of output.split(RECORD_SEPARATOR)) {
    const record = rawRecord.trim();
    if (record.length === 0) {
      continue;
    }

    const [sha, authorName, authorEmail, authoredAt, message = ''] =
      record.split(FIELD_SEPARATOR, 5);

    if (
      !sha ||
      !authorName ||
      !authorEmail ||
      !authoredAt ||
      seenShas.has(sha)
    ) {
      continue;
    }

    seenShas.add(sha);
    commits.push({
      sha,
      repositoryFullName,
      authorName,
      authorEmail,
      authoredAt,
      message,
    });
  }

  return commits;
}

export async function runGitCommand(
  repositoryPath: string,
  args: Array<string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(
      'git',
      ['-c', `safe.directory=${repositoryPath}`, '-C', repositoryPath, ...args],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    childProcess.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    childProcess.on('error', (error) => {
      reject(
        new Error(
          `Failed to execute git for "${repositoryPath}": ${formatErrorMessage(error)}`,
        ),
      );
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const details = stderr.trim();
      reject(
        new Error(
          details.length > 0
            ? details
            : `git log failed for "${repositoryPath}" with exit code ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

function checkGitAvailability(): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('git', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';

    childProcess.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    childProcess.on('error', (error) => {
      reject(
        new Error(
          `Git executable is not available: ${formatErrorMessage(error)}`,
        ),
      );
    });
    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim();
      reject(
        new Error(
          details.length > 0
            ? `Git executable check failed: ${details}`
            : `Git executable check failed with exit code ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

export async function ensureGitAvailable(): Promise<void> {
  if (!gitAvailabilityPromise) {
    gitAvailabilityPromise = checkGitAvailability().catch((error) => {
      gitAvailabilityPromise = null;
      throw error;
    });
  }

  await gitAvailabilityPromise;
}

export async function fetchLocalRepositoryCommits(
  options: FetchLocalRepositoryCommitsOptions,
): Promise<Array<LocalRepositoryCommit>> {
  await ensureGitAvailable();

  const runCommand = options.runGitCommand ?? runGitCommand;
  const commits: Array<LocalRepositoryCommit> = [];
  const gitLogArgs = buildGitLogArgs(options.since);

  for (const repository of options.repositories) {
    try {
      const output = await runCommand(repository.absolutePath, gitLogArgs);
      logger.info(
        `Fetched ${output.split(RECORD_SEPARATOR).length} commits for "${repository.repositoryFullName}"`,
      );
      commits.push(...parseGitLogOutput(output, repository.repositoryFullName));
    } catch (error) {
      emitFailure(options.onFailure, {
        targetType: 'repository',
        targetName: repository.repositoryFullName,
        repositoryFullName: repository.repositoryFullName,
        commitHash: null,
        statusCode: null,
        message: formatErrorMessage(error),
      });
    }
  }

  return commits;
}
