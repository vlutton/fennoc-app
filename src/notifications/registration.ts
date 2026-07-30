/**
 * Push token acquisition + server registration.
 *
 * INT-020 built the local (client-only) half of notifications: channels,
 * categories, the foreground handler, and the permission mechanism. It
 * deliberately stopped short of the remote transport — no Expo push token
 * was ever requested, so `POST /api/push/register` (which has existed on
 * the server the whole time) has never been called and `device_tokens` is
 * empty. This module is that missing half.
 *
 * Three things this module refuses to do, on purpose:
 *
 * 1. It never calls `Notifications.requestPermissionsAsync()`. Permission
 *    prompting is permissions.ts's job, gated to a specific "worth
 *    interrupting for" moment (see the long comment at the top of that
 *    file). If this module prompted too, it would create a second,
 *    uncontrolled call site for the exact prompt permissions.ts goes out of
 *    its way to gate — so it only *reads* permission state via
 *    `getPermissionsAsync()` and treats "not granted" as a normal,
 *    non-error outcome.
 * 2. It never throws for an expected condition (web, simulator, no
 *    permission, missing config, network failure). All of those are
 *    encoded in `RegistrationResult` instead, so callers — the dev button
 *    in SettingsScreen today, the self-heal call in `initNotifications`
 *    tomorrow — never need a try/catch for the normal paths. Truly
 *    unexpected failures (e.g. `getExpoPushTokenAsync` throwing something
 *    that isn't an Error/Axios shape) are still caught and folded into a
 *    "failed" result rather than propagated, for the same reason.
 * 3. It never attempts to obtain a token on web or on a simulator/emulator.
 *    Expo's push service has nothing to hand back in either case (there is
 *    no APNs/FCM registration to piggyback on) — `getExpoPushTokenAsync`
 *    on web/simulator either throws or resolves with a token that will
 *    never receive anything, and failing loudly with a specific reason
 *    beats leaving a phantom row in `device_tokens` or a confusing native
 *    crash.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { formatApiError, registerPushToken } from "../api/client";

export type RegistrationResult =
  | { status: "registered"; token: string }
  | { status: "skipped-not-a-device"; reason: string }
  | { status: "skipped-no-permission" }
  | { status: "failed"; reason: string };

/**
 * `Constants.expoConfig.extra` is typed `{ [k: string]: any }` upstream
 * (there is no way for `@expo/config-types` to know the shape of an app's
 * own `extra` block), so reading `extra.eas.projectId` off it directly
 * would smuggle an implicit `any` into an otherwise-strict module. This
 * walks the object by hand and returns `undefined` for anything that
 * isn't a string, rather than casting.
 */
function readEasProjectId(): string | undefined {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== "object" || extra === null) return undefined;

  const eas: unknown = (extra as Record<string, unknown>).eas;
  if (typeof eas !== "object" || eas === null) return undefined;

  const projectId: unknown = (eas as Record<string, unknown>).projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

/**
 * Acquire this device's Expo push token (if one can be acquired) and
 * register it with `POST /api/push/register`. Safe to call speculatively —
 * every non-success path returns a descriptive result instead of throwing.
 *
 * Deliberately NOT idempotent-avoidant: the server endpoint upserts, and
 * Expo push tokens can change (app reinstall, device restore), so calling
 * this repeatedly and re-sending an unchanged token is the expected,
 * cheap-refresh usage pattern — not something this function tries to
 * dedupe against.
 */
export async function registerPushTokenAsync(): Promise<RegistrationResult> {
  // Web has no APNs/FCM registration for expo-notifications to piggyback
  // on; this app config does not meaningfully target web for notifications
  // anyway (see categories.ts's identical web guard).
  if (Platform.OS === "web") {
    return {
      status: "skipped-not-a-device",
      reason: "Push tokens are not available on web.",
    };
  }

  // expo-device's `isDevice` is false on simulators/emulators. Requesting a
  // token there either throws or hands back a token nothing will ever
  // deliver to — surfacing that plainly beats a confusing native error.
  if (!Device.isDevice) {
    return {
      status: "skipped-not-a-device",
      reason:
        "Simulators/emulators cannot receive push notifications — a physical device is required.",
    };
  }

  // Read-only permission check. Requesting permission is out of scope here
  // by design — see the module comment and permissions.ts.
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return { status: "skipped-no-permission" };
  }

  const projectId = readEasProjectId();
  if (!projectId) {
    return {
      status: "failed",
      reason:
        "Missing EAS project id (app.json extra.eas.projectId) — cannot request an Expo push token.",
    };
  }

  let token: string;
  try {
    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
    token = pushToken.data;
  } catch (error) {
    return {
      status: "failed",
      reason: `Could not obtain an Expo push token: ${formatApiError(error)}`,
    };
  }

  try {
    await registerPushToken(token, Platform.OS);
  } catch (error) {
    return {
      status: "failed",
      reason: `Got a push token but registration failed: ${formatApiError(error)}`,
    };
  }

  return { status: "registered", token };
}
