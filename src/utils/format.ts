const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDueDate(dateStr: string): Date | null {
  // Accept YYYY-MM-DD or full ISO; treat bare dates as local calendar days.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (bare) {
    const year = Number(bare[1]);
    const month = Number(bare[2]) - 1;
    const day = Number(bare[3]);
    const parsed = new Date(year, month, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Relative due label. null / invalid → "". */
export function formatRelativeDue(dateStr: string | null): string {
  if (!dateStr) return "";
  const due = parseDueDate(dateStr);
  if (!due) return "";

  const today = startOfLocalDay(new Date());
  const target = startOfLocalDay(due);
  const deltaDays = Math.round((target.getTime() - today.getTime()) / DAY_MS);

  if (deltaDays === 0) return "today";
  if (deltaDays === 1) return "tomorrow";
  if (deltaDays === -1) return "yesterday";
  if (deltaDays > 1) return `in ${deltaDays} days`;
  return `${Math.abs(deltaDays)} days ago`;
}

/** Human duration from seconds → "2h 10m" / "45m" / "0s". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return "0s";

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}

/** Elapsed clock from ms → "HH:MM:SS" zero-padded. */
export function formatClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** "HH:MM" 24h local time from an ISO timestamp. "" if missing/invalid. */
export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Today's YYYY-MM-DD in America/Chicago. */
export function chicagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * YYYY-MM-DD in America/Chicago for an arbitrary ISO instant — same
 * projection `chicagoToday()` uses for "now", parametrized. This is how a
 * turn's `created_at` or a provenance source's `ts` gets matched against
 * `GET /api/thread`'s day keys (INT-057), which are themselves computed
 * server-side in operator-local (America/Chicago) terms.
 */
export function chicagoDateKey(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

/**
 * Parses a bare `YYYY-MM-DD` day key into a LOCAL midnight `Date`, same
 * "treat bare dates as local calendar days" convention `parseDueDate`
 * above already uses. Deliberately NOT run through a `timeZone` formatting
 * option afterward: the three digits already ARE the calendar date (the
 * server computed them in America/Chicago; this function's only job is to
 * recover which weekday/day-of-month/month those three numbers name), and
 * reprojecting through `Intl.DateTimeFormat`'s `timeZone: "America/
 * Chicago"` on a `new Date("YYYY-MM-DD")` (parsed as UTC midnight) would
 * shift it BACKWARD a calendar day for any timezone behind UTC — a real
 * bug this function exists to avoid, not a hypothetical one.
 */
function parseDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `"WED 29"` — weekday abbreviation + day-of-month, mono/terminus style
 *  (step 18a). Used for a collapsed day's tappable summary line and a
 *  live-but-past day's header. Falls back to the raw key on a malformed
 *  input rather than throwing — a rendering nicety is not worth crashing
 *  the thread over. */
export function formatDayLabel(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return `${weekday} ${parsed.getDate()}`;
}

/** `"SAT 1 AUG"` — weekday + day-of-month + month abbreviation, for the
 *  date rule marking today's boundary (step 18a's worked example). */
export function formatDayLabelWithMonth(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const month = parsed.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${weekday} ${parsed.getDate()} ${month}`;
}

/** Whether `dateKey` is the calendar day immediately before `todayKey` —
 *  both bare `YYYY-MM-DD`, same convention as the rest of this section.
 *  Used to render "YESTERDAY" instead of a bare day label for exactly the
 *  one live-but-past day it names. */
export function isYesterday(dateKey: string, todayKey: string): boolean {
  const target = parseDateKey(dateKey);
  const today = parseDateKey(todayKey);
  if (!target || !today) return false;
  return Math.round((today.getTime() - target.getTime()) / DAY_MS) === 1;
}

/**
 * `"15:00 today"` / `"tomorrow 09:00"` / `"09:00 · WED 5"` — a reminder's
 * `condition_value` (INT-057 commit 3), an ISO 8601 America/Chicago local
 * datetime the server writes for its only condition type today (`'time'`
 * — see `fennoc.store.accessors`' `set_down_items` migration comment).
 * Deliberately asymmetric ("time today" vs. "tomorrow time") rather than
 * one fixed order for both — that is how the two are actually said out
 * loud, and the design's own worked examples use exactly this pairing.
 * Anything past tomorrow falls back to a bare day label, time-first, same
 * as "today"'s ordering.
 */
export function formatReminderWhen(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);

  const dateKey = chicagoDateKey(iso);
  const today = chicagoToday();
  if (dateKey === today) return `${time} today`;
  if (dateKey === addDaysToDateKey(today, 1)) return `tomorrow ${time}`;
  return `${time} · ${formatDayLabel(dateKey)}`;
}

/** `dateKey` shifted by `delta` calendar days, still a bare `YYYY-MM-DD` —
 *  local helper for `formatReminderWhen`'s "is this tomorrow" check. */
function addDaysToDateKey(dateKey: string, delta: number): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const shifted = new Date(parsed.getTime() + delta * DAY_MS);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const d = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
