import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "./api";
import { applyOptimisticChecklistUpdate, type ChecklistCacheItem, type ChecklistCacheResponse } from "./checklist-cache";

export type ChecklistUpdateItem = ChecklistCacheItem;

export type ChecklistUpdateResponse = ChecklistCacheResponse;

export function useChecklistUpdate(eventId: string | undefined) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (args: {
      item: ChecklistUpdateItem;
      value: string | null;
      status?: string;
      correctionReason?: string | null;
    }) => {
      if (!eventId) throw new Error("Event not found");
      await apiPatch(`/events/${eventId}/checklist/${args.item.id}`, {
        value: args.value,
        status: args.status,
        correction_reason: args.correctionReason,
      });
    },
    onMutate: async (args) => {
      if (!eventId) return { previous: undefined };
      const queryKey = ["event", eventId, "checklist"] as const;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<ChecklistUpdateResponse>(queryKey);
      if (previous) {
        qc.setQueryData(
          queryKey,
          applyOptimisticChecklistUpdate(previous, args.item, args.value, args.status),
        );
      }
      return { previous };
    },
    onSuccess: async () => {
      if (!eventId) return;
      const queryKey = ["event", eventId, "checklist"] as const;
      const freshChecklist = await apiGet<ChecklistUpdateResponse>(`/events/${eventId}/checklist`);
      qc.setQueryData(queryKey, freshChecklist);
      qc.invalidateQueries({ queryKey: ["event", eventId] });
      qc.invalidateQueries({ queryKey: ["tasks", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-lifecycle"], exact: false });
    },
    onError: (_err, _args, context) => {
      if (!eventId || !context?.previous) return;
      qc.setQueryData(["event", eventId, "checklist"], context.previous);
    },
  });

  const savingItemId = mutation.isPending ? mutation.variables?.item.id ?? null : null;

  return { ...mutation, savingItemId };
}
