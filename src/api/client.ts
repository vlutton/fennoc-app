import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  isAxiosError,
} from "axios";

import type {
  AgentMessage,
  AgentMessageCreated,
  Briefing,
  Budget,
  CaptureOpts,
  CaptureResult,
  CheckinCoverage,
  CheckinCurrent,
  CheckinReply,
  GetTasksOpts,
  HttpMethod,
  ImageUploadResult,
  OpenTimer,
  PendingCheckin,
  PushRegisterResult,
  Status,
  Task,
  TimeBlock,
  TimeStartOpts,
} from "./types";
import { getKey, useAuth } from "../store/useAuth";

let client: AxiosInstance | null = null;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getClient(): Promise<AxiosInstance> {
  const { baseUrl, userId } = useAuth.getState();
  const apiKey = (await getKey()) ?? "";

  client = axios.create({
    baseURL: normalizeBaseUrl(baseUrl),
    timeout: 10_000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "X-Fennoc-User": userId || "vince",
    },
  });

  return client;
}

export function resetClient(): void {
  client = null;
}

export function formatApiError(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.response) {
      const detail =
        typeof error.response.data === "object" &&
        error.response.data !== null &&
        "detail" in error.response.data
          ? String((error.response.data as { detail: unknown }).detail)
          : error.message;
      return `${error.response.status}: ${detail}`;
    }
    if (error.code === "ECONNABORTED") {
      return "Request timed out";
    }
    return error.message || "Network error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const instance = await getClient();
  const response = await instance.request<T>({
    method,
    url: path,
    data: body,
    ...config,
  });
  return response.data;
}

export async function getStatus(): Promise<Status> {
  return request<Status>("GET", "/api/status");
}

export async function getTasks(opts: GetTasksOpts = {}): Promise<Task[]> {
  return request<Task[]>("GET", "/api/tasks", undefined, { params: opts });
}

export async function getTodayTasks(): Promise<Task[]> {
  return request<Task[]>("GET", "/api/tasks/today");
}

export async function getOverdueTasks(): Promise<Task[]> {
  return request<Task[]>("GET", "/api/tasks/overdue");
}

export async function completeTask(
  taskId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("POST", `/api/tasks/${taskId}/complete`);
}

export async function dropTask(taskId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("POST", `/api/tasks/${taskId}/drop`);
}

export async function getTodayTimeBlocks(day?: string): Promise<TimeBlock[]> {
  return request<TimeBlock[]>("GET", "/api/time/blocks", undefined, {
    params: day ? { day } : undefined,
  });
}

export async function getOpenTimer(): Promise<OpenTimer> {
  return request<OpenTimer>("GET", "/api/time/open");
}

export async function startTime(
  opts: TimeStartOpts,
): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>("POST", "/api/time/start", opts);
}

export async function stopTime(): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>("POST", "/api/time/stop");
}

export async function briefingMorning(day?: string): Promise<Briefing> {
  return request<Briefing>("GET", "/api/briefing/morning", undefined, {
    params: day ? { day } : undefined,
  });
}

export async function briefingEvening(day?: string): Promise<Briefing> {
  return request<Briefing>("GET", "/api/briefing/evening", undefined, {
    params: day ? { day } : undefined,
  });
}

export async function getCheckinCurrentActivity(): Promise<CheckinCurrent> {
  return request<CheckinCurrent>("GET", "/api/time/current");
}

export async function getPendingCheckin(): Promise<PendingCheckin> {
  return request<PendingCheckin>("GET", "/api/checkin/pending");
}

export async function replyCheckin(
  text: string,
  questionType: string,
): Promise<CheckinReply> {
  return request<CheckinReply>("POST", "/api/checkin/reply", {
    text,
    question_type: questionType,
  });
}

export async function getCheckinCoverage(
  day?: string,
): Promise<CheckinCoverage> {
  return request<CheckinCoverage>("GET", "/api/checkin/coverage", undefined, {
    params: day ? { day } : undefined,
  });
}

export async function capture(
  text: string,
  opts?: CaptureOpts,
): Promise<CaptureResult> {
  return request<CaptureResult>("POST", "/api/capture", {
    text,
    idempotency_key: opts?.idempotency_key,
    source_ref: opts?.source_ref ?? "fennoc-app",
  });
}

export async function getBudget(): Promise<Budget> {
  return request<Budget>("GET", "/api/budget");
}

export async function setBudgetLimit(limit: number): Promise<Budget> {
  return request<Budget>("PATCH", "/api/budget", { limit });
}

// `user` is sent explicitly in the body, even though getClient() also sets
// an `X-Fennoc-User` header on every request. That header looks like it
// should be enough, but the server does not read it — anywhere. The
// endpoint resolves the owner as `body.user or "vince"`, so omitting it
// here would silently file every device token under "vince" regardless of
// who the client says it is.
//
// That is invisible while there is one user and it is Vince, and wrong the
// moment there isn't. A device token is the one row that says "notify THIS
// person on THIS handset"; misattributing it means pushing someone else's
// content to a stranger's phone. Cheap to get right now, expensive to
// discover later.
export async function registerPushToken(
  token: string,
  platform: string,
): Promise<PushRegisterResult> {
  const { userId } = useAuth.getState();
  return request<PushRegisterResult>("POST", "/api/push/register", {
    token,
    platform,
    user: userId || "vince",
  });
}

export async function sendAgentMessage(text: string): Promise<AgentMessageCreated> {
  return request<AgentMessageCreated>("POST", "/api/message", { text });
}

export async function getAgentMessage(id: string): Promise<AgentMessage> {
  return request<AgentMessage>("GET", `/api/message/${id}`);
}

/**
 * POST /api/image — multipart upload for the photo-capture hot path (Step
 * 11 of the design handoff). Not built on `request()` above: that helper
 * always sends `application/json`, and a multipart body needs its own
 * `Content-Type` (with a boundary the platform generates, not one we could
 * write out by hand — see the header override below) plus a longer timeout
 * than a JSON round trip, since this one has a real vision-model call behind
 * it rather than a database write.
 *
 * `uri` is a `file://` URI, not bytes read into JS memory — React Native's
 * networking layer streams the file straight off disk when the request is
 * sent. This matters for the held/offline path in particular: a held photo
 * can sit queued for a while (src/outbox), and nothing here ever holds the
 * whole image in memory just to keep it around.
 *
 * `question` is the ONLY place a caption reaches this endpoint (mapped to
 * the server's optional `question` form field — see
 * `fennoc.vision.client.build_extraction_question`), and it is wired up
 * from exactly one caller: a gallery pick (src/components/CaptureBar.tsx's
 * long-press flow). The camera hot path never passes it — "shutter sends,"
 * no caption field, per Step 15 of the design handoff.
 */
export async function uploadImage(
  uri: string,
  mime: string,
  filename: string,
  question?: string,
): Promise<ImageUploadResult> {
  const instance = await getClient();

  // React Native's global `FormData` (see its own type declarations,
  // `FormDataValue`) accepts an `{ uri, name, type }` object directly for a
  // file part at RUNTIME — it is not a `Blob` and does not need to be one.
  // The TYPE CHECKER doesn't agree, though: `expo/tsconfig.base` (this
  // project's base config) sets `"lib": ["DOM", "ESNext"]`, and TypeScript's
  // global-scope merging lets lib.dom.d.ts's `FormData.append(name,
  // value: string | Blob)` shadow the narrower, RN-specific overload from
  // react-native's own `FormData.d.ts` — so `tsc` insists on a `Blob` here
  // even though the actual class backing `FormData` at runtime is RN's
  // polyfill, which has never had a `Blob` implementation to hand one to.
  // This is a known friction point wherever RN + a DOM-including tsconfig
  // meet; the one bridge across it is a type assertion, not a rewrite of
  // the request — RN's own official docs use the identical shape. `unknown`
  // as the intermediate step (not a direct `as Blob`) because the object
  // shape and `Blob` share no overlapping members for TS to accept a direct
  // assertion between.
  const formData = new FormData();
  formData.append("file", { uri, name: filename, type: mime } as unknown as Blob);
  if (question) formData.append("question", question);

  const response = await instance.post<ImageUploadResult>("/api/image", formData, {
    // Overrides the instance default (`application/json`, set in
    // getClient()). Deliberately no `boundary=` parameter: RN's XHR
    // polyfill fills one in when it sees a `FormData` body and a
    // `multipart/form-data` Content-Type with no boundary already present —
    // writing one out here would have to match what FormData actually
    // serializes byte-for-byte, so the right move is to leave it out.
    headers: { "Content-Type": "multipart/form-data" },
    // The default 10s client timeout (getClient) is tuned for the JSON
    // endpoints' database round trips. This one waits on a hosted vision
    // model reading a real photo — routinely longer — so 10s would trip
    // ECONNABORTED on a healthy connection just because the model was
    // still thinking. A timeout here still reads as a network error to
    // isNetworkError() (see src/outbox) and falls into the held queue for a
    // retry, which is the right outcome for a slow response; 30s just makes
    // that a genuine timeout rather than an impatient one.
    timeout: 30_000,
  });
  return response.data;
}

/**
 * DELETE /api/image/{id} — the server half of photo Undo for a shot that
 * had already finished uploading by the time Undo was tapped (see
 * `useThread.ts`'s `undoPhotoBatch` and `ThreadScreen.tsx`'s `onUndoPhoto`,
 * which calls this for every "done" shot in the batch). `POST /api/image`
 * never keeps the bytes, but the extracted-text row it inserts survives
 * past the request — and that text is the sensitive part, a full
 * transcription of whatever was photographed. Without this call, Undo on
 * an already-sent shot only ever hid the message locally while the row sat
 * on the server forever; that's the bug this wrapper exists to close.
 *
 * The endpoint is 204-always, idempotent by design (see its own docstring
 * in `api/server.py`) — deleting an id that's already gone, or was never
 * valid, is not an error. Callers of this wrapper get that idempotency for
 * free: it resolves on 204 the same as any other 2xx, and there is nothing
 * to distinguish "just deleted" from "already gone" here either.
 */
export async function deleteImage(id: string): Promise<void> {
  await request<void>("DELETE", `/api/image/${id}`);
}
