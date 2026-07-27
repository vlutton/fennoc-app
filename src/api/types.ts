export interface Status {
  open: number;
  completed: number;
  overdue: number;
  checkin_coverage: { answered: number; total: number };
}

export interface Task {
  task_id: string;
  title: string;
  project: string;
  priority: number;
  due_date: string | null;
  labels: string[];
  status: "open" | "completed" | "dropped";
  source: string;
  source_ref: string;
  recurrence: string | null;
  recurrence_parent_id: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface Briefing {
  text: string | null;
  date: string | null; // "YYYY-MM-DD"
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GetTasksOpts {
  status?: Task["status"] | "all";
  project?: string;
  priority?: number;
  due_before?: string;
  due_after?: string;
  source?: string;
  /** Server-side filter on labels containing domain:work|personal. */
  domain?: "work" | "personal";
  limit?: number;
}

export interface TimeBlock {
  block_id: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  source: string;
  category: string;
  label: string;
  confidence: string;
  idempotency_key: string;
  metadata: string; // JSON STRING on the wire — NOT an object
  created_at: string;
}

export interface OpenTimer {
  active: boolean;
  started_at?: string;
  label?: string;
  category?: string;
}

export interface TimeStartOpts {
  category: string;
  label?: string;
}

export interface PendingCheckin {
  pending: boolean;
  id?: number;
  sent_at?: string;
  question_type?: string;
  question_text?: string;
}

export interface CheckinReply {
  ok: boolean;
  ack: string;
}

/** Check-in cursor from GET /api/time/current — distinct from OpenTimer (/api/time/open). */
export interface CheckinCurrent {
  active: boolean;
  category?: string;
  label?: string;
  started_at?: string;
}

export interface CaptureResult {
  ok: boolean;
  event_id: string | null;
}

export interface CaptureOpts {
  idempotency_key?: string;
  source_ref?: string;
}

export interface CheckinCoverage {
  answered: number;
  total: number;
}

export interface Budget {
  limit: number;
  spent: number;
  remaining: number;
  deferred: number;
  quiet_hours: boolean;
  reset_at: string; // ISO 8601 local-time STRING on the wire — NOT a Date
}
