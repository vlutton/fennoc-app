/**
 * The "doorbell" — turning a data-only server push into a real local
 * notification (INT-020 follow-on).
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
 * THE LOOP GUARD (read this before touching `isDoorbellPayload`):
 * `handleDoorbellNotification` below POSTS a local notification, which
 * means `Notifications.addNotificationReceivedListener` — the very listener
 * this module installs — WILL fire again for the notification this module
 * just created. If that second firing were mistaken for another doorbell,
 * it would fetch and post again, forever.
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
 * So: `id` may be added to locally-posted data freely. `v` may not.
 *
 * KNOWN LIMITATION — force-stopped app: this module relies on
 * `expo-notifications`' JS event listener, which only runs while the app
 * process is alive (foreground or backgrounded-but-not-killed). A
 * force-stopped app cannot process a doorbell at all — the data-only push
 * arrives, nothing is listening, and no local notification is ever posted.
 * Fixing that needs a native background task (`expo-task-manager`'s
 * `Notifications.registerTaskAsync` background handler), which is a new
 * native module — explicitly out of scope here because this change ships
 * as an over-the-air EAS Update onto an already-built APK, and a new native
 * module cannot be delivered that way. Do not attempt a JS-only workaround;
 * there isn't one. This is a "needs a new build" gap, not a bug in this
 * file.
 */
import * as Notifications from "expo-notifications";

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
 * Narrows an unknown notification `data` payload to a doorbell. Deliberately
 * defensive rather than a cast: `data` is untrusted input off the network
 * (Expo → FCM/APNs → device), and a malformed or unrelated payload (or,
 * critically, a notification this module itself just posted — see the
 * module docstring's loop-guard section) must fall through as "not a
 * doorbell," never throw.
 */
function isDoorbellPayload(data: unknown): data is DoorbellPayload {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;

  const channel = record.channel;
  const id = record.id;
  // `v` is the server's schema stamp and the actual loop guard — see the
  // module docstring. Checked first because it is the one condition that
  // cannot be satisfied by anything this app posts itself.
  const version = record.v;

  return (
    typeof version === "number" &&
    typeof channel === "string" &&
    (CHANNEL_IDS as string[]).includes(channel) &&
    typeof id === "string" &&
    id.length > 0
  );
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
 *
 * On fetch failure — network error, non-2xx, or the row not actually having
 * content yet (`status === "error"`, or `reply_lede` still null because the
 * server hasn't finished the turn) — this deliberately does NOT post a
 * placeholder notification. A generic "Fennoc has something to tell you"
 * would be Fennoc appearing to speak without actually having said anything
 * — worse than staying silent, because the user has no way to tell a real
 * doorbell from a broken one. A silent miss just means one tap on the app
 * would have shown nothing new yet; that's the safe failure mode, so this
 * only logs a warning and returns.
 */
async function handleDoorbellNotification(payload: DoorbellPayload): Promise<void> {
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
    return;
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
    return;
  }

  const { title, body } = toNotificationText(
    payload.channel,
    message.reply_lede,
    message.reply_body,
  );
  await postLocalNotificationAsync(payload.channel, title, body);
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
 */
export function subscribeToDoorbellNotifications(): () => void {
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const data: unknown = notification.request.content.data;
    if (!isDoorbellPayload(data)) {
      // Not a doorbell — most commonly this IS the received-event for a
      // notification this module (or devTrigger) just posted locally. See
      // the module docstring's loop-guard section for why that's expected
      // and correctly a no-op here, not a bug.
      return;
    }

    void handleDoorbellNotification(data);
  });

  return () => subscription.remove();
}
