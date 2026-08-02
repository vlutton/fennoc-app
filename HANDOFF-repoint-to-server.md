# Handoff: repoint the Fennoc app at the hosted server

Paste everything below this line to the agent taking this on.

---

You are working in `/Users/vlutton/Code/fennoc-app` (Expo SDK 57, React Native,
TypeScript). Read `AGENTS.md` in the repo root first — it carries two hard-won
rules about Expo config and the gitignored `android/` directory.

## Context

`fennoc-core` moved off the operator's laptop onto a public VPS on 2026-08-02
(INT-058 increment 0). The API is live at **`https://api.fennoc.com`** behind
Caddy with a Let's Encrypt certificate, on port 443. It is verified working:
`401` without a bearer token, `200` with one, and the operator's existing token
is unchanged — increment 1's cutover adopted it into a tokens table rather than
reissuing it.

The app currently defaults to a Tailscale address that points at the Mac:

```ts
// src/store/useAuth.ts
const DEFAULT_BASE_URL = "https://vinces-macbook-air.tail46861b.ts.net:8643";
```

That address only resolves on the tailnet, so the app cannot work off it. No
server-side work is outstanding — this is a client change only.

## The task

### 1. Point the default at the server

In `src/store/useAuth.ts`, change `DEFAULT_BASE_URL` to
`https://api.fennoc.com`. Note there is **no port** — Caddy serves 443, unlike
the old `:8643`.

### 2. Migrate existing installs — this is the part that will catch you out

Changing the constant alone **will do nothing on the operator's phone.**
`baseUrl` is in `partialize`, so it is persisted to AsyncStorage, and `migrate`
only runs when the persist `version` changes. The store is currently at
`version: 1`, so a rehydrated install keeps the old Tailscale URL forever and
the app will look exactly as broken as before your change.

Bump the persist `version` to `2` and add a migration that repoints any install
still holding the old Tailscale host, while preserving a base URL the operator
has deliberately set to something else. The existing `version: 1` migration is
right there as a model — follow its shape, including its habit of returning a
fully-populated normalized object so a missing field cannot crash rehydration.

Write the migration so it is idempotent and so a *future* server move is a
one-line change rather than another archaeology exercise.

### 3. Delete the `X-Fennoc-User` header

`src/api/client.ts` sends `"X-Fennoc-User": userId || "vince"` on every request.
The server never reads it — `verify_auth` takes only the bearer credential, and
identity now comes from the token resolving to a tenant in a store (INT-058
increments 1–2). A client-set identity header implies a claim the client is not
allowed to make, so it should go rather than linger as a misleading no-op.

There is a comment near `src/api/client.ts:205` explaining the header. Update or
remove it so the file does not keep describing something that no longer exists.

Leave `userId` in the auth store if removing it turns into a wide refactor —
the header is the part that matters. Say so in your summary if you leave it.

### 4. Version bump and ship

Bump `version` in `app.json`. This is a **JS-only change**, so it can ship over
the air via EAS Update — no native module changed, so `runtimeVersion`'s
`appVersion` policy will let existing builds pick it up. Do not trigger a full
rebuild unless something you did touched native config.

## Verify before you call it done

- A fresh install (clear app data) lands on `https://api.fennoc.com`.
- An install that already has the old Tailscale URL persisted **migrates to the
  new one** — this is the check that actually matters, and the one a naive fix
  fails. Test it by seeding AsyncStorage with the old value, not by reasoning
  about it.
- The thread, task list, and ledger load against the live server.
- `npm run lint` is clean.

## Two things to know that are not bugs

1. **The first voice capture will be very slow.** `POST /api/transcribe` uses
   server-side Whisper (INT-040), and the model (`small.en`) downloads from
   Hugging Face on the first request after a container start. The client already
   uses a 30s timeout for transcribe and image upload rather than the 10s JSON
   default, but that first request can exceed even 30s. If you see one timeout
   on the very first transcription and success afterwards, that is this — not a
   regression you introduced. Mention it in your summary rather than raising the
   timeout to paper over it.

2. **Do not add a login screen or touch auth.** Sign-in with Google and Apple is
   designed in `fennoc-pm/intents/INT-059-sign-in.md` and is a separate piece of
   work with its own rulings. The token continues to live in `expo-secure-store`
   under `fennoc-api-key` exactly as it does today.

## Do not

- Do not edit `android/` — it is gitignored local output, EAS runs `prebuild`
  remotely, and hand edits there change nothing about a build. `AGENTS.md`
  documents two dead-microphone builds that were shipped learning this.
- Do not commit or deploy without the operator's say-so. Report what you
  changed and what you verified.
