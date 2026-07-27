/**
 * Notification categories and actions (INT-020).
 *
 * A "category" (`setNotificationCategoryAsync`) is expo-notifications' one
 * cross-platform abstraction over both iOS's `UNNotificationCategory` +
 * `UNTextInputNotificationAction` and Android's per-notification action
 * buttons + `RemoteInput`. `setNotificationCategoryAsync` is documented
 * `@platform android @platform ios` in the installed
 * expo-notifications@57.0.7 types, and its Android native implementation
 * (`ExpoNotificationBuilder.kt`) builds an `androidx.core.app.RemoteInput`
 * straight off an action's `textInput` field — so registering one category
 * here covers both platforms' text-reply UI. (Note: `NotificationContentInput
 * .categoryIdentifier`'s own TSDoc is annotated `@platform ios` only — that
 * annotation looks stale/incomplete against the actual native Android
 * source, which reads `categoryIdentifier` off the content payload
 * unconditionally (`ArgumentsNotificationContentBuilder.CATEGORY_IDENTIFIER_KEY`).
 * Verified by reading the native Android sources under
 * `node_modules/expo-notifications/android/src/main/java/...`, not just the
 * docs — flagging this because it contradicts what the .d.ts comment says.)
 *
 * Category identifiers reuse the channel ids 1:1 — one category per channel,
 * not a shared namespace, so there's no separate id scheme to keep in sync.
 *
 * No category may carry a Dismiss action — see `_assertNoDismissAction`,
 * the client-side mirror of the server's `fennoc/notify/payload.py`
 * `_validate_actions` hard rejection.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import type { ChannelId } from "./channels";

// Action identifiers. Stable strings — the response listener switches on
// these, and (for "questions") they get echoed toward the reply endpoint's
// semantics ("not now" is recorded as an answer, not silently dropped).
export const ACTION_ANSWER = "answer";
export const ACTION_NOT_NOW = "not_now";
export const ACTION_START_IT = "start_it";
export const ACTION_NOT_TODAY = "not_today";
export const ACTION_READ = "read";
export const ACTION_STOP = "stop";
export const ACTION_SWITCH = "switch";

const CATEGORY_ACTIONS: Record<ChannelId, Notifications.NotificationAction[]> = {
  questions: [
    {
      identifier: ACTION_ANSWER,
      buttonTitle: "Answer",
      textInput: {
        placeholder: "Type a reply…",
        submitButtonTitle: "Send",
      },
      options: { opensAppToForeground: false },
    },
    {
      identifier: ACTION_NOT_NOW,
      buttonTitle: "Not now",
      options: { opensAppToForeground: false },
    },
  ],
  returns: [
    {
      identifier: ACTION_START_IT,
      buttonTitle: "Start it",
      options: { opensAppToForeground: true },
    },
    {
      identifier: ACTION_NOT_TODAY,
      buttonTitle: "Not today",
      options: { opensAppToForeground: false },
    },
  ],
  briefing: [
    {
      identifier: ACTION_READ,
      buttonTitle: "Read",
      options: { opensAppToForeground: true },
    },
  ],
  tracking: [
    {
      identifier: ACTION_STOP,
      buttonTitle: "Stop",
      options: { opensAppToForeground: false },
    },
    {
      identifier: ACTION_SWITCH,
      buttonTitle: "Switch",
      options: { opensAppToForeground: true },
    },
  ],
};

/**
 * Defensive mirror of the server's `_looks_like_dismiss` /
 * `_validate_actions` (`fennoc/notify/payload.py`). The action sets above
 * are hand-authored and fixed, so this can never actually fire today — it
 * exists so a future edit to `CATEGORY_ACTIONS` fails loudly in dev instead
 * of quietly shipping the exact reflex-teaching button INT-020 forbids.
 */
function assertNoDismissAction(action: Notifications.NotificationAction): void {
  const haystack = `${action.identifier} ${action.buttonTitle}`.toLowerCase();
  if (haystack.includes("dismiss")) {
    throw new Error(
      `[notifications] Dismiss-like action not allowed on any category: ${action.identifier}`,
    );
  }
}

/**
 * Register the four notification categories (action sets). Runs on iOS and
 * Android; guarded against web, which this app config does not meaningfully
 * target for notifications.
 */
export async function registerNotificationCategoriesAsync(): Promise<void> {
  if (Platform.OS === "web") return;

  for (const channelId of Object.keys(CATEGORY_ACTIONS) as ChannelId[]) {
    const actions = CATEGORY_ACTIONS[channelId];
    if (__DEV__) {
      actions.forEach(assertNoDismissAction);
    }
    await Notifications.setNotificationCategoryAsync(channelId, actions);
  }
}
