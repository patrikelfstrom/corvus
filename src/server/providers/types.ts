export type ContributionCategory =
  | 'General'
  | 'Code review'
  | 'Commits'
  | 'Issues'
  | 'Pull requests';

export type ContributionType =
  | 'repository.created'
  | 'repository.forked'
  | 'discussion.opened'
  | 'discussion.answered'
  | 'issue.opened'
  | 'pull_request.opened'
  | 'code_review.submitted'
  | 'code_review.inline_comment'
  | 'commit.authored';

export interface NormalisedCommit {
  sha: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  message: string;
  repository_full_name: string | null;
}

export interface NormalisedContribution {
  category: ContributionCategory;
  contributionType: ContributionType;
  occurredAt: string;
  dedupeKeyInput: string;
}

export type SyncStream =
  | 'commits'
  | 'general'
  | 'issues'
  | 'pull_requests'
  | 'code_reviews';

export type SyncFailureTargetType =
  | 'repository'
  | 'project'
  | 'workspace'
  | 'sync';

export interface ProviderFailure {
  targetType: SyncFailureTargetType;
  targetName: string;
  repositoryFullName: string | null;
  commitHash: string | null;
  statusCode: number | null;
  message: string;
}

export interface ProviderFetchContext<TFailure, TRequestQueue> {
  requestQueue: TRequestQueue;
  username: string;
  additionalMatchers: Array<string>;
  blacklist: Array<string>;
  since?: string;
  apiBaseUrl?: string;
  path?: string;
  depth?: number;
  onFailure(failure: TFailure): void;
}

export interface ProviderAdapter<TCommit, TFailure, TRequestQueue> {
  shouldFilterClientSide(additionalMatchers: Array<string>): boolean;
  createRequestQueue(username: string, token: string): TRequestQueue;
  resolveApiBaseUrl?(url?: string): string;
  fetchGeneralContributions?(
    context: ProviderFetchContext<TFailure, TRequestQueue>,
  ): Promise<Array<NormalisedContribution>>;
  fetchIssueContributions?(
    context: ProviderFetchContext<TFailure, TRequestQueue>,
  ): Promise<Array<NormalisedContribution>>;
  fetchPullRequestContributions?(
    context: ProviderFetchContext<TFailure, TRequestQueue>,
  ): Promise<Array<NormalisedContribution>>;
  fetchCodeReviewContributions?(
    context: ProviderFetchContext<TFailure, TRequestQueue>,
  ): Promise<Array<NormalisedContribution>>;
  fetchCommits(
    context: ProviderFetchContext<TFailure, TRequestQueue>,
  ): Promise<Array<TCommit>>;
  normaliseCommit(commit: TCommit): NormalisedCommit;
  normaliseFailure(failure: TFailure): ProviderFailure;
}

export type AnyProviderAdapter = ProviderAdapter<unknown, unknown, unknown>;

export function defineProviderAdapter<TCommit, TFailure, TRequestQueue>(
  adapter: ProviderAdapter<TCommit, TFailure, TRequestQueue>,
): ProviderAdapter<TCommit, TFailure, TRequestQueue> {
  return adapter;
}

export function requireResolvedApiBaseUrl(
  apiBaseUrl: string | undefined,
  provider: string,
): string {
  if (apiBaseUrl) {
    return apiBaseUrl;
  }

  throw Error(`Resolved ${provider} API base URL is required.`);
}
