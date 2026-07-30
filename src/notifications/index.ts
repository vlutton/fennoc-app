/**
 * INT-020 notification layer — barrel + one-shot init.
 *
 * `initNotifications()` does the three things that must happen once, early,
 * regardless of permission state (channel/category registration is not
 * gated on permission — Android lets you create channels before the user
 * has granted POST_NOTIFICATIONS, and doing so early means the channel
 * settings exist by the time the user goes looking for them in system
 * settings):
 *
 *   1. Register the four Android channels (no-op on iOS/web).
 *   2. Register the four notification categories/actions (iOS + Android).
 *   3. Install the foreground handler and the response (tap/action) listener.
 *
 * It deliberately does NOT request permission — see permissions.ts for why,
 * and where that call belongs instead.
 *
 * It DOES, as a fourth step, opportunistically re-register the push token
 * — see the comment above that block for why that's not a contradiction of
 * the "no permission prompt" rule above.
 */
import { registerNotificationCategoriesAsync } from "./categories";
import { registerNotificationChannelsAsync } from "./channels";
import {
  configureNotificationHandler,
  subscribeToNotificationResponses,
} from "./handler";
import { registerPushTokenAsync } from "./registration";

export { CHANNELS, CHANNEL_IDS, type ChannelId, type ChannelSpec } from "./channels";
export {
  ACTION_ANSWER,
  ACTION_NOT_NOW,
  ACTION_NOT_TODAY,
  ACTION_READ,
  ACTION_START_IT,
  ACTION_STOP,
  ACTION_SWITCH,
} from "./categories";
export { triggerDevNotificationAsync } from "./devTrigger";
export { requestNotificationPermissionAsync } from "./permissions";
export { registerPushTokenAsync, type RegistrationResult } from "./registration";

/**
 * Call once near the app root (see App.tsx). Returns an unsubscribe
 * function for the response listener — call it on unmount.
 */
export async function initNotifications(): Promise<() => void> {
  configureNotificationHandler();
  const unsubscribe = subscribeToNotificationResponses();

  await Promise.all([
    registerNotificationChannelsAsync(),
    registerNotificationCategoriesAsync(),
  ]);

  // Self-heal: if the user already granted permission — most likely
  // because they hit the real requestNotificationPermissionAsync() call
  // site (permissions.ts) on a previous launch, or (in dev) the
  // SettingsScreen button — but this device's token was never sent (fresh
  // install, token rotated, the earlier registration call failed), this is
  // the one moment guaranteed to run on every cold start without any UI
  // trigger. It re-sends
  // unconditionally rather than trying to track "did we already register
  // this exact token" locally, because the server call is a cheap upsert
  // and re-sending an unchanged token is harmless (see registration.ts's
  // idempotency note).
  //
  // This does NOT request permission — `registerPushTokenAsync` only reads
  // permission state — so it cannot become a second, uncontrolled prompt
  // site. It also must never block app startup or reject: failures here
  // are a background nicety, not something a cold boot should wait on or
  // crash over, so they're swallowed and logged instead of awaited by the
  // caller or re-thrown.
  void registerPushTokenAsync()
    .then((result) => {
      if (result.status === "failed") {
        console.warn("[notifications] background token registration failed:", result.reason);
      }
    })
    .catch((error: unknown) => {
      // registerPushTokenAsync is written not to throw, but this catch is
      // the backstop that keeps a bug in it from ever reaching app boot.
      console.warn("[notifications] background token registration threw:", error);
    });

  return unsubscribe;
}
