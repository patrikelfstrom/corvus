import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getConfigCacheVersion,
  loadConfig,
  loadThemesFromConfig,
} from './config.ts';
import { logger } from './logger.ts';

async function withTempConfig(
  content: string,
  callback: () => void | Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'corvus-config-test-'));
  const configPath = path.join(directory, 'config.yaml');
  const previousConfigPath = process.env.CONFIG_PATH;

  writeFileSync(configPath, content, 'utf8');
  process.env.CONFIG_PATH = directory;

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

test('loadConfig includes custom themes alongside built-in themes', async () => {
  await withTempConfig(
    `theme: fuchsia
themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const config = loadConfig();
      const themes = config.themes;

      assert.equal(config.theme, 'fuchsia');
      assert.deepEqual(themes.fuchsia, {
        light: ['#eff2f5', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177'],
        dark: ['#151b23', '#7a0177', '#c51b8a', '#f768a1', '#fbb4b9'],
      });
      assert.ok(themes.corvus);
      assert.ok(themes.github);
    },
  );
});

test('loadConfig preserves the configured default theme', async () => {
  await withTempConfig(
    `theme: fuchsia
themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const config = loadConfig();

      assert.equal(config.theme, 'fuchsia');
    },
  );
});

test('loadConfig preserves configured theme name casing', async () => {
  await withTempConfig(
    `themes:
  Fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const themes = loadConfig().themes;

      assert.ok(themes.Fuchsia);
      assert.equal(themes.fuchsia, undefined);
    },
  );
});

test('loadConfig resolves config.yaml next to a file CONFIG_PATH', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'corvus-config-test-'));
  const configPath = path.join(directory, 'config.yaml');
  const integrationsConfigPath = path.join(directory, 'integrations.yaml');
  const previousConfigPath = process.env.CONFIG_PATH;

  writeFileSync(
    configPath,
    `themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    'utf8',
  );
  writeFileSync(integrationsConfigPath, 'integrations: []\n', 'utf8');
  process.env.CONFIG_PATH = integrationsConfigPath;

  try {
    const themes = loadConfig().themes;

    assert.ok(themes.fuchsia);
  } finally {
    if (previousConfigPath == null) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = previousConfigPath;
    }

    rmSync(directory, { recursive: true, force: true });
  }
});

test('loadThemesFromConfig returns the themes config property', async () => {
  await withTempConfig(
    `themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const themes = loadThemesFromConfig();

      assert.ok(themes.fuchsia);
      assert.ok(themes.corvus);
    },
  );
});

test('loadThemesFromConfig rejects custom themes that conflict with built-in names', async () => {
  await withTempConfig(
    `themes:
  github:
    light:
      - "#eff2f5"
      - "#111111"
      - "#222222"
      - "#333333"
      - "#444444"
    dark:
      - "#151b23"
      - "#111111"
      - "#222222"
      - "#333333"
      - "#444444"
`,
    () => {
      assert.throws(() => loadThemesFromConfig(), {
        message: /conflicts with a built-in theme/i,
      });
    },
  );
});

test('loadThemesFromConfig rejects invalid theme definitions', async () => {
  await withTempConfig(
    `themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
    dark: invalid
`,
    () => {
      assert.throws(() => loadThemesFromConfig(), {
        message: /Invalid config.yaml: themes.fuchsia.dark/i,
      });
    },
  );
});

test('loadConfig ignores non-renderable custom themes and logs a warning', async () => {
  await withTempConfig(
    `themes:
  broken:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const originalWarn = logger.warn;
      const warningMessages: Array<string> = [];

      (logger as unknown as { warn: (...args: Array<unknown>) => void }).warn = (
        ...args: Array<unknown>
      ) => {
        warningMessages.push(String(args.at(-1)));
      };

      try {
        const themes = loadConfig().themes;

        assert.equal(themes.broken, undefined);
        assert.ok(themes.fuchsia);
        assert.ok(
          warningMessages.includes(
            'Ignoring invalid custom theme from config.yaml',
          ),
        );
      } finally {
        (logger as unknown as { warn: typeof logger.warn }).warn = originalWarn;
      }
    },
  );
});

test('loadConfig ignores an unknown default theme and logs a warning', async () => {
  await withTempConfig(
    `theme: missing
themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const originalWarn = logger.warn;
      const warningMessages: Array<string> = [];

      (logger as unknown as { warn: (...args: Array<unknown>) => void }).warn = (
        ...args: Array<unknown>
      ) => {
        warningMessages.push(String(args.at(-1)));
      };

      try {
        const config = loadConfig();

        assert.equal(config.theme, undefined);
        assert.ok(
          warningMessages.includes(
            'Ignoring unknown default theme from config.yaml',
          ),
        );
      } finally {
        (logger as unknown as { warn: typeof logger.warn }).warn = originalWarn;
      }
    },
  );
});

test('getConfigCacheVersion changes when config.yaml changes', async () => {
  await withTempConfig(
    `theme: github
themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
    () => {
      const configDirectory = process.env.CONFIG_PATH;

      assert.ok(configDirectory);

      const configPath = path.join(configDirectory, 'config.yaml');
      const firstVersion = getConfigCacheVersion();

      writeFileSync(
        configPath,
        `theme: fuchsia
themes:
  fuchsia:
    light:
      - "#eff2f5"
      - "#fbb4b9"
      - "#f768a1"
      - "#c51b8a"
      - "#7a0177"
    dark:
      - "#151b23"
      - "#7a0177"
      - "#c51b8a"
      - "#f768a1"
      - "#fbb4b9"
`,
        'utf8',
      );

      const secondVersion = getConfigCacheVersion();

      assert.notEqual(firstVersion, secondVersion);
    },
  );
});
