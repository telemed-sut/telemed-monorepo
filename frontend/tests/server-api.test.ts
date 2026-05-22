import { afterEach, describe, expect, it, vi } from "vitest";

describe("server API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns null when the backend session fetch is unavailable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchCurrentUserSessionServer } = await import("@/app/server-api");

    await expect(fetchCurrentUserSessionServer("opaque-cookie-token")).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/auth/me",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.any(Headers),
      })
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer opaque-cookie-token");
  });

  it("still throws server API errors for non-auth backend failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
    );

    const { serverApiFetch, ServerApiError } = await import("@/app/server-api");

    await expect(serverApiFetch("/auth/me", "opaque-cookie-token", { method: "GET" })).rejects.toBeInstanceOf(
      ServerApiError
    );
  });
});
