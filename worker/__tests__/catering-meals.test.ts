import { describe, expect, it } from "vitest";
import {
  CATERING_MEAL_NOT_APPLICABLE,
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
  isCateringMealNotApplicable,
  isCateringMealPaxKey,
  isCateringMealRequired,
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

  it("treats only Yes as a required meal and N/A as settled", () => {
    expect(CATERING_MEAL_NOT_APPLICABLE).toBe("N/A");
    expect(isCateringMealRequired("Yes")).toBe(true);
    expect(isCateringMealRequired("No")).toBe(false);
    expect(isCateringMealRequired("")).toBe(false);
    expect(isCateringMealRequired(CATERING_MEAL_NOT_APPLICABLE)).toBe(false);
    expect(isCateringMealNotApplicable("")).toBe(true);
    expect(isCateringMealNotApplicable("No")).toBe(true);
    expect(isCateringMealNotApplicable("Yes")).toBe(false);
  });
});
