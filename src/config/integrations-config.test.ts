import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadIntegrationsFromConfig } from './integrations-config.ts';

async function withTempConfig(
  content: string,
  callback: () => void | Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'corvus-config-test-'));
  const configPath = path.join(directory, 'integrations.yaml');
  const previousConfigPath = process.env.CONFIG_PATH;

  writeFileSync(configPath, content, 'utf8');
  process.env.CONFIG_PATH = configPath;

  try {
    await callback();
  } finally {
    if (previousConfigPath == null) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = previousConfigPath;
    }

    rmSync(directory, { recursive: true, force: true });
  }
}

test('loadIntegrationsFromConfig defaults enabled to true and accepts enabled false', async () => {
  await withTempConfig(
    `integrations:
  - id: enabled-integration
    provider: github
    auth:
      username: enabled-user
      token: token-enabled
  - id: disabled-integration
    provider: github
    enabled: false
    auth:
      username: disabled-user
      token: token-disabled
`,
    () => {
      const integrations = loadIntegrationsFromConfig();

      assert.equal(integrations.length, 2);
      assert.equal(integrations[0]?.enabled, true);
      assert.equal(integrations[1]?.enabled, false);
    },
  );
});

test('loadIntegrationsFromConfig accepts config without explicit version', async () => {
  await withTempConfig(
    `integrations:
  - id: github-main
    provider: github
    auth:
      username: octocat
      token: token
`,
    () => {
      const integrations = loadIntegrationsFromConfig();

      assert.equal(integrations.length, 1);
      assert.equal(integrations[0]?.provider, 'github');
    },
  );
});

test('loadIntegrationsFromConfig ignores top-level version key when present', async () => {
  await withTempConfig(
    `version: 1
integrations:
  - id: github-main
    provider: github
    auth:
      username: octocat
      token: token
`,
    () => {
      const integrations = loadIntegrationsFromConfig();

      assert.equal(integrations.length, 1);
      assert.equal(integrations[0]?.provider, 'github');
    },
  );
});

test('loadIntegrationsFromConfig rejects duplicate integration ids', async () => {
  await withTempConfig(
    `integrations:
  - id: github-main
    provider: github
    auth:
      username: first-user
      token: first-token
  - id: github-main
    provider: github
    auth:
      username: second-user
      token: second-token
`,
    () => {
      assert.throws(() => loadIntegrationsFromConfig(), {
        message: /duplicate integration ids/i,
      });
    },
  );
});

test('loadIntegrationsFromConfig rejects unknown provider', async () => {
  await withTempConfig(
    `integrations:
  - id: unknown-provider
    provider: unknown
    auth:
      username: unknown-user
      token: unknown-token
`,
    () => {
      assert.throws(() => loadIntegrationsFromConfig(), {
        message: /unknown provider/i,
      });
    },
  );
});

test('loadIntegrationsFromConfig accepts forgejo source.base_url', async () => {
  await withTempConfig(
    `integrations:
  - id: forgejo-main
    provider: forgejo
    auth:
      username: forgejo-user
      token: token-forgejo
    source:
      base_url: https://forgejo.example.com
`,
    () => {
      const integrations = loadIntegrationsFromConfig();
      const integration = integrations[0];

      assert.equal(integrations.length, 1);
      assert.equal(integration?.provider, 'forgejo');
      assert.equal(
        integration?.fetchOptions.url,
        'https://forgejo.example.com',
      );
    },
  );
});

test('loadIntegrationsFromConfig requires forgejo source.base_url', async () => {
  await withTempConfig(
    `integrations:
  - id: forgejo-main
    provider: forgejo
    auth:
      username: forgejo-user
      token: token-forgejo
`,
    () => {
      assert.throws(() => loadIntegrationsFromConfig(), {
        message: /source|base_url/i,
      });
    },
  );
});

test('loadIntegrationsFromConfig defaults remote author_include to auth.username', async () => {
  await withTempConfig(
    `integrations:
  - id: github-main
    provider: github
    auth:
      username: octocat
      token: token
`,
    () => {
      const integrations = loadIntegrationsFromConfig();
      const integration = integrations[0];

      assert.equal(integration?.provider, 'github');
      assert.deepEqual(integration?.fetchOptions.match_author, ['octocat']);
    },
  );
});

test('loadIntegrationsFromConfig accepts filepath integration and enforces required author_include', async () => {
  const rootPath = path.join(os.tmpdir(), 'corvus-filepath-provider-root');

  await withTempConfig(
    `integrations:
  - id: local-work
    provider: filepath
    source:
      path: ${JSON.stringify(rootPath)}
      depth: 2
    filters:
      author_include:
        - " Your Name "
        - "your.name@example.com"
        - "Your Name"
      repository_exclude:
        - archive
`,
    () => {
      const integrations = loadIntegrationsFromConfig();
      const integration = integrations[0];

      assert.equal(integrations.length, 1);
      assert.equal(integration?.provider, 'filepath');
      assert.equal(integration?.fetchOptions.path, rootPath);
      assert.equal(integration?.fetchOptions.depth, 2);
      assert.equal(integration?.fetchOptions.username, 'Your Name');
      assert.deepEqual(integration?.fetchOptions.match_author, [
        'Your Name',
        'your.name@example.com',
      ]);
      assert.deepEqual(integration?.fetchOptions.blacklist, ['archive']);
    },
  );

  await withTempConfig(
    `integrations:
  - id: local-work
    provider: filepath
    source:
      path: /tmp/repos
    filters:
      repository_exclude:
        - archive
`,
    () => {
      assert.throws(() => loadIntegrationsFromConfig(), {
        message: /author_include/i,
      });
    },
  );
});

test('loadIntegrationsFromConfig rejects filepath integration with relative path', async () => {
  await withTempConfig(
    `integrations:
  - id: local-repos
    provider: filepath
    source:
      path: ./relative/path
    filters:
      author_include:
        - your.name@example.com
`,
    () => {
      assert.throws(() => loadIntegrationsFromConfig(), {
        message: /path must be absolute/i,
      });
    },
  );
});

test('loadIntegrationsFromConfig rejects unknown integration keys', async () => {
  await withTempConfig(
    `integrations:
  - id: github-main
    provider: github
    auth:
      username: octocat
      token: token
    unknown_option: true
`,
    () => {
      assert.throws(() => loadIntegrationsFromConfig(), {
        message: /unknown_option/i,
      });
    },
  );
});
