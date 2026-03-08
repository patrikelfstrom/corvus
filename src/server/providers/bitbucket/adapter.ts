import { defineProviderAdapter } from '../types.ts';
import type { BitbucketRepositoryFailure } from './commits.ts';
import {
  createBitbucketRequestQueue,
  fetchAllBitbucketCommits,
  fetchBitbucketPullRequestContributions,
  parseAuthorRaw,
} from './index.ts';
import type { BitbucketCommit } from './types.ts';

export const providerAdapter = defineProviderAdapter<
  BitbucketCommit,
  BitbucketRepositoryFailure,
  ReturnType<typeof createBitbucketRequestQueue>
>({
  shouldFilterClientSide: () => true,
  createRequestQueue: (username, token) =>
    createBitbucketRequestQueue(username, token),
  fetchPullRequestContributions: ({
    blacklist,
    onFailure,
    requestQueue,
    since,
  }) =>
    fetchBitbucketPullRequestContributions(
      requestQueue,
      blacklist,
      since,
      onFailure,
    ),
  fetchCommits: ({ blacklist, onFailure, requestQueue, since }) =>
    fetchAllBitbucketCommits(requestQueue, onFailure, blacklist, since),
  normaliseCommit: (commit) => {
    const parsedAuthor = parseAuthorRaw(commit.author.raw);
    return {
      sha: commit.hash,
      author_name: parsedAuthor.name,
      author_email: parsedAuthor.email,
      authored_at: commit.date,
      message: commit.message,
      repository_full_name: commit.repository.full_name,
    };
  },
  normaliseFailure: (failure) => {
    const targetType =
      failure.target === 'workspaces' || failure.target.startsWith('workspace:')
        ? 'workspace'
        : 'repository';

    return {
      targetType,
      targetName: failure.target,
      repositoryFullName: targetType === 'repository' ? failure.target : null,
      commitHash: failure.commitHash,
      statusCode: failure.statusCode,
      message: failure.message,
    };
  },
});
