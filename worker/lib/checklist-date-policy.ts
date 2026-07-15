const PRE_SHOW_OPERATION_DATE_FIELDS = new Set([
  "approval_sent_on",
  "approval_received_on",
  "setup_date",
  "rehearsal_date",
  "installment_1_expected_date",
  "installment_2_expected_date",
  "installment_3_expected_date",
  "installment_4_expected_date",
  "installment_5_expected_date",
  "confirmation_couriered",
  "noc_sent_on",
  "onstage_asked_client",
  "onstage_received_from_client",
  "onstage_sent_to_team",
  "onstage_verified",
  "onstage_complete",
  "emailer_asked_client",
  "emailer_received_from_client",
  "emailer_sent_to_team",
  "emailer_sent",
  "technical_meeting_date",
]);

export function isPreShowOperationDate(fieldKey: string): boolean {
  return PRE_SHOW_OPERATION_DATE_FIELDS.has(fieldKey);
}

export function getPostShowDateWarning(fieldKey: string, value: string | null, finalShowDate: string | null): string | null {
  if (!isPreShowOperationDate(fieldKey) || !value || !finalShowDate || value <= finalShowDate) return null;
  return `The date entered is post-show. Choose ${finalShowDate} or an earlier date.`;
}
