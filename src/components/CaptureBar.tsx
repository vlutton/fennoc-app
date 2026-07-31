import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { ArrowUp, Camera as CameraIcon, Keyboard as KeyboardIcon, Mic, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { captureShot } from "../capture/photoCapture";
import { useSendAgentMessage } from "../hooks/useAgentMessage";
import { useCapture } from "../hooks/useHome";
import { isNetworkError } from "../outbox";
import { useThreadStore } from "../store/useThread";
import { useTheme } from "../theme/useTheme";
import { CameraCapture } from "./CameraCapture";

type Feedback = "captured" | "queued" | "error" | null;

/**
 * `bg.float`, 1px top border `line.strong`, padding 14/16, gap 14. The
 * 48×48 keyboard button is a peer that focuses the composer; it never
 * becomes the resting state. The 72×72 mic is the largest target on
 * screen and the default input.
 *
 * Voice capture itself (listening, auto-stop on silence, haptic + tone
 * confirmation) is INT-025 scope. This shell wires the mic to the same send
 * path the composer's text uses — tapping it sends whatever has been
 * typed. With nothing typed it's a no-op (see comment below) rather than a
 * fake "recording" state with no real transcription behind it.
 *
 * Product decision (INT-029b): the composer talks to the *agent*
 * (`POST /api/message`), not `/api/capture`, because the thread is a
 * conversation — Fennoc reads the message and replies in-thread, which
 * `/api/capture` has no way to do. `/api/capture` remains underneath it as
 * the instant, offline-safe path: `useCapture` (still wired below) is what
 * actually queues to the outbox, and is exactly what runs when the agent
 * send fails because the device has no network — a thought must still land
 * somewhere even if there's no one to read it yet.
 *
 * The camera key (Step 11 of the design handoff) is the third input this
 * bar owns, at a deliberately smaller 56×56 — see the `h-camera`/`w-camera`
 * tailwind tokens — so it never reads as competing with the mic for the
 * thumb. A tap opens `CameraCapture` (the hot path: shutter sends, no
 * review, no caption). A long-press opens the system photo library instead
 * (the cold path) and stages the result in `pendingImage` rather than
 * sending it immediately — a gallery pick is the ONE place in this whole
 * flow a caption survives (Step 15), because by the time you're choosing
 * an old photo the moment it depicts has already passed, so there's
 * something worth typing. All of the actual upload/batching/held-queue
 * logic for both paths lives in `src/capture/photoCapture.ts`, on purpose:
 * this component only decides WHEN to call it (shutter press vs. picker
 * result vs. Send with something staged), never HOW an upload behaves.
 */
export function CaptureBar() {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const captureMutation = useCapture();
  const sendAgentMessage = useSendAgentMessage();
  // The camera hot path (tap) — CameraCapture is rendered below, toggled by
  // this alone; it owns its own permission/preview/shutter state entirely.
  const [cameraOpen, setCameraOpen] = useState(false);
  // The library cold path (long-press) — a picked-but-not-yet-sent photo,
  // waiting on whatever the user types next as its caption (Step 15: "the
  // next thing you say is the caption" — the ONE place that's true for a
  // photo, since the camera hot path never has this state at all). Cleared
  // by sending, by the X on the attachment strip, or by picking again.
  const [pendingImage, setPendingImage] = useState<{ uri: string; mime: string } | null>(null);
  // Selected as an action reference, not derived state — see the store's own
  // "Maximum update depth exceeded" warning on why a selector here must
  // never allocate.
  const addCapture = useThreadStore((s) => s.addCapture);
  const addAgentPending = useThreadStore((s) => s.addAgentPending);
  const replyingTo = useThreadStore((s) => s.replyingTo);
  const setReplyingTo = useThreadStore((s) => s.setReplyingTo);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  // Focus the composer the moment `replyingTo` transitions from null to
  // non-null (i.e. a Reply CTA was just pressed elsewhere in the tree).
  // CaptureBar owns its own TextInput ref, so this is the simplest way to
  // react to that transition without leaking the ref across the tree.
  const wasReplyingRef = useRef(false);
  useEffect(() => {
    if (replyingTo && !wasReplyingRef.current) {
      inputRef.current?.focus();
    }
    wasReplyingRef.current = replyingTo !== null;
  }, [replyingTo]);

  const showFeedback = (kind: Feedback, msg?: string) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback(kind);
    setErrorMsg(msg ?? null);
    // Success and queued self-clear — Fennoc doesn't announce that it did its
    // job. An ERROR must not: it is telling you a thought did not save, and the
    // text is still sitting in the composer waiting to be retried. Auto-hiding
    // that after 1.5s is how a capture goes missing silently, which is the one
    // outcome this product cannot afford. It clears on the next attempt.
    if (kind === "error") return;
    clearTimer.current = setTimeout(() => {
      setFeedback(null);
      setErrorMsg(null);
    }, 1500);
  };

  // Fallback path: the existing /api/capture mutation, used only when the
  // agent send fails offline. It already queues to the outbox and echoes
  // the user's own bubble in its own onSuccess (see useHome.ts), so this
  // wrapper only needs to translate its result into composer feedback.
  const fallbackToCapture = (trimmed: string) => {
    const idempotencyKey = Crypto.randomUUID();
    captureMutation.mutate(
      {
        text: trimmed,
        opts: {
          idempotency_key: idempotencyKey,
          source_ref: "fennoc-app",
        },
      },
      {
        onSuccess: (result) => {
          setText("");
          setReplyingTo(null);
          showFeedback(result.queued ? "queued" : "captured");
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : "Capture failed";
          showFeedback("error", message);
        },
      },
    );
  };

  // Sends a gallery pick (Step 15's one caption case) with whatever is
  // currently typed as its `question`. Fire-and-forget, same as the camera
  // hot path's own `captureShot` call — this function does not await the
  // upload, because the composer clearing IS the send confirmation here,
  // the same way the shutter firing is the confirmation for a camera shot.
  // The thread entry (added synchronously inside captureShot, before any
  // network call) is what actually shows the outcome.
  const onSendPhoto = () => {
    if (!pendingImage) return;
    const image = pendingImage;
    const caption = text.trim();
    setPendingImage(null);
    setText("");
    setReplyingTo(null);
    void captureShot(
      { uri: image.uri, mime: image.mime },
      {
        // A gallery pick never batches with anything — multi-shot is a
        // camera-hot-path-only idea (Step 11: "Multi-shot is a second and
        // third shutter press"), so every pick mints its own fresh batch.
        batchId: Crypto.randomUUID(),
        isFirstInBatch: true,
        question: caption.length > 0 ? caption : undefined,
      },
    );
  };

  // Long-press on the camera key: the library, "cold path, picker allowed"
  // (Step 11). Requested explicitly rather than relying on
  // `launchImageLibraryAsync`'s own implicit prompt-on-first-call, to match
  // this app's existing habit of asking for permission with its own,
  // legible call site (see src/notifications/permissions.ts) rather than
  // letting a native API surface a system dialog with no app-level context
  // around it.
  const onCameraLongPress = () => {
    void (async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        // No screen for this (unlike CameraCapture's denied state) — a
        // long-press that silently does nothing is a reasonable outcome
        // for the COLD path; the user can grant access from Settings and
        // long-press again. Escalating this into a modal/alert would be
        // more chrome than the cold path is worth.
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      // `mimeType` is optional on `ImagePickerAsset` — undefined on some
      // Android content providers per its own doc comment. Falling back to
      // JPEG rather than leaving it blank: the server's `Content-Type`
      // check (fennoc-core's `ALLOWED_MIME_TYPES`) needs SOME value, and a
      // photo picked from a library is jpeg far more often than not.
      setPendingImage({ uri: asset.uri, mime: asset.mimeType ?? "image/jpeg" });
      setReplyingTo(null);
      inputRef.current?.focus();
    })();
  };

  const onSubmit = () => {
    if (pendingImage) {
      onSendPhoto();
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || sendAgentMessage.isPending || captureMutation.isPending) return;

    // A lingering ERROR "clears on the next attempt" (see showFeedback
    // above) — that only happens if something here actually clears it, since
    // a successful agent send below doesn't call showFeedback itself.
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback(null);
    setErrorMsg(null);

    // `trimmed` is sent as-is, never prefixed with `replyingTo.quote`. The
    // app's thread is one continuous Hermes session, so the agent already
    // has its own question in context — the quote strip above is purely a
    // user-facing affordance for what "Reply" is answering. Sending the raw
    // answer also keeps this input identical to what Telegram sends, which
    // is what the INT-029 acceptance test depends on.
    sendAgentMessage.mutate(trimmed, {
      onSuccess: (result) => {
        // The user's own bubble, then a pending Fennoc entry the
        // AgentTurnWatcher (ThreadScreen) will resolve once the turn
        // finishes — see useThread.ts's addAgentPending/resolveAgent.
        addCapture(trimmed);
        addAgentPending(result.id);
        setText("");
        setReplyingTo(null);
      },
      onError: (error) => {
        // A thought must never go missing because the network dropped:
        // fall back to the offline-safe capture path, which queues to the
        // outbox. A real (non-network) server error on /api/message is
        // reported as-is instead — falling back there would silently
        // re-route a genuine agent failure through a different endpoint.
        if (isNetworkError(error)) {
          fallbackToCapture(trimmed);
          return;
        }
        const message = error instanceof Error ? error.message : "Send failed";
        showFeedback("error", message);
      },
    });
  };

  const pending = sendAgentMessage.isPending || captureMutation.isPending;
  const hasText = text.trim().length > 0;

  const onMicPress = () => {
    if (pendingImage || text.trim().length > 0) {
      onSubmit();
      return;
    }
    // TODO(INT-025): the signature listening/thinking/done sequence and
    // real speech capture. Nothing is typed, so there is nothing to send —
    // do not fake a "listening" state with no transcription behind it.
  };

  return (
    <View className="gap-[14px] border-t border-line-strong bg-bg-float px-4 py-[14px]">
      {/* The quoted strip for whatever "Reply" (ThreadScreen / ReplySheet)
          most recently targeted. UI affordance only — see the comment above
          sendAgentMessage.mutate in onSubmit for why the quote itself is
          never sent. Left accent uses the same border-line-strong token as
          the rest of the border; `signal` (amber) is reserved for an
          unanswered question / running timer, not this strip.

          Surface is `bg.raised`, NOT `bg.float` — the composer bar this sits
          inside is already `bg.float`, so a float-on-float strip has zero
          contrast and reads as a bare outline. Recessed is also the right
          metaphor for a quote: it belongs beneath what you're writing, not
          floating above it. */}
      {replyingTo ? (
        <View className="flex-row items-start gap-2 rounded-sm border border-line-strong border-l-2 bg-bg-raised px-3 py-2">
          <View className="flex-1">
            <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
              REPLYING TO
            </Text>
            <Text className="mt-1 font-sans text-caption text-ink-secondary" numberOfLines={2}>
              {replyingTo.quote}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cancel reply"
            accessibilityRole="button"
            className="h-touch w-touch items-center justify-center"
            onPress={() => setReplyingTo(null)}
          >
            <X color={palette.ink.muted} size={18} />
          </Pressable>
        </View>
      ) : null}

      {/* The picked-but-unsent gallery photo (Step 15's one caption case).
          Same recessed-strip treatment as the reply quote above, for the
          same reason: it belongs beneath what you're about to type, not
          floating above it. The thumbnail here is a LOCAL file preview,
          not a fetch from the server — the server never returns image
          bytes (see ImageUploadResult's doc comment), so this is the only
          moment this app ever shows this photo full-fidelity; once sent,
          the thread only ever has the extracted text. */}
      {pendingImage ? (
        <View className="flex-row items-center gap-2 rounded-sm border border-line-strong border-l-2 bg-bg-raised px-3 py-2">
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: pendingImage.uri }}
            style={{ height: 40, width: 40, borderRadius: 4 }}
          />
          <View className="flex-1">
            <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
              PHOTO ATTACHED
            </Text>
            <Text className="mt-1 font-sans text-caption text-ink-secondary" numberOfLines={1}>
              Say what it is, or send as-is
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Remove photo"
            accessibilityRole="button"
            className="h-touch w-touch items-center justify-center"
            onPress={() => setPendingImage(null)}
          >
            <X color={palette.ink.muted} size={18} />
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row items-center gap-[14px]">
        <Pressable
          accessibilityLabel="Open keyboard"
          accessibilityRole="button"
          className="h-touch w-touch items-center justify-center rounded-sm border border-line-strong active:opacity-80"
          onPress={() => inputRef.current?.focus()}
        >
          <KeyboardIcon color={palette.ink.DEFAULT} size={20} />
        </Pressable>

        {/* 56px, deliberately smaller than the 72px mic — "the camera never
            competes for the thumb" (Step 11's capture rules). Tap opens the
            hot path (CameraCapture, no menu in between); long-press opens
            the library instead — "cold path, picker allowed... never the
            default tap." */}
        <Pressable
          accessibilityHint="Long-press to choose a photo from your library"
          accessibilityLabel="Camera"
          accessibilityRole="button"
          className="h-camera w-camera items-center justify-center rounded-sm border border-line-strong active:opacity-80"
          onLongPress={onCameraLongPress}
          onPress={() => setCameraOpen(true)}
        >
          <CameraIcon color={palette.ink.DEFAULT} size={22} />
        </Pressable>

        <TextInput
          autoCapitalize="sentences"
          autoCorrect
          className="flex-1 font-sans text-body text-ink"
          editable={!pending}
          onChangeText={setText}
          onSubmitEditing={onSubmit}
          placeholder={pendingImage ? "Say what it is (optional)" : "Say anything"}
          placeholderTextColor={palette.ink.muted}
          ref={inputRef}
          returnKeyType="send"
          value={text}
        />

        <Pressable
          accessibilityLabel={hasText || pendingImage ? "Send" : "Capture"}
          accessibilityRole="button"
          className="h-mic w-mic items-center justify-center rounded-full bg-ink active:opacity-80"
          disabled={pending}
          onPress={onMicPress}
        >
          {pending ? (
            <ActivityIndicator color={palette.bg.base} />
          ) : hasText || pendingImage ? (
            // Reported from a real device: "the microphone icon is throwing
            // me… maybe it should toggle to a paper plane when I start
            // typing." onMicPress already sends typed text (see its comment
            // above) — this just makes that existing behaviour legible. The
            // same swap applies with a photo pending and nothing typed: the
            // button is a send action either way, never a no-op mic tap.
            // Same size/shape/fill as the mic; only the glyph changes.
            <ArrowUp color={palette.bg.base} size={28} />
          ) : (
            <Mic color={palette.bg.base} size={28} />
          )}
        </Pressable>
      </View>

      <CameraCapture onClose={() => setCameraOpen(false)} visible={cameraOpen} />

      {feedback === "captured" ? (
        <Text className="font-sans text-caption text-ink-muted">
          Captured.
        </Text>
      ) : null}
      {feedback === "queued" ? (
        <Text className="font-sans text-caption text-ink-secondary">
          Held. Will send.
        </Text>
      ) : null}
      {feedback === "error" ? (
        <Text className="font-sans text-caption text-alert">
          {errorMsg ?? "Capture failed."}
        </Text>
      ) : null}
    </View>
  );
}
