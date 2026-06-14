// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import bindings from 'bindings';

let addon;
const muteSubscribers = new Set();
const dndSubscribers = new Set();

function onIsMutedChange() {
  const newValue = isMuted();
  for (const fn of muteSubscribers) {
    fn(newValue);
  }
}

function onDoNotDisturbChange(newValue) {
  for (const fn of dndSubscribers) {
    fn(newValue);
  }
}

function getAddon() {
  if (addon === undefined) {
    try {
      addon = bindings('mute-state-change');
      addon.onIsMutedChange(onIsMutedChange);
      addon.onDoNotDisturbChange(onDoNotDisturbChange);
    } catch {
      // Windows, Linux, older macOS
      addon = {
        getIsDoNotDisturbEnabled: () => undefined,
        getIsMuted: () => undefined,
        onDoNotDisturbChange: () => undefined,
        onIsMutedChange: () => undefined,
        setIsMuted: () => undefined,
      };
    }
  }

  return addon;
}

export function isMuted() {
  return getAddon().getIsMuted();
}

export function setIsMuted(newValue) {
  getAddon().setIsMuted(!!newValue);
}

export function isDoNotDisturbEnabled() {
  return getAddon().getIsDoNotDisturbEnabled();
}

export function subscribe(callback) {
  muteSubscribers.add(callback);
}

export function unsubscribe(callback) {
  muteSubscribers.delete(callback);
}

export function subscribeDoNotDisturb(callback) {
  dndSubscribers.add(callback);
}

export function unsubscribeDoNotDisturb(callback) {
  dndSubscribers.delete(callback);
}
