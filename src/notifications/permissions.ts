/**
 * Notification permission, asked late.
 *
 * Per the design: never at onboarding. This module exposes only the
 * mechanism — no call site is wired up here, and there is deliberately no
 * onboarding UI touched by this change (INT-020's client scope is
 * explicit: "Out of scope: ... onboarding UI").
 *
 * CALL SITE (for whoever wires the real trigger moment, e.g. INT-023's
 * status strip or the first live check-in): call
 * `requestNotificationPermissionAsync()` at the moment there is something
 * genuinely worth interrupting for — e.g. immediately before Fennoc would
 * otherwise send its first `questions` push — paired with copy that
 * explains the 3-a-day budget contract, roughly:
 *
 *   "Fennoc pings you at most 3 times a day, only when it's worth
 *    interrupting for. Turn on notifications to answer from the lock
 *    screen instead of opening the app."
 *
 * Do not call this from App.tsx's mount effect, a splash screen, or any
 * other "first launch" path.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * Request notification permission if not already granted. Returns whether
 * the app is now allowed to display notifications.
 */
export async function requestNotificationPermissionAsync(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  // iOS "provisional" authorization already delivers quietly to
  // Notification Center without ever showing the system prompt; treat that
  // as "already asked," not as a reason to prompt again.
  if (
    Platform.OS === "ios" &&
    existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }

  const result = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  return result.granted;
}
