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
 * declined," rendered in the order they happened. Hand-written, not
 * generated: `fennoc-core`'s server team is landing `actions` on
 * `GET /api/message/{id}` (and thread listing) in parallel with this
 * client change, so it isn't in `schema.gen.ts` yet. `AgentMessage` below
 * declares it optional-and-nullable for exactly that reason — until the
 * server ships, every real response simply omits the key, which reads
 * identically to `null` for every consumer in this app (see
 * `qualifiesForReceipt` in components/Receipt.tsx). Re-derive this type
 * from the generated schema (drop this intersection) once
 * `npm run gen:api-schema && npm run gen:api-types` picks up the real field.
 */
export interface AgentAction {
  text: string;
  kind: "write" | "read" | "decline";
}

/** GET /api/message/{id} and /api/messages — full `agent_messages` row (INT-029b). */
export type AgentMessage = components["schemas"]["AgentMessageResponse"] & {
  /** See `AgentAction`'s own doc comment — not yet in the generated schema. */
  actions?: AgentAction[] | null;
};

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
