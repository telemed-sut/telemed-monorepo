import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = {
  prefetch: vi.fn(),
  push: vi.fn(),
};

const currentUser = {
  id: "user-1",
  email: "demo@example.com",
  first_name: "Demo",
  last_name: "Doctor",
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => router,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-session-logout", () => ({
  useSessionLogout: () => vi.fn(),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (
    selector: (state: { language: "th" }) => unknown
  ) => selector({ language: "th" }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (
    selector: (state: {
      token: string;
      userId: string;
      currentUser: typeof currentUser;
      role: "doctor";
      setCurrentUser: (user: typeof currentUser) => void;
    }) => unknown
  ) =>
    selector({
      token: "token",
      userId: currentUser.id,
      currentUser,
      role: "doctor",
      setCurrentUser: vi.fn(),
    }),
}));

vi.mock("@/lib/api", () => ({
  canManageUsers: (role: string | null) => role === "admin",
  canViewClinicalData: (role: string | null) =>
    role === "admin" || role === "doctor" || role === "medical_student",
  fetchCurrentUser: vi.fn().mockResolvedValue(currentUser),
}));

describe("DashboardSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles the sidebar from the sidebar surface", async () => {
    const { DashboardSidebar } = await import("@/components/dashboard/sidebar");
    const { SidebarProvider } = await import("@/components/ui/sidebar");

    const { container } = render(
      <SidebarProvider>
        <DashboardSidebar />
      </SidebarProvider>
    );
    const sidebarSurface = container.querySelector(
      '[data-slot="sidebar-container"]'
    );

    expect(sidebarSurface).toHaveClass("cursor-ew-resize");
    expect(sidebarSurface).not.toHaveClass("cursor-pointer");
    expect(
      container.querySelector('[data-slot="sidebar"][data-state="expanded"]')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("E Med Help"));

    expect(
      container.querySelector('[data-slot="sidebar"][data-state="collapsed"]')
    ).toBeInTheDocument();

    fireEvent.click(
      container.querySelector('[data-slot="sidebar-content"]') as HTMLElement
    );

    expect(
      container.querySelector('[data-slot="sidebar"][data-state="expanded"]')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ผู้ป่วย" }));

    expect(router.push).toHaveBeenCalledWith("/patients");
    expect(
      container.querySelector('[data-slot="sidebar"][data-state="expanded"]')
    ).toBeInTheDocument();
  });

  it("keeps the brand text mounted so collapse can animate smoothly", async () => {
    const { DashboardSidebar } = await import("@/components/dashboard/sidebar");
    const { SidebarProvider } = await import("@/components/ui/sidebar");

    render(
      <SidebarProvider defaultOpen={false}>
        <DashboardSidebar />
      </SidebarProvider>
    );

    expect(screen.getByText("E Med Help")).toHaveClass("max-w-0");
    expect(
      screen.getByText("E Med Help")
    ).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("ภาพรวม")).toHaveClass("max-w-0");
    expect(screen.getByRole("button", { name: "ภาพรวม" })).toHaveClass("gap-0!");
    expect(screen.getByRole("button", { name: "ภาพรวม" })).toHaveClass("size-10!");
    expect(screen.getByRole("button", { name: "ภาพรวม" })).toHaveClass("p-0!");
    expect(document.querySelector("#sidebar-item-overview svg:first-child")).toHaveClass("left-1/2");
    expect(document.querySelector("#sidebar-item-overview svg:first-child")).toHaveClass("-translate-x-1/2");
    expect(document.querySelector("#sidebar-item-overview svg:last-child")).toHaveClass("w-0");
    expect(document.querySelector('[data-slot="sidebar-content"]')).toHaveClass("items-center");
    expect(document.querySelector('[data-slot="sidebar-footer"]')).toHaveClass("items-center");
    expect(document.querySelector("#sidebar-user-menu-button")).toHaveClass("size-10!");
    expect(document.querySelector("#sidebar-user-menu-button")?.parentElement).toHaveClass("w-10");
  });
});
