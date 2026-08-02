import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { ArrowUp, Mic, Square, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Linking,
  Pressable,
  Text,
  TextInput,
  type TextInputContentSizeChangeEvent,
  View,
} from "react-native";

import { captureShot } from "../capture/photoCapture";
import { useSendAgentMessage } from "../hooks/useAgentMessage";
import { useCapture } from "../hooks/useHome";
import { isNetworkError } from "../outbox";
import { useThreadStore } from "../store/useThread";
import { useTheme } from "../theme/useTheme";
import { CameraCapture } from "./CameraCapture";
import { CameraKey } from "./CameraKey";

type Feedback = "captured" | "queued" | "error" | null;

// Matches `text-body`'s lineHeight in tailwind.config.js (16px/24px). The
// composer starts at exactly one line — its original, single-line height —
// and is allowed to grow up to roughly 4.5 lines (the ".5" is deliberate: a
// partial line peeking at the cap is what tells the eye "there's more, this
// scrolls" instead of the box just silently stopping). Past that it scrolls
// internally rather than pushing the mic/camera buttons or the rest of the
// bar around.
const COMPOSER_LINE_HEIGHT = 24;
const COMPOSER_MIN_HEIGHT = COMPOSER_LINE_HEIGHT;
const COMPOSER_MAX_HEIGHT = COMPOSER_LINE_HEIGHT * 4.5;

// INT-040: quiet, non-modal copy for the speech-recognition "error" event.
// No exclamation marks, no praise — matches this file's existing feedback
// copy ("Captured.", "Held. Will send."). `aborted` deliberately has no
// entry here: it's what `stop()`/`abort()` themselves can surface, i.e. the
// user's own tap-to-stop, not a failure worth a message.
const VOICE_ERROR_MESSAGES: Partial<Record<string, string>> = {
  "no-speech": "No speech detected.",
  "not-allowed": "Microphone access is off.",
  "service-not-allowed": "Voice capture isn't available on this device.",
  "audio-capture": "Microphone unavailable.",
  "language-not-supported": "Voice recognition isn't available for this language on this device.",
  network: "Voice capture needs a connection right now.",
};

const voiceErrorMessage = (code: string) =>
  VOICE_ERROR_MESSAGES[code] ?? "Voice capture didn't catch that.";

/**
 * `bg.float`, 1px top border `line.strong`, padding 14/16, gap 14. The
 * 72×72 mic is the largest target on screen and the default input.
 *
 * With something typed (or a photo staged), tapping the mic sends — see
 * `onMicPress` below. With the composer empty, it starts on-device speech
 * recognition (INT-040): tap to start, tap again to stop, never
 * press-and-hold (PRD). Interim results stream straight into the composer
 * as they arrive; the final transcript sits there for a glance/edit before
 * the user sends it themselves — this build never auto-sends a transcript
 * (INT-040 ruling 2). The signature listening/thinking/done animation is
 * still INT-025 scope and deliberately NOT built here — the mic icon
 * swapping to a stop glyph while recognizing is the only state change,
 * on purpose (a real capability, not a rehearsal of one).
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
 * review, no caption). Holding it opens the system photo library instead
 * and stages the result in `pendingImage` rather than sending it
 * immediately — a gallery pick is the ONE place in this whole flow a
 * caption survives (Step 15), because by the time you're choosing an old
 * photo the moment it depicts has already passed, so there's something
 * worth typing.
 *
 * Discoverability history, because this key's affordance has been
 * relitigated twice:
 *
 *   Ruling 11 (2026-07-31, post-launch) found that the hold was reachable
 *   only via a gesture with no visible affordance beyond a screen-reader-
 *   only `accessibilityHint` — fine for an old photograph (there genuinely
 *   is no moment to miss), wrong for the operator's actual most-frequent
 *   use, a MacroFactor screenshot. It answered by repurposing the 48×48
 *   keyboard key (redundant since tapping the composer already focuses it)
 *   into a second, always-visible library button.
 *
 *   Ruling 12 (INT-035, step 16) supersedes that with a better answer to
 *   the SAME problem and restores the original canon — camera 56px, mic
 *   72px, library is a hold, never the default tap. The dedicated library
 *   key is gone; discoverability is now three layers instead of a second
 *   button, all owned by `CameraKey.tsx`:
 *     1. A standing 5px dot (`SecondaryContextDot`, dim amber, always
 *        visible) marking that this key hides a second context.
 *     2. The hold itself answers early — visible, reversible motion
 *        starting at 180ms, committing with one soft haptic at 400ms —
 *        rather than a silent `onLongPress` delay.
 *     3. One ordinary Fennoc thread message, fired once, after the third
 *        photo, only if the hold has never been used — see
 *        `src/store/useDiscoverability.ts`'s `recordPhotoCaptured`,
 *        called from `captureShot`.
 *   Ruling 12 also requires the library stay reachable WITHOUT the hold —
 *   "nothing is reachable only through a hold" — which is what
 *   `onChooseFromLibrary` below wires into `CameraCapture`'s own capture
 *   sheet: open the camera key, and the library is a second, ordinary tap
 *   away, no gesture required.
 *
 * All of the actual upload/batching/held-queue logic for both the camera
 * and library paths lives in `src/capture/photoCapture.ts`, on purpose:
 * this component only decides WHEN to call it (shutter press vs. picker
 * result vs. Send with something staged), never HOW an upload behaves.
 */
export function CaptureBar() {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  // Auto-growing composer height. `style` (not `className`) on purpose:
  // NativeWind classes are static strings resolved once, and this value
  // changes on every keystroke — there is no Tailwind utility for "whatever
  // height the content just measured at". `onContentSizeChange` reports the
  // TextInput's actual content height as the user types; clamping it here
  // is what turns that into "starts at one line, grows, caps at ~4.5 lines
  // and scrolls" instead of an unbounded box that could swallow the rest of
  // the screen on a long brain-dump.
  const [inputHeight, setInputHeight] = useState(COMPOSER_MIN_HEIGHT);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Bumped by each of the three real send successes below (agent send,
  // offline-capture fallback, gallery-photo send) — never by a failure, and
  // never by the user just backspacing the composer empty by hand. That
  // last case is why this isn't just another `text === ""` check like the
  // height-reset effect below: `text` also goes empty on manual clearing,
  // which must NOT slam the keyboard shut mid-edit. A dedicated counter is
  // the smallest signal that means "a send actually happened."
  const [sendCount, setSendCount] = useState(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const captureMutation = useCapture();
  const sendAgentMessage = useSendAgentMessage();
  // The camera hot path (tap) — CameraCapture is rendered below, toggled by
  // this alone; it owns its own permission/preview/shutter state entirely.
  const [cameraOpen, setCameraOpen] = useState(false);
  // The library pick (`openPhotoLibrary`, reached by holding the camera key
  // to commit ruling 12's layer 2, or via the capture sheet's non-gesture
  // route — see CameraCapture's `onChooseFromLibrary`) — a picked-but-not-
  // yet-sent photo, waiting on whatever the user types next as its caption
  // (Step 15: "the next thing you say is the caption" — the ONE place
  // that's true for a photo, since the camera hot path never has this
  // state at all). Cleared by sending, by the X on the attachment strip,
  // or by picking again.
  const [pendingImage, setPendingImage] = useState<{ uri: string; mime: string } | null>(null);
  // INT-040: true while on-device speech recognition is actively listening.
  // Set synchronously at the moment `start()` is called (not on the native
  // "start" event) — same "reflect the tap immediately, don't wait on a
  // round trip" pattern as `capturing` in CameraCapture.tsx. Cleared on the
  // native "end" event, which the library guarantees fires last, even after
  // an error (see `voiceErrorMessage` above).
  const [recognizing, setRecognizing] = useState(false);
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
      // INT-040: if this bar unmounts mid-recognition (navigating away
      // while listening), abort rather than leaving the native session — and
      // the OS mic indicator — running with nothing left to receive its
      // events. A no-op if nothing is in progress.
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  // Collapse the composer back to one line whenever it empties. This is
  // belt-and-braces on top of `onContentSizeChange`, and it is here because
  // every clear in this component is PROGRAMMATIC — `setText("")` after a
  // send, a photo send, or an offline fallback — never a keystroke. Android
  // does not reliably re-measure a multiline TextInput whose value was
  // replaced from JS, so relying on the measurement callback alone risks a
  // composer that stays four lines tall over a placeholder after every send.
  // Resetting on the state that actually changed is cheaper than trying to
  // remember to reset at all three call sites, and cannot be forgotten at a
  // fourth.
  useEffect(() => {
    if (text === "") setInputHeight(COMPOSER_MIN_HEIGHT);
  }, [text]);

  // Collapse the keyboard after every real send. `sendCount` starts at 0 and
  // that first render is skipped on purpose — there is nothing to dismiss on
  // mount, and firing here unconditionally would make this effect ambiguous
  // about whether 0 means "no send yet" or "just mounted." Declared ABOVE the
  // reply-focus effect below so that if a send success and a Reply-CTA press
  // ever land in the same commit, this dismiss runs first and the focus
  // (declared after) is what wins — never the other way around, which is the
  // "tap Reply and the keyboard closes anyway" bug this file's spec warns
  // about. In practice the two never collide: every place that bumps
  // `sendCount` also sets `replyingTo` to null, never to non-null.
  useEffect(() => {
    if (sendCount === 0) return;
    Keyboard.dismiss();
  }, [sendCount]);

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

  // INT-040: interim AND final results land here — the library doesn't
  // distinguish them in a way this component needs to, since either way the
  // right move is "show what's been heard so far." `results[0]` is the
  // top alternative; `maxAlternatives` is left at its default (1), so
  // there's only ever one to read. Only fires while `startListening` below
  // is running, and only ever with the composer already empty (see
  // `onMicPress`), so this can never clobber typed text.
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript !== undefined) setText(transcript);
  });

  // Guaranteed to fire last by the library, even after an "error" — the one
  // place `recognizing` is ever cleared.
  useSpeechRecognitionEvent("end", () => {
    setRecognizing(false);
  });

  // The quiet, non-modal line this file already has for a failed send
  // (`feedback === "error"` below) is reused here rather than adding a
  // second error surface — see INT-040's "never a modal, never a toast"
  // requirement. `aborted` never reaches here because tap-to-stop below
  // calls `stop()` (a graceful stop with whatever was heard), not `abort()`.
  useSpeechRecognitionEvent("error", (event) => {
    showFeedback("error", voiceErrorMessage(event.error));
  });

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
          setSendCount((n) => n + 1);
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
    setSendCount((n) => n + 1);
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

  // Opens the system photo library — reached by holding the camera key
  // (`CameraKey`'s `onHoldCommit`) or via the capture sheet's ordinary tap
  // (`CameraCapture`'s `onChooseFromLibrary`); see the top-of-file comment
  // on ruling 12 for why BOTH exist ("nothing is reachable only through a
  // hold"). Requested explicitly rather than relying on
  // `launchImageLibraryAsync`'s own implicit prompt-on-first-call, to match
  // this app's existing habit of asking for permission with its own,
  // legible call site (see src/notifications/permissions.ts) rather than
  // letting a native API surface a system dialog with no app-level context
  // around it.
  const openPhotoLibrary = () => {
    void (async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        // No screen for this (unlike CameraCapture's denied state) — a tap
        // that silently does nothing is a reasonable outcome here; the
        // user can grant access from Settings and tap again. Escalating
        // this into a modal/alert would be more chrome than a denied
        // library permission is worth.
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

  const onComposerContentSizeChange = (event: TextInputContentSizeChangeEvent) => {
    const measured = event.nativeEvent.contentSize.height;
    setInputHeight(Math.min(Math.max(measured, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT));
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
        setSendCount((n) => n + 1);
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

  // INT-040: tap to stop, called from `onMicPress` below and from the
  // unmount cleanup effect above. Deliberately `stop()`, not `abort()` — a
  // graceful stop hands back whatever was heard as the final "result" event
  // before "end" fires, which is what leaves a transcript in the composer
  // to edit/send rather than discarding it.
  const stopListening = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    ExpoSpeechRecognitionModule.stop();
  };

  // INT-040: tap to start. Gated on three checks — device capability,
  // microphone/speech permission, and on-device model availability — run
  // BEFORE the haptic and `start()` call, not after, so a tap that can't
  // possibly start recognition doesn't buzz the user for nothing (mirrors
  // `onShutterPress`'s `cameraReady` gate in CameraCapture.tsx). Any
  // failure here degrades silently to the same quiet composer-adjacent
  // line a failed send already uses — never a modal, never a toast.
  const startListening = async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      showFeedback("error", "Voice capture isn't available on this device.");
      return;
    }

    const existing = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!existing.granted) {
      // Android treats a dismissed dialog as a denial and stops re-asking
      // after very few of those — at which point requestPermissionsAsync
      // resolves denied instantly and "Microphone access is off" was a
      // dead end the user could not act on from here. The tap's intent is
      // unambiguous (they pressed the mic wanting voice), so when the OS
      // will no longer ask, take them to the one switch that fixes it
      // instead of stating a fact. openSettings over a message: the same
      // reasoning as "ambiguity becomes a question" — a dead end becomes
      // a door.
      if (!existing.canAskAgain) {
        showFeedback("error", "Microphone access is off — opening settings.");
        await Linking.openSettings();
        return;
      }
      const requested = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!requested.granted) {
        showFeedback(
          "error",
          requested.canAskAgain
            ? "Microphone access is off."
            : "Microphone access is off — enable it in system settings for Fennoc.",
        );
        return;
      }
    }

    // Ruling 1b: on-device platform STT, not the cloud-backed mode these
    // APIs default to. Forcing it is also what makes the offline promise
    // (the persisted outbox this app already has) hold for voice: without
    // it, a tap with no network would fail with a "network" error instead
    // of transcribing locally. On Android this can be unavailable if the
    // offline language pack was never downloaded — that's reported here
    // rather than this app driving the OS's download flow, which is out of
    // scope for this build (see the report on what INT-040 deferred).
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      showFeedback(
        "error",
        "Voice recognition isn't available on this device.",
      );
      return;
    }

    // A lingering ERROR from a previous attempt clears on the next one —
    // same rule `onSubmit` above already follows for a failed send.
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback(null);
    setErrorMsg(null);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRecognizing(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      requiresOnDeviceRecognition: true,
      // `continuous` left at its default (false) on purpose — that default
      // IS the endpointing this needs: the platform stops itself after a
      // pause in speech rather than this app reimplementing silence
      // detection. Tap-to-stop (`stopListening`) still works at any point
      // regardless, per the PRD's "tap to start, tap to stop" rule.
      //
      // `recordingOptions` is left unset, which defaults `persist` to
      // false — no audio file is ever written to disk for this to clean
      // up. That's ruling 3 (audio never durably stored) satisfied by the
      // library's own default, not by this app deleting anything after
      // the fact.
    });
  };

  const onMicPress = () => {
    if (pendingImage || text.trim().length > 0) {
      onSubmit();
      return;
    }
    if (recognizing) {
      stopListening();
      return;
    }
    void startListening();
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
            <Text
              className="mt-1 font-sans text-caption text-ink-secondary"
              numberOfLines={2}
              selectable
            >
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

      {/* Deliberately still `items-center`, not `items-end`, even though the
          composer below can now grow to ~4.5 lines. The 72px mic is the
          tallest thing in this row (see the top-of-file comment) and stays
          that way for the first ~3 grown lines (24px each) — through that
          whole common range, `items-center` is what keeps the camera key,
          mic and single-line placeholder text sharing one visual
          centerline, same as before this fix. `items-end` only wins once
          the input outgrows the mic (the last ~1.5 lines of its range),
          and switching to it globally would misalign the 56px camera key
          against the mic for every rest state and short entry, which is
          the overwhelmingly common case per this file's own "the mic is
          the default input" framing — a worse trade. */}
      <View className="flex-row items-center gap-[14px]">
        {/* 56px, deliberately smaller than the 72px mic — "the camera never
            competes for the thumb" (Step 11's capture rules). Tap opens the
            hot path (CameraCapture, no menu in between); holding it reveals
            and opens the library — see CameraKey.tsx for ruling 12's three
            discoverability layers, which is why this is no longer a plain
            `Pressable` with `onLongPress`. */}
        <CameraKey onHoldCommit={openPhotoLibrary} onTapCamera={() => setCameraOpen(true)} />

        <TextInput
          autoCapitalize="sentences"
          autoCorrect
          className="flex-1 font-sans text-body text-ink"
          editable={!pending}
          multiline
          onChangeText={setText}
          onContentSizeChange={onComposerContentSizeChange}
          placeholder={pendingImage ? "Say what it is (optional)" : "Say anything"}
          placeholderTextColor={palette.ink.muted}
          ref={inputRef}
          // No `returnKeyType="send"` / `onSubmitEditing` here — deliberately.
          // With `multiline`, Android inserts a newline on Enter regardless
          // of `returnKeyType`, so a "send" label on that key would lie
          // about what pressing it does, and `onSubmitEditing` is
          // unreliable enough under multiline (esp. on Android, where it
          // effectively never fires) that wiring it to `onSubmit` would be
          // dead code dressed up as a feature. `submitBehavior="newline"` is
          // multiline's own default — set explicitly so this reads as a
          // decision, not an oversight. The send affordance is entirely the
          // mic/arrow button below (`onMicPress`, which already calls
          // `onSubmit`); losing Enter-to-send is an acceptable trade for a
          // field that needs to show a multi-sentence entry.
          submitBehavior="newline"
          style={{ height: inputHeight }}
          textAlignVertical="top"
          value={text}
        />

        <Pressable
          accessibilityLabel={
            recognizing ? "Stop" : hasText || pendingImage ? "Send" : "Capture"
          }
          accessibilityRole="button"
          className="h-mic w-mic items-center justify-center rounded-full bg-ink active:opacity-80"
          disabled={pending}
          onPress={onMicPress}
        >
          {pending ? (
            <ActivityIndicator color={palette.bg.base} />
          ) : recognizing ? (
            // INT-040's one deliberate, minimal, non-animated "listening"
            // indicator — a filled square, the standard record/stop glyph.
            // No pulsing, no waveform: that's INT-025's signature animation,
            // built on top of this, not here. Smaller than the mic/arrow
            // glyphs (22 vs 28) to read as "a stop button", not "a shape".
            <Square color={palette.bg.base} fill={palette.bg.base} size={22} />
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

      {/* `onChooseFromLibrary` is ruling 12's non-gesture route — "nothing
          is reachable only through a hold... library is also reachable
          from the capture sheet." Passing the SAME `openPhotoLibrary`
          `CameraKey`'s hold commits into means there is exactly one "open
          the library" implementation regardless of which door was used. */}
      <CameraCapture
        onChooseFromLibrary={openPhotoLibrary}
        onClose={() => setCameraOpen(false)}
        visible={cameraOpen}
      />

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
        // The exact bug report behind this whole task: "the operator hit
        // this trying to copy an error message to send me, and couldn't."
        // No Pressable wraps this Text and the composer's own growth
        // behaviour (COMPOSER_MIN_HEIGHT/MAX_HEIGHT above) is untouched —
        // this is the one line under the bar, not the input itself.
        <Text className="font-sans text-caption text-alert" selectable>
          {errorMsg ?? "Capture failed."}
        </Text>
      ) : null}
    </View>
  );
}
