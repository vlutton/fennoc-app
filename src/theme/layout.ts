/**
 * Layout tokens — the reading column (INT-060).
 *
 * The design system (INT-022) was drawn for a phone, and until iOS there was
 * no screen wide enough for that to matter. `supportsTablet: true` means the
 * daughter's iPad renders the same tree at 834pt portrait / 1194pt landscape,
 * where every screen is `flex-1` full-bleed with fixed `px-4` padding and
 * nothing anywhere constrains width.
 *
 * At `text-body` (16px), that yields roughly 100 characters per line in
 * portrait and 145 in landscape. Comfortable prose runs 45–75. The thread is
 * the app's primary surface and the most prose-heavy thing in it, so the
 * stretched-phone failure lands squarely on the part that matters most.
 *
 * INT-060 gave two acceptable answers — earn the width, or record the
 * compromise. This is the first, taken at its cheapest honest form: a
 * centered column with a ceiling, rather than a tablet redesign. Screens keep
 * their internals; they simply stop being asked to fill a width they were
 * never drawn for.
 */

/**
 * Maximum width of the app's content column, in points.
 *
 * 700 is chosen against the type scale rather than against any device: at
 * 16px body text less the 16pt `px-4` gutters, it lands near 80 characters —
 * the top of the comfortable range, so the column reads as generous on an
 * iPad without going slack.
 *
 * Below this width the constraint is inert. Every iPhone is narrower than
 * 700pt, so `width: "100%"` wins and phone layout is bit-for-bit unchanged —
 * this token can only ever take effect on a tablet.
 */
export const READING_COLUMN_MAX_WIDTH = 700;
