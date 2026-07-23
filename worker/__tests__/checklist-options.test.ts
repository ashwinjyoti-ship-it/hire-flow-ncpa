import { describe, expect, it } from "vitest";
import {
  CHECKLIST_LOOKUP_LIST_KEYS,
  hydrateChecklistItemOptions,
  loadLookupOptionValues,
} from "../lib/checklist-options";

describe("checklist lookup options", () => {
  it("maps genre_head to approval_sent_to", () => {
    expect(CHECKLIST_LOOKUP_LIST_KEYS.genre_head).toBe("approval_sent_to");
  });

  it("loads active lookup values and preserves a stored value when deactivated", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes("dropdown_options")) {
                  return { results: [{ value: "Bruce" }, { value: "Bianca" }] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const values = await loadLookupOptionValues(db, "approval_sent_to", "Legacy Head");
    expect(values).toEqual(["Bruce", "Bianca", "Legacy Head"]);
  });

  it("hydrates genre_head dropdown options from the lookup list", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes("dropdown_options")) {
                  return { results: [{ value: "Bruce" }, { value: "Bianca" }] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const hydrated = await hydrateChecklistItemOptions(db, [{
      field_key: "genre_head",
      field_type: "dropdown",
      options: null,
      value: null,
    }]);

    expect(hydrated[0]?.options).toBe(JSON.stringify(["Bruce", "Bianca"]));
  });
});
