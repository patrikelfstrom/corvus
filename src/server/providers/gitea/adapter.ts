import { defineProviderAdapter, requireResolvedApiBaseUrl } from '../types.ts';
import type { GiteaRequestExecutor } from './client.ts';
import type { GiteaRepositoryFailure } from './commits.ts';
import {
  createGiteaRequestQueue,
  fetchAllGiteaCommits,
  fetchGiteaIssueContributions,
  fetchGiteaPullRequestContributions,
  resolveGiteaApiBaseUrl,
} from './index.ts';
import type { GiteaCommitItem } from './types.ts';

interface GiteaCompatibleProviderAdapterOptions {
  provider: string;
  providerName: string;
  createRequestQueue(token: string): GiteaRequestExecutor;
  resolveApiBaseUrl(url?: string): string;
}

export function createGiteaCompatibleProviderAdapter(
  options: GiteaCompatibleProviderAdapterOptions,
) {
  const { createRequestQueue, provider, providerName, resolveApiBaseUrl } =
    options;

  return defineProviderAdapter<
    GiteaCommitItem,
    GiteaRepositoryFailure,
    GiteaRequestExecutor
  >({
    shouldFilterClientSide: (additionalMatchers) =>
      additionalMatchers.length > 0,
    resolveApiBaseUrl,
    createRequestQueue: (_username, token) => createRequestQueue(token),
    fetchIssueContributions: ({ apiBaseUrl, blacklist, requestQueue, since }) =>
      fetchGiteaIssueContributions(
        requestQueue,
        requireResolvedApiBaseUrl(apiBaseUrl, provider),
        blacklist,
        since,
      ),
    fetchPullRequestContributions: ({
      apiBaseUrl,
      blacklist,
      requestQueue,
      since,
    }) =>
      fetchGiteaPullRequestContributions(
        requestQueue,
        requireResolvedApiBaseUrl(apiBaseUrl, provider),
        blacklist,
        since,
      ),
    fetchCommits: ({
      additionalMatchers,
      apiBaseUrl,
      blacklist,
      onFailure,
      requestQueue,
      since,
      username,
    }) => {
      const shouldFetchAllAuthors = additionalMatchers.length > 0;
      return fetchAllGiteaCommits(
        requestQueue,
        requireResolvedApiBaseUrl(apiBaseUrl, provider),
        username,
        shouldFetchAllAuthors ? [] : undefined,
        onFailure,
        blacklist,
        since,
        providerName,
      );
    },
    normaliseCommit: (commit) => ({
      sha: commit.sha,
      author_name: commit.commit.author?.name ?? '',
      author_email: commit.commit.author?.email ?? '',
      authored_at: commit.commit.author?.date ?? '',
      message: commit.commit.message,
      repository_full_name: commit.repository.full_name,
    }),
    normaliseFailure: (failure) => ({
      targetType: 'repository',
      targetName: failure.repositoryFullName,
      repositoryFullName: failure.repositoryFullName,
      commitHash: failure.commitHash,
      statusCode: failure.statusCode,
      message: failure.message,
    }),
  });
}

export const providerAdapter = createGiteaCompatibleProviderAdapter({
  provider: 'gitea',
  providerName: 'Gitea',
  createRequestQueue: createGiteaRequestQueue,
  resolveApiBaseUrl: resolveGiteaApiBaseUrl,
});
