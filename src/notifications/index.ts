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
 */
import { registerNotificationCategoriesAsync } from "./categories";
import { registerNotificationChannelsAsync } from "./channels";
import {
  configureNotificationHandler,
  subscribeToNotificationResponses,
} from "./handler";

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

  return unsubscribe;
}
