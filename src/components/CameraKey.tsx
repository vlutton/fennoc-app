import * as Haptics from "expo-haptics";
import { Camera as CameraIcon, Images } from "lucide-react-native";
import { useCallback, useRef } from "react";
import { type GestureResponderEvent, Pressable } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

import { useDiscoverability } from "../store/useDiscoverability";
import {
  HOLD_LIFT_RISE_MS,
  HOLD_LIFT_START_MS,
  liftEasing,
  quietEasing,
  STATE_SETTLE,
  useReducedMotion,
} from "../theme/motion";
import { useTheme } from "../theme/useTheme";
import { SecondaryContextDot } from "./SecondaryContextDot";

interface CameraKeyProps {
  /** Plain tap — opens the camera hot path. Untouched by ruling 12: ruling
   *  1 (shutter is send) and "the camera key is 56px, mic stays 72px" both
   *  still stand. */
  onTapCamera: () => void;
  /** The hold committed at `HOLD_LIFT_COMMIT_MS` — opens the photo
   *  library. Callers pass the SAME function the non-gesture route (the
   *  capture sheet's own library affordance — see `CameraCapture.tsx`)
   *  calls, so there is exactly one "open the library" implementation. */
  onHoldCommit: () => void;
}

// The badge both the resting dot (SecondaryContextDot, 5px) and the
// committed state (a small filled circle carrying the library glyph, once
// it has fully risen) occupy the SAME bottom-right anchor point — this is
// what makes it read as "the dot became the menu" rather than two
// unrelated things overlapping. It starts at the dot's own footprint and
// grows outward from its own center, so no separate translate is needed to
// keep it anchored through the scale.
const BADGE_SIZE = 24;
const DOT_SIZE = 5;
const BADGE_MIN_SCALE = DOT_SIZE / BADGE_SIZE;
const BADGE_REDUCED_SIZE = 20;

// How far the badge travels upward, off the key, by the time the hold
// commits — on top of the growth above. Purely a scale animation would
// read as "the corner is swelling"; adding a lift on top is what reads as
// "pulling something up and out."
const LIFT_TRAVEL_PX = 18;

// A deliberate upward drag adds on top of whatever the timed rise has
// already reached — see the module doc below for what problem this solves
// and, honestly, what it doesn't.
const DRAG_ASSIST_MAX_PX = 10;

/**
 * The camera key, wearing ruling 12's (INT-035) layers 1 and 2 together —
 * layer 1's standing mark (`SecondaryContextDot`, always on) and layer 2's
 * "the press answers early" hold-to-reveal, which is what actually opens
 * the library now that ruling 12 has removed the dedicated 48px library
 * key ruling 11 added. Layer 3 (the one-time thread message) lives outside
 * this component entirely — see `src/store/useDiscoverability.ts`'s
 * `recordPhotoCaptured`, called from `captureShot` — because it's keyed
 * off photo COUNT, not press behaviour, and needs to survive this
 * component unmounting.
 *
 * Why this isn't just `<Pressable onPress={...} onLongPress={...}>`: a
 * plain `onLongPress` with a delay is exactly what ruling 12 rules out — it
 * is silent for the whole delay and then fires or doesn't, with nothing in
 * between for a lingering finger to notice. What ruling 12 asks for is
 * built by hand instead, entirely on top of `Pressable`'s own
 * `onPressIn`/`onPressMove`/`onPressOut`/`onPress` (all four are still
 * genuine `Pressable` props — see React Native's `Pressability`, which
 * exposes per-move events even though `onLongPress` alone wouldn't):
 *
 *   - `onPressIn` starts a `withDelay(180, withTiming(1, {duration: 220},
 *     cb))` on `liftProgress` — a single reanimated clock that is both the
 *     lift's visual driver AND, via `cb`, the thing that calls `commit()`
 *     the instant it finishes uninterrupted. There is no second, separate
 *     `setTimeout` for the commit — one clock, so the visual and the
 *     action can never drift apart.
 *   - `onPressOut`, called for EVERY way a press can end (a real release,
 *     a drag out of the hit rect, a responder termination — see
 *     `Pressability`'s state machine), reassigns `liftProgress` to
 *     `withTiming(0, ...)` if the hold hasn't committed yet. Reassigning a
 *     shared value mid-animation cancels whatever's in flight — including
 *     the DELAYED call itself if release happens inside the first 180ms —
 *     so `cb` above receives `finished: false` and `commit()` never runs.
 *     That's "release now and it settles back — nothing happened," built
 *     out of the same primitive that produces the rise, not a second
 *     bolted-on undo path.
 *   - `onPress` still fires on every valid tap release (React Native
 *     always calls it unless an `onLongPress` prop is present to suppress
 *     it — there is deliberately no `onLongPress` prop here) — the
 *     `committedRef` guard inside it is what stands in for that
 *     suppression once a hold has already opened the library.
 *
 * What this does NOT literally do: track the finger's real drag distance
 * as the sole driver of the lift. A stationary hold (the overwhelming
 * common case — most people don't drag while holding a button) has no
 * directional signal to track, so the 180/400ms contract has to be
 * guaranteed by the timed clock above regardless. `onPressMove`'s real
 * touch-Y delta (`dragAssistPx`) is layered ON TOP of that guaranteed
 * timed rise as a small, additive nudge (see `DRAG_ASSIST_MAX_PX`) — an
 * attentive person who pulls upward on purpose gets an immediate,
 * proportional response rather than being forced to wait out the full
 * window, which is the spirit of "tracking the finger 1:1... rather than
 * waiting out a timer" even though the BASELINE motion remains time-driven.
 */
export function CameraKey({ onTapCamera, onHoldCommit }: CameraKeyProps) {
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  // Action reference, not derived state — see useThread.ts's own note (its
  // "Maximum update depth exceeded" warning) on why a selector here must
  // never allocate. Retires layer 3's thread message app-globally the
  // first time ANY marked element commits a hold — see this store's own
  // header on why that flag isn't scoped to just this key.
  const recordMarkedHold = useDiscoverability((s) => s.recordMarkedHold);

  // 0 -> 1 across the HOLD_LIFT_START_MS..HOLD_LIFT_COMMIT_MS window.
  const liftProgress = useSharedValue(0);
  // Extra px from a genuine upward drag — see the module doc above.
  // Reduced-motion callers ignore this entirely (opacity-only twin below).
  const dragAssistPx = useSharedValue(0);

  const startPageYRef = useRef<number | null>(null);
  const committedRef = useRef(false);

  const commit = useCallback(() => {
    committedRef.current = true;
    // "One soft haptic" — `Soft` is the literal name of the gentlest style
    // expo-haptics exposes, distinct from the camera shutter's own
    // `Medium` thump (CameraCapture.tsx) — the two need to feel different,
    // since one confirms a send and this one confirms a reveal.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
    recordMarkedHold();
    onHoldCommit();
  }, [onHoldCommit, recordMarkedHold]);

  const onPressIn = useCallback(
    (event: GestureResponderEvent) => {
      committedRef.current = false;
      startPageYRef.current = event.nativeEvent.pageY;
      dragAssistPx.value = 0;
      // Reduced motion still runs the identical 180/400 clock — the GAP is
      // the point ("a finger that lingers a beat too long...") and has to
      // stay true with motion off. Only the STYLE this drives changes (see
      // `liftStyle` below): opacity instead of travel, per this file's
      // (and `motion.ts`'s) standing rule that a reduced twin drops travel,
      // never the information.
      liftProgress.value = withDelay(
        HOLD_LIFT_START_MS,
        withTiming(
          1,
          { duration: HOLD_LIFT_RISE_MS, easing: reduced ? quietEasing() : liftEasing() },
          (finished) => {
            if (finished) runOnJS(commit)();
          },
        ),
      );
    },
    // `dragAssistPx`/`liftProgress` deliberately excluded — reanimated
    // shared values have a stable identity across renders, same as a ref
    // (see this codebase's existing convention of excluding refs from
    // dependency arrays, e.g. CaptureBar.tsx's `wasReplyingRef`), and
    // listing a shared value here trips `react-hooks/immutability`: the
    // compiler reads mutating a value that ALSO appears in a hook's own
    // dependency array as breaking that hook's memoization contract, even
    // though reanimated's whole API is built on exactly this kind of
    // outside-render `.value =` mutation (see `FennocMark.tsx`'s
    // `ThinkingColumn`, which does the same mutation from inside a plain
    // `useEffect` instead, where this rule doesn't fire).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, reduced],
  );

  const onPressMove = useCallback(
    (event: GestureResponderEvent) => {
      if (reduced || committedRef.current || startPageYRef.current == null) return;
      // pageY decreases as the finger moves UP the screen — that's the
      // "pulling something up" direction this key's lift travels in.
      const draggedUp = startPageYRef.current - event.nativeEvent.pageY;
      // `react-hooks/immutability` (the React Compiler ESLint plugin) does
      // not know reanimated's `useSharedValue` — it only recognises
      // `useRef`-style mutation as safe outside render, and additionally
      // only tolerates a GIVEN shared value being written from the single
      // callback closure it first sees write to it (that's why the near-
      // identical `dragAssistPx.value = 0` in `onPressIn` above needs no
      // disable, but this second write site to the SAME shared value does).
      // Reanimated's entire API is built on exactly this kind of
      // outside-render `.value =` mutation from an event handler — see
      // `FennocMark.tsx`'s `ThinkingColumn`, which does the same thing and
      // only avoids this rule because all of its writes happen to live in
      // one `useEffect` rather than split across sibling callbacks the way
      // a press/move/release gesture necessarily has to be.
      // eslint-disable-next-line react-hooks/immutability
      dragAssistPx.value = Math.max(0, Math.min(draggedUp, DRAG_ASSIST_MAX_PX));
    },
    // `dragAssistPx` excluded — see the identical note on `onPressIn` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reduced],
  );

  const onPressOut = useCallback(() => {
    startPageYRef.current = null;
    // See the `eslint-disable` comment in `onPressMove` above for why these
    // two (the second write site each for `dragAssistPx` and
    // `liftProgress`) need an explicit disable and the two in `onPressIn`
    // don't.
    // eslint-disable-next-line react-hooks/immutability
    dragAssistPx.value = withTiming(0, { duration: STATE_SETTLE });
    // Whether this release is the ordinary end of a completed commit, or an
    // early "let go before 400ms," the visual resets the same way — reset
    // to rest, reversibly animated. The only difference is which one
    // already fired `onHoldCommit` on the way here.
    // eslint-disable-next-line react-hooks/immutability
    liftProgress.value = withTiming(0, { duration: STATE_SETTLE, easing: quietEasing() });
    // `dragAssistPx`/`liftProgress` excluded — see the note on `onPressIn`
    // above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPress = useCallback(() => {
    if (committedRef.current) return;
    onTapCamera();
  }, [onTapCamera]);

  const liftStyle = useAnimatedStyle(() => {
    if (reduced) {
      // Reduced twin: opacity only, fixed size, no travel — see the module
      // doc. The information (something is starting; it committed) is
      // still fully present, just not as motion.
      return { opacity: liftProgress.value };
    }
    return {
      opacity: liftProgress.value,
      transform: [
        { translateY: -(liftProgress.value * LIFT_TRAVEL_PX + dragAssistPx.value) },
        { scale: BADGE_MIN_SCALE + liftProgress.value * (1 - BADGE_MIN_SCALE) },
      ],
    };
  });

  const iconStyle = useAnimatedStyle(() => ({
    // The library glyph only earns its keep once the badge is big enough
    // to actually hold it legibly — fading it in across the back half of
    // the rise (progress > 0.5) rather than from the very first pixel of
    // growth, when the badge is still smaller than the icon itself.
    opacity: Math.max(0, liftProgress.value - 0.5) * 2,
  }));

  return (
    <Pressable
      accessibilityHint="Long-press to choose a photo from your library"
      accessibilityLabel="Camera"
      accessibilityRole="button"
      className="relative h-camera w-camera items-center justify-center rounded-sm border border-line-strong active:opacity-80"
      onPress={onPress}
      onPressIn={onPressIn}
      onPressMove={onPressMove}
      onPressOut={onPressOut}
    >
      <CameraIcon color={palette.ink.DEFAULT} size={22} />

      {/* Layer 1 — the standing mark. Always present underneath layer 2's
          badge; the badge growing on top of it is what visually reads as
          "the dot became the menu" rather than two separate elements. */}
      <SecondaryContextDot />

      {/* Layer 2 — the committing badge. Full-strength `signal`, not the
          dot's dim `signal/60`: Step 18's token delta explicitly licenses
          spending amber at full strength on "an active control," and while
          it's rising/committed this key IS one — the dim standing mark is
          the only thing ruling 12 requires to stay muted at rest. */}
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            bottom: 2,
            right: 2,
            height: reduced ? BADGE_REDUCED_SIZE : BADGE_SIZE,
            width: reduced ? BADGE_REDUCED_SIZE : BADGE_SIZE,
            borderRadius: (reduced ? BADGE_REDUCED_SIZE : BADGE_SIZE) / 2,
            backgroundColor: palette.signal.DEFAULT,
            alignItems: "center",
            justifyContent: "center",
          },
          liftStyle,
        ]}
      >
        <Animated.View style={iconStyle}>
          <Images color={palette.signal.on} size={12} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}
