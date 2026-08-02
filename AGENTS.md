# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# android/ is a LOCAL, GITIGNORED artifact — EAS runs prebuild

The checked-out `android/` directory is stale local output and is NOT
uploaded to EAS (gitignored). Builds run `expo prebuild` remotely: config
plugins DO apply. Two lessons paid for on 2026-08-01 (a build shipped with
a dead microphone, twice):
- Editing `android/` by hand changes nothing about an EAS build. Change
  app.json / plugin config instead, and verify with a local
  `expo prebuild` into a scratch dir.
- A permission mysteriously missing from the built APK means some plugin
  BLOCKED it: any `<permission>Permission: false` plugin option may call
  `withBlockedPermissions`, which writes `tools:node="remove"` and vetoes
  every other package's request for it (expo-image-picker's
  `microphonePermission: false` did exactly this to RECORD_AUDIO).
