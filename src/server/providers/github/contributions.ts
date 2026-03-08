import { z } from 'zod';
import {
  fetchJsonWithSchema,
  includesCaseInsensitiveMatcher,
  normalizeCaseInsensitiveMatchers,
} from '../shared.ts';
import type { NormalisedContribution } from '../types.ts';
import type { GitHubRequestExecutor } from './client.ts';

const SEARCH_PER_PAGE = 100;
const GITHUB_API_BASE = 'https://api.github.com';

const gitHubSearchItemSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  created_at: z.string(),
  repository_url: z.string(),
});

const gitHubSearchResponseSchema = z.object({
  items: z.array(gitHubSearchItemSchema),
});

function toSinceDateQuery(since?: string): string | null {
  if (!since) {
    return null;
  }

  return since.slice(0, 10);
}

function isSameOrAfter(date: string, since?: string): boolean {
  if (!since) {
    return true;
  }

  const dateTimestamp = Date.parse(date);
  const sinceTimestamp = Date.parse(since);

  if (!Number.isFinite(dateTimestamp) || !Number.isFinite(sinceTimestamp)) {
    return true;
  }

  return dateTimestamp >= sinceTimestamp;
}

async function fetchSearchContributions(
  requestQueue: GitHubRequestExecutor,
  username: string,
  contributionType: 'issue.opened' | 'pull_request.opened',
  blacklistMatchers: Array<string>,
  since?: string,
): Promise<Array<NormalisedContribution>> {
  const contributions: Array<NormalisedContribution> = [];
  const seenIds = new Set<number>();
  const normalizedBlacklistMatchers =
    normalizeCaseInsensitiveMatchers(blacklistMatchers);
  const sinceQuery = toSinceDateQuery(since);
  let page = 1;

  for (;;) {
    const url = new URL(`${GITHUB_API_BASE}/search/issues`);
    const qualifiers = [
      contributionType === 'issue.opened' ? 'type:issue' : 'type:pr',
      `author:${username}`,
    ];

    if (sinceQuery) {
      qualifiers.push(`created:>=${sinceQuery}`);
    }

    url.searchParams.set('q', qualifiers.join(' '));
    url.searchParams.set('sort', 'created');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', String(SEARCH_PER_PAGE));
    url.searchParams.set('page', String(page));

    const response = await fetchJsonWithSchema(
      requestQueue,
      url.toString(),
      gitHubSearchResponseSchema,
    );

    if (response.items.length === 0) {
      break;
    }

    for (const item of response.items) {
      if (
        seenIds.has(item.id) ||
        !isSameOrAfter(item.created_at, since) ||
        includesCaseInsensitiveMatcher(
          item.repository_url,
          normalizedBlacklistMatchers,
        )
      ) {
        continue;
      }

      seenIds.add(item.id);
      contributions.push({
        category:
          contributionType === 'issue.opened' ? 'Issues' : 'Pull requests',
        contributionType,
        occurredAt: item.created_at,
        dedupeKeyInput: `${item.repository_url}#${item.id}`,
      });
    }

    page += 1;
  }

  return contributions;
}

export async function fetchGitHubIssueContributions(
  requestQueue: GitHubRequestExecutor,
  username: string,
  blacklistMatchers: Array<string> = [],
  since?: string,
): Promise<Array<NormalisedContribution>> {
  return fetchSearchContributions(
    requestQueue,
    username,
    'issue.opened',
    blacklistMatchers,
    since,
  );
}

export async function fetchGitHubPullRequestContributions(
  requestQueue: GitHubRequestExecutor,
  username: string,
  blacklistMatchers: Array<string> = [],
  since?: string,
): Promise<Array<NormalisedContribution>> {
  return fetchSearchContributions(
    requestQueue,
    username,
    'pull_request.opened',
    blacklistMatchers,
    since,
  );
}
