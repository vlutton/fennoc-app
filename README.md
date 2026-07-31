# fennoc-app

Expo client for Fennoc. Thin — effectively all state lives server-side in
`fennoc-core`; this app renders it and sends input back.

## Setup

```bash
npm install
npm start
```

The app talks to a `fennoc-core` instance. Point it at one in Settings
(base URL + API key). The default deployment is tailnet-only, so the device
must be on the tailnet for anything to load — an off-tailnet phone gets
connection failures on every request, not an auth error.

### `google-services.json` is required and is NOT in this repo

An Android build needs `google-services.json` in the project root. It is
deliberately gitignored: this repository is public, and while Google
documents that file as non-secret — its API key is restricted to the package
name plus signing certificate, and it ships inside every APK anyway — that is
a reason it *can* be published, not a reason it should be.

Get it from the Firebase console → project `fennoc` → Project settings →
your Android app (`com.fennoc.app`) → Download `google-services.json`, and
drop it in the project root.

Without it the build still succeeds, which is the trap. It fails later and
somewhere else: the app cannot register with FCM, so
`getExpoPushTokenAsync()` throws on device and push registration fails with a
native error that says nothing about a missing config file.

EAS Build gets the file via `.easignore`, which EAS uses in preference to
`.gitignore`. **`.easignore` therefore shadows `.gitignore` completely** — a
new `.gitignore` entry that is not also added to `.easignore` will be
uploaded to EAS builds regardless. Keep them in sync.

### Push notifications

Two credentials, two different moments, easy to conflate:

| File | Where it goes | When it matters |
|---|---|---|
| `google-services.json` | project root (above) | build time — lets the app obtain a push token |
| Firebase service-account key | `eas credentials` → Android → Google Service Account → **FCM V1** | send time — lets Expo hand messages to FCM |

The service-account key never goes in this repo. Note that a bad or missing
one is invisible until a push is sent to a *real* token: Expo rejects
malformed tokens at its own layer, before it ever needs the credential, so
early testing can look like it is working when it is not.

Pushes are data-only by design — they carry no title or body, only
`{channel, id}`. The device fetches the real content from the Fennoc API and
posts the notification locally, so no user content passes through Expo, FCM,
or APNs. See `src/notifications/doorbell.ts`.

## Over-the-air updates

JS-only changes ship without a rebuild:

```bash
npx eas-cli update --branch preview
```

Anything touching native code or dependencies needs a full build. Adding a
native module to work around a JS limitation forfeits the OTA path, which is
usually the more expensive trade.

## Codegen

`src/api/schema.gen.ts` is generated from the running server's OpenAPI, not
hand-written:

```bash
npm run gen:api-schema   # curl the live server's /openapi.json
npm run gen:api-types    # regenerate TypeScript from it
```

Both require `fennoc-core` running locally on the port in `package.json`.
Regenerate after any server contract change, or the client's types will
quietly describe a server that no longer exists.
