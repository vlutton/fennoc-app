import { View } from "react-native";

/**
 * Ruling 12 (INT-035), layer 1 — "the standing mark." A 5px dot, bottom-
 * right of the element it sits on, always visible, dim amber against the
 * key/surface it decorates — NEVER `signal`'s full strength. Its one job is
 * consistency: every element that hides a second context behind a hold
 * wears exactly this mark, and nothing else ever does, so learning it once
 * teaches the whole app. Ruling 12 names six eventual places it belongs
 * (the camera key, the Fennoc mark, the pinned timer, a case photo, a
 * ledger row twice) and is explicit that if that list ever grows past what
 * a person can hold in mind, the mark has stopped being a promise and
 * become decoration.
 *
 * A SHARED component on purpose, even though only one call site (the
 * camera key — see `CameraKey.tsx`) exists yet: the mark's whole value is
 * looking and behaving identically everywhere, so a future site should
 * import this rather than hand-roll another 5px dot with a slightly
 * different amber. Do not inline this into whatever renders it.
 *
 * Deliberately dumb — no press state, no animation, no size/position
 * props. Ruling 12 fixes the geometry ("5px, bottom-right, always"); a
 * component with knobs to move or resize it stops being the one promise
 * it's supposed to be. `signal/60` (not full-strength `signal`, not
 * `signal.wash`, which is a near-invisible background wash, not a dot
 * colour) is the dim reading ruling 12 asks for. The parent MUST itself be
 * positioned (`relative`) for the `absolute` placement below to anchor to
 * IT rather than some further-out ancestor.
 *
 * Hidden from assistive tech entirely — it is not a control, carries no
 * label, and must never be announced as a second focusable element sitting
 * on top of the thing it decorates. The host element's own
 * `accessibilityHint` is what actually tells a screen reader about the
 * second context.
 */
export function SecondaryContextDot() {
  return (
    <View
      accessibilityElementsHidden
      className="absolute bottom-[2px] right-[2px] h-[5px] w-[5px] rounded-full bg-signal/60"
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    />
  );
}
