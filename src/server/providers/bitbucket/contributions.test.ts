import assert from 'node:assert/strict';
import test from 'node:test';
import type { BitbucketRequestExecutor } from './client.ts';
import { fetchBitbucketPullRequestContributions } from './contributions.ts';

function createRequestQueue(
  responses: Array<{ body: Record<string, unknown>; status?: number }>,
): BitbucketRequestExecutor {
  let index = 0;

  return async () => {
    const response = responses[index++] ?? { body: { values: [] } };

    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  };
}

test('fetchBitbucketPullRequestContributions fetches authored pull requests across workspaces', async () => {
  const requestQueue = createRequestQueue([
    { body: { uuid: '{user-uuid}' } },
    {
      body: {
        values: [
          { workspace: { slug: 'alpha' } },
          { workspace: { slug: 'beta' } },
        ],
      },
    },
    {
      body: {
        values: [
          {
            id: 1,
            created_on: '2026-03-01T00:00:00.000Z',
            links: {
              html: {
                href: 'https://bitbucket.org/alpha/repo/pull-requests/1',
              },
            },
            source: { repository: { full_name: 'alpha/repo' } },
            destination: { repository: { full_name: 'alpha/repo' } },
          },
        ],
      },
    },
    {
      body: {
        values: [
          {
            id: 2,
            created_on: '2026-03-02T00:00:00.000Z',
            links: {
              html: { href: 'https://bitbucket.org/beta/repo/pull-requests/2' },
            },
            source: { repository: { full_name: 'beta/repo' } },
            destination: { repository: { full_name: 'beta/repo' } },
          },
        ],
      },
    },
  ]);

  const contributions =
    await fetchBitbucketPullRequestContributions(requestQueue);

  assert.deepEqual(
    contributions.map((contribution) => contribution.dedupeKeyInput),
    [
      'https://bitbucket.org/alpha/repo/pull-requests/1',
      'https://bitbucket.org/beta/repo/pull-requests/2',
    ],
  );
});

test('fetchBitbucketPullRequestContributions skips blacklisted repositories', async () => {
  const requestQueue = createRequestQueue([
    { body: { uuid: '{user-uuid}' } },
    {
      body: {
        values: [{ workspace: { slug: 'alpha' } }],
      },
    },
    {
      body: {
        values: [
          {
            id: 1,
            created_on: '2026-03-01T00:00:00.000Z',
            links: {
              html: {
                href: 'https://bitbucket.org/alpha/keep/pull-requests/1',
              },
            },
            source: { repository: { full_name: 'alpha/keep' } },
            destination: { repository: { full_name: 'alpha/keep' } },
          },
          {
            id: 2,
            created_on: '2026-03-01T00:00:00.000Z',
            links: {
              html: {
                href: 'https://bitbucket.org/alpha/archive/pull-requests/2',
              },
            },
            source: { repository: { full_name: 'alpha/archive' } },
            destination: { repository: { full_name: 'alpha/archive' } },
          },
        ],
      },
    },
  ]);

  const contributions = await fetchBitbucketPullRequestContributions(
    requestQueue,
    ['archive'],
  );

  assert.deepEqual(contributions, [
    {
      category: 'Pull requests',
      contributionType: 'pull_request.opened',
      occurredAt: '2026-03-01T00:00:00.000Z',
      dedupeKeyInput: 'https://bitbucket.org/alpha/keep/pull-requests/1',
    },
  ]);
});
