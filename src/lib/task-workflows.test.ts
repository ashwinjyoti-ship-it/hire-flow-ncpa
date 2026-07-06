import { describe, expect, it } from "vitest";
import {
  buildEventCommandCards,
  groupTasksByTiming,
  groupTasksByWorkflowLane,
  getTaskUrgencyLabels,
  getWorkflowFamily,
  type TaskLike,
} from "./task-workflows";

const today = "2026-07-06";

function task(overrides: Partial<TaskLike> & Pick<TaskLike, "id" | "title">): TaskLike {
  return {
    id: overrides.id,
    title: overrides.title,
    description: null,
    event_id: overrides.event_id ?? "ev_default",
    event_title: overrides.event_title ?? "Default Event",
    event_status: overrides.event_status ?? "tentative",
    event_start_date: overrides.event_start_date ?? "2026-07-15",
    event_end_date: overrides.event_end_date ?? null,
    event_venues: overrides.event_venues ?? "JBT",
    event_owner: overrides.event_owner ?? "Aditi Rao",
    task_type: overrides.task_type ?? "automatic",
    source_rule: overrides.source_rule ?? null,
    assignee_name: overrides.assignee_name === undefined ? "Ops" : overrides.assignee_name,
    due_date: overrides.due_date ?? null,
    priority: overrides.priority ?? "medium",
    status: overrides.status ?? "open",
  };
}

describe("task workflow helpers", () => {
  it("classifies workflow families from source rules and task titles", () => {
    expect(getWorkflowFamily(task({ id: "a", title: "Approval follow up", source_rule: "approval_followup" }))).toBe("approval");
    expect(getWorkflowFamily(task({ id: "b", title: "Send confirmation letter" }))).toBe("confirmation");
    expect(getWorkflowFamily(task({ id: "c", title: "Collect installment 2" }))).toBe("payments");
    expect(getWorkflowFamily(task({ id: "d", title: "OnStage technical sheet" }))).toBe("operations");
    expect(getWorkflowFamily(task({ id: "e", title: "Accounts file status" }))).toBe("accounts");
    expect(getWorkflowFamily(task({ id: "f", title: "Send feedback form" }))).toBe("postEvent");
    expect(getWorkflowFamily(task({ id: "g", title: "Call client" }))).toBe("manual");
  });

  it("orders event command cards by operational importance", () => {
    const cards = buildEventCommandCards([
      task({ id: "later", title: "Later work", event_id: "ev_later", event_title: "Later Event", due_date: "2026-07-20" }),
      task({ id: "high", title: "High work", event_id: "ev_high", event_title: "High Event", due_date: "2026-07-12", priority: "high" }),
      task({ id: "today", title: "Today work", event_id: "ev_today", event_title: "Today Event", due_date: today }),
      task({ id: "overdue", title: "Overdue work", event_id: "ev_overdue", event_title: "Overdue Event", due_date: "2026-07-05" }),
      task({ id: "soon", title: "Approval blocker", source_rule: "approval_followup", event_id: "ev_soon", event_title: "Soon Event", event_start_date: "2026-07-08", due_date: "2026-07-10" }),
      task({ id: "nodate", title: "No date work", event_id: "ev_nodate", event_title: "No Date Event", due_date: null }),
    ], today);

    expect(cards.map((card) => card.event.id)).toEqual(["ev_overdue", "ev_today", "ev_high", "ev_soon", "ev_later", "ev_nodate"]);
  });

  it("groups tasks by timing and workflow lane", () => {
    const tasks = [
      task({ id: "overdue", title: "Approval", due_date: "2026-07-05", source_rule: "approval_followup" }),
      task({ id: "tomorrow", title: "Payment", due_date: "2026-07-07", source_rule: "installment_due" }),
      task({ id: "nodate", title: "Manual call", due_date: null, task_type: "manual" }),
    ];

    expect(groupTasksByTiming(tasks, today).map((group) => [group.key, group.tasks.map((t) => t.id)])).toEqual([
      ["overdue", ["overdue"]],
      ["tomorrow", ["tomorrow"]],
      ["noDate", ["nodate"]],
    ]);

    expect(groupTasksByWorkflowLane(tasks, today).map((lane) => [lane.key, lane.tasks.map((t) => t.id)])).toEqual([
      ["approval", ["overdue"]],
      ["payments", ["tomorrow"]],
      ["manual", ["nodate"]],
    ]);
  });

  it("keeps task urgency separate from event status surfaces", () => {
    expect(getTaskUrgencyLabels(task({ id: "a", title: "Late", due_date: "2026-07-05", assignee_name: null }), today)).toEqual(["Overdue", "Unassigned"]);
    expect(getTaskUrgencyLabels(task({ id: "b", title: "Today", due_date: today, priority: "high" }), today)).toEqual(["Due today", "High priority"]);
  });
});
