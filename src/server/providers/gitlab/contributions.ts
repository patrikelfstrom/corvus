import { z } from 'zod';
import {
  includesCaseInsensitiveMatcher,
  normalizeCaseInsensitiveMatchers,
} from '../shared.ts';
import type { NormalisedContribution } from '../types.ts';
import type { GitLabRequestExecutor } from './client.ts';

const ITEMS_PER_PAGE = 100;

const gitLabIssueSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  web_url: z.string().optional(),
});

const gitLabMergeRequestSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  web_url: z.string().optional(),
});

const gitLabIssueListSchema = z.array(gitLabIssueSchema);
const gitLabMergeRequestListSchema = z.array(gitLabMergeRequestSchema);

async function fetchGitLabPage<T>(
  requestQueue: GitLabRequestExecutor,
  url: URL,
  schema: z.ZodType<T>,
): Promise<{ data: T; nextPage: number | null }> {
  const response = await requestQueue(url.toString());
  const payload =
    response._data === undefined ? await response.json() : response._data;
  const data = schema.parse(payload);
  const nextPageRaw = response.headers.get('x-next-page');
  const nextPage = Number(nextPageRaw);

  return {
    data,
    nextPage: Number.isFinite(nextPage) && nextPage > 0 ? nextPage : null,
  };
}

async function fetchContributionList<
  TItem extends { id: number; created_at: string; web_url?: string },
>(
  requestQueue: GitLabRequestExecutor,
  url: URL,
  schema: z.ZodType<Array<TItem>>,
  category: 'Issues' | 'Pull requests',
  contributionType: 'issue.opened' | 'pull_request.opened',
  blacklistMatchers: Array<string>,
): Promise<Array<NormalisedContribution>> {
  const contributions: Array<NormalisedContribution> = [];
  const seenIds = new Set<number>();
  const normalizedBlacklistMatchers =
    normalizeCaseInsensitiveMatchers(blacklistMatchers);
  let page = 1;

  for (;;) {
    url.searchParams.set('page', String(page));
    const response = await fetchGitLabPage(requestQueue, url, schema);
    const items = response.data;

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const webUrl = item.web_url?.trim() ?? '';

      if (
        seenIds.has(item.id) ||
        includesCaseInsensitiveMatcher(webUrl, normalizedBlacklistMatchers)
      ) {
        continue;
      }

      seenIds.add(item.id);
      contributions.push({
        category,
        contributionType,
        occurredAt: item.created_at,
        dedupeKeyInput:
          webUrl.length > 0 ? webUrl : `${contributionType}:${item.id}`,
      });
    }

    if (response.nextPage == null) {
      break;
    }

    page = response.nextPage;
  }

  return contributions;
}

export async function fetchGitLabIssueContributions(
  requestQueue: GitLabRequestExecutor,
  apiBaseUrl: string,
  username: string,
  blacklistMatchers: Array<string> = [],
  since?: string,
): Promise<Array<NormalisedContribution>> {
  const url = new URL(`${apiBaseUrl}/issues`);
  url.searchParams.set('author_username', username);
  url.searchParams.set('scope', 'all');
  url.searchParams.set('order_by', 'created_at');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('per_page', String(ITEMS_PER_PAGE));
  if (since) {
    url.searchParams.set('created_after', since);
  }

  return fetchContributionList(
    requestQueue,
    url,
    gitLabIssueListSchema,
    'Issues',
    'issue.opened',
    blacklistMatchers,
  );
}

export async function fetchGitLabPullRequestContributions(
  requestQueue: GitLabRequestExecutor,
  apiBaseUrl: string,
  username: string,
  blacklistMatchers: Array<string> = [],
  since?: string,
): Promise<Array<NormalisedContribution>> {
  const url = new URL(`${apiBaseUrl}/merge_requests`);
  url.searchParams.set('author_username', username);
  url.searchParams.set('scope', 'all');
  url.searchParams.set('order_by', 'created_at');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('per_page', String(ITEMS_PER_PAGE));
  if (since) {
    url.searchParams.set('created_after', since);
  }

  return fetchContributionList(
    requestQueue,
    url,
    gitLabMergeRequestListSchema,
    'Pull requests',
    'pull_request.opened',
    blacklistMatchers,
  );
}
