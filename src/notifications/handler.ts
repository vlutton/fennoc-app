/**
 * Foreground notification handler + response (tap/action) listener.
 *
 * Foreground behaviour: per the design, "Fennoc never speaks unsolicited
 * while the app is open." `shouldShowBanner: false` suppresses the
 * heads-up popup while the JS handler is live (foregrounded); `shouldPlaySound:
 * false` for the same reason — a sound is also "speaking." `shouldShowList:
 * true` deliberately keeps the notification in the system tray/history
 * rather than suppressing it outright: this is about not interrupting the
 * open app, not about hiding that Fennoc pinged at all. `shouldSetBadge` is
 * false because badges are not part of this app's UI (out of INT-020 scope).
 *
 * THE SERVER'S RAW ENVELOPE IS SUPPRESSED ENTIRELY (Aug 2026 "blank
 * notification" fix): the block above describes behaviour for a real,
 * content-bearing notification. The server's own push, though, carries no
 * content at all — just a `{channel, id, v}` pointer (see doorbell.ts's
 * module docstring) — and this handler runs for EVERY notification the OS
 * hands the app, including that pointer, before doorbell.ts's own listener
 * has a chance to fetch real content and post a replacement. `shouldShowList:
 * true` above still puts that title-less, body-less pointer into the
 * system tray/history, which is exactly the reported bug: a blank
 * notification while the app was foregrounded. `isServerEnvelope` (keyed
 * on the presence of `v`, the same discriminator doorbell.ts's loop guard
 * uses — see its docstring) is how this handler tells "the server's
 * pointer, never worth showing as-is" apart from "doorbell's own local
 * repost, real content, no `v`, show it exactly as before."
 *
 * Response listener: reads `actionIdentifier` + `userText` off
 * `NotificationResponse` (per expo-notifications@57.0.7's
 * `Notifications.types.d.ts`) and, for the `questions` channel only, routes
 * toward `POST /api/checkin/reply` via the existing typed client. "Not now"
 * is treated as an answer — it is sent as reply text, not swallowed as a
 * dismissal, per the intent doc's explicit instruction.
 *
 * UNVERIFIED: the emulator cannot reach the Tailscale-only API (requests
 * 401 today, no remote transport exists yet either), so this file's
 * `replyCheckin` call has not round-tripped against a real server in
 * testing. The network-error branch (queue-and-retry via the existing
 * offline outbox) and the non-network-error branch (log, don't throw) are
 * both written and typecheck, but neither has been exercised live.
 */
import * as Notifications from "expo-notifications";

import { formatApiError, replyCheckin } from "../api/client";
import { enqueueIfOffline, isNetworkError } from "../outbox";
import { ACTION_ANSWER, ACTION_NOT_NOW } from "./categories";
import type { ChannelId } from "./channels";
import { isServerEnvelope } from "./doorbell";

const NOT_NOW_REPLY_TEXT = "Not now";

/**
 * Sets the process-wide notification handler. Call once, near the app
 * root (see App.tsx) — a later call replaces the earlier one rather than
 * stacking.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      if (isServerEnvelope(notification.request.content.data)) {
        // The server's raw pointer — a doorbell that hasn't been resolved
        // into real content yet. Never worth showing as-is; see this
        // file's own header comment. All-false, not just no-banner: this
        // is the difference from the branch below.
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}

// Client-side data contract for a `questions` notification. Nothing on the
// remote-transport side exists yet to enforce this shape (see the intent
// doc's "Out of scope"), so this is this file's own assumption about what
// a future push payload's `data` field will carry — documented here so
// whoever wires the real transport knows what the client expects.
interface QuestionsNotificationData {
  channel?: ChannelId;
  questionType?: string;
}

function readData(
  data: Record<string, unknown> | undefined,
): QuestionsNotificationData {
  if (!data) return {};
  return {
    channel: typeof data.channel === "string" ? (data.channel as ChannelId) : undefined,
    questionType:
      typeof data.questionType === "string" ? data.questionType : undefined,
  };
}

async function sendCheckinReply(text: string, questionType: string): Promise<void> {
  try {
    await replyCheckin(text, questionType);
  } catch (error) {
    if (isNetworkError(error)) {
      // Same offline path the in-app CheckinCard reply uses
      // (useReplyCheckin in src/hooks/useHome.ts) — queued, drained later.
      enqueueIfOffline("checkin_reply", { text, questionType });
      return;
    }
    // Never throw out of a notification response callback — there is no
    // UI here to catch it. Logged so it's visible during dev verification.
    console.warn("[notifications] checkin reply failed:", formatApiError(error));
  }
}

/**
 * Subscribe to notification taps and action button presses (including
 * text-input replies). Returns an unsubscribe function; call once near the
 * app root and clean up on unmount (see App.tsx).
 */
export function subscribeToNotificationResponses(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const { actionIdentifier, userText, notification } = response;
      const data = readData(notification.request.content.data);

      if (data.channel !== "questions") {
        // returns/briefing/tracking actions (Start it, Not today, Read,
        // Stop, Switch) have no client endpoint yet — wiring them is
        // outside INT-020's client scope. Logged, not silently dropped, so
        // a tap is visible during dev/emulator verification.
        if (actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
          console.log(
            "[notifications] action not wired yet:",
            actionIdentifier,
            data.channel,
          );
        }
        return;
      }

      const questionType = data.questionType ?? "freeform";

      if (actionIdentifier === ACTION_ANSWER) {
        const text = userText?.trim();
        if (!text) return;
        void sendCheckinReply(text, questionType);
        return;
      }

      if (actionIdentifier === ACTION_NOT_NOW) {
        // "Not now" is an answer, not a dismissal — recorded as one.
        void sendCheckinReply(NOT_NOW_REPLY_TEXT, questionType);
        return;
      }

      // A bare tap (DEFAULT_ACTION_IDENTIFIER) just opens the app; the
      // existing Home screen check-in card (CheckinCard.tsx) takes it from
      // there via the normal pending-checkin query.
    },
  );

  return () => subscription.remove();
}
