import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { Images, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { captureShot } from "../capture/photoCapture";

interface CameraCaptureProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Ruling 12's (INT-035) non-gesture route to the library — "nothing is
   * reachable only through a hold... library is also reachable from the
   * capture sheet." This IS "the capture sheet" the ruling names: since the
   * dedicated 48px library key is gone (superseded by `CameraKey`'s hold),
   * this screen is the one other place, besides the hold itself, where
   * "choose from library" is an ordinary tap. Callers pass the same
   * `openPhotoLibrary` the hold commits into (see CaptureBar.tsx) — there
   * is exactly one "open the library" implementation regardless of door.
   */
  onChooseFromLibrary: () => void;
}

/** `CameraCapturedPicture.format` is only ever `'jpg' | 'png'` (see
 *  expo-camera's Camera.types.d.ts) — narrower than the full set the
 *  server accepts, but that's fine: this is the only mime that format can
 *  actually mean, never a guess. */
function mimeForFormat(format: "jpg" | "png"): string {
  return format === "png" ? "image/png" : "image/jpeg";
}

/**
 * Step 11's "no viewfinder chrome": full-bleed preview, a Cancel affordance,
 * a shutter, and — as of ruling 12 (INT-035) — one more: a small "choose
 * from library" affordance, the non-gesture route the ruling requires exist
 * SOMEWHERE now that the dedicated library key is gone (see this file's
 * `onChooseFromLibrary` prop doc). Nothing else — no flash toggle, no grid,
 * no flip-camera, no zoom slider. Those are all real camera-app features
 * this deliberately does not build, because every one of them is a second
 * decision standing between "point" and "sent," and the whole design bet
 * here is that there is exactly one decision: point, then shutter. The
 * library affordance is a deliberate exception to that rule, not a crack in
 * it — ruling 11 already rejected a library button INSIDE this screen as
 * the library's PRIMARY route (it charges an unwanted camera warm-up), but
 * as a rarely-used fallback for people who never found — or can't
 * perform — the hold, the cost of having already opened the camera is a
 * sunk one by the time this button is visible at all.
 *
 * Multi-shot bookkeeping lives entirely in two refs, reset once per
 * camera-open (the effect below, keyed on `visible`): `batchIdRef` is
 * minted fresh each time the camera opens, and `shotCountRef` tracks
 * whether the NEXT shutter press is the first in this session (starts a
 * new thread entry) or a follow-up (joins the existing one) — see
 * `captureShot`'s `isFirstInBatch` for what that decision controls. Both
 * reset on every open, not just the first mount, because this component
 * stays mounted (with `visible` toggling) rather than being torn down and
 * rebuilt by CaptureBar — see its own render of this component.
 *
 * INT-035 ruling 13 (2026-08-02) reverses ruling 2: an optional single-line
 * caption now lives on this sheet, above the shutter. It shares the same
 * reset-on-open lifetime as `batchIdRef`/`shotCountRef` above — one note
 * per camera session, covering every shot in that session's batch, cleared
 * the next time the camera opens — rather than its own independent state
 * machine. Ruling 1 (shutter is send) is untouched: the field never gates
 * or delays the shutter, which sends with whatever the field holds (often
 * nothing) the instant it's pressed.
 */
export function CameraCapture({ visible, onClose, onChooseFromLibrary }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [caption, setCaption] = useState("");
  const cameraRef = useRef<CameraView>(null);
  const batchIdRef = useRef<string>(Crypto.randomUUID());
  const shotCountRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    // Fresh batch every time the camera opens — see the component doc
    // above. Also re-request permission here rather than only on first
    // mount: a user who denied it once, left, and enabled it from iOS
    // Settings should not have to force-quit the app to get a working
    // camera key.
    batchIdRef.current = Crypto.randomUUID();
    shotCountRef.current = 0;
    setCaption("");
    setCameraReady(false);
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
    // `permission`/`requestPermission` intentionally excluded: this effect
    // is keyed on the camera OPENING, not on every permission object
    // identity change the hook produces (requestPermission itself causes
    // one), which would otherwise re-trigger the request in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onShutterPress = () => {
    if (!cameraReady || capturing) return;
    setCapturing(true);

    // Fires the instant the shutter is pressed — see photoCapture.ts's own
    // note on why this is not gated on the upload (or even the native
    // takePictureAsync call) resolving. "One haptic thump confirms" means
    // AT THE PRESS, not once bytes have left the device.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    const isFirstInBatch = shotCountRef.current === 0;
    shotCountRef.current += 1;

    cameraRef.current
      ?.takePictureAsync()
      .then((picture) => {
        // Fire-and-forget from THIS component's point of view: the shot is
        // already "sent" per the shutter-is-send rule the instant this
        // call is made, and captureShot's own success/failure handling
        // writes straight into the thread store, not back through a
        // return value this component would need to react to. Staying
        // open for another shot does not wait on it.
        void captureShot(
          { uri: picture.uri, mime: mimeForFormat(picture.format) },
          {
            batchId: batchIdRef.current,
            isFirstInBatch,
            // Ruling 13 (INT-035): optional and never a gate — an empty
            // field sends `undefined`, identical to today's payload, so
            // the quick shutter-is-send path is byte-for-byte unchanged.
            question: caption.trim() || undefined,
          },
        );
      })
      .catch((error: unknown) => {
        // The native capture itself failed (not the upload — this is
        // BEFORE any network call). Nothing was sent, so there is nothing
        // to show as held or errored in the thread; roll the shot counter
        // back so the NEXT press is still treated as "first" if this was
        // the first attempt in the session.
        if (isFirstInBatch) shotCountRef.current = 0;
        console.warn("[camera] takePictureAsync failed", error);
      })
      .finally(() => setCapturing(false));
  };

  // Closes this screen and opens the library, in that order — once the
  // person has chosen "not the camera," there is nothing left for this
  // screen to do; leaving it open behind the system picker would just be a
  // second surface to dismiss afterward.
  const onChooseFromLibraryPress = () => {
    onClose();
    onChooseFromLibrary();
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      {/* `react-native-safe-area-context`'s app-root `SafeAreaProvider`
          (App.tsx) does not reach in here — a `Modal` renders into its own
          native root, so a bare `SafeAreaView` below would resolve to a 0
          inset and let the Cancel button draw under the status bar/notch.
          Same trap, same fix, as ReplySheet.tsx's own note on this: nest a
          SEPARATE `SafeAreaProvider`, seeded with `initialWindowMetrics` so
          the very first frame isn't a 0-inset flash while the real
          measurement comes in. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View className="flex-1 bg-black">
          {permission?.granted ? (
            <CameraView
              facing="back"
              onCameraReady={() => setCameraReady(true)}
              ref={cameraRef}
              style={{ flex: 1 }}
            />
          ) : (
            // Permission not yet granted (or permanently denied). No
            // viewfinder to show, so this is the one screen in the camera
            // flow that DOES get a sentence of copy — otherwise the user is
            // staring at a black rectangle with no idea why.
            <View className="flex-1 items-center justify-center px-8">
              <Text className="text-center font-sans text-body text-white">
                {permission?.canAskAgain === false
                  ? "Camera access is off. Turn it on in Settings to use the camera key."
                  : "Fennoc needs your camera to read what you photograph."}
              </Text>
              {permission && permission.canAskAgain ? (
                <Pressable
                  accessibilityLabel="Allow camera"
                  accessibilityRole="button"
                  className="mt-4 h-touch items-center justify-center rounded-sm border border-white px-4"
                  onPress={() => void requestPermission()}
                >
                  <Text className="font-sans-medium text-label text-white">
                    Allow camera
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}

          <SafeAreaView className="absolute inset-0" pointerEvents="box-none">
            <View className="flex-row items-center justify-between px-4 pt-3">
              {/* Cancel — top-left. Closing here never undoes shots already
                  taken: those are already sent per shutter-is-send, and the
                  only undo is the 10s window on the sent message itself
                  (PhotoMessage). */}
              <Pressable
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                className="h-touch w-touch items-center justify-center rounded-full bg-black/40"
                onPress={onClose}
              >
                <X color="#FFFFFF" size={22} />
              </Pressable>

              {/* "Choose from library" — top-right. Ruling 12's (INT-035)
                  non-gesture route; see this file's module doc and
                  `onChooseFromLibrary`'s own doc for why this exists and
                  why it's deliberately NOT the primary way in. */}
              <Pressable
                accessibilityHint="Opens your photo library instead of the camera"
                accessibilityLabel="Choose from library"
                accessibilityRole="button"
                className="h-touch w-touch items-center justify-center rounded-full bg-black/40"
                onPress={onChooseFromLibraryPress}
              >
                <Images color="#FFFFFF" size={20} />
              </Pressable>
            </View>

            <View className="flex-1" />

            {/* Ruling 13 (INT-035): an optional caption, above the shutter.
                Wrapped in its own `KeyboardAvoidingView` (same "padding" /
                `keyboardVerticalOffset={0}` combination ThreadScreen uses
                around the composer, for the identical reason — Android's
                edge-to-edge default silently defeats the manifest's
                `adjustResize` and the field would otherwise draw under the
                keyboard) so a focused field lifts clear of the keyboard.
                The shutter riding up with it is fine — it's still reachable
                — but nothing here forces that; the field is free to sit
                right above the keyboard even if that means the shutter
                itself ends up covered while typing, since typing is not
                shooting. */}
            <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
              <View className="mb-4 px-8">
                <TextInput
                  accessibilityLabel="Caption"
                  autoCapitalize="sentences"
                  autoCorrect
                  // Deliberately NOT `autoFocus`: the viewfinder is the
                  // first thing this sheet shows, and shooting without ever
                  // touching this field has to stay the frictionless
                  // default (ruling 1, still untouched by ruling 13).
                  className="h-touch rounded-full bg-black/40 px-4 font-sans text-body text-white"
                  onChangeText={setCaption}
                  placeholder="Add a note…"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  returnKeyType="done"
                  value={caption}
                />
              </View>

              <View className="mb-8 items-center">
                <Pressable
                  accessibilityLabel="Shutter"
                  accessibilityRole="button"
                  className="h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white active:opacity-70"
                  disabled={!cameraReady}
                  onPress={onShutterPress}
                >
                  <View
                    className="h-[60px] w-[60px] rounded-full bg-white"
                    style={{ opacity: cameraReady ? 1 : 0.4 }}
                  />
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
