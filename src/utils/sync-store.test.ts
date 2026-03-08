import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalisedContribution } from '../server/providers.ts';
import { persistContributionsWithDatabase } from './sync-store.ts';

interface FakeDatabaseOptions {
  failOnInsert?: number;
}

function createFakeDatabase(options: FakeDatabaseOptions = {}) {
  const seenContributionKeys = new Set<string>();
  const seenCommitKeys = new Set<string>();
  const statements: Array<string> = [];
  let insertCounter = 0;

  const database = {
    async sql<T = unknown>(
      strings: TemplateStringsArray,
      ...values: Array<unknown>
    ): Promise<T> {
      const statement = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push(statement);

      if (
        statement.startsWith('INSERT OR IGNORE INTO contributions') ||
        statement.startsWith('INSERT OR IGNORE INTO commits')
      ) {
        insertCounter += 1;
        if (options.failOnInsert === insertCounter) {
          throw new Error('insert failed');
        }
      }

      if (statement.startsWith('INSERT OR IGNORE INTO contributions')) {
        const dedupeKey = String(values[5] ?? '');
        if (seenContributionKeys.has(dedupeKey)) {
          return { changes: 0 } as T;
        }

        seenContributionKeys.add(dedupeKey);
        return { changes: 1 } as T;
      }

      if (statement.startsWith('INSERT OR IGNORE INTO commits')) {
        const dedupeKey = String(values[0] ?? '');
        if (seenCommitKeys.has(dedupeKey)) {
          return { changes: 0 } as T;
        }

        seenCommitKeys.add(dedupeKey);
        return { changes: 1 } as T;
      }

      return {} as T;
    },
  };

  return {
    database,
    statements,
  };
}

function contribution(
  contributionType: NormalisedContribution['contributionType'],
  occurredAt = '2026-03-01T00:00:00.000Z',
): NormalisedContribution {
  const commitKey = `sha-${occurredAt}`;

  return {
    category: contributionType.startsWith('commit.')
      ? 'Commits'
      : contributionType === 'issue.opened'
        ? 'Issues'
        : 'Pull requests',
    contributionType,
    occurredAt,
    dedupeKeyInput:
      contributionType === 'commit.authored'
        ? commitKey
        : `${contributionType}:${occurredAt}`,
  };
}

test('persistContributionsWithDatabase writes contributions in a transaction and projects authored commits', async () => {
  const { database, statements } = createFakeDatabase();

  const stored = await persistContributionsWithDatabase(
    'github-main',
    'github',
    [
      contribution('commit.authored'),
      contribution('commit.authored'),
      contribution('issue.opened'),
    ],
    database,
  );

  assert.deepEqual(stored, {
    contributionsStored: 2,
    commitsStored: 1,
  });
  assert.ok(statements.some((statement) => statement === 'BEGIN'));
  assert.ok(statements.some((statement) => statement === 'COMMIT'));
  assert.equal(
    statements.some((statement) => statement === 'ROLLBACK'),
    false,
  );
});

test('persistContributionsWithDatabase rolls back the transaction when an insert fails', async () => {
  const { database, statements } = createFakeDatabase({ failOnInsert: 2 });

  await assert.rejects(() =>
    persistContributionsWithDatabase(
      'github-main',
      'github',
      [contribution('commit.authored'), contribution('issue.opened')],
      database,
    ),
  );

  assert.ok(statements.some((statement) => statement === 'BEGIN'));
  assert.ok(statements.some((statement) => statement === 'ROLLBACK'));
  assert.equal(
    statements.some((statement) => statement === 'COMMIT'),
    false,
  );
});

test('persistContributionsWithDatabase deduplicates the same provider contribution across integrations', async () => {
  const { database } = createFakeDatabase();
  const authoredCommit = contribution('commit.authored');
  const openedIssue = contribution('issue.opened');

  const firstStored = await persistContributionsWithDatabase(
    'github-main',
    'github',
    [authoredCommit, openedIssue],
    database,
  );
  const secondStored = await persistContributionsWithDatabase(
    'github-secondary',
    'github',
    [authoredCommit, openedIssue],
    database,
  );

  assert.deepEqual(firstStored, {
    contributionsStored: 2,
    commitsStored: 1,
  });
  assert.deepEqual(secondStored, {
    contributionsStored: 0,
    commitsStored: 0,
  });
});
