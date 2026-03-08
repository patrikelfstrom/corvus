import { defineProviderAdapter, requireResolvedApiBaseUrl } from '../types.ts';
import type { GitLabProjectFailure } from './commits.ts';
import {
  createGitLabRequestQueue,
  fetchAllGitLabCommits,
  fetchGitLabIssueContributions,
  fetchGitLabPullRequestContributions,
  resolveGitLabApiBaseUrl,
} from './index.ts';
import type { GitLabCommitWithRepository } from './types.ts';

export const providerAdapter = defineProviderAdapter<
  GitLabCommitWithRepository,
  GitLabProjectFailure,
  ReturnType<typeof createGitLabRequestQueue>
>({
  shouldFilterClientSide: () => false,
  resolveApiBaseUrl: resolveGitLabApiBaseUrl,
  createRequestQueue: (_username, token) => createGitLabRequestQueue(token),
  fetchIssueContributions: ({
    apiBaseUrl,
    blacklist,
    requestQueue,
    since,
    username,
  }) =>
    fetchGitLabIssueContributions(
      requestQueue,
      requireResolvedApiBaseUrl(apiBaseUrl, 'gitlab'),
      username,
      blacklist,
      since,
    ),
  fetchPullRequestContributions: ({
    apiBaseUrl,
    blacklist,
    requestQueue,
    since,
    username,
  }) =>
    fetchGitLabPullRequestContributions(
      requestQueue,
      requireResolvedApiBaseUrl(apiBaseUrl, 'gitlab'),
      username,
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
  }) =>
    fetchAllGitLabCommits(
      requestQueue,
      username,
      additionalMatchers,
      onFailure,
      blacklist,
      since,
      requireResolvedApiBaseUrl(apiBaseUrl, 'gitlab'),
    ),
  normaliseCommit: (commit) => ({
    sha: commit.id,
    author_name: commit.author_name,
    author_email: commit.author_email,
    authored_at: commit.authored_date,
    message: commit.message,
    repository_full_name: commit.repository.full_name,
  }),
  normaliseFailure: (failure) => ({
    targetType: 'project',
    targetName: failure.projectPath,
    repositoryFullName: failure.projectPath,
    commitHash: failure.commitHash,
    statusCode: failure.statusCode,
    message: failure.message,
  }),
});
