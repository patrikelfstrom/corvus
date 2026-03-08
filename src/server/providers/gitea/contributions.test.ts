import assert from 'node:assert/strict';
import test from 'node:test';
import type { GiteaRequestExecutor } from './client.ts';
import {
  fetchGiteaIssueContributions,
  fetchGiteaPullRequestContributions,
} from './contributions.ts';

function createRequestQueue(
  responses: Array<Array<Record<string, unknown>>>,
): GiteaRequestExecutor {
  let index = 0;

  return async () =>
    new Response(JSON.stringify(responses[index++] ?? []), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
}

test('fetchGiteaIssueContributions skips blacklisted repositories', async () => {
  const requestQueue = createRequestQueue([
    [
      {
        id: 1,
        created_at: '2026-03-01T00:00:00.000Z',
        html_url: 'https://gitea.example.com/owner/keep/issues/1',
        repository: { full_name: 'owner/keep' },
      },
      {
        id: 2,
        created_at: '2026-03-01T00:00:00.000Z',
        html_url: 'https://gitea.example.com/owner/archive/issues/2',
        repository: { full_name: 'owner/archive' },
      },
    ],
  ]);

  const contributions = await fetchGiteaIssueContributions(
    requestQueue,
    'https://gitea.example.com/api/v1',
    ['archive'],
  );

  assert.deepEqual(contributions, [
    {
      category: 'Issues',
      contributionType: 'issue.opened',
      occurredAt: '2026-03-01T00:00:00.000Z',
      dedupeKeyInput: 'https://gitea.example.com/owner/keep/issues/1',
    },
  ]);
});

test('fetchGiteaPullRequestContributions uses resource urls as dedupe keys', async () => {
  const requestQueue = createRequestQueue([
    [
      {
        id: 7,
        created_at: '2026-03-01T00:00:00.000Z',
        html_url: 'https://forgejo.example.com/owner/repo/pulls/7',
      },
    ],
  ]);

  const contributions = await fetchGiteaPullRequestContributions(
    requestQueue,
    'https://forgejo.example.com/api/v1',
  );

  assert.equal(
    contributions[0]?.dedupeKeyInput,
    'https://forgejo.example.com/owner/repo/pulls/7',
  );
});
