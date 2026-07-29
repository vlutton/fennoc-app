import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { PRESENCE_THINK, PRESENCE_THINK_STAGGER, settleEasing, useReducedMotion } from "../theme/motion";
import { useTheme } from "../theme/useTheme";

interface FennocMarkProps {
  /** Edge length of the square viewport the mark is drawn in. */
  size?: number;
  /**
   * Fill colour for all three idle paths — pass a resolved palette hex, not
   * a className. Ignored when `state="thinking"`: that state's three
   * columns are fixed to `ink.DEFAULT` / `ink.muted` / `ink.disabled` per
   * the design's geometry table (see below), regardless of what's passed
   * here. Kept required anyway so `state="idle"` — by far the more common
   * call site — doesn't need a conditional prop shape.
   */
  color: string;
  /**
   * "idle" (default) renders the static crest exactly as before — no
   * animation, ever ("a resting animation in an ADHD tool is a bug", per
   * the design handoff). "thinking" swaps the body for `presence.think`:
   * three columns rising and settling in a loop, INT-025's signature "it is
   * working" interaction. Listening/done presence are a later state machine
   * (still INT-025) and aren't built here.
   */
  state?: "idle" | "thinking";
}

/**
 * The Fennoc mark — "Sentinel": a solid keystone body with two ears standing
 * off the top. A crest, not a creature; no eyes, no snout, no expression.
 *
 * Idle presence is always `ink-muted` (by convention of callers) and
 * completely static — no animation of any kind.
 */
function IdleMark({ size, color }: { size: number; color: string }) {
  return (
    <Svg fill="none" height={size} viewBox="0 0 64 64" width={size}>
      <Path d="M17 6 L26 26 L8 26 Z" fill={color} />
      <Path d="M47 6 L56 26 L38 26 Z" fill={color} />
      <Path
        d="M14 22 H50 A8 8 0 0 1 58 30 V48 A8 8 0 0 1 50 56 H14 A8 8 0 0 1 6 48 V30 A8 8 0 0 1 14 22 Z"
        fill={color}
      />
    </Svg>
  );
}

// Geometry lifted verbatim from the working prototype's 64×64 viewBox:
//   rect x=6  y=22 w=14 h=34 rx=7   fill: ink
//   rect x=25 y=26 w=14 h=30 rx=7   fill: ink.muted
//   rect x=44 y=30 w=14 h=26 rx=7   fill: ink.disabled
// All three bottoms sit on y=56 — the SAME y the idle mark's body rounds out
// to (see its third Path above), so swapping idle <-> thinking never shifts
// the glyph's footprint or baseline.
const VIEWBOX = 64;
const COLUMN_WIDTH = 14;
const COLUMN_GAP = 5; // 25 - (6 + 14) === 44 - (25 + 14)
const COLUMN_HEIGHTS = [34, 30, 26];
const COLUMN_BOTTOM_Y = 56;

/**
 * One `presence.think` column. Rendered as a plain `View` (well, an
 * `Animated.View` for the transform — see the module comment above) rather
 * than fighting animated SVG rect props. Scales vertically about its BOTTOM
 * edge, 0.52 → 1 → 0.52, over 1400ms, looping, `settle` curve, staggered by
 * `index * 160ms` — the prototype's `fnc-think` keyframes.
 *
 * A `withRepeat(withTiming(1, { duration: 700 }), -1, true)` — reverse=true
 * — produces exactly that: 0.52→1 over 700ms, then (reversed) 1→0.52 over
 * another 700ms, for a 1400ms total loop period.
 */
function ThinkingColumn({
  index,
  height,
  width,
  color,
  reduced,
}: {
  index: number;
  height: number;
  width: number;
  color: string;
  reduced: boolean;
}) {
  const scaleY = useSharedValue(reduced ? 1 : 0.52);

  useEffect(() => {
    if (reduced) {
      // Reduced twin: no loop at all. Static, at full height — the
      // information ("it is working") is carried by the accompanying
      // "THINKING" label, not the movement. See ThreadScreen's AgentThinking.
      scaleY.value = 1;
      return;
    }
    scaleY.value = 0.52;
    scaleY.value = withDelay(
      index * PRESENCE_THINK_STAGGER,
      withRepeat(
        withTiming(1, { duration: PRESENCE_THINK / 2, easing: settleEasing() }),
        -1,
        true,
      ),
    );
  }, [index, reduced, scaleY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: width / 2,
          backgroundColor: color,
          transformOrigin: "bottom",
        },
        animatedStyle,
      ]}
    />
  );
}

function ThinkingMark({ size, reduced }: { size: number; reduced: boolean }) {
  const { palette } = useTheme();
  const scale = size / VIEWBOX;
  const colors = [palette.ink.DEFAULT, palette.ink.muted, palette.ink.disabled];
  // 64 - 56: keeps the columns' shared bottom edge aligned with the idle
  // mark's body bottom edge (also y=56), so the two states share a footprint.
  const bottomInset = (VIEWBOX - COLUMN_BOTTOM_Y) * scale;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: COLUMN_GAP * scale,
        paddingBottom: bottomInset,
      }}
    >
      {COLUMN_HEIGHTS.map((h, index) => (
        <ThinkingColumn
          color={colors[index]}
          height={h * scale}
          index={index}
          key={index}
          reduced={reduced}
          width={COLUMN_WIDTH * scale}
        />
      ))}
    </View>
  );
}

export function FennocMark({ size = 24, color, state = "idle" }: FennocMarkProps) {
  // Always called (hooks can't be conditional) — cheap, and only the
  // "thinking" branch below actually uses the result.
  const reduced = useReducedMotion();

  if (state === "thinking") {
    return <ThinkingMark reduced={reduced} size={size} />;
  }

  return <IdleMark color={color} size={size} />;
}
