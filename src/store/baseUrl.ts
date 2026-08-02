/**
 * Where the app talks to — and how an install that predates a server move
 * catches up.
 *
 * This is deliberately a separate module from `useAuth.ts` and imports
 * nothing: no AsyncStorage, no SecureStore, no zustand. That is what lets the
 * migration below be exercised against seeded input directly, rather than
 * reasoned about. A migration that has only ever been read is exactly the
 * kind that turns out to be a no-op on the one install that matters.
 */

/**
 * The live server. `fennoc-core` moved off the operator's laptop onto a
 * public VPS on 2026-08-02 (INT-058 increment 0); Caddy terminates TLS on
 * 443, so unlike the Tailscale address this carries **no port**.
 */
export const DEFAULT_BASE_URL = "https://api.fennoc.com";

/**
 * Every base URL this app has previously shipped as its default.
 *
 * An install still holding one of these is holding it because it was the
 * default at the time, not because anyone chose it — so a migration may
 * safely repoint it. Anything NOT in this list is treated as a deliberate
 * choice (a LAN address, a staging box, a port-forward while debugging) and
 * is left exactly as the operator set it.
 *
 * **Moving the server again is two lines:** add the outgoing
 * `DEFAULT_BASE_URL` to the top of this list, point `DEFAULT_BASE_URL` at
 * the new host, and bump the persist `version` in `useAuth.ts`. No
 * archaeology, and no per-move bespoke migration function.
 */
export const SUPERSEDED_BASE_URLS: readonly string[] = [
  // The operator's MacBook over Tailscale. Resolves only on the tailnet, so
  // an install still pointed here cannot reach Fennoc from a cellular
  // network at all — it fails to connect rather than failing over.
  "https://vinces-macbook-air.tail46861b.ts.net:8643",
];

/** Trailing slashes and case are not meaningful in a host; comparison ignores both. */
function canonical(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

const SUPERSEDED_CANONICAL = new Set(SUPERSEDED_BASE_URLS.map(canonical));

/**
 * Resolve the base URL a rehydrating install should end up with.
 *
 * - A missing, non-string, or empty value becomes the current default.
 * - A value that was a previous default is repointed to the current one.
 * - Anything else is returned untouched, preserving the operator's own
 *   string exactly (including a trailing slash, which `normalizeBaseUrl` in
 *   `api/client.ts` strips at request time anyway).
 *
 * Idempotent: the output is never itself a superseded URL, so running this
 * twice — or on an install that already migrated — changes nothing.
 */
export function migrateBaseUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BASE_URL;
  const key = canonical(value);
  if (key === "") return DEFAULT_BASE_URL;
  return SUPERSEDED_CANONICAL.has(key) ? DEFAULT_BASE_URL : value;
}
