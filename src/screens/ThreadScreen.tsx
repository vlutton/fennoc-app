import { isAxiosError } from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { deleteImage, formatApiError } from "../api/client";
import type { AgentAction, AgentMessage, AgentSource, ThreadDay } from "../api/types";
import { BriefingSheet } from "../components/BriefingSheet";
import { CaptureBar } from "../components/CaptureBar";
import { CheckinCard } from "../components/CheckinCard";
import { FennocMark } from "../components/FennocMark";
import { LedgerSheet } from "../components/LedgerSheet";
import { PhotoMessage } from "../components/PhotoMessage";
import { qualifiesForReceipt, Receipt } from "../components/Receipt";
import { ReplySheet } from "../components/ReplySheet";
import { StatusStrip } from "../components/StatusStrip";
import { Strip } from "../components/Strip";
import { useAgentMessagePoll } from "../hooks/useAgentMessage";
import { useEveningBriefing, useMorningBriefing } from "../hooks/useBriefing";
import { usePendingCheckin, useReplyCheckin } from "../hooks/useHome";
import { useResolveOvernight, useThread } from "../hooks/useThreadQuery";
import { cancelHeldUploadsForBatch } from "../outbox";
import { type PhotoBatch, type ThreadCapture, useThreadStore, useTodayCaptures } from "../store/useThread";
import {
  chicagoDateKey,
  chicagoToday,
  formatDayLabel,
  formatDayLabelWithMonth,
  formatTimeOfDay,
  isYesterday,
} from "../utils/format";
import { useTheme } from "../theme/useTheme";

interface ThreadScreenProps {
  onOpenSettings: () => void;
}

// Nominal on-screen times for briefing messages. `GET /api/briefing/*`
// returns the briefing's DATE but not the moment it was generated. These
// match the design handoff's own worked example ("06:45 · MORNING").
// Briefings are fetched for TODAY only (see the two hooks below), so they
// only ever merge into today's day — nothing here scopes them per-day.
const MORNING_BRIEFING_TIME = "06:45";
const EVENING_BRIEFING_TIME = "18:00";

type ThreadMessage =
  | {
      id: string;
      kind: "fennoc-briefing";
      atMs: number;
      stamp: string;
      label: string;
      /** What the "Read briefing" sheet should show as its title/body. */
      title: string;
      text: string;
    }
  | { id: string; kind: "fennoc-line"; atMs: number; stamp: string; text: string }
  | { id: string; kind: "user-capture"; atMs: number; text: string }
  | { id: string; kind: "photo-batch"; atMs: number; stamp: string; batch: PhotoBatch }
  | {
      id: string;
      kind: "agent-turn";
      atMs: number;
      stamp: string;
      messageId: string;
      state: "thinking" | "done" | "error";
      text: string;
      body: string | null;
      /** See AgentAction's own doc comment — null on old turns / a server
       *  build that doesn't send this yet. */
      actions: AgentAction[] | null;
      /** See AgentSource's own doc comment (INT-057 commit 2). */
      sources: AgentSource[] | null;
    };

/**
 * A plain thing Fennoc said — no action attached. Same unboxed treatment as
 * FennocMessage but without the briefing's "Read briefing" affordance, since
 * an acknowledgement has nothing to open.
 *
 * `dimmed` (INT-057, step 18a) renders the body at `ink.muted` instead of
 * `ink` — "yesterday stays dim" for a past live day. The stamp above it is
 * already `ink.muted` unconditionally, so only the body text changes.
 */
function FennocLine({
  stamp,
  text,
  dimmed = false,
}: {
  stamp: string;
  text: string;
  dimmed?: boolean;
}) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      {/* Selectable, not the stamp above it: "anything worth reading is
          worth quoting" is about what Fennoc SAID, not the clock reading
          next to it. No Pressable wraps this Text — nothing here competes
          with the native long-press-to-select gesture. */}
      <Text
        className={`mt-1 font-sans text-lead ${dimmed ? "text-ink-muted" : "text-ink"}`}
        selectable
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * Fennoc speaks unboxed — no bubble, no avatar. Fennoc is the environment;
 * the user is the guest. Do not symmetrise this with UserBubble below.
 *
 * `onOpen` is undefined exactly when there's nothing to open — the caller
 * (ThreadScreen) only supplies it once it has real briefing text in hand.
 * The "Read briefing" button is therefore only ever rendered when it would
 * actually do something: reported from a real device, "Clicking the 'Read
 * briefing' button makes a noise but doesn't actually do anything" was the
 * bug, and a button with nothing behind it is exactly that bug, so this
 * component doesn't render one to guard against a null body — see
 * BriefingSheet's own note.
 */
function FennocMessage({
  stamp,
  label,
  onOpen,
}: {
  stamp: string;
  label: string;
  onOpen?: () => void;
}) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <Text className="mt-1 font-sans text-lead text-ink" selectable>
        {label}
      </Text>
      {onOpen ? (
        <Pressable
          accessibilityLabel="Read briefing"
          accessibilityRole="button"
          className="mt-2 h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
          onPress={onOpen}
        >
          <Text className="font-sans-medium text-label text-ink">Read briefing</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The user speaks in a bubble — right-aligned, max-width 84%.
 *
 * `dimmed` (INT-057, step 18a) is "flatter bubbles": the border and raised
 * background drop out in favour of a plain, muted-text bubble — still
 * legible as "the user said this", just visually receded behind today.
 */
function UserBubble({ text, dimmed = false }: { text: string; dimmed?: boolean }) {
  return (
    <View className="items-end">
      <View
        className={`max-w-[84%] rounded-tl-md rounded-tr-md rounded-bl-md rounded-br-[4px] px-4 py-3 ${
          dimmed ? "" : "border border-line-hairline bg-bg-raised"
        }`}
      >
        {/* The user's own words, not just Fennoc's — "the user's own
            messages" per the selectability rule. No Pressable wraps the
            bubble itself, so there's no tap/long-press to fight. */}
        <Text
          className={`font-sans text-body ${dimmed ? "text-ink-muted" : "text-ink"}`}
          selectable
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

/**
 * An agent turn still running (INT-029b) — `presence.think`, the design's
 * signature "it is working" animation. `signal` (amber) is reserved for
 * exactly an unanswered question and a running timer, so it still doesn't
 * belong here; the mark plus the "THINKING" label carry that meaning
 * instead. The full presence state machine (listening/done) remains
 * INT-025 — this only builds the "thinking" state.
 */
function AgentThinking({ stamp }: { stamp: string }) {
  const { palette } = useTheme();
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <View className="mt-1 flex-row items-center gap-2">
        <FennocMark color={palette.ink.muted} size={28} state="thinking" />
        <Text className="font-mono-medium text-dataSm text-ink-muted">THINKING</Text>
      </View>
    </View>
  );
}

/** An agent turn that came back `error`. The user's bubble above it (pushed
 * by CaptureBar's onSuccess before the pending entry) stays visible — this
 * only replaces what Fennoc says, not what the user said. */
function AgentError({ stamp, error }: { stamp: string; error: string }) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      {/* The exact surface this whole task exists for: an operator hit this
          trying to copy an error message and couldn't. Plain Text, no
          Pressable over it — nothing to fight for the long-press. */}
      <Text className="mt-1 font-sans text-lead text-alert" selectable>
        {error}
      </Text>
    </View>
  );
}

/**
 * Provenance chips (INT-057 step 18b) — "answer first, source underneath."
 * At most 2 shown, per the design's own restraint ("never a list of
 * matches"); a turn with more than 2 sources still only surfaces its first
 * two, in server order. Grey mono, same register as Receipt's collapsed
 * header — available to the user, not asking for attention.
 */
function SourceChips({
  sources,
  onTapSource,
}: {
  sources: AgentSource[];
  onTapSource: (source: AgentSource) => void;
}) {
  return (
    <View className="mt-2 gap-1">
      {sources.slice(0, 2).map((source, index) => (
        <Pressable
          accessibilityLabel={`Source: ${source.label}`}
          accessibilityRole="button"
          // No stable id on a source row (server contract is `{turn_id,
          // image_id, ts, label}`, none of which is guaranteed unique
          // within one turn's list on their own — e.g. two hits from the
          // same prior turn) — index is fine since this array is only ever
          // rendered whole, in the order the server sent it, same
          // reasoning as Receipt.tsx's row key.
          key={index}
          onPress={() => onTapSource(source)}
        >
          <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
            {source.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Polls one in-flight agent turn (`GET /api/message/{id}`) and resolves it
 * into the thread store once the server reports `done` or `error`. Renders
 * nothing — ThreadScreen renders one of these per "thinking" entry, which
 * keeps the polling declarative and handles several queued turns at once
 * without any special-casing here.
 */
function AgentTurnWatcher({ messageId }: { messageId: string }) {
  const resolveAgent = useThreadStore((s) => s.resolveAgent);
  const { data, isError, error } = useAgentMessagePoll(messageId);

  useEffect(() => {
    // A poll that can't reach the server has to terminate somewhere. React
    // Query has already exhausted its retries by the time `isError` is set,
    // and leaving the entry on "Thinking…" indefinitely is the one outcome
    // this product can't afford — the same rule the capture error follows.
    // Resolving to `error` is terminal (the watcher unmounts, since it only
    // renders for "thinking" entries), so the user re-sends rather than
    // waiting on a spinner that will never resolve. Their own bubble stays.
    if (isError) {
      resolveAgent(messageId, {
        text: formatApiError(error) || "Couldn't reach Fennoc.",
        body: null,
        state: "error",
      });
      return;
    }
    if (!data) return;
    if (data.status === "done") {
      resolveAgent(messageId, {
        text: data.reply_lede ?? data.reply ?? "",
        body: data.reply_body,
        state: "done",
        // `actions`/`sources` read as real arrays or `null` off the
        // generated schema now (see api/types.ts) — `?? null` is only a
        // guard against a server build old enough to omit the key
        // entirely, which reads as `undefined` here.
        actions: data.actions ?? null,
        sources: data.sources ?? null,
      });
    } else if (data.status === "error") {
      resolveAgent(messageId, {
        text: data.error ?? "That didn't go through.",
        body: null,
        state: "error",
      });
    }
  }, [data, error, isError, messageId, resolveAgent]);

  return null;
}

/**
 * What the composer's "REPLYING TO" strip should show for a given reply.
 *
 * Not the lede. When Fennoc asks something, the question is usually the LAST
 * thing it says — often buried at the end of a collapsed body — and the lede
 * is a heading like "Full plate. Tue Jul 28.", which tells you nothing about
 * what you're answering. So: quote the final question if there is one, and
 * fall back to the opening line only when there isn't.
 *
 * Whitespace is collapsed because the raw reply is `lede\n\nbody`, and a
 * two-line clamp spends one of its lines on the blank.
 */
function quoteFor(fullText: string): string {
  const flat = fullText.replace(/\s+/g, " ").trim();
  const questions = flat.match(/[^.!?]*\?/g);
  if (questions && questions.length > 0) {
    return questions[questions.length - 1].trim();
  }
  return flat;
}

/**
 * The server-side half of photo Undo for shots that had ALREADY finished
 * uploading by the time Undo was tapped (`shot.state === "done"`, with a
 * server-assigned `imageId`) — the counterpart to `cancelHeldUploadsForBatch`
 * (src/outbox) for the held/offline case. Fires `DELETE /api/image/{id}`
 * for every such shot in the batch; a "held" or "uploading" shot has no
 * `imageId` yet and is skipped here (it's `cancelHeldUploadsForBatch`'s or
 * nothing's job, respectively).
 *
 * Deliberately not awaited by the caller (`onUndoPhoto`, above): the
 * message has already been hidden from the thread by `undoPhotoBatch` by
 * the time this runs, and there is no "undo the undo" if the network call
 * fails — the message must not reappear, and Step 11 defines no "delete
 * failed, retry?" affordance to hold it open for. The delete is genuinely
 * best-effort from the UI's perspective: the message disappears either
 * way. What must NOT happen is the failure vanishing silently — a failed
 * server-side delete means the extracted-text row is still sitting there
 * even though the user was just shown "gone," so every rejection is logged
 * loudly via `console.error`. There is no UI surface left to attach a
 * warning to once the message is hidden (the whole point of Undo is that
 * it disappears), so a log line — not new UI chrome the spec doesn't call
 * for — is the honest ceiling here; a future retry-on-next-launch sweep
 * would be the real fix, not something this handler can do alone.
 */
function deleteSentUploadsForBatch(batch: PhotoBatch): void {
  for (const shot of batch.shots) {
    if (shot.state !== "done" || !shot.imageId) continue;
    deleteImage(shot.imageId).catch((error: unknown) => {
      console.error(
        "[thread] Undo: server-side image delete failed — the extracted-text row may still exist",
        shot.imageId,
        formatApiError(error),
      );
    });
  }
}

function ThreadTerminus() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-line-hairline" />
      <Text
        className="font-mono-medium text-dataSm text-ink-muted"
        numberOfLines={1}
      >
        NOTHING ELSE · NEXT AFTER 17:00
      </Text>
      <View className="h-px flex-1 bg-line-hairline" />
    </View>
  );
}

/**
 * A date rule between days (step 18a: `"SAT 1 AUG"` mono style) — visually
 * identical to `ThreadTerminus` above (two hairlines flanking a centered
 * mono label) but a separate, small component rather than a shared one:
 * `ThreadTerminus` is a fixed, one-off end-of-thread marker with its own
 * hardcoded copy, and parametrizing it for a per-day label would couple
 * two things that happen to look alike today but mean different things
 * (end of thread vs. start of a day) for no real code reuse — this is six
 * lines either way.
 */
function DayRule({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-line-hairline" />
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {label}
      </Text>
      <View className="h-px flex-1 bg-line-hairline" />
    </View>
  );
}

/**
 * A collapsed day (step 18a): one tappable mono line, `"WED 29 ·
 * Kessler drawings, invoice photo, 3 closed"` — the day label plus the
 * server's own deterministic composition (`ThreadDay.line`), never a
 * client-side summary. Tapping expands the day in place (`expandDay` in
 * the store, which widens the `?expand=` set the next `GET /api/thread`
 * call sends) rather than navigating anywhere.
 */
function CollapsedDayRow({
  dateKey,
  line,
  onPress,
}: {
  dateKey: string;
  line: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Expands this day in place"
      accessibilityLabel={`${formatDayLabel(dateKey)}. ${line ?? ""}`}
      accessibilityRole="button"
      className="py-1 active:opacity-70"
      onPress={onPress}
    >
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {formatDayLabel(dateKey)} · {line ?? ""}
      </Text>
    </Pressable>
  );
}

/**
 * The overnight-timer resolution card (step 18a) — "resolved first, before
 * anything else." Styled like `CheckinCard` (open top/left/right border,
 * no bottom edge, two stub lines implying continuation) but in `ink`, not
 * `signal`: this is a closing-out prompt, not an unanswered question, so it
 * does not borrow the amber reserved for that. No praise copy anywhere,
 * per the product's own voice rule — the three actions are stated plainly.
 */
function OvernightCard({
  label,
  startedAt,
  suggestedMinutes,
  onDone,
  onKeep,
  onBin,
  sending,
}: {
  label: string;
  startedAt: string;
  suggestedMinutes: number;
  onDone: () => void;
  onKeep: () => void;
  onBin: () => void;
  sending: boolean;
}) {
  const since = formatTimeOfDay(startedAt) || "--:--";
  return (
    <View className="relative mx-4 mb-3">
      <View className="rounded-t-md border-x border-t border-line-strong bg-bg-raised p-4">
        <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
          STILL ON · SINCE {since} YESTERDAY
        </Text>

        <Text className="mt-2 font-sans-semibold text-title text-ink">{label}</Text>

        <Text className="mt-2 font-sans text-body text-ink-secondary">
          This was running when you put the phone down yesterday. Call it{" "}
          {suggestedMinutes} minutes and close it, or did you carry on after?
        </Text>

        <View className="mt-4 gap-2">
          <Pressable
            accessibilityLabel={`${suggestedMinutes} minutes, done`}
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm bg-ink active:opacity-80"
            disabled={sending}
            onPress={onDone}
          >
            <Text className="font-sans-semibold text-label text-bg-base">
              {suggestedMinutes} min, done
            </Text>
          </Pressable>
          <View className="flex-row gap-3">
            <Pressable
              accessibilityLabel="Still going"
              accessibilityRole="button"
              className="h-touch flex-1 items-center justify-center rounded-sm border border-line-strong active:opacity-80"
              disabled={sending}
              onPress={onKeep}
            >
              <Text className="font-sans-medium text-label text-ink">Still going</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Bin the time"
              accessibilityRole="button"
              className="h-touch flex-1 items-center justify-center rounded-sm border border-line-strong active:opacity-80"
              disabled={sending}
              onPress={onBin}
            >
              <Text className="font-sans-medium text-label text-ink">Bin the time</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View className="absolute -bottom-px left-0 h-px w-5 bg-line-strong" />
      <View className="absolute -bottom-px right-0 h-px w-5 bg-line-strong" />
    </View>
  );
}

/**
 * Converts one server turn into 0–2 render items: a user bubble (only when
 * `kind === "user"` and `text` is non-null — a `kind === "proactive"` turn
 * has neither, per the server's own nullable-`text` contract, so it
 * correctly produces no bubble here, "no user bubble — render as Fennoc
 * speech, unboxed") and a Fennoc reply item shaped by `status`
 * (`"done"`/`"error"` render exactly like a resolved local capture always
 * has; anything else — `"queued"`/`"running"`, or a future status this
 * app doesn't special-case — renders as "Thinking…", matching a fresh
 * local capture's own initial state).
 */
function agentMessageToItems(turn: AgentMessage): ThreadMessage[] {
  const atMs = new Date(turn.created_at).getTime();
  const stamp = formatTimeOfDay(turn.created_at);
  const items: ThreadMessage[] = [];

  if (turn.kind === "user" && turn.text) {
    items.push({ id: `${turn.id}:user`, kind: "user-capture", atMs, text: turn.text });
  }

  if (turn.status === "done") {
    items.push({
      id: turn.id,
      kind: "agent-turn",
      atMs,
      stamp,
      messageId: turn.id,
      state: "done",
      text: turn.reply_lede ?? turn.reply ?? "",
      body: turn.reply_body,
      actions: turn.actions,
      sources: turn.sources,
    });
  } else if (turn.status === "error") {
    items.push({
      id: turn.id,
      kind: "agent-turn",
      atMs,
      stamp,
      messageId: turn.id,
      state: "error",
      text: turn.error ?? "That didn't go through.",
      body: null,
      actions: null,
      sources: null,
    });
  } else {
    items.push({
      id: turn.id,
      kind: "agent-turn",
      atMs,
      stamp,
      messageId: turn.id,
      state: "thinking",
      text: "",
      body: null,
      actions: null,
      sources: null,
    });
  }

  return items;
}

/** Converts one session-local capture into a render item — identical to
 *  ThreadScreen's pre-INT-057 inline logic, factored out so it can feed
 *  both today's overlay merge and (if this ever needs it) a standalone
 *  render. Briefings are not captures and are merged in separately. */
function captureToItem(capture: ThreadCapture): ThreadMessage {
  const atMs = new Date(capture.createdAt).getTime();
  if (capture.photo) {
    return {
      id: capture.id,
      kind: "photo-batch",
      atMs,
      stamp: formatTimeOfDay(capture.createdAt),
      batch: capture.photo,
    };
  }
  if (capture.speaker === "fennoc" && capture.agent) {
    return {
      id: capture.id,
      kind: "agent-turn",
      atMs,
      stamp: formatTimeOfDay(capture.createdAt),
      messageId: capture.agent.messageId,
      state: capture.agent.state,
      text: capture.text,
      body: capture.agent.body,
      actions: capture.agent.actions,
      sources: capture.agent.sources,
    };
  }
  if (capture.speaker === "fennoc") {
    return {
      id: capture.id,
      kind: "fennoc-line",
      atMs,
      stamp: formatTimeOfDay(capture.createdAt),
      text: capture.text,
    };
  }
  return { id: capture.id, kind: "user-capture", atMs, text: capture.text };
}

/**
 * Builds one day's render list: every server turn NOT already covered by a
 * local capture, plus (today only) the local overlay itself.
 *
 * THE DEDUPE RULE (INT-057): a local capture with `agent.messageId` set
 * means "this session already knows what this turn is" — whether it's
 * still `"thinking"` or has resolved. Any server turn sharing that id is
 * therefore excluded here in favour of the local rendering, which is what
 * keeps the LIVE, poll-driven "Thinking… → resolved" transition (via
 * `AgentTurnWatcher`) working exactly as it did before this change, rather
 * than racing a 60s thread refetch. A local capture with NO message id
 * (a plain typed bubble from `addCapture`, a photo batch, a check-in
 * echo) has nothing to dedupe against and is never excluded from either
 * side — it simply has no server counterpart to collide with.
 *
 * `overlay` is omitted for every day except today: session-local captures
 * are always created "now" (see useTodayCaptures), so no other day could
 * possibly need one.
 */
function buildDayMessages(day: ThreadDay, overlay?: ThreadCapture[]): ThreadMessage[] {
  const localMessageIds = new Set(
    (overlay ?? [])
      .map((c) => c.agent?.messageId)
      .filter((id): id is string => id !== undefined),
  );

  const items: ThreadMessage[] = [];
  for (const turn of day.turns) {
    if (localMessageIds.has(turn.id)) continue;
    items.push(...agentMessageToItems(turn));
  }
  for (const capture of overlay ?? []) {
    items.push(captureToItem(capture));
  }

  return items.sort((a, b) => a.atMs - b.atMs);
}

/**
 * The thread — root screen of the app (INT-023; server-backed since
 * INT-057). Renders `GET /api/thread`'s days, oldest→newest, merged with
 * the session-local overlay (`useThreadStore` — pending sends, in-flight
 * agent turns, photo batches, expansion state; see its own header comment
 * for the exact doctrine). Today renders exactly as ThreadScreen always
 * has; the up-to-2 prior live days render the same turns dimmed; anything
 * older is one tappable line per day until expanded.
 */
export function ThreadScreen({ onOpenSettings }: ThreadScreenProps) {
  const { palette } = useTheme();
  const today = chicagoToday();
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const morningBriefing = useMorningBriefing(today);
  const eveningBriefing = useEveningBriefing(today);
  const captures = useTodayCaptures();
  // Select the actions individually — a selector returning a fresh object each
  // read is what caused the "Maximum update depth exceeded" crash earlier.
  const addCapture = useThreadStore((s) => s.addCapture);
  const addFennocLine = useThreadStore((s) => s.addFennocLine);
  const setReplyingTo = useThreadStore((s) => s.setReplyingTo);
  const undoPhotoBatch = useThreadStore((s) => s.undoPhotoBatch);
  // The whole map, not a per-message slice — selecting `receiptExpanded[id]`
  // here would need `id` in the selector's closure per row, and a selector
  // that computes rather than reads verbatim is the exact "fresh value every
  // read" trap the comment above already warns about. Reading the map once
  // and indexing it per-row at render time (below) is cheap and correct.
  const receiptExpanded = useThreadStore((s) => s.receiptExpanded);
  const toggleReceiptExpanded = useThreadStore((s) => s.toggleReceiptExpanded);
  const expandedDays = useThreadStore((s) => s.expandedDays);
  const expandDay = useThreadStore((s) => s.expandDay);
  const pendingQuery = usePendingCheckin();
  const replyMutation = useReplyCheckin();

  // Stable, sorted array for the query key (`useThread` sorts again itself,
  // but deriving it here too keeps this component from allocating a new
  // array reference into that hook on every render regardless — see
  // threadQueryKeys' own comment on why sort order can't be left to depend
  // on object key iteration order).
  const expandParam = useMemo(
    () => Object.keys(expandedDays).filter((date) => expandedDays[date]).sort(),
    [expandedDays],
  );
  const thread = useThread(expandParam);
  const resolveOvernightMutation = useResolveOvernight();

  // The server's `days` array is what today's local overlay (`captures`)
  // attaches to (see `buildDayMessages`) — but the FIRST `GET /api/thread`
  // call, or a slow/failed one, means `thread.data` can be `undefined` for
  // a while. Without this fallback, a message typed in that window would
  // have no "today" day to render onto at all and would simply not
  // appear — a real regression from the pre-INT-057 behaviour, where the
  // local store WAS the thread and never depended on a network round trip
  // to show what the user just said. Synthesizing an empty "live" today
  // when the server hasn't supplied one yet keeps that guarantee: what you
  // type shows up immediately, thread fetch or no.
  const days = useMemo(() => {
    const fetched = thread.data?.days ?? [];
    if (fetched.some((d) => d.date === today)) return fetched;
    return [
      ...fetched,
      { date: today, state: "live", turns: [], line: null, turn_count: 0 },
    ];
  }, [thread.data, today]);

  // Every currently-"thinking" agent entry gets its own poller — see
  // AgentTurnWatcher above. Derived in useMemo, not read off the zustand
  // selector directly, for the same reason `useTodayCaptures` filters in a
  // useMemo rather than the selector: a selector that allocates (`.filter`
  // here) makes every store read look like a change.
  const pendingAgentIds = useMemo(
    () =>
      captures
        .filter((c) => c.agent?.state === "thinking")
        .map((c) => c.agent?.messageId)
        .filter((id): id is string => id !== undefined),
    [captures],
  );

  // Holds the message the "Read the rest" sheet is currently showing — its
  // body (the sheet's content), and its messageId/quote (so the sheet's own
  // always-visible Reply button, see ReplySheet, has something to hand off
  // to onReply below).
  const [openReplyMessage, setOpenReplyMessage] = useState<{
    messageId: string;
    body: string;
    quote: string;
  } | null>(null);

  // Which briefing (if any) the "Read briefing" sheet is currently showing —
  // see FennocMessage's onOpen and BriefingSheet below.
  const [openBriefing, setOpenBriefing] = useState<{ title: string; text: string } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  // Day-boundary y-offsets within the scroll content, captured via each
  // day section's own `onLayout` — same pattern LedgerSheet's scrollspy
  // already uses for its section pills. Read fresh at the moment of a
  // scroll (never cached elsewhere), so a boundary that moves as new
  // content renders above it self-corrects the next time it lays out.
  const dayOffsets = useRef<Record<string, number>>({});
  // Set by `onTapSource` below; cleared once the scroll actually happens.
  // See the effect beneath the JSX for why this needs to be state (and not
  // just an imperative call) — the target day may still be collapsed and
  // waiting on an `?expand=` refetch when the tap happens.
  const [pendingScrollDate, setPendingScrollDate] = useState<string | null>(null);

  const onOpenLedger = () => {
    setLedgerOpen(true);
  };

  // Fix for a reported bug: "after the thinking went away it had responded
  // but it was below the text box so I couldn't see it and didn't realize
  // it." The ScrollView never auto-scrolled, so a reply landing below the
  // fold was invisible and read as "it didn't answer". onContentSizeChange
  // fires whenever the content height changes — which covers all three
  // cases that matter here: the user's own bubble appearing, the
  // "Thinking…" entry appearing, and that entry resolving into a reply
  // (a further height change). Do not simplify this away.
  //
  // Guarded on `pendingScrollDate`: a source tap wants to land on a SPECIFIC
  // day, not the bottom, and expanding a collapsed day changes content size
  // exactly like a new message would — without this guard, that expansion
  // would fight the source-scroll effect below for control of the scroll
  // position on the very same content-size change.
  const onThreadContentSizeChange = () => {
    if (pendingScrollDate) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  // Shared by both Reply entry points (the inline CTA on an agent reply in
  // the thread, and ReplySheet's always-visible Reply button): close the
  // sheet if it's open (a no-op if it wasn't) and hand the message off to
  // the composer via the store. CaptureBar focuses itself once
  // `replyingTo` goes from null to non-null — see its own effect.
  const onReply = (messageId: string, quote: string) => {
    setOpenReplyMessage(null);
    setReplyingTo({ messageId, quote });
  };

  // Undo (Step 11: "Undo lives on the sent message for 10s"). Three steps,
  // in order, once the window is confirmed still open: hide the message
  // (`undoPhotoBatch` — store-only, returns whether the window was actually
  // still open), cancel any of its shots that are still sitting unsent in
  // the outbox (`cancelHeldUploadsForBatch` — the held/offline case: the
  // outbox item is dropped and the local file deleted, a genuine cancel),
  // and — the case this used to lie about — tell the server to delete the
  // row for every shot that had ALREADY finished uploading
  // (`deleteSentUploadsForBatch`, below). `POST /api/image` never keeps the
  // bytes, but the extracted-text row it inserts survives the request; for
  // an already-sent shot, hiding the message without this call meant the
  // user believed the photo's content was gone when it was still sitting
  // in the images table. Split across two modules (this component +
  // outbox) on purpose: useThread.ts can't import the outbox without
  // creating a cycle (the outbox already imports FROM useThread.ts, to
  // deliver upload results) — this component is the one place both sides,
  // plus the API client, are already in scope to call in sequence.
  const onUndoPhoto = (batch: PhotoBatch) => {
    if (undoPhotoBatch(batch.batchId)) {
      cancelHeldUploadsForBatch(batch.batchId);
      deleteSentUploadsForBatch(batch);
    }
  };

  const onCheckinReply = (text: string) => {
    const questionType = pendingQuery.data?.question_type;
    if (!questionType) return;
    replyMutation.mutate(
      { text, questionType },
      {
        onSuccess: (result) => {
          // Answering used to leave nothing behind: the card unmounted and the
          // thread was unchanged, which reads as "it ignored me". Echo the
          // answer, then Fennoc's own ack — the server returns either a
          // confirmation or a follow-up question depending on whether the
          // reply actually parsed, so this stays honest when parsing fails.
          addCapture(text);
          if (result?.ack) addFennocLine(result.ack);
        },
        onError: (error) => {
          // Already answered/expired elsewhere — the server's state wins;
          // resync so the card clears instead of surfacing a dead end.
          if (isAxiosError(error) && error.response?.status === 409) {
            void pendingQuery.refetch();
          }
        },
      },
    );
  };

  const openTimer = thread.data?.open_timer ?? null;
  const onResolveOvernight = (action: "done" | "keep" | "bin") => {
    if (!openTimer) return;
    resolveOvernightMutation.mutate({ blockId: openTimer.block_id, action });
  };

  // Tapping a provenance chip (step 18b): find which day the source's
  // timestamp falls on, expand it if it's still collapsed, then scroll.
  // SHIPPED: scroll-to-DAY-BOUNDARY, not scroll-to-exact-turn. Per-turn
  // scrolling would need a y-offset cached per TURN rather than per day,
  // and this thread's content resizes constantly (turns resolving, days
  // expanding) in a way LedgerSheet's stable section list never has to
  // tolerate — a stale per-turn offset landing a few rows off is a worse
  // failure than a coarser, more robust "land at the top of the right
  // day" that self-corrects the same way the day-offset scroll below
  // already does. Landing on the day and letting the user glance down a
  // few lines is the honest v1 here.
  const onTapSource = (source: AgentSource) => {
    if (!source.turn_id) {
      // An image-recall source has no turn to jump to — see AgentSource's
      // own doc comment on why `turn_id` is null there by design, not a
      // gap. Nothing to do.
      return;
    }
    const dateKey = chicagoDateKey(source.ts);
    const day = days.find((d) => d.date === dateKey);
    if (!day) return; // outside the thread's ~30-day window — nothing to land on
    if (day.turns.length === 0) {
      // Collapsed and not yet loaded — widen the `?expand=` set; the
      // pending-scroll effect below fires once this day's turns (and its
      // boundary's real offset) actually arrive.
      expandDay(dateKey);
    }
    setPendingScrollDate(dateKey);
  };

  // Resolves `pendingScrollDate` once the target day's boundary has a real
  // layout offset — which may be immediately (an already-loaded live day)
  // or only after the expand-triggered refetch above lands and that day's
  // content actually renders. Re-runs on every thread refetch so a
  // just-expanded day gets a fresh chance once its turns are in.
  useEffect(() => {
    if (!pendingScrollDate) return;
    const y = dayOffsets.current[pendingScrollDate];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
    setPendingScrollDate(null);
  }, [pendingScrollDate, thread.data]);

  const onDayBoundaryLayout = (dateKey: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
    dayOffsets.current[dateKey] = event.nativeEvent.layout.y;
  };

  // 2. It persists above the composer until the query says otherwise —
  // there is no local-only dismiss that could hide it. See CheckinCard's
  // own "no dismiss button" note for the answer-recording side of this.
  const showCheckin = pendingQuery.data?.pending === true && !pendingQuery.isError;

  const renderMessage = (message: ThreadMessage, dimmed: boolean) => {
    if (message.kind === "fennoc-briefing") {
      return (
        <FennocMessage
          key={message.id}
          label={message.label}
          onOpen={() => setOpenBriefing({ title: message.title, text: message.text })}
          stamp={message.stamp}
        />
      );
    }
    if (message.kind === "photo-batch") {
      // No dimmed variant for a photo batch — see the day-loop's own note;
      // a photo entry in a past day renders exactly as it does today.
      return (
        <PhotoMessage
          batch={message.batch}
          key={message.id}
          onUndo={() => onUndoPhoto(message.batch)}
          stamp={message.stamp}
        />
      );
    }
    if (message.kind === "fennoc-line") {
      return (
        <FennocLine dimmed={dimmed} key={message.id} stamp={message.stamp} text={message.text} />
      );
    }
    if (message.kind === "agent-turn") {
      if (message.state === "thinking") {
        // No dimmed variant here either: a past-day turn only ever renders
        // "thinking" for a turn that's genuinely still unresolved server-
        // side (see agentMessageToItems) — a rare, transient state that
        // isn't worth a second visual treatment for.
        return <AgentThinking key={message.id} stamp={message.stamp} />;
      }
      if (message.state === "error") {
        // Left at full `alert` red even in a dimmed day on purpose: a
        // failed turn is still worth noticing, past day or not.
        return (
          <AgentError
            error={message.text || "That didn't go through."}
            key={message.id}
            stamp={message.stamp}
          />
        );
      }
      // The full reply — lede plus the collapsed body, when there is
      // one — is what both the "does this need a Reply CTA" heuristic
      // and the composer's quoted strip work from, so a question
      // buried in the collapsed part still surfaces the button.
      const fullReplyText = message.body
        ? `${message.text}\n\n${message.body}`
        : message.text;
      // Heuristic, not a real question-detector: a "?" anywhere in the
      // reply. Cheap and honest for the reported case (a question with
      // no way to answer); a boxed "Reply" under every Fennoc line
      // would be noise Fennoc's unboxed voice doesn't want. Revisit if
      // this proves too broad or too narrow in practice.
      const hasQuestion = fullReplyText.includes("?");
      // See quoteFor: the strip shows the QUESTION, not the lede.
      const replyQuote = quoteFor(fullReplyText);
      return (
        <View key={message.id}>
          <FennocLine dimmed={dimmed} stamp={message.stamp} text={message.text} />
          {/* Provenance chips (INT-057 step 18b) — sit directly under the
              reply, above the receipt: "answer first, source underneath"
              is about the reply itself, not the turn's write/read log. */}
          {message.sources && message.sources.length > 0 ? (
            <SourceChips onTapSource={onTapSource} sources={message.sources} />
          ) : null}
          {/* INT-050 — sits above the message body (the collapsed
              "Read the rest" content and Reply CTA below), never
              rendered at all when the turn doesn't qualify (see
              qualifiesForReceipt) — most turns carry no `actions` yet
              (old turns, or a server build that hasn't shipped the
              field), and this stays silent for every one of them. */}
          {message.actions && qualifiesForReceipt(message.actions) ? (
            <Receipt
              actions={message.actions}
              expanded={receiptExpanded[message.messageId] === true}
              onToggle={() => toggleReceiptExpanded(message.messageId)}
            />
          ) : null}
          {message.body !== null || hasQuestion ? (
            <View className="mt-2 flex-row items-center gap-2">
              {message.body !== null ? (
                <Pressable
                  accessibilityLabel="Read the rest"
                  accessibilityRole="button"
                  className="h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
                  onPress={() =>
                    setOpenReplyMessage({
                      messageId: message.messageId,
                      body: message.body as string,
                      quote: replyQuote,
                    })
                  }
                >
                  <Text className="font-sans-medium text-label text-ink">Read the rest</Text>
                </Pressable>
              ) : null}
              {hasQuestion ? (
                <Pressable
                  accessibilityLabel="Reply"
                  accessibilityRole="button"
                  className="h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
                  onPress={() => onReply(message.messageId, replyQuote)}
                >
                  <Text className="font-sans-medium text-label text-ink">Reply</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    }
    return <UserBubble dimmed={dimmed} key={message.id} text={message.text} />;
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base" edges={["top", "bottom"]}>
      <View className="h-16 flex-row items-center gap-3 border-b border-line-hairline px-4">
        <Pressable
          accessibilityHint="Long-press to open Settings"
          accessibilityLabel="Fennoc"
          accessibilityRole="button"
          className="h-touch w-touch items-center justify-center"
          onLongPress={onOpenSettings}
        >
          <FennocMark color={palette.mark} size={24} />
        </Pressable>

        <Text
          className="font-sans-semibold text-ink"
          style={{ fontSize: 17, lineHeight: 22 }}
        >
          Fennoc
        </Text>

        <View className="flex-1" />

        <Pressable
          accessibilityLabel="Ledger"
          accessibilityRole="button"
          className="h-touch items-center justify-center rounded-sm border border-line-strong px-[18px] active:opacity-80"
          onPress={onOpenLedger}
        >
          <Text className="font-sans-medium text-label text-ink">
            Ledger
          </Text>
        </Pressable>
      </View>

      <StatusStrip />

      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-end gap-[18px] px-4 py-5"
        onContentSizeChange={onThreadContentSizeChange}
        ref={scrollRef}
      >
        {days.map((day, dayIndex) => {
          const isToday = day.date === today;
          const collapsed = day.state === "collapsed" && day.turns.length === 0;

          if (collapsed) {
            return (
              <CollapsedDayRow
                dateKey={day.date}
                key={day.date}
                line={day.line}
                onPress={() => expandDay(day.date)}
              />
            );
          }

          const dimmed = !isToday;
          const messages = buildDayMessages(day, isToday ? captures : undefined);
          const dayMessages = isToday
            ? [
                ...(morningBriefing.data?.text && morningBriefing.data.date === today
                  ? [
                      {
                        id: "briefing-morning",
                        kind: "fennoc-briefing" as const,
                        atMs: new Date(`${today}T${MORNING_BRIEFING_TIME}:00`).getTime(),
                        stamp: `${MORNING_BRIEFING_TIME} · MORNING`,
                        label: "Morning briefing ready.",
                        title: "Morning briefing",
                        text: morningBriefing.data.text,
                      },
                    ]
                  : []),
                ...(eveningBriefing.data?.text && eveningBriefing.data.date === today
                  ? [
                      {
                        id: "briefing-evening",
                        kind: "fennoc-briefing" as const,
                        atMs: new Date(`${today}T${EVENING_BRIEFING_TIME}:00`).getTime(),
                        stamp: `${EVENING_BRIEFING_TIME} · EVENING`,
                        label: "Evening briefing ready.",
                        title: "Evening briefing",
                        text: eveningBriefing.data.text,
                      },
                    ]
                  : []),
                ...messages,
              ].sort((a, b) => a.atMs - b.atMs)
            : messages;

          // The date rule between days (step 18a). Today's own boundary
          // always shows the full "SAT 1 AUG" form (the anchor into
          // "now"); a live-but-past day shows "YESTERDAY" for exactly the
          // day named that, or a bare "WED 29" for anything further back
          // but still live — collapsed days get their own row above and
          // never reach this branch.
          const ruleLabel = isToday
            ? formatDayLabelWithMonth(day.date)
            : isYesterday(day.date, today)
              ? "YESTERDAY"
              : formatDayLabel(day.date);

          return (
            <View key={day.date} onLayout={onDayBoundaryLayout(day.date)}>
              {/* No rule above the very first rendered day — nothing sits
                  above it to separate from. */}
              {dayIndex > 0 ? (
                <View className="mb-[18px]">
                  <DayRule label={ruleLabel} />
                </View>
              ) : null}
              <View className="gap-[18px]">
                {dayMessages.map((message) => renderMessage(message, dimmed))}
              </View>
            </View>
          );
        })}
        <ThreadTerminus />
      </ScrollView>

      {/* One poller per in-flight agent turn (see AgentTurnWatcher above).
          Renders nothing — this just keeps polling declarative for however
          many turns are queued at once. */}
      {pendingAgentIds.map((messageId) => (
        <AgentTurnWatcher key={messageId} messageId={messageId} />
      ))}

      {/*
        The manifest sets android:windowSoftInputMode="adjustResize", but Expo
        enables edge-to-edge on Android by default and under edge-to-edge the
        window no longer resizes for the keyboard — so the composer, the
        check-in card, and any capture error message all end up UNDERNEATH it.
        Reported from a real device: "the onscreen keyboard drew over the text
        box so I could not see what I was typing."

        Everything the keyboard must not cover goes inside this.
      */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        {/* The overnight card (step 18a) — "resolved first, before
            anything else," which this literally is: it sits above the
            check-in card in this same pending-cards stack, not merely
            earlier in reading order. */}
        {openTimer ? (
          <OvernightCard
            label={openTimer.label}
            onBin={() => onResolveOvernight("bin")}
            onDone={() => onResolveOvernight("done")}
            onKeep={() => onResolveOvernight("keep")}
            sending={resolveOvernightMutation.isPending}
            startedAt={openTimer.started_at}
            suggestedMinutes={openTimer.suggested_minutes}
          />
        ) : null}

        {showCheckin && pendingQuery.data ? (
          <CheckinCard
            onReply={onCheckinReply}
            pending={pendingQuery.data}
            sending={replyMutation.isPending}
          />
        ) : null}

        <Strip />
        <CaptureBar />
      </KeyboardAvoidingView>

      <LedgerSheet onClose={() => setLedgerOpen(false)} visible={ledgerOpen} />
      <ReplySheet
        body={openReplyMessage?.body ?? null}
        messageId={openReplyMessage?.messageId ?? null}
        onClose={() => setOpenReplyMessage(null)}
        onReply={onReply}
        quote={openReplyMessage?.quote ?? ""}
        visible={openReplyMessage !== null}
      />
      <BriefingSheet
        onClose={() => setOpenBriefing(null)}
        text={openBriefing?.text ?? null}
        title={openBriefing?.title ?? ""}
        visible={openBriefing !== null}
      />
    </SafeAreaView>
  );
}
