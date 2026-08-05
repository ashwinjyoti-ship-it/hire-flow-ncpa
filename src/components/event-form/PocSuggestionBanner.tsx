import {
  countApplicablePocSuggestionFields,
  formatPocSuggestionSourceLabel,
  type PocSuggestionResponse,
} from "../../lib/org-poc-suggestion";

type PocSuggestionBannerProps = {
  organisationName: string;
  currentRequirements: Record<string, unknown>;
  data: PocSuggestionResponse;
  onApply: () => void;
  onDismiss: () => void;
};

export function PocSuggestionBanner({
  organisationName,
  currentRequirements,
  data,
  onApply,
  onDismiss,
}: PocSuggestionBannerProps) {
  const applicableCount = countApplicablePocSuggestionFields(currentRequirements, data.suggestion);
  if (applicableCount === 0) return null;

  const sourceLabel = formatPocSuggestionSourceLabel(data.source, organisationName);
  const previewParts = [data.preview.poc_name, data.preview.poc_email].filter(Boolean);
  const previewText = previewParts.length > 0 ? previewParts.join(" · ") : null;

  return (
    <div
      role="status"
      className="mb-4 rounded-xl border border-sage/30 bg-sage/10 px-4 py-3 text-xs text-ink-secondary etched"
    >
      <p className="text-sm font-semibold text-sage-text etched-deep">POC on file</p>
      <p className="mt-1">
        We found Point of Contact details for <span className="font-medium text-ink-primary">{sourceLabel}</span>.
        {previewText ? (
          <span className="mt-1 block text-ink-muted">{previewText}</span>
        ) : null}
      </p>
      <p className="mt-1 text-ink-muted">
        Apply will fill {applicableCount} empty field{applicableCount === 1 ? "" : "s"} only — nothing you have already entered will be overwritten.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApply}
          className="carved-btn rounded-full bg-terracotta-btn px-4 py-1.5 text-xs font-semibold text-terracotta-text etched"
        >
          Apply POC
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="carved-btn rounded-full bg-neutral-btn px-4 py-1.5 text-xs font-medium text-ink-secondary etched"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
