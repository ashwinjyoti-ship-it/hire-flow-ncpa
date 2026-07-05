import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch } from "../lib/api";
import { formatDate } from "../lib/use-lookups";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  event_id: string | null;
  event_title: string | null;
  event_status: string | null;
  task_type: "automatic" | "manual";
  source_rule: string | null;
  assignee_name: string | null;
  due_date: string | null;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "completed" | "cancelled";
};

export function TasksPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const [mine, setMine] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", status, mine],
    queryFn: () => apiGet<{ tasks: TaskRow[] }>(`/tasks?status=${status}&mine=${mine ? "1" : "0"}`),
  });

  const updateTask = useMutation({
    mutationFn: async (args: { id: string; status: TaskRow["status"] }) => apiPatch(`/tasks/${args.id}`, { status: args.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Automatic follow-ups and manual operational work" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {["open", "in_progress", "completed", "all"].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatus(option)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-medium etched " +
              (status === option ? "carved-btn-sage bg-sage-btn text-sage-text" : "carved-btn bg-neutral-btn text-ink-secondary")
            }
          >
            {option.replace(/_/g, " ")}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-ink-secondary etched">
          <input type="checkbox" checked={mine} onChange={(ev) => setMine(ev.target.checked)} className="h-4 w-4 accent-sage" />
          My tasks
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">
          {(error as Error).message}
        </div>
      )}

      <div className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/50">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-muted etched">Loading...</div>
        ) : (data?.tasks.length ?? 0) === 0 ? (
          <div className="p-6 text-sm text-ink-muted etched">No tasks in this view.</div>
        ) : (
          <div className="divide-y divide-ink-muted/10">
            {data?.tasks.map((task) => (
              <div key={task.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink-primary etched-deep">{task.title}</h3>
                    <span className={badgeClass(task.priority)}>{task.priority}</span>
                    <span className={statusClass(task.status)}>{task.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted etched">
                    <span>{task.task_type === "automatic" ? "Automatic" : "Manual"}</span>
                    {task.source_rule && <span>{task.source_rule.replace(/_/g, " ")}</span>}
                    {task.due_date && <span>Due {formatDate(task.due_date)}</span>}
                    {task.assignee_name && <span>{task.assignee_name}</span>}
                    {task.event_id && task.event_title && <Link to={`/events/${task.event_id}`} className="text-sage-text underline">{task.event_title}</Link>}
                  </div>
                  {task.description && <p className="mt-2 text-xs text-ink-secondary etched">{task.description}</p>}
                </div>
                <div className="flex gap-2">
                  {task.status === "open" && (
                    <button
                      type="button"
                      disabled={updateTask.isPending}
                      onClick={() => updateTask.mutate({ id: task.id, status: "in_progress" })}
                      className="carved-btn rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched"
                    >
                      Start
                    </button>
                  )}
                  {task.status !== "completed" && task.status !== "cancelled" && (
                    <button
                      type="button"
                      disabled={updateTask.isPending}
                      onClick={() => updateTask.mutate({ id: task.id, status: "completed" })}
                      className="carved-btn-sage rounded-full bg-sage-btn px-3 py-1.5 text-xs font-semibold text-sage-text etched"
                    >
                      Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function badgeClass(priority: string): string {
  if (priority === "high") return "rounded-full bg-status-cancelled/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-cancelled";
  if (priority === "low") return "rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted";
  return "rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-awaitingApproval";
}

function statusClass(status: string): string {
  if (status === "completed") return "rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sage-text";
  if (status === "cancelled") return "rounded-full bg-status-cancelled/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-cancelled";
  if (status === "in_progress") return "rounded-full bg-status-awaitingApproval/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-status-awaitingApproval";
  return "rounded-full bg-marble-shadow/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted";
}
