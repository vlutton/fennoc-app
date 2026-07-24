/**
 * Minimal in-memory capture outbox stub.
 * INT-014f replaces this with a persisted store + drain().
 */

export interface OutboxCapture {
  text: string;
  idempotency_key: string;
  source_ref?: string;
}

const queue: OutboxCapture[] = [];

export function enqueueCapture(opts: {
  text: string;
  idempotency_key: string;
  source_ref?: string;
}): void {
  queue.push({
    text: opts.text,
    idempotency_key: opts.idempotency_key,
    source_ref: opts.source_ref,
  });
  console.warn(
    "[outbox] queued capture (in-memory stub)",
    opts.idempotency_key,
    opts.text.slice(0, 40),
  );
}

/** Test/debug helper — not used by UI. */
export function _peekOutbox(): readonly OutboxCapture[] {
  return queue;
}
