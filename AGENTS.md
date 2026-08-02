# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# This is a BARE-WORKFLOW repo: android/ is checked in

EAS builds the committed `android/` project — **app.json config plugins do
NOT run at build time**. A plugin that edits the Android manifest, gradle,
or resources is silently inert (this shipped a build with a dead microphone
on 2026-08-01). Adding a native module or plugin means ALSO applying its
Android changes to `android/` by hand (or a reviewed `expo prebuild` pass)
— and saying so in the commit.
