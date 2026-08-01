import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { isPhotoUndoAvailable, type PhotoBatch } from "../store/useThread";
import { useTheme } from "../theme/useTheme";
import { FennocMark } from "./FennocMark";

/**
 * One line of a photo batch's body — what Step 11 calls "the read." There
 * is no classifier in this build's scope (see the capture hot path's own
 * scope note: log/obligation/case routing is later work), so what renders
 * here is the raw one-pass extraction text from `POST /api/image`, not the
 * synthesized "Water bill, £84.20, due 12 Aug" one-liner the design mock
 * shows — that sentence is the classifier's job, not this endpoint's. A
 * multi-shot batch with more than one finished shot renders one paragraph
 * per shot rather than a single merged sentence, for the same reason:
 * merging N reads into one coherent line is exactly the synthesis step
 * that's out of scope here. This is the honest, structurally-correct stand-
 * in — "one message, one entry in the thread" is satisfied even though
 * "one read" in the fully-synthesized sense isn't yet.
 */
function ShotLine({ shot }: { shot: PhotoBatch["shots"][number] }) {
  const { palette } = useTheme();

  if (shot.state === "uploading") {
    // Mirrors ThreadScreen's AgentThinking treatment exactly — same mark,
    // same quiet mono label — because it's the same underlying idea ("it
    // is working"), not a new pattern invented for photos.
    return (
      <View className="flex-row items-center gap-2">
        <FennocMark color={palette.ink.muted} size={20} state="thinking" />
        <Text className="font-mono-medium text-dataSm text-ink-muted">READING</Text>
      </View>
    );
  }

  if (shot.state === "held") {
    // "Held is colourless by rule: offline is not a warning state... no
    // badge, no red, no nag" (Step 11). ink-muted, no icon, no different
    // treatment from any other quiet status line in this app.
    return (
      <Text className="font-sans text-body text-ink-muted" selectable>
        Kept on device · goes when you're back
      </Text>
    );
  }

  if (shot.state === "error") {
    // Deliberately NOT `text-alert` (the red AgentError uses elsewhere):
    // Step 11's failure rule is "one sentence with no retry," a calm
    // correction rather than an alarm — a photo that couldn't be read is
    // an everyday outcome (glare, a blurry shot), not a system failure.
    // Still selectable for the same reason AgentError's alert text is: a
    // failure message is exactly the thing someone wants to paste elsewhere.
    return (
      <Text className="font-sans text-body text-ink" selectable>
        {shot.errorText ?? "Can't read this one."}
      </Text>
    );
  }

  // A routed shot renders its caption — "Logged · 2nd this week" — and
  // nothing else. Step 12a: a recognized log gets a caption line, never
  // narration; the full extraction stays server-side, in the thread turn
  // and behind fennoc_recall_image, where the ASSISTANT needs it. Showing
  // it here was the "very verbose for a normal user" complaint, verbatim.
  if (shot.caption) {
    return (
      <Text className="font-sans text-body text-ink" selectable>
        {shot.caption}
      </Text>
    );
  }

  // An unrouted shot's extraction collapses behind the same grey-header
  // treatment the Receipt uses (INT-050's visual language, reused rather
  // than reinvented). Step 11's reading rule — "one line, then the item.
  // Never a bulleted extraction dump in the thread" — and the extraction
  // rendered open was exactly that dump: 75% of the screen, at the same
  // visual level as the actual answer. The machine text is subordinate
  // material: available on a tap, never competing with the reply.
  return <CollapsedExtraction text={shot.extractedText ?? ""} />;
}

/**
 * Collapsed: `WHAT IT READ`, mono, ink-disabled — the Receipt's exact
 * collapsed treatment (grey, deliberately, never amber: available to the
 * user, not asking for their attention). Tap: header lifts to ink-muted
 * and the full extraction opens beneath, selectable. Local state is
 * enough for persistence — the thread is a ScrollView (children stay
 * mounted), and the store's own thread state is in-memory session-local
 * anyway.
 */
function CollapsedExtraction({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityHint={expanded ? "Tap to collapse" : "Tap to show the full text it read"}
        accessibilityLabel="What it read"
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => setExpanded((v) => !v)}
      >
        <Text
          className={
            expanded
              ? "font-mono-medium text-dataSm text-ink-muted"
              : "font-mono-medium text-dataSm text-ink-disabled"
          }
          numberOfLines={1}
        >
          WHAT IT READ
        </Text>
      </Pressable>
      {expanded ? (
        <Text className="mt-1 font-sans text-body text-ink" selectable>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A camera-hot-path (or gallery) message. Header carries the send stamp
 * plus the Undo affordance while the 10s window is open ("Undo lives on
 * the sent message for 10s" — Step 11). Body is one `ShotLine` per shot in
 * the batch, in shutter-press order.
 */
export function PhotoMessage({
  stamp,
  batch,
  onUndo,
}: {
  stamp: string;
  batch: PhotoBatch;
  onUndo: () => void;
}) {
  // Re-render once a second while the undo window is open so the
  // affordance disappears on its own at the 10s mark, without needing any
  // OTHER store change to trigger a re-render in the meantime. The actual
  // rule being checked — `isPhotoUndoAvailable` — is the same pure
  // function useThread.ts exports for testing; this effect only decides
  // WHEN to re-check it, not what the answer is.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isPhotoUndoAvailable(batch.createdAtMs)) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [batch.createdAtMs]);

  const undoAvailable = isPhotoUndoAvailable(batch.createdAtMs);

  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
          {stamp} · Sent
        </Text>
        {undoAvailable ? (
          <Pressable
            accessibilityLabel="Undo sent photo"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onUndo}
          >
            <Text className="font-mono-medium text-dataSm text-ink-secondary">
              Undo
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View className="mt-1 gap-2">
        {batch.shots.map((shot) => (
          <ShotLine key={shot.localId} shot={shot} />
        ))}
      </View>
    </View>
  );
}
