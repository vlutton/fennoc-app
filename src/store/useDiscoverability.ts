import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useThreadStore } from "./useThread";

/**
 * State for INT-035 ruling 12's discoverability layers 2 and 3 — the parts
 * that have to survive an app restart, unlike `useThreadStore` (session-
 * local, bounded to today; see its own header on why that's deliberate).
 *
 * Two independent facts live here:
 *
 *   - `photoCount`: how many photos this install has ever captured (camera
 *     shutter presses AND gallery sends both count — see
 *     `src/capture/photoCapture.ts`'s `captureShot`, the one place both
 *     paths funnel through). Layer 3's message needs "the third photo,
 *     ever," not "the third photo today," so it cannot reuse
 *     `useThreadStore`'s today-bounded captures.
 *   - `hasHeldMarkedElement`: whether ANY element wearing
 *     `SecondaryContextDot` has ever been held to commit (ruling 12 layer
 *     2). Deliberately APP-GLOBAL, not per-element — the ruling is explicit
 *     that holding a completely different marked element later still
 *     retires layer 3's message ("the gesture is one idea, learned once"),
 *     so this can't be scoped to "has the camera key specifically been
 *     held." Today only the camera key exists to set it; the other five
 *     places ruling 12 names (Fennoc mark, pinned timer, a case photo, a
 *     ledger row twice) are out of scope for this change but will set the
 *     SAME flag when they're built, not one each.
 *
 * `libraryTipShown` is a third, separate bit: layer 3's message can be
 * PRE-EMPTED by a hold before it ever would have fired (photoCount never
 * reaches 3, or does but `hasHeldMarkedElement` is already true by then) —
 * in that case this stays false forever, which is correct, not a bug: the
 * message's whole job was teaching a gesture the person already found on
 * their own.
 *
 * Persisted like `useAuth.ts` (AsyncStorage via zustand's `persist`), not
 * left in-memory like `useMotionPrefs.ts` — unlike a session toggle, both
 * facts here are specifically about surviving restarts (a person doesn't
 * take three photos in one uninterrupted session, and "has ever held"
 * literally means ever). No `hydrated` flag like `useAuth.ts` carries: the
 * only consequence of reading this store before AsyncStorage finishes
 * hydrating is a photo taken in the first instant of a cold start not
 * counting toward the threshold, which self-corrects on the very next
 * photo — not worth the extra state for what it protects against.
 */
interface DiscoverabilityState {
  photoCount: number;
  hasHeldMarkedElement: boolean;
  libraryTipShown: boolean;
  recordMarkedHold: () => void;
}

export const useDiscoverability = create<DiscoverabilityState>()(
  persist(
    (set) => ({
      photoCount: 0,
      hasHeldMarkedElement: false,
      libraryTipShown: false,
      recordMarkedHold: () => set({ hasHeldMarkedElement: true }),
    }),
    {
      name: "fennoc-discoverability",
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => ({
        photoCount: state.photoCount,
        hasHeldMarkedElement: state.hasHeldMarkedElement,
        libraryTipShown: state.libraryTipShown,
      }),
    },
  ),
);

/** Photo count layer 3 waits for — "fires only after the third photo"
 *  (ruling 12). Exported so the threshold has exactly one home rather than
 *  a magic `3` duplicated at every call site that ever needs to reason
 *  about it. */
export const LIBRARY_TIP_PHOTO_THRESHOLD = 3;

/** Verbatim text from ruling 12 layer 3 — an ordinary Fennoc line, not a
 *  composed/templated string, so there is exactly one place this copy is
 *  authored and no risk of a paraphrase drifting from the ruling. */
export const LIBRARY_TIP_TEXT =
  "If you ever need a photo you already took, hold the camera key instead of tapping it.";

/**
 * Bump the lifetime photo counter and, if this capture is the one that
 * crosses the threshold, say layer 3's line — ONCE, ever, and only if the
 * hold gesture hasn't already taught itself.
 *
 * Called from `captureShot` (`src/capture/photoCapture.ts`), the single
 * choke point both the camera hot path and the gallery/library path
 * already funnel every shot through, so this needs exactly one call site
 * to cover both origins. Fires at the moment the shot is taken/sent, not
 * once the upload resolves — consistent with "shutter is send": the
 * person's own count of photos they've taken doesn't wait on a network
 * round trip, and an offline-held or even a failed shot is still a photo
 * they took.
 *
 * `>=` rather than `===` on the threshold check on purpose: a person
 * who's already past three photos by the time this ships (or who somehow
 * skips a beat some other way) still gets the message on their very next
 * photo, rather than having permanently missed the one moment `=== 3`
 * would have caught. `libraryTipShown` still keeps it to exactly once.
 */
export function recordPhotoCaptured(): void {
  const before = useDiscoverability.getState();
  const photoCount = before.photoCount + 1;
  useDiscoverability.setState({ photoCount });

  if (
    photoCount >= LIBRARY_TIP_PHOTO_THRESHOLD &&
    !before.hasHeldMarkedElement &&
    !before.libraryTipShown
  ) {
    useThreadStore.getState().addFennocLine(LIBRARY_TIP_TEXT);
    useDiscoverability.setState({ libraryTipShown: true });
  }
}
