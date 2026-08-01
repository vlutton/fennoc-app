/**
 * Camera/gallery → upload orchestration for the photo-capture hot path
 * (Step 11 of the design handoff — "a photo is a sentence you didn't have
 * to say"). Two callers share this: CameraCapture.tsx (the hot path — one
 * tap on the composer's camera key, no chrome, shutter-is-send) and
 * CaptureBar's long-press library flow (the cold path — a picker, and the
 * one place a caption survives, per Step 15).
 *
 * Deliberately framework-free: no React import, no `expo-camera` import.
 * Everything that talks to native APIs here (`expo-file-system`, the
 * outbox, the API client) is a plain async function call, and the shot/
 * batch bookkeeping is pure zustand-store mutation (src/store/useThread.ts).
 * That split is what makes "multi-shot batching, undo window, held-queue
 * behaviour" checkable without a camera or a device: `captureShot` below
 * can be called directly with a fake `{ uri, mime }` and a mocked
 * `uploadImage`/network condition, and everything downstream of it —
 * which batch a shot joins, what state it ends up in, what the thread
 * shows — is ordinary store state, inspectable with `useThreadStore.
 * getState()`. See useThread.ts's `isPhotoUndoAvailable` for the same idea
 * applied to the 10s undo window.
 */
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { uploadImage } from "../api/client";
import { enqueueImageUpload, isNetworkError } from "../outbox";
import { recordPhotoCaptured } from "../store/useDiscoverability";
import {
  deliverPhotoShotError,
  deliverPhotoShotResult,
  type PhotoShot,
  useThreadStore,
} from "../store/useThread";

/** What either capture source (expo-camera's `takePictureAsync`, or
 *  expo-image-picker's `launchImageLibraryAsync` asset) hands back — the
 *  two shapes are different enough elsewhere that normalising to this at
 *  the call site keeps this module from importing either package. */
export interface CapturedPhoto {
  uri: string;
  mime: string;
}

/**
 * fennoc-core's `ALLOWED_MIME_TYPES` (fennoc/vision/storage.py) is
 * `{png, jpeg, webp, gif, heic}` — this mapping exists purely to name the
 * file we upload; the server trusts the `Content-Type` we send in the
 * multipart part (see uploadImage), not this extension. Pure function, no
 * native call — the cheapest thing in this file to unit test directly.
 */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

const HELD_PHOTOS_DIR_NAME = "held-photos";

function heldPhotosDirectory(): Directory {
  return new Directory(Paths.document, HELD_PHOTOS_DIR_NAME);
}

/**
 * Copy a shot out of wherever it was captured into durable, app-owned
 * storage before it goes into the outbox.
 *
 * Why this exists at all: expo-camera's own `takePictureAsync` doc is
 * explicit that its `uri` is temporary — "the local image URI is
 * temporary. Use FileSystem.copy to make a permanent copy" — because it
 * writes into a CACHE directory the OS is free to reclaim under storage
 * pressure. That's a fine tradeoff for a shot that uploads in the next
 * second (the common case, handled entirely by `captureShot` below without
 * ever calling this function). It is not a fine tradeoff for a shot that
 * is about to sit in the outbox until the device is "back" — which the
 * design explicitly treats as something that can take a while ("Kept on
 * device · goes when you're back" is a real, unhurried state, not a
 * spinner) — so held shots get moved somewhere the OS won't quietly delete
 * out from under them: `Paths.document`, which survives app restarts and
 * is only ever cleared by an explicit uninstall.
 */
async function persistForHold(sourceUri: string, filename: string): Promise<string> {
  const dir = heldPhotosDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const destination = new File(dir, filename);
  await new File(sourceUri).copy(destination);
  return destination.uri;
}

export interface CaptureShotOptions {
  /** Which thread entry this shot belongs to — see PhotoBatch's own note on
   *  who mints this and when. */
  batchId: string;
  /** True for the FIRST shutter press in a camera-open session (or for any
   *  standalone gallery pick, which never batches with anything). Decides
   *  whether this shot starts a new thread entry or joins an existing one. */
  isFirstInBatch: boolean;
  /** Set only by the gallery/library flow (CaptureBar's long-press path) —
   *  the camera hot path never passes this. See Step 15: "No caption
   *  field... The next thing you say is the caption" for the camera path;
   *  a gallery pick is the one exception, because "choosing an old photo
   *  means the moment is gone." */
  question?: string;
}

/**
 * One shutter press (or one gallery pick). Records the shot into the
 * thread immediately in an "uploading" state — the message exists the
 * instant the shutter fires, per "shutter sends," well before the network
 * request resolves either way — then updates it in place once the upload
 * settles.
 *
 * Three outcomes:
 *   1. Success → `deliverPhotoShotResult` (state "done").
 *   2. A real server rejection (bad mime, oversized, vision model down) →
 *      `deliverPhotoShotError` (state "error"), no retry — Step 11's
 *      "Failure is one sentence with no retry" rule: retrying the same
 *      bytes gets the same answer.
 *   3. No network → the shot is copied to durable storage, queued on the
 *      shared outbox (state "held"), and left for `useOutboxBootstrap`'s
 *      reconnect-triggered drain to pick up later — possibly much later,
 *      possibly after this app process is gone (see `deliverPhotoShotResult`
 *      in useThread.ts for what happens to the thread entry in that case).
 *
 * Callers do not need to distinguish (2) from (3) themselves — that's the
 * one thing `isNetworkError` (src/outbox) already knows how to tell apart,
 * the same helper CaptureBar's text-send path uses for the identical
 * decision.
 */
export async function captureShot(photo: CapturedPhoto, opts: CaptureShotOptions): Promise<void> {
  const localId = Crypto.randomUUID();
  const filename = `${localId}.${extensionForMime(photo.mime)}`;

  const shot: PhotoShot = {
    localId,
    state: "uploading",
    localUri: photo.uri,
    imageId: null,
    extractedText: null,
    errorText: null,
  };

  const store = useThreadStore.getState();
  if (opts.isFirstInBatch) {
    store.addPhotoBatch(opts.batchId, shot);
  } else {
    store.appendPhotoShot(opts.batchId, shot);
  }

  // INT-035 ruling 12, layer 3: bump the lifetime photo counter (and,
  // once, say the one-line library tip) right here — the one place both
  // the camera hot path and the gallery/library path funnel every shot
  // through. Fires now, not once the upload below resolves: same "shutter
  // is send" reasoning as the haptic comment just below — the person has
  // already taken the photo, whatever happens to the bytes next.
  recordPhotoCaptured();

  // The haptic thump ("one haptic thump confirms") fires at the moment of
  // the shutter press, in the CALLER (CameraCapture) — not here, and not
  // gated on this promise resolving. By the time an upload finishes the
  // user's thumb has usually already moved on to the next shot or closed
  // the camera; the confirmation has to be immediate to mean "sent."

  try {
    const result = await uploadImage(photo.uri, photo.mime, filename, opts.question);
    deliverPhotoShotResult(opts.batchId, localId, {
      imageId: result.id,
      extractedText: result.extracted_text,
    });
    return;
  } catch (error) {
    if (!isNetworkError(error)) {
      deliverPhotoShotError(
        opts.batchId,
        localId,
        "Can't read this one. It's on the thread if you want to tell me what it was.",
      );
      return;
    }
  }

  // Offline path, kept out of the try/catch above so a failure IN HERE
  // (persistForHold, disk full, permissions) is never mistaken for the
  // network error that got us here — it needs its own message.
  try {
    const durableUri = await persistForHold(photo.uri, filename);
    useThreadStore.getState().updatePhotoShot(opts.batchId, localId, {
      state: "held",
      localUri: durableUri,
    });
    enqueueImageUpload({
      uri: durableUri,
      mime: photo.mime,
      filename,
      batchId: opts.batchId,
      localShotId: localId,
      question: opts.question,
    });
  } catch (persistError) {
    console.warn("[capture] couldn't persist photo for hold", persistError);
    deliverPhotoShotError(
      opts.batchId,
      localId,
      "Couldn't hold onto that one to send later. It's on the thread if you want to tell me what it was.",
    );
  }
}
