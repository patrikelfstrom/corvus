import assert from 'node:assert/strict';
import test from 'node:test';
import type { GitLabRequestExecutor } from './client.ts';
import {
  fetchGitLabIssueContributions,
  fetchGitLabPullRequestContributions,
} from './contributions.ts';

function createGitLabRequestQueue(
  responses: Array<{
    body: Array<Record<string, unknown>>;
    nextPage?: string | null;
  }>,
): GitLabRequestExecutor {
  let index = 0;

  return async () => {
    const response = responses[index++] ?? { body: [], nextPage: null };

    return new Response(JSON.stringify(response.body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-next-page': response.nextPage ?? '',
      },
    });
  };
}

test('fetchGitLabIssueContributions skips blacklisted projects', async () => {
  const requestQueue = createGitLabRequestQueue([
    {
      body: [
        {
          id: 1,
          created_at: '2026-03-01T00:00:00.000Z',
          web_url: 'https://gitlab.example.com/owner/keep/-/issues/1',
        },
        {
          id: 2,
          created_at: '2026-03-01T00:00:00.000Z',
          web_url: 'https://gitlab.example.com/owner/archive/-/issues/2',
        },
      ],
    },
  ]);

  const contributions = await fetchGitLabIssueContributions(
    requestQueue,
    'https://gitlab.example.com/api/v4',
    'octocat',
    ['archive'],
  );

  assert.deepEqual(contributions, [
    {
      category: 'Issues',
      contributionType: 'issue.opened',
      occurredAt: '2026-03-01T00:00:00.000Z',
      dedupeKeyInput: 'https://gitlab.example.com/owner/keep/-/issues/1',
    },
  ]);
});

test('fetchGitLabPullRequestContributions uses instance-scoped dedupe keys', async () => {
  const requestQueue = createGitLabRequestQueue([
    {
      body: [
        {
          id: 123,
          created_at: '2026-03-01T00:00:00.000Z',
          web_url: 'https://gitlab.internal/owner/repo/-/merge_requests/123',
        },
      ],
    },
  ]);

  const contributions = await fetchGitLabPullRequestContributions(
    requestQueue,
    'https://gitlab.internal/api/v4',
    'octocat',
  );

  assert.equal(
    contributions[0]?.dedupeKeyInput,
    'https://gitlab.internal/owner/repo/-/merge_requests/123',
  );
});
