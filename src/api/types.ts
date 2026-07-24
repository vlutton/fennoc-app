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
  limit?: number;
}
