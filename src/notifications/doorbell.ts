/**
 * The "doorbell" — turning a data-only server push into a real local
 * notification (INT-020 follow-on; background delivery added for the
 * "blank notification" fix, Aug 2026).
 *
 * WHY the server sends no content: Expo relays pushes through FCM/APNs, and
 * no user content may pass through either — Fennoc's replies are private.
 * So the server's push carries only a pointer:
 *
 *   data: { channel: "questions"|"returns"|"briefing"|"tracking",
 *            id: "<agent_messages row id>", v: 1 }
 *
 * This module's job: notice that pointer arrive, fetch the real content from
 * `GET /api/message/{id}` (already wired for INT-029b polling — see
 * `getAgentMessage` in ../api/client.ts and `useAgentMessagePoll`), and post
 * a LOCAL notification built from the turn's text (see `toNotificationText`
 * for how that becomes a title and a body — they are NOT the server's
 * lede/body split), on the right channel, with that channel's category — the same
 * shape `devTrigger.ts` builds for its dev-only fixtures, so action buttons
 * and the `questions` text-input reply keep working no matter which path
 * produced the notification. `devTrigger.ts` itself is untouched; the shape
 * below is intentionally kept in lockstep with it by hand (see the "kept in
 * sync" comments below), not by importing from it, so this module can never
 * be blamed for changing that file's already-verified dev behaviour.
 *
 * TWO SUBSCRIBERS, ONE HANDLER: `handleDoorbellNotification` below is the
 * entire "fetch by id, post locally" flow, and it is the only place that
 * flow is written. It has two callers:
 *
 *   1. `subscribeToDoorbellNotifications` — `addNotificationReceivedListener`,
 *      which only runs while the app's JS engine is alive (foreground or
 *      backgrounded-but-not-killed). This is the original INT-020 path.
 *   2. The `TaskManager.defineTask` block below, registered via
 *      `Notifications.registerTaskAsync` — runs even when the app process
 *      was killed, per expo-notifications' "headless background
 *      notification" mechanism (see the long comment above that block for
 *      exactly how the OS invokes it and what shape the payload arrives
 *      in). This is what was missing: a force-stopped app previously
 *      dropped every doorbell silently.
 *
 * Both parse whatever raw `data` they were handed down to the same
 * `DoorbellPayload` via `toDoorbellPayload` (below), and both feed the
 * result to the same `handleDoorbellNotification` — so the fetch-and-post
 * behaviour, the "don't fake content on failure" rule, and the loop guard
 * are each written exactly once.
 *
 * THE LOOP GUARD (read this before touching `toDoorbellPayload`):
 * `handleDoorbellNotification` below POSTS a local notification, which
 * means both subscribers above — the very listener/task this module
 * installs — WILL fire again for the notification this module just
 * created. If that second firing were mistaken for another doorbell, it
 * would fetch and post again, forever.
 *
 * The discriminator is `v`, the schema version the SERVER stamps on every
 * doorbell (see `_DATA_SCHEMA_VERSION` in fennoc-core's
 * `fennoc/notify/transport.py`). Nothing posted on-device sets it, so its
 * presence means "this arrived from the server" affirmatively.
 *
 * It would be easier to key on `id` — a doorbell has one, a local post
 * doesn't — and that is what this guard originally did. It was changed on
 * purpose. Keying on the ABSENCE of a field only holds while nobody adds
 * that field, and `id` is precisely the field the next feature wants: to
 * make tapping a notification open that message in the thread, you put the
 * message id in the local notification's data. That change is natural,
 * obviously correct in isolation, and would silently build an infinite
 * loop. Requiring an affirmative server marker makes it safe instead.
 *
 * So: `id` may be added to locally-posted data freely. `v` may not. This is
 * exactly as true for the background task's payload as for the foreground
 * listener's — see `toDoorbellPayload`, the one place both normalize down
 * to a `DoorbellPayload` and the one place the guard is actually enforced.
 *
 * This module also exports `isServerEnvelope` (a thin wrapper around the
 * same `v`-presence check) for `handler.ts`'s `handleNotification` to use —
 * that is the OTHER half of the blank-notification fix: suppressing the
 * server's raw pointer from ever being shown as-is, foreground or not, so
 * only doorbell's own local reposts (real content, no `v`) render. See
 * handler.ts for why that is a separate concern from this file's fetch-and-
 * post flow.
 */
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { formatApiError, getAgentMessage } from "../api/client";
import { CHANNEL_IDS, type ChannelId } from "./channels";

/** The server's data-only doorbell payload, once validated. */
interface DoorbellPayload {
  channel: ChannelId;
  id: string;
  /** Server schema stamp. Its presence is the loop guard — see the docstring. */
  v: number;
}

/**
 * Validates and normalizes a flat `{channel, id, v}` record into a
 * `DoorbellPayload`. Deliberately defensive rather than a cast: the input
 * is untrusted off the network (Expo → FCM/APNs → device), and a malformed
 * or unrelated payload (or, critically, a notification this module itself
 * just posted — see the module docstring's loop-guard section) must fall
 * through as "not a doorbell," never throw.
 *
 * `v` is accepted as either a real `number` or a numeric STRING. The
 * foreground listener's `notification.request.content.data` (see
 * `parseForegroundDoorbell` below) always hands this a real number —
 * expo-notifications has already parsed it by the time JS sees it. The
 * background task's raw payload (see `parseBackgroundDoorbell`) is not
 * guaranteed that: a data-only FCM message is natively a map of STRINGS,
 * and while this app's actual delivery path (Expo's push service, see
 * registration.ts) re-encodes the whole `data` object as real JSON before
 * the device ever sees it — so `v` does arrive as a number there too in
 * practice — nothing prevents a future direct-FCM path from handing this a
 * string "1" instead. Coercing here, once, means the loop guard holds
 * either way instead of silently failing closed against a numeric string.
 */
function toDoorbellPayload(record: Record<string, unknown>): DoorbellPayload | null {
  const channel = record.channel;
  const id = record.id;
  // `v` is the server's schema stamp and the actual loop guard — see the
  // module docstring. Checked first because it is the one condition that
  // cannot be satisfied by anything this app posts itself.
  const rawVersion = record.v;
  const version =
    typeof rawVersion === "number"
      ? rawVersion
      : typeof rawVersion === "string"
        ? Number(rawVersion)
        : NaN;

  if (
    !Number.isFinite(version) ||
    typeof channel !== "string" ||
    !(CHANNEL_IDS as string[]).includes(channel) ||
    typeof id !== "string" ||
    id.length === 0
  ) {
    return null;
  }

  return { channel: channel as ChannelId, id, v: version };
}

/** True when `data` carries the server's schema stamp `v` at all — the
 *  same discriminator `toDoorbellPayload` uses for the loop guard (see the
 *  module docstring). Exported for handler.ts's `handleNotification`,
 *  which needs only "is this the server's raw pointer envelope," not a
 *  fully validated `DoorbellPayload` (a malformed-but-`v`-bearing payload
 *  should still be suppressed as a would-be pointer, not shown blank). */
export function isServerEnvelope(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as Record<string, unknown>).v !== undefined;
}

/**
 * Parses the foreground listener's already-normalized notification data
 * (`notification.request.content.data`) into a `DoorbellPayload`.
 */
function parseForegroundDoorbell(data: unknown): DoorbellPayload | null {
  if (typeof data !== "object" || data === null) return null;
  return toDoorbellPayload(data as Record<string, unknown>);
}

/**
 * Parses the background task's raw notification data into a
 * `DoorbellPayload`.
 *
 * This app receives pushes through Expo's push service (see
 * registration.ts's `getExpoPushTokenAsync`), which relays through
 * FCM/APNs as a headless data-only message whose native "body" field
 * carries the FULL Expo push message (title/body/data/...) JSON-encoded.
 * expo-notifications' native background-task bridge re-exposes that exact
 * string as `data.dataString` — verified by reading
 * `RemoteMessageSerializer.java`'s `toBundle` (Android) and
 * `BackgroundEventTransformer.swift` (iOS) in the installed
 * expo-notifications@57.0.7 package, and confirmed by the SDK's own
 * documented background-task example, which does
 * `JSON.parse(data.dataString)` and then reads `.title` / `.data` off the
 * result. So this doorbell's `{channel, id, v}` fields live at
 * `JSON.parse(dataString).data` — one level deeper than the foreground
 * listener's already-unwrapped `notification.request.content.data`.
 *
 * `dataString` would be absent for a push that reached the device WITHOUT
 * going through that Expo relay. There is no such path in this app today —
 * `registerPushTokenAsync` only ever requests an Expo token — but "today"
 * is doing a lot of work in that sentence, so this falls back to treating
 * the raw record's own top-level fields as the candidate, flat, rather
 * than returning null outright if that ever changes.
 */
function parseBackgroundDoorbell(data: unknown): DoorbellPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;

  if (typeof record.dataString === "string") {
    try {
      const expoMessage: unknown = JSON.parse(record.dataString);
      if (typeof expoMessage === "object" && expoMessage !== null) {
        const nested = (expoMessage as Record<string, unknown>).data;
        if (typeof nested === "object" && nested !== null) {
          const parsed = toDoorbellPayload(nested as Record<string, unknown>);
          if (parsed) return parsed;
        }
      }
    } catch {
      // Malformed dataString — fall through to the flat record below rather
      // than throwing out of a background task. Same "fail closed, log
      // don't throw" posture as handleDoorbellNotification's own catch
      // blocks below.
    }
  }

  return toDoorbellPayload(record);
}

// iOS interruption levels. Kept in sync BY HAND with the identical table in
// devTrigger.ts (itself mirroring `fennoc/notify/channels.py`'s
// `ios_interruption_level`) rather than imported from it, so this module
// cannot be the thing that changes devTrigger's behaviour — see the module
// docstring.
const IOS_INTERRUPTION_LEVEL: Record<ChannelId, Notifications.InterruptionLevel> = {
  questions: "timeSensitive",
  returns: "active",
  briefing: "passive",
  tracking: "passive",
};

// The design system's amber accent — duplicated here rather than imported,
// same rationale as channels.ts's own duplicate of this literal: keeps this
// module import-light. See channels.ts's `CHANNEL_ACCENT` comment.
const CHANNEL_ACCENT = "#F0A93B";

/**
 * Posts the real local notification for a doorbell, once its content has
 * been fetched. Mirrors devTrigger.ts's `scheduleNotificationAsync` shape —
 * same category, same channel targeting, same trigger type — so this is a
 * drop-in second producer of "a real Fennoc notification," not a
 * differently-shaped one.
 */
async function postLocalNotificationAsync(
  channel: ChannelId,
  title: string,
  body: string | null,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: body ?? undefined,
      categoryIdentifier: channel,
      color: CHANNEL_ACCENT,
      sticky: channel === "tracking",
      interruptionLevel: IOS_INTERRUPTION_LEVEL[channel],
      // Must NOT carry `v` — that is the server's stamp and the loop guard
      // keys on it (see the module docstring). `id` would now be safe to
      // add here, and is the obvious thing to add when notification taps
      // start opening the message in the thread.
      //
      // `questionType` is omitted deliberately, left to the response
      // handler's own `?? "freeform"` default in handler.ts: the server's
      // `AgentMessageResponse` has no question-type field to forward, and
      // inventing one here would be a guess dressed as data.
      data: {
        channel,
      },
    },
    // `TIME_INTERVAL` (not an immediate/null trigger) because that's the
    // only trigger shape `expo-notifications` lets carry a `channelId` —
    // see devTrigger.ts's identical comment on this exact point.
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId: channel,
    },
  });
}

/**
 * Handles one validated doorbell: fetch the real content, post it locally.
 * Shared verbatim by both subscribers — see the module docstring's "TWO
 * SUBSCRIBERS, ONE HANDLER" section.
 *
 * Returns whether it actually posted a local notification. The foreground
 * subscriber ignores this (it's fire-and-forget, same as before); the
 * background task uses it to report an honest
 * `BackgroundNotificationTaskResult` (`NewData` vs `NoData`) back to the OS.
 *
 * On fetch failure — network error, non-2xx, or the row not actually having
 * content yet (`status === "error"`, or `reply_lede` still null because the
 * server hasn't finished the turn) — this deliberately does NOT post a
 * placeholder notification. A generic "Fennoc has something to tell you"
 * would be Fennoc appearing to speak without actually having said anything
 * — worse than staying silent, because the user has no way to tell a real
 * doorbell from a broken one. A silent miss just means one tap on the app
 * would have shown nothing new yet; that's the safe failure mode, so this
 * only logs a warning and returns `false` — never throws, which matters
 * doubly for the background task: an uncaught rejection there has no UI to
 * surface it to, and no retry loop should be built out of it either.
 */
async function handleDoorbellNotification(payload: DoorbellPayload): Promise<boolean> {
  let message;
  try {
    message = await getAgentMessage(payload.id);
  } catch (error) {
    console.warn(
      "[notifications] doorbell fetch failed — not posting a placeholder:",
      payload.channel,
      payload.id,
      formatApiError(error),
    );
    return false;
  }

  if (message.status === "error" || !message.reply_lede) {
    // Same "don't fake it" reasoning as the catch block above: a fetch that
    // technically succeeds but has no reply yet (still running) or failed
    // server-side is exactly as untrustworthy as a network error, content-wise.
    console.warn(
      "[notifications] doorbell fetched but has no content to show — not posting:",
      payload.channel,
      payload.id,
      message.status,
    );
    return false;
  }

  const { title, body } = toNotificationText(
    payload.channel,
    message.reply_lede,
    message.reply_body,
  );
  await postLocalNotificationAsync(payload.channel, title, body);
  return true;
}

/** Short, human titles per channel, used when the message has no usable one. */
const CHANNEL_TITLE: Record<ChannelId, string> = {
  questions: "Fennoc has a question",
  returns: "Something came back",
  briefing: "Your briefing",
  tracking: "Tracking",
};

/**
 * Longest lede we will promote to a notification title. Past this Android
 * ellipsises it into uselessness, and iOS gives it one line.
 */
const MAX_TITLE_CHARS = 60;

/**
 * Turn a thread turn's `(reply_lede, reply_body)` into a notification's
 * `(title, body)`. These are NOT the same split, which is the bug this
 * function exists to fix.
 *
 * `split_reply` on the server divides a reply by LINE COUNT, answering "is
 * this long enough to need a Read affordance in the thread?" — so a short
 * reply comes back whole as the lede with a null body, by design. Feeding
 * that straight into a notification put the entire message in the TITLE and
 * left the body empty: Android truncated the title in the shade and there
 * was nothing to expand into, so the notification arrived carrying no
 * readable content at all.
 *
 * The rule here is that THE BODY ALWAYS CARRIES THE FULL TEXT. A title is
 * decoration; losing it costs nothing. Losing the message is the actual
 * failure, so nothing is ever routed exclusively through the title.
 */
export function toNotificationText(
  channel: ChannelId,
  lede: string,
  body: string | null,
): { title: string; body: string } {
  const full = body ? `${lede}\n\n${body}` : lede;

  // A short single-line lede makes a good title — "The shelving's back."
  // Anything longer, or anything with a line break in it, is prose rather
  // than a heading, so it belongs in the body under a generic title.
  const usableAsTitle =
    !lede.includes("\n") && lede.length <= MAX_TITLE_CHARS;

  if (usableAsTitle && body) {
    // Genuine heading + detail: keep the server's split as-is.
    return { title: lede, body };
  }
  if (usableAsTitle) {
    // Short message, no body. Show it as the body under a channel title so
    // the text is in the expandable region rather than the truncated one.
    return { title: CHANNEL_TITLE[channel], body: lede };
  }
  return { title: CHANNEL_TITLE[channel], body: full };
}

/**
 * Subscribe to `Notifications.addNotificationReceivedListener` and turn
 * doorbell pushes into real local notifications. Returns an unsubscribe
 * function; call once near the app root (see `initNotifications` in
 * index.ts) and clean up on unmount.
 *
 * This is subscriber #1 of 2 — see the module docstring's "TWO
 * SUBSCRIBERS, ONE HANDLER" section. It only runs while the app's JS
 * engine is alive; subscriber #2, below, is what covers a killed app.
 */
export function subscribeToDoorbellNotifications(): () => void {
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const payload = parseForegroundDoorbell(notification.request.content.data);
    if (!payload) {
      // Not a doorbell — most commonly this IS the received-event for a
      // notification this module (or devTrigger) just posted locally. See
      // the module docstring's loop-guard section for why that's expected
      // and correctly a no-op here, not a bug.
      return;
    }

    void handleDoorbellNotification(payload);
  });

  return () => subscription.remove();
}

/**
 * The background doorbell task — subscriber #2 of 2 (see the module
 * docstring's "TWO SUBSCRIBERS, ONE HANDLER" section). This is what a
 * force-stopped or never-yet-launched app was missing: `expo-notifications`'
 * JS event listeners (subscriber #1, above) only run while the app process
 * is alive, so a doorbell arriving while the app was killed previously had
 * nothing listening for it at all — the data-only push arrived, and no
 * local notification was ever posted. Silently. Forever, for that push.
 *
 * HOW THIS RUNS WHEN THE APP IS KILLED (expo-task-manager@57.0.7 +
 * expo-notifications@57.0.7 docs, `docs.expo.dev/versions/v57.0.0`): when a
 * headless background notification (data-only, no `title`/`body` at the
 * native level — exactly this app's server envelope) arrives for a
 * terminated app, the OS asks Expo's native module to spin up the JS
 * engine, require the SAME main bundle a normal launch would (no views are
 * mounted — nothing here can assume `App.tsx` has rendered, or that
 * anything React-related is available), run the task registered under
 * `BACKGROUND_DOORBELL_TASK`, and then shut back down. `TaskManager.
 * defineTask` — the call below — MUST therefore execute during that bundle
 * evaluation regardless of whether any component ever mounts. It is called
 * here, at MODULE scope (never inside a function/effect/component — the
 * docs are explicit that a lifecycle-method call site does not work), and
 * this module is reachable from `index.ts` via a plain, unconditional
 * import chain (index.ts → App.tsx → src/notifications → this file), which
 * is what actually satisfies "required early" — ES module imports evaluate
 * a module's top-level code before the importing module's own function
 * bodies run, so this `defineTask` call has already executed by the time
 * `index.ts`'s `registerRootComponent(App)` line runs, let alone by the
 * time anything renders.
 *
 * `Notifications.registerTaskAsync(BACKGROUND_DOORBELL_TASK)` is the OTHER
 * required half — it tells the native side which defined task to actually
 * invoke for notification events — and is called from
 * `registerDoorbellBackgroundTaskAsync` below, from `initNotifications` in
 * index.ts, next to `configureNotificationHandler()`. Unlike `defineTask`,
 * that call has no module-scope restriction; it only needs to run once,
 * early, same as the channel/category registration it sits beside.
 *
 * SDK 57 CAVEATS surfaced while reading the docs (not just skimmed):
 *
 * - iOS requires `UIBackgroundModes: ["remote-notification"]` in
 *   Info.plist for a headless push to wake a killed app at all — set via
 *   `enableBackgroundRemoteNotifications: true` on the `expo-notifications`
 *   config plugin in app.json (added alongside this file). Without it this
 *   entire task is unreachable on iOS.
 * - This is `expo-task-manager`, a NEW native module this app didn't
 *   depend on before — it cannot be delivered as an over-the-air EAS
 *   Update onto an already-built binary; it requires a new build (a
 *   `runtimeVersion` bump — see app.json's own comment on the identical
 *   reasoning from the speech-recognition build).
 * - Unavailable in Expo Go on Android, and does not support real
 *   background execution on iOS there either — a development build is
 *   required to exercise this at all (matches this app's existing
 *   `expo-dev-client` dependency, so no new constraint in practice).
 * - The OS may simply decline to deliver a headless notification at all
 *   (Android Doze mode; Apple's own guidance caps "two or three per hour").
 *   There is no client-side mitigation for that — it's an OS policy, not a
 *   bug in this file.
 * - `console.log` output from inside the task body is not reliably visible
 *   depending on platform/app state (per the docs) — `console.warn` calls
 *   below are diagnostic best-effort, not something to depend on seeing.
 */
const BACKGROUND_DOORBELL_TASK = "fennoc-background-doorbell";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_DOORBELL_TASK,
  async ({ data: taskPayload, error }) => {
    if (error) {
      console.warn("[notifications] background doorbell task reported an error:", error);
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }

    if (!taskPayload || "actionIdentifier" in taskPayload) {
      // Either nothing came through, or this is a `NotificationResponse`
      // (the user tapped an action button while the app was backgrounded/
      // terminated — Android only, per `registerTaskAsync`'s own doc).
      // Routing THAT into a checkin reply etc. is handler.ts's job when the
      // JS response listener is alive; wiring the equivalent for a killed
      // app is a real gap but a different one from the doorbell fix this
      // task exists for, so it's deliberately left alone here rather than
      // half-built inside a module about something else.
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }

    const payload = parseBackgroundDoorbell(taskPayload.data);
    if (!payload) {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }

    const posted = await handleDoorbellNotification(payload);
    return posted
      ? Notifications.BackgroundNotificationTaskResult.NewData
      : Notifications.BackgroundNotificationTaskResult.NoData;
  },
);

/**
 * Registers the background doorbell task with the native side (the
 * `Notifications.registerTaskAsync` half of the wiring described in the
 * long comment above `BACKGROUND_DOORBELL_TASK`). Call once near the app
 * root, alongside `configureNotificationHandler()` — see `initNotifications`
 * in index.ts. Never throws: a failure here (e.g. `TaskManager` genuinely
 * unavailable — Expo Go on Android, or web) degrades to "background
 * doorbells silently don't work," which is exactly the pre-existing
 * behaviour this change is additive to, not a reason to block app startup.
 */
export async function registerDoorbellBackgroundTaskAsync(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(BACKGROUND_DOORBELL_TASK);
  } catch (error) {
    console.warn("[notifications] registering background doorbell task failed:", error);
  }
}
