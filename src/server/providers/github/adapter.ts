import { defineProviderAdapter } from '../types.ts';
import type { GitHubRepositoryFailure } from './commits.ts';
import {
  createRequestQueue,
  fetchAllCommits,
  fetchGitHubIssueContributions,
  fetchGitHubPullRequestContributions,
} from './index.ts';
import type { GitHubCommitItem } from './types.ts';

export const providerAdapter = defineProviderAdapter<
  GitHubCommitItem,
  GitHubRepositoryFailure,
  ReturnType<typeof createRequestQueue>
>({
  shouldFilterClientSide: (additionalMatchers) => additionalMatchers.length > 0,
  createRequestQueue: (_username, token) => createRequestQueue(token),
  fetchIssueContributions: ({ blacklist, requestQueue, since, username }) =>
    fetchGitHubIssueContributions(requestQueue, username, blacklist, since),
  fetchPullRequestContributions: ({
    blacklist,
    requestQueue,
    since,
    username,
  }) =>
    fetchGitHubPullRequestContributions(
      requestQueue,
      username,
      blacklist,
      since,
    ),
  fetchCommits: ({
    additionalMatchers,
    blacklist,
    onFailure,
    requestQueue,
    since,
    username,
  }) => {
    const shouldFetchAllAuthors = additionalMatchers.length > 0;
    return fetchAllCommits(
      requestQueue,
      username,
      shouldFetchAllAuthors ? [] : undefined,
      onFailure,
      blacklist,
      since,
    );
  },
  normaliseCommit: (commit) => ({
    sha: commit.sha,
    author_name: commit.commit.author.name,
    author_email: commit.commit.author.email,
    authored_at: commit.commit.author.date,
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
