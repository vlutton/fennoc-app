/**
 * Dev-only local notification firing, one per channel, for verifying
 * INT-020's channel/category wiring on an emulator without any remote
 * transport (Expo push service / FCM credentials / token upload are all
 * out of scope — see the intent doc). Every call goes through
 * `scheduleNotificationAsync` with a ~1s `TIME_INTERVAL` trigger, which is
 * the only trigger shape that accepts a `channelId` (per the installed
 * expo-notifications@57.0.7 types, an immediate/`null` trigger cannot
 * target a channel at all — `ChannelAwareTriggerInput` requires one, and a
 * schedulable trigger is the way to attach it).
 *
 * Exercises the real payload shape: title, body, the budget subtext (only
 * on the two budget-spending channels), and the channel's registered
 * category (so the action buttons show up for real).
 *
 * KNOWN GAP: the `tracking` channel's design spec calls for Android's
 * `setUsesChronometer` (a running mm:ss counter in the notification). The
 * installed expo-notifications@57.0.7 `NotificationContentInput` /
 * `NotificationContentAndroid` types expose no chronometer/`setWhen`/
 * `setShowWhen` field at all (verified by grepping the whole package, JS
 * and native Android sources — nothing). `sticky` (→ Android's
 * `setOngoing`) is the closest thing this library exposes, so that's what's
 * used below; a true chronometer would need a bare native module or an
 * expo-notifications version bump, neither of which is in this intent's
 * scope. Flagging this rather than silently shipping a non-chronometer
 * "ongoing" notification and calling it done.
 */
import * as Notifications from "expo-notifications";

import { CHANNELS, type ChannelId } from "./channels";

interface DevContent {
  title: string;
  body: string;
}

const DEV_CONTENT: Record<ChannelId, DevContent> = {
  questions: { title: "Fennoc", body: "What are you working on?" },
  returns: { title: "Fennoc", body: "The shelving order is back." },
  briefing: { title: "Fennoc", body: "Your morning briefing is ready." },
  tracking: { title: "Fennoc", body: "Tracking: Q3 draft" },
};

// iOS interruption levels, mirroring `fennoc/notify/channels.py`'s
// `ios_interruption_level` field (spelled differently here only because
// that's the literal union expo-notifications' `InterruptionLevel` type
// uses — `timeSensitive`, not `time-sensitive`).
const IOS_INTERRUPTION_LEVEL: Record<ChannelId, Notifications.InterruptionLevel> = {
  questions: "timeSensitive",
  returns: "active",
  briefing: "passive",
  tracking: "passive", // placeholder — iOS tracking is deferred to INT-028
};

// Dev fixture only: "2 of 3 remaining" — a filled mark (◆) is a ping the
// user still has, matching the resolved-2026-07-27 semantics in the intent
// doc and the server's `_budget_subtext` (payload.py). Mirrors that
// function's glyph algorithm exactly; there is no live budget to read on
// the client yet (GET /api/budget exists but this trigger is fire-and-see,
// not wired to it — wiring the real number in is next-intent work).
function devBudgetSubtext(): string {
  const limit = 3;
  const remaining = 2;
  const filled = "◆".repeat(remaining);
  const empty = "◇".repeat(limit - remaining);
  return `${filled}${empty} ${remaining} of ${limit}`;
}

/**
 * Fire one local test notification on the given channel. No-ops outside
 * dev builds. Rejects if the OS declines to schedule it (e.g. permission
 * not yet granted) — callers should catch and surface that, not assume it
 * always succeeds.
 */
export async function triggerDevNotificationAsync(channelId: ChannelId): Promise<void> {
  if (!__DEV__) return;

  const channel = CHANNELS[channelId];
  const content = DEV_CONTENT[channelId];

  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      subtitle: channel.spendsBudget ? devBudgetSubtext() : undefined,
      categoryIdentifier: channelId,
      color: "#F0A93B",
      sticky: channelId === "tracking",
      interruptionLevel: IOS_INTERRUPTION_LEVEL[channelId],
      data: {
        channel: channelId,
        questionType: "freeform",
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId,
    },
  });
}
