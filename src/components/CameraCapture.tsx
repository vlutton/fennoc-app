import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { captureShot } from "../capture/photoCapture";

interface CameraCaptureProps {
  visible: boolean;
  onClose: () => void;
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
 * a shutter. Nothing else — no flash toggle, no grid, no flip-camera, no
 * zoom slider. Those are all real camera-app features this deliberately
 * does not build, because every one of them is a second decision standing
 * between "point" and "sent," and the whole design bet here is that there
 * is exactly one decision: point, then shutter.
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
 */
export function CameraCapture({ visible, onClose }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
          { batchId: batchIdRef.current, isFirstInBatch },
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
            {/* Cancel — top-left, the only chrome besides the shutter (Step
                11: "Camera · no viewfinder chrome / Cancel / [shutter]").
                Closing here never undoes shots already taken: those are
                already sent per shutter-is-send, and the only undo is the
                10s window on the sent message itself (PhotoMessage). */}
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              className="ml-4 mt-3 h-touch w-touch items-center justify-center rounded-full bg-black/40"
              onPress={onClose}
            >
              <X color="#FFFFFF" size={22} />
            </Pressable>

            <View className="flex-1" />

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
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
