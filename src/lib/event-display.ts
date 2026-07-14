/** Strip a redundant "Organisation - " prefix when the event title already includes it. */
export function eventDisplayName(title: string, organisationName: string | null): string {
  if (!organisationName) return title;
  const prefix = `${organisationName} - `;
  if (title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return title.slice(prefix.length).trim();
  }
  return title;
}

export type EventContextLines = {
  primary: string;
  secondary: string | null;
};

/** Organisation-first labels for task and event surfaces. */
export function eventContextLines(
  organisationName: string | null | undefined,
  eventTitle: string | null | undefined,
): EventContextLines {
  const org = organisationName?.trim() || null;
  const event = eventTitle?.trim() || null;
  const primary = org ?? "No organisation";

  if (!event) return { primary, secondary: null };

  if (!org) {
    return { primary: "No organisation", secondary: event };
  }

  const secondary = eventDisplayName(event, org);
  if (secondary.toLocaleLowerCase() === org.toLocaleLowerCase()) {
    return { primary, secondary: null };
  }

  return { primary, secondary };
}
