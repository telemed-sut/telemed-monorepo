import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createExpiringToken(expOffsetSeconds: number) {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds })
  );
  return `${header}.${payload}.signature`;
}

describe("api client token refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("abandons a stalled refresh attempt after the timeout and continues the original request", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("refresh timed out")));
        });
      }

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { apiFetch, TOKEN_REFRESH_TIMEOUT_MS } = await import("@/lib/api-client");

    const requestPromise = apiFetch<{ ok: boolean }>(
      "/patients",
      {},
      createExpiringToken(60)
    );

    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_TIMEOUT_MS + 1);

    await expect(requestPromise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/refresh");
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/patients");
  });
});
