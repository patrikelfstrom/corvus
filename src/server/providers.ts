import {
  commitMatchesIdentity,
  normalizeIdentityMatchers,
} from './identity.ts';
import { logger } from './logger.ts';
import { loadProviderAdapter, type Provider } from './providers/config.ts';
import type { ProviderFetchOptions } from './providers/kernel/manifest-types.ts';
import type {
  NormalisedCommit,
  NormalisedContribution,
  ProviderFailure,
  SyncStream,
} from './providers/types.ts';

export type { Provider } from './providers/config.ts';
export type {
  ContributionCategory,
  ContributionType,
  NormalisedCommit,
  NormalisedContribution,
  SyncFailureTargetType,
  SyncStream,
} from './providers/types.ts';

export interface SyncFetchFailure extends ProviderFailure {
  provider: Provider;
}

export interface FetchContributionStreamForProviderOptions {
  provider: Provider;
  fetchOptions: ProviderFetchOptions;
  stream: SyncStream;
  since?: string;
}

export interface FetchContributionStreamForProviderResult {
  contributions: Array<NormalisedContribution>;
  failures: Array<SyncFetchFailure>;
  supported: boolean;
}

function getAdditionalMatchers(
  username: string,
  matchAuthor: Array<string>,
): Array<string> {
  const normalizedUsername = username.trim().toLowerCase();
  return matchAuthor.filter((matcher) => {
    return matcher.trim().toLowerCase() !== normalizedUsername;
  });
}

function buildCommitContributions(
  commits: Array<NormalisedCommit>,
  username: string,
  additionalMatchers: Array<string>,
): Array<NormalisedContribution> {
  const identityMatchers = normalizeIdentityMatchers([
    username,
    ...additionalMatchers,
  ]);
  const contributions: Array<NormalisedContribution> = [];

  for (const commit of commits) {
    const authored = commitMatchesIdentity(
      commit.author_name,
      commit.author_email,
      identityMatchers,
    );

    if (!authored) {
      continue;
    }

    contributions.push({
      category: 'Commits',
      contributionType: 'commit.authored',
      occurredAt: commit.authored_at,
      dedupeKeyInput: commit.sha,
    });
  }

  return contributions;
}

function normaliseFailures(
  provider: Provider,
  failures: Array<unknown>,
  normalizeFailure: (failure: unknown) => ProviderFailure,
): Array<SyncFetchFailure> {
  return failures.map((failure) => ({
    provider,
    ...normalizeFailure(failure),
  }));
}

export async function fetchContributionStreamForProvider(
  options: FetchContributionStreamForProviderOptions,
): Promise<FetchContributionStreamForProviderResult> {
  const { provider, fetchOptions, stream, since } = options;
  const {
    username,
    token,
    match_author: matchAuthor = [],
    blacklist = [],
    url,
    path,
    depth,
  } = fetchOptions;
  const additionalMatchers = getAdditionalMatchers(username, matchAuthor);
  const adapter = await loadProviderAdapter(provider);
  const apiBaseUrl = adapter.resolveApiBaseUrl?.(url);
  const requestQueue = adapter.createRequestQueue(username, token ?? '');
  const rawFailures: Array<unknown> = [];
  const context = {
    requestQueue,
    username,
    additionalMatchers,
    blacklist,
    since,
    apiBaseUrl,
    path,
    depth,
    onFailure: (failure: unknown) => {
      rawFailures.push(failure);
    },
  };

  logger.info(
    { provider, stream, username, apiBaseUrl, path, depth },
    'Starting provider contribution fetch',
  );

  let contributions: Array<NormalisedContribution> = [];
  let supported = true;

  if (stream === 'commits') {
    const rawCommits = await adapter.fetchCommits(context);
    const normalisedCommits = rawCommits.map((commit) =>
      adapter.normaliseCommit(commit),
    );
    contributions = buildCommitContributions(
      normalisedCommits,
      username,
      additionalMatchers,
    );
  } else if (stream === 'general') {
    contributions = adapter.fetchGeneralContributions
      ? await adapter.fetchGeneralContributions(context)
      : [];
    supported = adapter.fetchGeneralContributions != null;
  } else if (stream === 'issues') {
    contributions = adapter.fetchIssueContributions
      ? await adapter.fetchIssueContributions(context)
      : [];
    supported = adapter.fetchIssueContributions != null;
  } else if (stream === 'pull_requests') {
    contributions = adapter.fetchPullRequestContributions
      ? await adapter.fetchPullRequestContributions(context)
      : [];
    supported = adapter.fetchPullRequestContributions != null;
  } else {
    contributions = adapter.fetchCodeReviewContributions
      ? await adapter.fetchCodeReviewContributions(context)
      : [];
    supported = adapter.fetchCodeReviewContributions != null;
  }

  const failures = normaliseFailures(provider, rawFailures, (failure) =>
    adapter.normaliseFailure(failure),
  );

  logger.info(
    {
      provider,
      stream,
      totalContributions: contributions.length,
      failuresCaptured: failures.length,
      supported,
    },
    'Provider contribution fetch complete',
  );

  return {
    contributions,
    failures,
    supported,
  };
}
