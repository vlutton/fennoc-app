/**
 * The four push notification channels (INT-020), and no fifth.
 *
 * Mirrors `fennoc-core`'s `fennoc/notify/channels.py` exactly — same four
 * ids, same importance mapping, same sound/budget semantics. That module is
 * the source of truth; this file is the Android-side registration of the
 * same four channels via `expo-notifications`' `setNotificationChannelAsync`.
 *
 * Channels are an Android-only concept (`NotificationChannel` was
 * introduced in Android 8/API 26; iOS has no equivalent — its nearest
 * analogue, `interruptionLevel`, is set per-notification instead, not
 * registered up front). `registerNotificationChannelsAsync` is a no-op on
 * every other platform rather than throwing, per INT-020 scope.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export type ChannelId = "questions" | "returns" | "briefing" | "tracking";

// The design system's amber accent (`signal.DEFAULT` in
// src/theme/tokens.js), also passed as the global notification-icon accent
// in app.json's expo-notifications plugin config. Duplicated as a literal
// here (rather than importing theme/colors.ts) so this module stays
// import-light enough to safely no-op on iOS without dragging in the
// NativeWind/theme stack for one hex value.
const CHANNEL_ACCENT = "#F0A93B";

export interface ChannelSpec {
  id: ChannelId;
  /** Display name shown in the Android system channel settings UI. */
  name: string;
  importance: Notifications.AndroidImportance;
  /** Whether this channel plays sound. Silent channels also skip vibration. */
  sound: boolean;
  /** Mirrors `Channel.spends_budget` in the server's channels.py. */
  spendsBudget: boolean;
}

export const CHANNELS: Record<ChannelId, ChannelSpec> = {
  questions: {
    id: "questions",
    name: "Questions",
    importance: Notifications.AndroidImportance.HIGH,
    sound: true,
    spendsBudget: true,
  },
  returns: {
    id: "returns",
    name: "Returns",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: true,
    spendsBudget: true,
  },
  briefing: {
    id: "briefing",
    name: "Briefing",
    importance: Notifications.AndroidImportance.LOW,
    sound: false,
    spendsBudget: false,
  },
  tracking: {
    id: "tracking",
    name: "Tracking",
    importance: Notifications.AndroidImportance.MIN,
    sound: false,
    spendsBudget: false,
  },
};

export const CHANNEL_IDS: ChannelId[] = ["questions", "returns", "briefing", "tracking"];

/**
 * Register the four Android notification channels. Safe to call on every
 * platform / every launch — `setNotificationChannelAsync` upserts, and this
 * function is a no-op on non-Android platforms.
 */
export async function registerNotificationChannelsAsync(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Promise.all(
    CHANNEL_IDS.map((id) => {
      const channel = CHANNELS[id];
      // `sound` is a FILENAME for a bundled custom sound, not a mode. Passing
      // "default" makes the native side hunt for a file called "default" and
      // log `Custom sound 'default' not found in native app` on every channel
      // registration. Omitting the key entirely is what selects the system
      // default; `null` is what makes a channel silent.
      return Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.importance,
        ...(channel.sound ? {} : { sound: null }),
        enableVibrate: channel.sound,
        vibrationPattern: channel.sound ? undefined : null,
        lightColor: CHANNEL_ACCENT,
        enableLights: true,
        showBadge: false,
      });
    }),
  );
}
