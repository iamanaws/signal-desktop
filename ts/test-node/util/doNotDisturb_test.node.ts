// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import sinon from 'sinon';

import {
  isDoNotDisturbEnabled,
  _resetDoNotDisturbCacheForTests,
  _setDoNotDisturbCommandRunnerForTests,
} from '../../util/doNotDisturb.node.ts';

function stubCommandRunner(
  sandbox: sinon.SinonSandbox,
  results: ReadonlyArray<string | Error>
): sinon.SinonStub<
  [command: string, args: ReadonlyArray<string>],
  Promise<string | undefined>
> {
  const commandRunner = sandbox.stub<
    [command: string, args: ReadonlyArray<string>],
    Promise<string | undefined>
  >();

  results.forEach((result, index) => {
    commandRunner
      .onCall(index)
      .resolves(result instanceof Error ? undefined : result.trim());
  });

  _setDoNotDisturbCommandRunnerForTests(commandRunner);

  return commandRunner;
}

const DBUS_INHIBITED_TRUE =
  'method return time=0.0 sender=:1.1 -> destination=:1.2 ' +
  'serial=3 reply_serial=2\n   variant       boolean true\n';

describe('doNotDisturb', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    _resetDoNotDisturbCacheForTests();
  });

  afterEach(() => {
    sandbox.restore();
    _resetDoNotDisturbCacheForTests();
  });

  it('uses the freedesktop inhibited property on Linux when available', async () => {
    sandbox.stub(process, 'platform').value('linux');
    const commandRunner = stubCommandRunner(sandbox, [DBUS_INHIBITED_TRUE]);

    assert.isTrue(await isDoNotDisturbEnabled());
    assert.strictEqual(commandRunner.callCount, 1);
  });

  it('falls back to gsettings when dbus does not expose inhibition', async () => {
    sandbox.stub(process, 'platform').value('linux');
    sandbox.stub(process, 'env').value({
      ...process.env,
      XDG_CURRENT_DESKTOP: 'GNOME',
    });
    const commandRunner = stubCommandRunner(sandbox, [
      new Error('unavailable'),
      'false\n',
    ]);

    assert.isTrue(await isDoNotDisturbEnabled());
    assert.strictEqual(commandRunner.callCount, 2);
  });

  it('falls back to Cinnamon settings on Cinnamon', async () => {
    sandbox.stub(process, 'platform').value('linux');
    sandbox.stub(process, 'env').value({
      ...process.env,
      XDG_CURRENT_DESKTOP: 'X-Cinnamon',
    });
    const commandRunner = stubCommandRunner(sandbox, [
      new Error('unavailable'),
      'false\n',
    ]);

    assert.isTrue(await isDoNotDisturbEnabled());
    assert.deepStrictEqual(commandRunner.secondCall.args[1], [
      'get',
      'org.cinnamon.desktop.notifications',
      'display-notifications',
    ]);
  });

  it('falls back to XFCE settings on XFCE', async () => {
    sandbox.stub(process, 'platform').value('linux');
    sandbox.stub(process, 'env').value({
      ...process.env,
      XDG_CURRENT_DESKTOP: 'XFCE',
    });
    const commandRunner = stubCommandRunner(sandbox, [
      new Error('unavailable'),
      'true\n',
    ]);

    assert.isTrue(await isDoNotDisturbEnabled());
    assert.deepStrictEqual(commandRunner.secondCall.args[1], [
      '-c',
      'xfce4-notifyd',
      '-p',
      '/do-not-disturb',
    ]);
  });

  it('does not run desktop-specific fallbacks for unknown desktops', async () => {
    sandbox.stub(process, 'platform').value('linux');
    sandbox.stub(process, 'env').value({
      ...process.env,
      XDG_CURRENT_DESKTOP: 'LXQt',
    });
    const commandRunner = stubCommandRunner(sandbox, [new Error('unavailable')]);

    assert.isFalse(await isDoNotDisturbEnabled());
    assert.strictEqual(commandRunner.callCount, 1);
  });

  it('caches results for five seconds', async () => {
    sandbox.stub(process, 'platform').value('linux');
    const clock = sandbox.useFakeTimers();
    const commandRunner = stubCommandRunner(sandbox, [
      DBUS_INHIBITED_TRUE,
      DBUS_INHIBITED_TRUE,
    ]);

    assert.isTrue(await isDoNotDisturbEnabled());
    assert.isTrue(await isDoNotDisturbEnabled());
    assert.strictEqual(commandRunner.callCount, 1);

    clock.tick(5001);

    assert.isTrue(await isDoNotDisturbEnabled());
    assert.strictEqual(commandRunner.callCount, 2);
  });
});
