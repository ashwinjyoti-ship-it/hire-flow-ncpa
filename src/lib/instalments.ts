import {
  INSTALMENT_COUNT,
  INSTALMENT_EXPECTED_DATE_FIELD_KEYS,
  INSTALMENT_RECEIVED_FIELD_KEYS,
  instalmentExpectedDateFieldKey,
  instalmentExpectedDateStatus,
  instalmentNumberFromFieldKey,
  instalmentReceivedFieldKey,
  isInstalmentExpectedDateField,
  isInstalmentReceivedField,
  isInstalmentReceivedValue,
} from "../../worker/lib/instalments";

export {
  INSTALMENT_COUNT,
  INSTALMENT_EXPECTED_DATE_FIELD_KEYS,
  INSTALMENT_RECEIVED_FIELD_KEYS,
  instalmentExpectedDateFieldKey,
  instalmentExpectedDateStatus,
  instalmentNumberFromFieldKey,
  instalmentReceivedFieldKey,
  isInstalmentExpectedDateField,
  isInstalmentReceivedField,
  isInstalmentReceivedValue,
};

export type InstalmentChecklistItem = {
  field_key: string;
  value: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lowest instalment with an expected date on/before today that is not yet received. */
export function getCurrentPendingInstalmentNumber(
  items: InstalmentChecklistItem[],
  today = todayIso(),
): number | null {
  const byKey = new Map(items.map((item) => [item.field_key, item.value]));
  for (let number = 1; number <= INSTALMENT_COUNT; number += 1) {
    const expectedDate = (byKey.get(instalmentExpectedDateFieldKey(number)) ?? "").trim();
    const received = byKey.get(instalmentReceivedFieldKey(number));
    if (!expectedDate || expectedDate > today || isInstalmentReceivedValue(received)) continue;
    return number;
  }
  return null;
}

/** Next instalment waiting on a future expected date (for softer highlight copy). */
export function getNextFutureInstalmentNumber(
  items: InstalmentChecklistItem[],
  today = todayIso(),
): number | null {
  const byKey = new Map(items.map((item) => [item.field_key, item.value]));
  for (let number = 1; number <= INSTALMENT_COUNT; number += 1) {
    const expectedDate = (byKey.get(instalmentExpectedDateFieldKey(number)) ?? "").trim();
    const received = byKey.get(instalmentReceivedFieldKey(number));
    if (!expectedDate || expectedDate <= today || isInstalmentReceivedValue(received)) continue;
    return number;
  }
  return null;
}
