import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "./api";
import {
  applyOptimisticChecklistUpdate,
  eventSnapshotFromDetail,
  mergeChecklistItem,
  patchEventDetailCache,
  patchEventSnapshotFromChecklistField,
  type ChecklistCacheItem,
  type ChecklistCacheResponse,
} from "./checklist-cache";

export type ChecklistUpdateItem = ChecklistCacheItem;

export type ChecklistUpdateResponse = ChecklistCacheResponse;

type EventDetailCache = { event: Record<string, unknown> };

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
      return apiPatch<{ item: ChecklistCacheItem }>(`/events/${eventId}/checklist/${args.item.id}`, {
        value: args.value,
        status: args.status,
        correction_reason: args.correctionReason,
      });
    },
    onMutate: (args) => {
      if (!eventId) return { previous: undefined, previousEvent: undefined };
      const queryKey = ["event", eventId, "checklist"] as const;
      const eventKey = ["event", eventId] as const;
      const previous = qc.getQueryData<ChecklistUpdateResponse>(queryKey);
      const previousEvent = qc.getQueryData<EventDetailCache>(eventKey);
      const eventSnapshot = previousEvent
        ? patchEventSnapshotFromChecklistField(
          eventSnapshotFromDetail(previousEvent.event),
          args.item.field_key,
          args.value,
        )
        : null;

      // Apply cache updates synchronously so the UI reflects the choice immediately.
      if (previous) {
        qc.setQueryData(
          queryKey,
          applyOptimisticChecklistUpdate(
            previous,
            args.item,
            args.value,
            args.status,
            eventSnapshot,
          ),
        );
      }
      if (previousEvent) {
        qc.setQueryData(eventKey, patchEventDetailCache(previousEvent, args.item.field_key, args.value));
      }

      void qc.cancelQueries({ queryKey });

      return { previous, previousEvent };
    },
    onSuccess: (response, args) => {
      if (!eventId) return;
      const queryKey = ["event", eventId, "checklist"] as const;
      const eventKey = ["event", eventId] as const;
      const eventDetail = qc.getQueryData<EventDetailCache>(eventKey);
      const eventSnapshot = eventDetail
        ? patchEventSnapshotFromChecklistField(
          eventSnapshotFromDetail(eventDetail.event),
          args.item.field_key,
          args.value,
        )
        : null;

      if (response?.item) {
        const current = qc.getQueryData<ChecklistUpdateResponse>(queryKey);
        if (current) {
          qc.setQueryData(queryKey, mergeChecklistItem(current, response.item, eventSnapshot));
        }
      }

      // Reconcile lifecycle / tasks in the background without blocking the UI.
      void (async () => {
        const freshChecklist = await apiGet<ChecklistUpdateResponse>(`/events/${eventId}/checklist`);
        qc.setQueryData(queryKey, freshChecklist);
        qc.invalidateQueries({ queryKey: eventKey });
        qc.invalidateQueries({ queryKey: ["tasks", eventId] });
        qc.invalidateQueries({ queryKey: ["calendar-lifecycle"], exact: false });
      })();
    },
    onError: (_err, _args, context) => {
      if (!eventId) return;
      if (context?.previous) {
        qc.setQueryData(["event", eventId, "checklist"], context.previous);
      }
      if (context?.previousEvent) {
        qc.setQueryData(["event", eventId], context.previousEvent);
      }
    },
  });

  const savingItemId = mutation.isPending ? mutation.variables?.item.id ?? null : null;
  const savingFieldKey = mutation.isPending ? mutation.variables?.item.field_key ?? null : null;

  return { ...mutation, savingItemId, savingFieldKey };
}
