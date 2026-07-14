import { describe, expect, it } from "vitest";
import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
  isCateringMealPaxKey,
} from "../lib/catering-meals";

describe("catering-meals", () => {
  it("defines stable requirement keys for each meal type", () => {
    expect(cateringMealRequiredKey("breakfast")).toBe("catering_breakfast_required");
    expect(cateringMealPaxKey("dinner")).toBe("catering_dinner_pax");
    expect(CATERING_MEAL_TYPES).toHaveLength(5);
  });

  it("recognises meal pax keys for aggregation", () => {
    expect(isCateringMealPaxKey("catering_lunch_pax")).toBe(true);
    expect(isCateringMealPaxKey("catering_required")).toBe(false);
    expect(isCateringMealPaxKey("no_of_pax")).toBe(false);
  });
});
