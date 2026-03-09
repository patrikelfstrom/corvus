import { z } from 'zod';
import { logger } from '../../logger.ts';
import { parseSyncFailureError } from '../../sync-failure.ts';
import {
  fetchJsonWithSchema,
  includesCaseInsensitiveMatcher,
  normalizeCaseInsensitiveMatchers,
} from '../shared.ts';
import type { NormalisedContribution } from '../types.ts';
import type { BitbucketRequestExecutor } from './client.ts';
import { BITBUCKET_API_BASE } from './client.ts';
import {
  bitbucketPaginatedResponseSchema,
  bitbucketWorkspaceAccessSchema,
} from './types.ts';

const WORKSPACES_PER_PAGE = 100;
const PULL_REQUESTS_PER_PAGE = 50;

const bitbucketCurrentUserSchema = z.object({
  uuid: z.string().trim().min(1),
});

const bitbucketWorkspacePageSchema = bitbucketPaginatedResponseSchema(
  bitbucketWorkspaceAccessSchema,
);

const bitbucketPullRequestSchema = z.object({
  id: z.number().int(),
  created_on: z.string(),
  links: z.object({
    html: z
      .object({
        href: z.string(),
      })
      .optional(),
  }),
  source: z
    .object({
      repository: z
        .object({
          full_name: z.string().trim().min(1),
        })
        .optional(),
    })
    .optional(),
  destination: z
    .object({
      repository: z
        .object({
          full_name: z.string().trim().min(1),
        })
        .optional(),
    })
    .optional(),
});

const bitbucketPullRequestPageSchema = bitbucketPaginatedResponseSchema(
  bitbucketPullRequestSchema,
);

interface BitbucketContributionFailure {
  target: string;
  message: string;
  statusCode: number | null;
  commitHash: string | null;
}

async function fetchCurrentUserUuid(
  requestQueue: BitbucketRequestExecutor,
): Promise<string> {
  const user = await fetchJsonWithSchema(
    requestQueue,
    `${BITBUCKET_API_BASE}/user`,
    bitbucketCurrentUserSchema,
  );

  return user.uuid;
}

async function fetchUserWorkspaces(
  requestQueue: BitbucketRequestExecutor,
): Promise<Array<string>> {
  const slugs: Array<string> = [];
  let url: string | undefined =
    `${BITBUCKET_API_BASE}/user/workspaces?pagelen=${WORKSPACES_PER_PAGE}`;

  while (url) {
    const data: z.infer<typeof bitbucketWorkspacePageSchema> =
      await fetchJsonWithSchema(
        requestQueue,
        url,
        bitbucketWorkspacePageSchema,
      );

    for (const entry of data.values) {
      slugs.push(entry.workspace.slug);
    }

    url = data.next;
  }

  return slugs;
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

async function fetchWorkspacePullRequests(
  requestQueue: BitbucketRequestExecutor,
  workspace: string,
  userUuid: string,
  blacklistMatchers: Array<string>,
  since?: string,
): Promise<Array<NormalisedContribution>> {
  const contributions: Array<NormalisedContribution> = [];
  const normalizedBlacklistMatchers =
    normalizeCaseInsensitiveMatchers(blacklistMatchers);
  const seenIds = new Set<number>();
  const url = new URL(
    `${BITBUCKET_API_BASE}/workspaces/${encodeURIComponent(workspace)}/pullrequests/${encodeURIComponent(userUuid)}`,
  );

  url.searchParams.set('pagelen', String(PULL_REQUESTS_PER_PAGE));
  url.searchParams.set('sort', '-created_on');
  url.searchParams.append('state', 'OPEN');
  url.searchParams.append('state', 'MERGED');
  url.searchParams.append('state', 'DECLINED');

  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const data: z.infer<typeof bitbucketPullRequestPageSchema> =
      await fetchJsonWithSchema(
        requestQueue,
        nextUrl,
        bitbucketPullRequestPageSchema,
      );

    if (data.values.length === 0) {
      break;
    }

    for (const pullRequest of data.values) {
      const sourceRepository = pullRequest.source?.repository?.full_name ?? '';
      const destinationRepository =
        pullRequest.destination?.repository?.full_name ?? '';
      const htmlUrl = pullRequest.links.html?.href?.trim() ?? '';
      const location = [sourceRepository, destinationRepository, htmlUrl]
        .filter(Boolean)
        .join(' ');

      if (
        seenIds.has(pullRequest.id) ||
        !isSameOrAfter(pullRequest.created_on, since) ||
        includesCaseInsensitiveMatcher(location, normalizedBlacklistMatchers)
      ) {
        continue;
      }

      seenIds.add(pullRequest.id);
      contributions.push({
        category: 'Pull requests',
        contributionType: 'pull_request.opened',
        occurredAt: pullRequest.created_on,
        dedupeKeyInput:
          htmlUrl ||
          `${workspace}:${sourceRepository || destinationRepository}:${pullRequest.id}`,
      });
    }

    nextUrl = data.next;
  }

  return contributions;
}

export async function fetchBitbucketPullRequestContributions(
  requestQueue: BitbucketRequestExecutor,
  blacklistMatchers: Array<string> = [],
  since?: string,
  onFailure?: (failure: BitbucketContributionFailure) => void,
): Promise<Array<NormalisedContribution>> {
  let userUuid: string;
  try {
    userUuid = await fetchCurrentUserUuid(requestQueue);
  } catch (error) {
    const parsedError = parseSyncFailureError(error);
    onFailure?.({
      target: 'workspace:identity',
      message: parsedError.message,
      statusCode: parsedError.statusCode,
      commitHash: parsedError.commitHash,
    });
    return [];
  }

  let workspaces: Array<string>;
  try {
    workspaces = await fetchUserWorkspaces(requestQueue);
  } catch (error) {
    const parsedError = parseSyncFailureError(error);
    onFailure?.({
      target: 'workspaces',
      message: parsedError.message,
      statusCode: parsedError.statusCode,
      commitHash: parsedError.commitHash,
    });
    return [];
  }

  const contributions: Array<NormalisedContribution> = [];

  for (const workspace of workspaces) {
    try {
      const workspaceContributions = await fetchWorkspacePullRequests(
        requestQueue,
        workspace,
        userUuid,
        blacklistMatchers,
        since,
      );
      contributions.push(...workspaceContributions);
    } catch (error) {
      const parsedError = parseSyncFailureError(error);
      logger.warn(
        { workspace, err: error },
        'Failed to fetch Bitbucket pull requests for workspace; skipping workspace',
      );
      onFailure?.({
        target: `workspace:${workspace}`,
        message: parsedError.message,
        statusCode: parsedError.statusCode,
        commitHash: parsedError.commitHash,
      });
    }
  }

  return contributions;
}
