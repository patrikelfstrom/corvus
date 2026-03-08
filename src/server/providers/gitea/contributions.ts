import { z } from 'zod';
import {
  fetchJsonWithSchema,
  includesCaseInsensitiveMatcher,
  normalizeCaseInsensitiveMatchers,
} from '../shared.ts';
import type { NormalisedContribution } from '../types.ts';
import type { GiteaRequestExecutor } from './client.ts';

const ITEMS_PER_PAGE = 100;

const giteaIssueSearchItemSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  html_url: z.string().optional(),
  url: z.string().optional(),
  repository: z
    .object({
      full_name: z.string().trim().min(1),
    })
    .optional(),
});

const giteaIssueSearchListSchema = z.array(giteaIssueSearchItemSchema);

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
  requestQueue: GiteaRequestExecutor,
  apiBaseUrl: string,
  contributionType: 'issue.opened' | 'pull_request.opened',
  blacklistMatchers: Array<string>,
  since?: string,
): Promise<Array<NormalisedContribution>> {
  const contributions: Array<NormalisedContribution> = [];
  const seenIds = new Set<number>();
  const normalizedBlacklistMatchers =
    normalizeCaseInsensitiveMatchers(blacklistMatchers);
  let page = 1;

  for (;;) {
    const url = new URL(`${apiBaseUrl}/repos/issues/search`);
    url.searchParams.set(
      'type',
      contributionType === 'issue.opened' ? 'issues' : 'pulls',
    );
    url.searchParams.set('state', 'all');
    url.searchParams.set('created', 'true');
    url.searchParams.set('limit', String(ITEMS_PER_PAGE));
    url.searchParams.set('page', String(page));

    const items = await fetchJsonWithSchema(
      requestQueue,
      url.toString(),
      giteaIssueSearchListSchema,
    );

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const location = [
        item.repository?.full_name ?? '',
        item.html_url ?? '',
        item.url ?? '',
      ]
        .filter(Boolean)
        .join(' ');

      if (
        seenIds.has(item.id) ||
        !isSameOrAfter(item.created_at, since) ||
        includesCaseInsensitiveMatcher(location, normalizedBlacklistMatchers)
      ) {
        continue;
      }

      seenIds.add(item.id);
      contributions.push({
        category:
          contributionType === 'issue.opened' ? 'Issues' : 'Pull requests',
        contributionType,
        occurredAt: item.created_at,
        dedupeKeyInput:
          item.html_url?.trim() ||
          item.url?.trim() ||
          `${contributionType}:${item.id}`,
      });
    }

    page += 1;
  }

  return contributions;
}

export async function fetchGiteaIssueContributions(
  requestQueue: GiteaRequestExecutor,
  apiBaseUrl: string,
  blacklistMatchers: Array<string> = [],
  since?: string,
): Promise<Array<NormalisedContribution>> {
  return fetchSearchContributions(
    requestQueue,
    apiBaseUrl,
    'issue.opened',
    blacklistMatchers,
    since,
  );
}

export async function fetchGiteaPullRequestContributions(
  requestQueue: GiteaRequestExecutor,
  apiBaseUrl: string,
  blacklistMatchers: Array<string> = [],
  since?: string,
): Promise<Array<NormalisedContribution>> {
  return fetchSearchContributions(
    requestQueue,
    apiBaseUrl,
    'pull_request.opened',
    blacklistMatchers,
    since,
  );
}
