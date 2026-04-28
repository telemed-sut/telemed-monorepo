import { describe, expect, it } from "vitest";

import {
  formatCompactDuration,
  getSecureSessionState,
  SECURE_SESSION_WINDOW_SECONDS,
} from "@/lib/secure-session";

describe("secure session utilities", () => {
  it("reports an active secure session while the window is still open", () => {
    const now = new Date("2026-04-05T00:00:00.000Z").getTime();
    const authenticatedAt = new Date("2026-04-04T21:30:00.000Z").toISOString();

    const state = getSecureSessionState(
      authenticatedAt,
      SECURE_SESSION_WINDOW_SECONDS,
      now,
    );

    expect(state.known).toBe(true);
    expect(state.active).toBe(true);
    expect(state.remainingSeconds).toBe(5_400);
  });

  it("reports an expired secure session once the window closes", () => {
    const now = new Date("2026-04-05T00:00:00.000Z").getTime();
    const authenticatedAt = new Date("2026-04-04T18:00:00.000Z").toISOString();

    const state = getSecureSessionState(
      authenticatedAt,
      SECURE_SESSION_WINDOW_SECONDS,
      now,
    );

    expect(state.known).toBe(true);
    expect(state.active).toBe(false);
    expect(state.remainingSeconds).toBe(0);
  });

  it("formats compact durations for both English and Thai", () => {
    expect(formatCompactDuration(3_900, "en")).toBe("1h 5m");
    expect(formatCompactDuration(3_900, "th")).toBe("1ชม. 5น.");
  });
});
