import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  isAxiosError,
} from "axios";

import type {
  Briefing,
  CaptureOpts,
  CaptureResult,
  CheckinCoverage,
  CheckinCurrent,
  CheckinReply,
  GetTasksOpts,
  HttpMethod,
  OpenTimer,
  PendingCheckin,
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

export async function briefingMorning(): Promise<Briefing> {
  return request<Briefing>("GET", "/api/briefing/morning");
}

export async function briefingEvening(): Promise<Briefing> {
  return request<Briefing>("GET", "/api/briefing/evening");
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
