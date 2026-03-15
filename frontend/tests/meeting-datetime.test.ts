import { describe, expect, it } from "vitest";

import {
  combineLocalDateAndTime,
  combineLocalDateAndTimeToIso,
  formatLocalDateKey,
  parseLocalDateKey,
} from "@/lib/meeting-datetime";

describe("meeting-datetime helpers", () => {
  it("round-trips a local date key without shifting the calendar day", () => {
    const parsed = parseLocalDateKey("2026-03-13");

    expect(parsed).not.toBeNull();
    expect(formatLocalDateKey(parsed as Date)).toBe("2026-03-13");
  });

  it("builds a date-time on the selected local day and time", () => {
    const selectedDate = parseLocalDateKey("2026-03-13");
    expect(selectedDate).not.toBeNull();

    const combined = combineLocalDateAndTime(selectedDate as Date, 8, 15);

    expect(formatLocalDateKey(combined)).toBe("2026-03-13");
    expect(combined.getHours()).toBe(8);
    expect(combined.getMinutes()).toBe(15);
  });

  it("serializes local date and time to ISO without losing the local calendar day", () => {
    const selectedDate = parseLocalDateKey("2026-03-13");
    expect(selectedDate).not.toBeNull();

    const iso = combineLocalDateAndTimeToIso(selectedDate as Date, 8, 15);
    const reparsed = new Date(iso);

    expect(formatLocalDateKey(reparsed)).toBe("2026-03-13");
    expect(reparsed.getHours()).toBe(8);
    expect(reparsed.getMinutes()).toBe(15);
  });
});
