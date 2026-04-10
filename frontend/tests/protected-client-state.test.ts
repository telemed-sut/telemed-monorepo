import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("protected client state helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("migrates legacy localStorage drafts into sessionStorage on first read", async () => {
    const { readProtectedSessionItem } = await import("@/lib/protected-client-state");
    const legacyKey = "month-calendar-popover-invitees:meeting-1";

    window.localStorage.setItem(legacyKey, "invitee@example.com");

    expect(
      readProtectedSessionItem(legacyKey, { migrateLegacyLocalStorage: true })
    ).toBe("invitee@example.com");
    expect(window.sessionStorage.getItem(legacyKey)).toBe("invitee@example.com");
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
  });
});
