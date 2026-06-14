// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

export function isMuted(): boolean | undefined;
export function setIsMuted(newValue: boolean): void;
export function isDoNotDisturbEnabled(): boolean | undefined;

export type SubscriberFunction = (isMuted: boolean) => void;
export type DoNotDisturbSubscriberFunction = (
  isDoNotDisturbEnabled: boolean
) => void;

export function subscribe(fn: SubscriberFunction): boolean;
export function unsubscribe(fn: SubscriberFunction): boolean;
export function subscribeDoNotDisturb(
  fn: DoNotDisturbSubscriberFunction
): boolean;
export function unsubscribeDoNotDisturb(
  fn: DoNotDisturbSubscriberFunction
): boolean;
