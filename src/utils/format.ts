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
