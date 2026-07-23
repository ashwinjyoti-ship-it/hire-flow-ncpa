/** Installment checklist field keys and status helpers (Financials section). */

export const INSTALMENT_COUNT = 5;

export const INSTALMENT_EXPECTED_DATE_FIELD_KEYS = [
  "installment_1_expected_date",
  "installment_2_expected_date",
  "installment_3_expected_date",
  "installment_4_expected_date",
  "installment_5_expected_date",
] as const;

export const INSTALMENT_RECEIVED_FIELD_KEYS = [
  "installment_1_received",
  "installment_2_received",
  "installment_3_received",
  "installment_4_received",
  "installment_5_received",
] as const;

export type InstalmentExpectedDateFieldKey = (typeof INSTALMENT_EXPECTED_DATE_FIELD_KEYS)[number];
export type InstalmentReceivedFieldKey = (typeof INSTALMENT_RECEIVED_FIELD_KEYS)[number];

const EXPECTED_DATE_PATTERN = /^installment_(\d)_expected_date$/;
const RECEIVED_PATTERN = /^installment_(\d)_received$/;

export function instalmentNumberFromFieldKey(fieldKey: string): number | null {
  const fromExpected = fieldKey.match(EXPECTED_DATE_PATTERN);
  if (fromExpected) return Number(fromExpected[1]);
  const fromReceived = fieldKey.match(RECEIVED_PATTERN);
  if (fromReceived) return Number(fromReceived[1]);
  return null;
}

export function isInstalmentExpectedDateField(fieldKey: string): fieldKey is InstalmentExpectedDateFieldKey {
  return (INSTALMENT_EXPECTED_DATE_FIELD_KEYS as readonly string[]).includes(fieldKey);
}

export function isInstalmentReceivedField(fieldKey: string): fieldKey is InstalmentReceivedFieldKey {
  return (INSTALMENT_RECEIVED_FIELD_KEYS as readonly string[]).includes(fieldKey);
}

export function instalmentExpectedDateFieldKey(number: number): InstalmentExpectedDateFieldKey {
  return `installment_${number}_expected_date` as InstalmentExpectedDateFieldKey;
}

export function instalmentReceivedFieldKey(number: number): InstalmentReceivedFieldKey {
  return `installment_${number}_received` as InstalmentReceivedFieldKey;
}

export function isInstalmentReceivedValue(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/** Expected-date row status: received → completed; date set → in_progress; else not_started. */
export function instalmentExpectedDateStatus(
  expectedDate: string | null | undefined,
  received: string | null | undefined,
): string {
  if (isInstalmentReceivedValue(received)) return "completed";
  if ((expectedDate ?? "").trim()) return "in_progress";
  return "not_started";
}
