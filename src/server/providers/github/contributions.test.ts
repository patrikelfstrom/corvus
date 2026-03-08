import assert from 'node:assert/strict';
import test from 'node:test';
import type { GitHubRequestExecutor } from './client.ts';
import {
  fetchGitHubIssueContributions,
  fetchGitHubPullRequestContributions,
} from './contributions.ts';

function createRequestQueue(
  responses: Array<{ items: Array<Record<string, unknown>> }>,
): GitHubRequestExecutor {
  let index = 0;

  return async () =>
    new Response(JSON.stringify(responses[index++] ?? { items: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
}

test('fetchGitHubIssueContributions skips blacklisted repositories', async () => {
  const requestQueue = createRequestQueue([
    {
      items: [
        {
          id: 1,
          number: 10,
          created_at: '2026-03-01T00:00:00.000Z',
          repository_url: 'https://api.github.com/repos/owner/keep-repo',
        },
        {
          id: 2,
          number: 11,
          created_at: '2026-03-01T00:00:00.000Z',
          repository_url: 'https://api.github.com/repos/owner/archive-repo',
        },
      ],
    },
  ]);

  const contributions = await fetchGitHubIssueContributions(
    requestQueue,
    'octocat',
    ['archive'],
  );

  assert.deepEqual(contributions, [
    {
      category: 'Issues',
      contributionType: 'issue.opened',
      occurredAt: '2026-03-01T00:00:00.000Z',
      dedupeKeyInput: 'https://api.github.com/repos/owner/keep-repo#1',
    },
  ]);
});

test('fetchGitHubPullRequestContributions uses repository-scoped dedupe keys', async () => {
  const requestQueue = createRequestQueue([
    {
      items: [
        {
          id: 123,
          number: 20,
          created_at: '2026-03-01T00:00:00.000Z',
          repository_url: 'https://github.example.com/api/v3/repos/owner/repo',
        },
      ],
    },
  ]);

  const contributions = await fetchGitHubPullRequestContributions(
    requestQueue,
    'octocat',
  );

  assert.equal(
    contributions[0]?.dedupeKeyInput,
    'https://github.example.com/api/v3/repos/owner/repo#123',
  );
});
