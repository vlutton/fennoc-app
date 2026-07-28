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
