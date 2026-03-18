import assert from 'node:assert/strict';
import test from 'node:test';
import { logger } from '../logger.ts';
import {
  getManualSyncBusyMessage,
  getScheduledSyncBusyMessage,
  isSyncActive,
  resetSyncTriggerCoordinatorForTests,
  triggerIntegrationsSync,
} from './sync-trigger-coordinator.ts';

function createDeferredPromise<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (!resolvePromise || !rejectPromise) {
    throw new Error('Failed to create deferred promise.');
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

const EMPTY_SYNC_SUMMARY = {
  totalIntegrations: 0,
  successfulCount: 0,
  failedCount: 0,
  runs: [],
};

async function waitForSyncToBecomeInactive(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isSyncActive()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.fail('Expected active sync lock to clear.');
}

test('triggerIntegrationsSync starts a manual sync and marks sync as active', async () => {
  resetSyncTriggerCoordinatorForTests();
  const deferred = createDeferredPromise(EMPTY_SYNC_SUMMARY);
  let executeCalls = 0;

  const result = await triggerIntegrationsSync({
    source: 'manual',
    executeSync: async () => {
      executeCalls += 1;
      return deferred.promise;
    },
  });

  assert.equal(result.status, 'started');
  assert.equal(isSyncActive(), true);
  await Promise.resolve();
  assert.equal(executeCalls, 1);

  deferred.resolve(EMPTY_SYNC_SUMMARY);
  await waitForSyncToBecomeInactive();
  resetSyncTriggerCoordinatorForTests();
});

test('triggerIntegrationsSync returns busy for manual triggers during an active sync', async () => {
  resetSyncTriggerCoordinatorForTests();
  const deferred = createDeferredPromise(EMPTY_SYNC_SUMMARY);

  await triggerIntegrationsSync({
    source: 'manual',
    executeSync: async () => deferred.promise,
  });

  const busyResult = await triggerIntegrationsSync({
    source: 'manual',
    executeSync: async () => {
      throw new Error('Expected busy response to skip sync execution.');
    },
  });

  assert.deepEqual(busyResult, {
    status: 'busy',
    message: getManualSyncBusyMessage(),
  });

  deferred.resolve(EMPTY_SYNC_SUMMARY);
  await Promise.resolve();
  await Promise.resolve();
  resetSyncTriggerCoordinatorForTests();
});

test('triggerIntegrationsSync skips scheduled trigger when an active sync exists and logs warning', async () => {
  resetSyncTriggerCoordinatorForTests();
  const deferred = createDeferredPromise(EMPTY_SYNC_SUMMARY);

  const originalWarn = logger.warn;
  const warningMessages: Array<string> = [];
  (logger as unknown as { warn: (...args: Array<unknown>) => void }).warn = (
    ...args: Array<unknown>
  ) => {
    warningMessages.push(String(args.at(-1)));
  };

  try {
    await triggerIntegrationsSync({
      source: 'manual',
      executeSync: async () => deferred.promise,
    });

    const busyResult = await triggerIntegrationsSync({
      source: 'scheduled',
      executeSync: async () => {
        throw new Error('Expected scheduled trigger to be skipped.');
      },
    });

    assert.deepEqual(busyResult, {
      status: 'busy',
      message: getScheduledSyncBusyMessage(),
    });
    assert.ok(warningMessages.includes(getScheduledSyncBusyMessage()));
  } finally {
    (logger as unknown as { warn: typeof logger.warn }).warn = originalWarn;
    deferred.resolve(EMPTY_SYNC_SUMMARY);
    await Promise.resolve();
    await Promise.resolve();
    resetSyncTriggerCoordinatorForTests();
  }
});

test('triggerIntegrationsSync clears active lock after a failed background sync', async () => {
  resetSyncTriggerCoordinatorForTests();

  await triggerIntegrationsSync({
    source: 'manual',
    executeSync: async () => {
      throw new Error('boom');
    },
  });

  assert.equal(isSyncActive(), true);
  await waitForSyncToBecomeInactive();
  resetSyncTriggerCoordinatorForTests();
});
