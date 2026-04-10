import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const cookiesMock = vi.fn();
const fetchCurrentUserSessionServerMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/app/server-api", () => ({
  fetchCurrentUserSessionServer: fetchCurrentUserSessionServerMock,
}));

vi.mock("@/components/dashboard/dashboard-shell", () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("DashboardLayout auth guard", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    cookiesMock.mockReset();
    fetchCurrentUserSessionServerMock.mockReset();
  });

  it("redirects to login when the access token cookie is missing", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => undefined),
    });

    const DashboardLayout = (await import("@/app/(dashboard)/layout")).default;

    await expect(
      DashboardLayout({
        children: <div>Protected dashboard</div>,
      })
    ).rejects.toThrow("redirect:/login");

    expect(fetchCurrentUserSessionServerMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to login when the server session lookup fails", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: "opaque-cookie-token" })),
    });
    fetchCurrentUserSessionServerMock.mockResolvedValue(null);

    const DashboardLayout = (await import("@/app/(dashboard)/layout")).default;

    await expect(
      DashboardLayout({
        children: <div>Protected dashboard</div>,
      })
    ).rejects.toThrow("redirect:/login");

    expect(fetchCurrentUserSessionServerMock).toHaveBeenCalledWith("opaque-cookie-token");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("renders the dashboard shell when the server session is valid", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: "valid-cookie-token" })),
    });
    fetchCurrentUserSessionServerMock.mockResolvedValue({
      role: "admin",
      mfaVerified: true,
    });

    const DashboardLayout = (await import("@/app/(dashboard)/layout")).default;
    const layout = await DashboardLayout({
      children: <div>Protected dashboard</div>,
    });

    render(layout);

    expect(fetchCurrentUserSessionServerMock).toHaveBeenCalledWith("valid-cookie-token");
    expect(screen.getByText("Protected dashboard")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
