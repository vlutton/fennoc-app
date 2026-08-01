// Response-shape types below are ALIASES of the generated OpenAPI types in
// `./schema.gen.ts` — they are not restated by hand. `schema.gen.ts` is
// generated from fennoc-core's `api/server.py` Pydantic response models via
// `npm run gen:api-schema && npm run gen:api-types` (see package.json). If a
// response shape here looks wrong, the fix belongs in the Pydantic model on
// the server, followed by regenerating — not by hand-editing this file.
//
// The export names are kept stable (Status, Task, Briefing, ...) so call
// sites don't churn even though the underlying type now comes from
// `components["schemas"][...]`.
import type { components } from "./schema.gen";

export type Status = components["schemas"]["StatusResponse"];

export type Task = components["schemas"]["TaskResponse"];

export type Briefing = components["schemas"]["BriefingResponse"];

/** metadata is a JSON STRING on the wire — NOT an object (see TimeBlockResponse in api/server.py). */
export type TimeBlock = components["schemas"]["TimeBlockResponse"];

export type OpenTimer = components["schemas"]["OpenTimerResponse"];

export type PendingCheckin = components["schemas"]["PendingCheckinResponse"];

export type CheckinReply = components["schemas"]["CheckinReplyResponse"];

/** Check-in cursor from GET /api/time/current — distinct from OpenTimer (/api/time/open). */
export type CheckinCurrent = components["schemas"]["CurrentActivityResponse"];

export type CaptureResult = components["schemas"]["CaptureResponse"];

export type CheckinCoverage = components["schemas"]["CheckinCoverageResponse"];

export type Budget = components["schemas"]["BudgetResponse"];

/** POST /api/message — 202 Accepted; the row has just been created (INT-029b). */
export type AgentMessageCreated = components["schemas"]["AgentMessageCreatedResponse"];

/**
 * One row of a turn's receipt (INT-050) — "what this turn read, wrote, or
 * declined," rendered in the order they happened.
 *
 * `AgentMessageResponse.actions` DID land in the generated schema (this
 * type used to be added via an intersection because it hadn't yet — see
 * git history for that version of this comment) but FastAPI/Pydantic only
 * declares the server field as `list[dict[str, Any]] | null`: a plain
 * dict, not a sub-model, so `schema.gen.ts` types each item as
 * `{[key: string]: unknown}`. The literal `kind` union below is still this
 * app's own knowledge of the closed set of values `fennoc-core` actually
 * writes (mirrors `fennoc/agent/loop.py`'s `_derive_actions`), same
 * reasoning as `TaskStatus` further down this file. `AgentMessage` narrows
 * the generated field to this stricter shape via `Omit`, not intersection,
 * since the field itself no longer needs adding — only refining.
 */
export interface AgentAction {
  text: string;
  kind: "write" | "read" | "decline";
}

/**
 * One provenance entry (INT-057 commit 2, step 18b) — "answer first,
 * source underneath." Same "generic dict on the wire, literal shape known
 * client-side" situation as `AgentAction` above; mirrors
 * `fennoc/agent/loop.py`'s `_derive_sources` exactly. `turn_id` and
 * `image_id` are mutually exclusive in practice (a thread-search hit cites
 * a turn; an image-recall hit cites an image, which has no turn back-
 * reference to give — see that function's own docstring) but both are
 * typed nullable rather than as a discriminated union, matching the
 * server's own untagged shape rather than inventing a tag it doesn't send.
 */
export interface AgentSource {
  turn_id: string | null;
  image_id: string | null;
  /** ISO 8601 — the cited turn/image's own `created_at`, used to find which
   *  rendered day a tapped source belongs to. */
  ts: string;
  /** Pre-formatted by the server (`_format_source_label`) — e.g.
   *  `"MON 27 · 11:52"` or `"MON 27 · 11:52 · FROM THE PHOTO"`. Render
   *  verbatim; do not reformat client-side. */
  label: string;
}

/** GET /api/message/{id} and /api/messages — full `agent_messages` row (INT-029b). */
export type AgentMessage = Omit<
  components["schemas"]["AgentMessageResponse"],
  "actions" | "sources"
> & {
  /** See `AgentAction`'s own doc comment. */
  actions: AgentAction[] | null;
  /** See `AgentSource`'s own doc comment (INT-057 commit 2). */
  sources: AgentSource[] | null;
};

/** One entry in `GET /api/thread`'s `days` array (INT-057 commit 2). */
export type ThreadDay = Omit<components["schemas"]["ThreadDayResponse"], "turns"> & {
  turns: AgentMessage[];
};

/** The overnight-timer resolution card (INT-057 commit 2, step 18a). */
export type OpenTimerCard = components["schemas"]["OpenTimerCardResponse"];

/** GET /api/thread — the durable thread the app renders (INT-057 commit 2). */
export type Thread = Omit<components["schemas"]["ThreadResponse"], "days"> & {
  days: ThreadDay[];
};

/** POST /api/time/resolve-overnight's response. */
export type ResolveOvernightResult = components["schemas"]["ResolveOvernightResponse"];

/** GET /api/reminders and the reminder action endpoints' echoed row. */
export type Reminder = components["schemas"]["ReminderResponse"];

/** POST /api/push/register — echoes back the upserted `device_tokens` row. */
export type PushRegisterResult = components["schemas"]["PushRegisterResponse"];

/**
 * POST /api/image — the one-pass vision read (INT capture hot path, Step 11
 * of the design handoff). `id` is the stored row's identifier — useful for a
 * later `fennoc_recall_image` follow-up question, not for re-fetching the
 * photo, since fennoc-core discards the image bytes before this response is
 * even returned (see `api/server.py`'s `upload_image_endpoint` docstring).
 * There is no client-side "view full size" affordance anywhere in this app
 * for exactly that reason: there is nothing left on the server to view.
 */
export type ImageUploadResult = components["schemas"]["ImageUploadResponse"];

// ---------------------------------------------------------------------------
// Hand-written types below.
//
// These are either not response bodies (so there's nothing in the OpenAPI
// schema to derive them from — HttpMethod, the *Opts call-site shapes), or
// encode client-side domain knowledge the generated schema can't express:
// `tasks.status` and `tasks.labels` are plain `TEXT`/`str` columns in
// fennoc-core (see fennoc/store/accessors.py's Task dataclass), so FastAPI
// has no way to know they're restricted to a closed set of values — the
// generated `TaskResponse.status` is just `string`. The literal unions here
// are this app's own knowledge of the valid values, not derivable from the
// schema.
// ---------------------------------------------------------------------------

export type TaskStatus = "open" | "completed" | "dropped";

/** `POST /api/time/resolve-overnight`'s `action` field — the server takes a
 *  plain `string` (`fennoc.thread.resolve_overnight` does its own
 *  validation), so this closed set is this app's own knowledge, same
 *  reasoning as `TaskStatus` above. Mirrors the three buttons on the
 *  overnight card (step 18a): `"done"` closes with a duration, `"keep"`
 *  leaves the block open, `"bin"` discards the block without touching the
 *  task. */
export type ResolveOvernightAction = "done" | "keep" | "bin";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GetTasksOpts {
  status?: TaskStatus | "all";
  project?: string;
  priority?: number;
  due_before?: string;
  due_after?: string;
  source?: string;
  /** Server-side filter on labels containing domain:work|personal. */
  domain?: "work" | "personal";
  limit?: number;
}

export interface TimeStartOpts {
  category: string;
  label?: string;
}

export interface CaptureOpts {
  idempotency_key?: string;
  source_ref?: string;
}
