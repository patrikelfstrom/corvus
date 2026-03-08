import { logger } from '../../logger.ts';
import {
  includesCaseInsensitiveMatcher,
  normalizeCaseInsensitiveMatchers,
} from '../shared.ts';
import type { ProviderFailure } from '../types.ts';
import { defineProviderAdapter } from '../types.ts';
import {
  ensureGitAvailable,
  fetchLocalRepositoryCommits,
  type LocalRepositoryCommit,
} from './commits.ts';
import { scanForGitRepositories } from './scan.ts';

export const providerAdapter = defineProviderAdapter<
  LocalRepositoryCommit,
  ProviderFailure,
  null
>({
  shouldFilterClientSide: () => true,
  createRequestQueue: () => null,
  fetchCommits: async ({ blacklist, depth, onFailure, path, since }) => {
    if (!path) {
      throw new Error('Filepath provider path is required.');
    }

    const maxDepth = depth ?? 1;
    const normalizedBlacklistMatchers =
      normalizeCaseInsensitiveMatchers(blacklist);
    try {
      await ensureGitAvailable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { path, message },
        'Filepath provider cannot run because git is unavailable',
      );
      onFailure({
        targetType: 'sync',
        targetName: path,
        repositoryFullName: null,
        commitHash: null,
        statusCode: null,
        message,
      });
      return [];
    }

    const discoveredRepositories = await scanForGitRepositories({
      rootPath: path,
      maxDepth,
      onFailure: (failure) => {
        onFailure(failure);
      },
    });
    const repositories = discoveredRepositories.filter((repository) => {
      if (
        !includesCaseInsensitiveMatcher(
          repository.repositoryFullName,
          normalizedBlacklistMatchers,
        )
      ) {
        return true;
      }

      logger.info(
        { repository: repository.repositoryFullName },
        'Skipping blacklisted local repository',
      );
      return false;
    });

    logger.info(
      {
        path,
        depth: maxDepth,
        repositoriesDiscovered: discoveredRepositories.length,
        repositoriesSelected: repositories.length,
      },
      'Filepath provider repository discovery complete',
    );

    return fetchLocalRepositoryCommits({
      repositories,
      since,
      onFailure: (failure) => {
        onFailure(failure);
      },
    });
  },
  normaliseCommit: (commit) => ({
    sha: commit.sha,
    author_name: commit.authorName,
    author_email: commit.authorEmail,
    authored_at: commit.authoredAt,
    message: commit.message,
    repository_full_name: commit.repositoryFullName,
  }),
  normaliseFailure: (failure) => failure,
});
