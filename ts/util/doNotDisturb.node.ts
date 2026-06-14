// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { isDoNotDisturbEnabled as getNativeDoNotDisturbEnabled } from '@signalapp/mute-state-change';

import { SECOND } from './durations/index.std.ts';

const CACHE_TTL_MS = 5 * SECOND;
const EXEC_TIMEOUT_MS = 2 * SECOND;

const execFile = promisify(execFileCb);

type CachedResult = Readonly<{
  expiresAt: number;
  value: boolean;
}>;
type CommandRunner = (
  command: string,
  args: ReadonlyArray<string>
) => Promise<string | undefined>;
type MacDoNotDisturbDebugState = Readonly<{
  platform: string;
  nativeObservedState?: boolean;
}>;
type DesktopQuery = () => Promise<boolean | undefined>;

const GNOME_NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';

// If the freedesktop.org Notifications.Inhibited property is unavailable, fall
// back to desktop-specific settings based on XDG_CURRENT_DESKTOP.
const LINUX_DESKTOP_QUERIES: ReadonlyArray<{
  desktops: ReadonlyArray<string>;
  query: DesktopQuery;
}> = [
  {
    desktops: ['GNOME', 'UNITY', 'BUDGIE', 'PANTHEON'],
    query: queryGnomeDoNotDisturb,
  },
  { desktops: ['CINNAMON'], query: queryCinnamonDoNotDisturb },
  { desktops: ['XFCE'], query: queryXfceDoNotDisturb },
];

let cachedResult: CachedResult | undefined;
let commandRunner = runCommand;
let pendingQuery: Promise<boolean> | undefined;

export async function isDoNotDisturbEnabled(): Promise<boolean> {
  // Cache short bursts of lookups and share the same in-flight query so we
  // avoid spawning multiple child processes for the same notification batch.
  if (cachedResult && cachedResult.expiresAt > Date.now()) {
    return cachedResult.value;
  }

  pendingQuery ??= queryDoNotDisturbEnabled()
    .then(value => {
      cachedResult = { expiresAt: Date.now() + CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      pendingQuery = undefined;
    });

  return pendingQuery;
}

export function _getDoNotDisturbDebugStateForTests(): MacDoNotDisturbDebugState {
  return {
    platform: process.platform,
    nativeObservedState: getNativeDoNotDisturbEnabled(),
  };
}

/** @internal */
export function _resetDoNotDisturbCacheForTests(): void {
  cachedResult = undefined;
  pendingQuery = undefined;
  commandRunner = runCommand;
}

/** @internal */
export function _setDoNotDisturbCommandRunnerForTests(
  runner: CommandRunner
): void {
  commandRunner = runner;
}

async function queryDoNotDisturbEnabled(): Promise<boolean> {
  if (process.platform === 'linux') {
    return isLinuxDoNotDisturbEnabled();
  }

  if (process.platform === 'darwin') {
    return getNativeDoNotDisturbEnabled() ?? false;
  }

  return false;
}

async function isLinuxDoNotDisturbEnabled(): Promise<boolean> {
  // Prefer the freedesktop.org Notifications 1.2 `Inhibited` property first.
  // It covers more environments than any single desktop-specific fallback.
  const inhibited = await queryFreedesktopNotificationsInhibited();
  if (inhibited !== undefined) {
    return inhibited;
  }

  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase();
  const match = LINUX_DESKTOP_QUERIES.find(({ desktops }) =>
    desktops.some(name => desktop.includes(name))
  );

  return (await match?.query()) ?? false;
}

async function queryFreedesktopNotificationsInhibited(): Promise<
  boolean | undefined
> {
  const stdout = await commandRunner('dbus-send', [
    '--session',
    '--print-reply',
    '--dest=org.freedesktop.Notifications',
    '/org/freedesktop/Notifications',
    'org.freedesktop.DBus.Properties.Get',
    'string:org.freedesktop.Notifications',
    'string:Inhibited',
  ]);

  if (!stdout) {
    return undefined;
  }

  return parseBoolean(/\bboolean (true|false)\b/.exec(stdout)?.[1]);
}

async function queryGnomeDoNotDisturb(): Promise<boolean | undefined> {
  // `show-banners` is the modern key; fall back to the older `enable` key.
  const showBanners = await queryGSettingsDoNotDisturb(
    GNOME_NOTIFICATIONS_SCHEMA,
    'show-banners'
  );
  if (showBanners !== undefined) {
    return showBanners;
  }

  return queryGSettingsDoNotDisturb(GNOME_NOTIFICATIONS_SCHEMA, 'enable');
}

function queryCinnamonDoNotDisturb(): Promise<boolean | undefined> {
  return queryGSettingsDoNotDisturb(
    'org.cinnamon.desktop.notifications',
    'display-notifications'
  );
}

// gsettings notification keys report whether notifications are shown, so Do Not
// Disturb is the inverse of the stored value.
async function queryGSettingsDoNotDisturb(
  schema: string,
  key: string
): Promise<boolean | undefined> {
  const shown = parseBoolean(
    await commandRunner('gsettings', ['get', schema, key])
  );
  return shown === undefined ? undefined : !shown;
}

async function queryXfceDoNotDisturb(): Promise<boolean | undefined> {
  return parseBoolean(
    await commandRunner('xfconf-query', [
      '-c',
      'xfce4-notifyd',
      '-p',
      '/do-not-disturb',
    ])
  );
}

async function runCommand(
  command: string,
  args: ReadonlyArray<string>
): Promise<string | undefined> {
  try {
    const { stdout } = await execFile(command, args, {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}
