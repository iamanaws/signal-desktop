// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

#include <mutex>

#include <AVFAudio/AVFAudio.h>
#include <Foundation/Foundation.h>

#include "napi.h"

struct InstanceData {
  std::mutex mutex;
  Napi::ThreadSafeFunction on_mute_change;
  Napi::ThreadSafeFunction on_dnd_change;
  bool dnd_known = false;
  bool dnd_enabled = false;
  id dnd_enabled_observer = nil;
  id dnd_disabled_observer = nil;
};

static NSString* const kDoNotDisturbEnabledNotification =
    @"_NSDoNotDisturbEnabledNotification";
static NSString* const kDoNotDisturbDisabledNotification =
    @"_NSDoNotDisturbDisabledNotification";

API_AVAILABLE(macos(14.0))
static Napi::Value GetIsMuted(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(),
                            AVAudioApplication.sharedInstance.inputMuted);
}

static Napi::Value GetIsDoNotDisturbEnabled(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto data = env.GetInstanceData<InstanceData>();
  std::lock_guard<std::mutex> guard(data->mutex);
  if (!data->dnd_known) {
    return env.Undefined();
  }
  return Napi::Boolean::New(env, data->dnd_enabled);
}

API_AVAILABLE(macos(14.0))
static void SetIsMuted(const Napi::CallbackInfo& info) {
  auto value = info[0].As<Napi::Boolean>();
  assert(value.IsBoolean());

  NSError* err = nil;
  BOOL muted = value.Value() ? YES : NO;
  auto res = [AVAudioApplication.sharedInstance setInputMuted:muted error:&err];
  if (!res || err != nil) {
    Napi::Error::New(info.Env(), err.localizedDescription.UTF8String)
        .ThrowAsJavaScriptException();
    return;
  }
}

API_AVAILABLE(macos(14.0))
static void OnIsMutedChange(const Napi::CallbackInfo& info) {
  auto env = info.Env();

  auto callback = info[0].As<Napi::Function>();
  assert(callback.IsFunction());

  auto data = env.GetInstanceData<InstanceData>();
  {
    std::lock_guard<std::mutex> guard(data->mutex);
    data->on_mute_change = Napi::ThreadSafeFunction::New(
        env, callback, "mute-state-change.onChange", 1, 1);
    data->on_mute_change.Unref(env);
  }
}

static void OnDoNotDisturbChange(const Napi::CallbackInfo& info) {
  auto env = info.Env();

  auto callback = info[0].As<Napi::Function>();
  assert(callback.IsFunction());

  auto data = env.GetInstanceData<InstanceData>();
  {
    std::lock_guard<std::mutex> guard(data->mutex);
    data->on_dnd_change = Napi::ThreadSafeFunction::New(
        env, callback, "mute-state-change.onDoNotDisturbChange", 1, 1);
    data->on_dnd_change.Unref(env);
  }
}

static void UpdateDoNotDisturbState(InstanceData* data, bool enabled) {
  std::lock_guard<std::mutex> guard(data->mutex);
  data->dnd_known = true;
  data->dnd_enabled = enabled;
  if (data->on_dnd_change) {
    data->on_dnd_change.NonBlockingCall([enabled](Napi::Env env,
                                                  Napi::Function fn) {
      fn.Call({Napi::Boolean::New(env, enabled)});
    });
  }
}

static void FinalizeInstance(Napi::Env env, InstanceData* data) {
  if (@available(macos 14.0, *)) {
    [AVAudioApplication.sharedInstance setInputMuteStateChangeHandler:nil
                                                                error:nil];
  }
  if (data->dnd_enabled_observer != nil || data->dnd_disabled_observer != nil) {
    auto center = NSDistributedNotificationCenter.defaultCenter;
    if (data->dnd_enabled_observer != nil) {
      [center removeObserver:data->dnd_enabled_observer];
    }
    if (data->dnd_disabled_observer != nil) {
      [center removeObserver:data->dnd_disabled_observer];
    }
  }
  delete data;
}

API_AVAILABLE(macos(14.0))
static void Init(Napi::Env env) {
  auto instanceData = new InstanceData();
  env.SetInstanceData<InstanceData, FinalizeInstance>(instanceData);

  NSError* err = nil;
  auto res = [AVAudioApplication.sharedInstance
      setInputMuteStateChangeHandler:^(BOOL muted) {
        std::lock_guard<std::mutex> guard(instanceData->mutex);
        if (instanceData->on_mute_change) {
          instanceData->on_mute_change.NonBlockingCall(
              ^(Napi::Env env, Napi::Function fn) {
                fn.Call({});
              });
        }
        return YES;
      }
                               error:&err];
  if (!res || err != nil) {
    Napi::Error::New(env, err.localizedDescription.UTF8String)
        .ThrowAsJavaScriptException();
    return;
  }

  // Setup the observer, otherwise the callback above is never called
  [NSNotificationCenter.defaultCenter
      addObserverForName:AVAudioApplicationInputMuteStateChangeNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*){
              }];

  auto center = NSDistributedNotificationCenter.defaultCenter;
  instanceData->dnd_enabled_observer = [center
      addObserverForName:kDoNotDisturbEnabledNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                UpdateDoNotDisturbState(instanceData, true);
              }];
  instanceData->dnd_disabled_observer = [center
      addObserverForName:kDoNotDisturbDisabledNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                UpdateDoNotDisturbState(instanceData, false);
              }];
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports["getIsDoNotDisturbEnabled"] =
      Napi::Function::New(env, &GetIsDoNotDisturbEnabled);
  exports["onDoNotDisturbChange"] =
      Napi::Function::New(env, &OnDoNotDisturbChange);

  if (@available(macos 14.0, *)) {
    exports["getIsMuted"] = Napi::Function::New(env, &GetIsMuted);
    exports["setIsMuted"] = Napi::Function::New(env, &SetIsMuted);
    exports["onIsMutedChange"] = Napi::Function::New(env, &OnIsMutedChange);

    Init(env);
  }
  return exports;
}

NODE_API_MODULE(mute - state - change, Init)
