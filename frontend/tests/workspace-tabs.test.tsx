import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceTabs } from "@/components/dashboard/workspace-tabs";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import {
  type RecentWorkspace,
  type WorkspaceTab,
  useWorkspaceTabsStore,
} from "@/store/workspace-tabs-store";

const pushMock = vi.fn();
const prefetchMock = vi.fn();
const { mockToastDestructiveAction } = vi.hoisted(() => ({
  mockToastDestructiveAction: vi.fn(),
}));
let pathnameValue = "/patients/patient-1";

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameValue,
  useRouter: () => ({
    push: pushMock,
    prefetch: prefetchMock,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    destructiveAction: mockToastDestructiveAction,
  },
}));

function createTab(
  id: string,
  title: string,
  href: string,
  options: Partial<WorkspaceTab> = {}
): WorkspaceTab {
  return {
    id,
    title,
    href,
    closable: true,
    pinned: false,
    customTitle: title,
    createdAt: options.createdAt ?? 1,
    lastVisitedAt: options.lastVisitedAt ?? 1,
    order: options.order ?? 0,
    ...options,
  };
}

function createRecentWorkspace(
  href: string,
  customTitle: string,
  lastVisitedAt: number
): RecentWorkspace {
  return {
    href,
    customTitle,
    lastVisitedAt,
  };
}

describe("WorkspaceTabs", () => {
  beforeEach(() => {
    pushMock.mockReset();
    prefetchMock.mockReset();
    mockToastDestructiveAction.mockReset();
    pathnameValue = "/patients/patient-1";
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });
    window.localStorage.clear();

    useAuthStore.setState({
      userId: "user-a",
      hydrated: true,
    });
    useLanguageStore.setState({
      language: "en",
      hydrated: true,
    });
  });

  it("moves overflow tabs into the More menu and navigates when selected", async () => {
    pathnameValue = "/patients/patient-3/heart-sound";
    const tabs = [
      createTab("tab-1", "Pinned home", "/patients/patient-1", {
        pinned: true,
        closable: false,
        customTitle: null,
        order: 0,
        lastVisitedAt: 100,
      }),
      createTab("tab-2", "Ward round", "/patients/patient-2", {
        order: 1,
        lastVisitedAt: 700,
      }),
      createTab("tab-3", "Heart review", "/patients/patient-3/heart-sound", {
        order: 2,
        lastVisitedAt: 650,
      }),
      createTab("tab-4", "Dense notes", "/patients/patient-3/dense", {
        order: 3,
        lastVisitedAt: 600,
      }),
      createTab("tab-5", "Patient five", "/patients/patient-5", {
        order: 4,
        lastVisitedAt: 550,
      }),
      createTab("tab-6", "Patient six", "/patients/patient-6", {
        order: 5,
        lastVisitedAt: 200,
      }),
    ];

    useWorkspaceTabsStore.setState({
      hydrated: true,
      tabs,
      recentWorkspaces: tabs.map((tab) =>
        createRecentWorkspace(tab.href, tab.customTitle ?? tab.title, tab.lastVisitedAt)
      ),
      activeTabId: "tab-3",
      homeHref: "/patients/patient-1",
      ownerUserId: "user-a",
    });

    render(<WorkspaceTabs />);

    expect(
      screen.getByRole("tab", { name: /Patient Workspace/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Heart review/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Patient six/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /More \(1\)/i }));

    expect(screen.getByText("Patient six")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Patient six"));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/patients/patient-6");
    });
  });

  it("reduces visible tabs on narrower desktop widths so the More control stays reachable", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 980,
    });
    window.dispatchEvent(new Event("resize"));

    pathnameValue = "/patients/patient-3/heart-sound";
    const tabs = [
      createTab("tab-1", "Pinned home", "/patients/patient-1", {
        pinned: true,
        closable: false,
        customTitle: null,
        order: 0,
        lastVisitedAt: 100,
      }),
      createTab("tab-2", "Ward round", "/patients/patient-2", {
        order: 1,
        lastVisitedAt: 700,
      }),
      createTab("tab-3", "Heart review", "/patients/patient-3/heart-sound", {
        order: 2,
        lastVisitedAt: 650,
      }),
      createTab("tab-4", "Dense notes", "/patients/patient-3/dense", {
        order: 3,
        lastVisitedAt: 600,
      }),
      createTab("tab-5", "Patient five", "/patients/patient-5", {
        order: 4,
        lastVisitedAt: 550,
      }),
      createTab("tab-6", "Patient six", "/patients/patient-6", {
        order: 5,
        lastVisitedAt: 200,
      }),
    ];

    useWorkspaceTabsStore.setState({
      hydrated: true,
      tabs,
      recentWorkspaces: tabs.map((tab) =>
        createRecentWorkspace(
          tab.href,
          tab.customTitle ?? tab.title,
          tab.lastVisitedAt
        )
      ),
      activeTabId: "tab-3",
      homeHref: "/patients/patient-1",
      ownerUserId: "user-a",
    });

    render(<WorkspaceTabs />);

    expect(screen.getByRole("button", { name: /More \(2\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Patient five/i })).not.toBeInTheDocument();
  });

  it("renders the language control in the workspace tabs row and updates the preference", async () => {
    const tabs = [
      createTab("tab-1", "Pinned home", "/patients/patient-1", {
        pinned: true,
        closable: false,
        customTitle: null,
        order: 0,
        lastVisitedAt: 100,
      }),
      createTab("tab-2", "Ward round", "/patients/patient-2", {
        order: 1,
        lastVisitedAt: 700,
      }),
    ];

    useWorkspaceTabsStore.setState({
      hydrated: true,
      tabs,
      recentWorkspaces: tabs.map((tab) =>
        createRecentWorkspace(
          tab.href,
          tab.customTitle ?? tab.title,
          tab.lastVisitedAt
        )
      ),
      activeTabId: "tab-2",
      homeHref: "/patients/patient-1",
      ownerUserId: "user-a",
    });

    render(<WorkspaceTabs />);

    const languageButton = document.getElementById("header-language-button");

    expect(languageButton).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /english/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /english/i }));
    fireEvent.click(screen.getByText("ไทย"));

    await waitFor(() => {
      expect(useLanguageStore.getState().language).toBe("th");
    });
  });

  it("shows recent workspaces in configure dialog and clears the current user's workspace", async () => {
    pathnameValue = "/patients/patient-2";
    const tabs = [
      createTab("tab-1", "Pinned home", "/patients/patient-1", {
        pinned: true,
        closable: false,
        customTitle: null,
        order: 0,
        lastVisitedAt: 100,
      }),
      createTab("tab-2", "Ward round", "/patients/patient-2", {
        order: 1,
        lastVisitedAt: 700,
      }),
    ];

    useWorkspaceTabsStore.setState({
      hydrated: true,
      tabs,
      recentWorkspaces: [
        createRecentWorkspace("/patients/patient-9", "Recent patient", 900),
        createRecentWorkspace("/patients/patient-2", "Ward round", 700),
      ],
      activeTabId: "tab-2",
      homeHref: "/patients/patient-1",
      ownerUserId: "user-a",
    });

    render(<WorkspaceTabs />);

    fireEvent.contextMenu(screen.getByRole("tab", { name: /Ward round/i }));
    fireEvent.click(await screen.findByText("Configure tabs & home"));

    expect(screen.getByText("Recent workspaces")).toBeInTheDocument();
    expect(screen.getByText("Recent patient")).toBeInTheDocument();
    expect(screen.getByText("Open now")).toBeInTheDocument();
    expect(screen.getByText("Reopen")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Recent patient"));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/patients/patient-9");
    });

    fireEvent.contextMenu(screen.getByRole("tab", { name: /Ward round/i }));
    fireEvent.click(await screen.findByText("Configure tabs & home"));
    fireEvent.click(screen.getByRole("button", { name: "Clear my tabs" }));

    const clearOptions = mockToastDestructiveAction.mock.calls.at(-1)?.[1] as
      | {
          button?: {
            onClick?: () => void;
          };
        }
      | undefined;
    clearOptions?.button?.onClick?.();

    await waitFor(() => {
      expect(useWorkspaceTabsStore.getState().tabs).toEqual([]);
      expect(useWorkspaceTabsStore.getState().recentWorkspaces).toEqual([]);
    });
  });

  it("returns focus to the invoking tab when the configure dialog closes", async () => {
    pathnameValue = "/patients/patient-2";
    const tabs = [
      createTab("tab-1", "Pinned home", "/patients/patient-1", {
        pinned: true,
        closable: false,
        customTitle: null,
        order: 0,
        lastVisitedAt: 100,
      }),
      createTab("tab-2", "Ward round", "/patients/patient-2", {
        order: 1,
        lastVisitedAt: 700,
      }),
    ];

    useWorkspaceTabsStore.setState({
      hydrated: true,
      tabs,
      recentWorkspaces: [
        createRecentWorkspace("/patients/patient-2", "Ward round", 700),
      ],
      activeTabId: "tab-2",
      homeHref: "/patients/patient-1",
      ownerUserId: "user-a",
    });

    render(<WorkspaceTabs />);

    const wardRoundTab = screen.getByRole("tab", { name: /Ward round/i });
    wardRoundTab.focus();

    fireEvent.contextMenu(wardRoundTab);
    fireEvent.click(await screen.findByText("Configure tabs & home"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(wardRoundTab).toHaveFocus();
    });
  });

  it("opens the clear-workspace confirmation toast from the clear action", async () => {
    pathnameValue = "/patients/patient-2";
    const tabs = [
      createTab("tab-1", "Pinned home", "/patients/patient-1", {
        pinned: true,
        closable: false,
        customTitle: null,
        order: 0,
        lastVisitedAt: 100,
      }),
      createTab("tab-2", "Ward round", "/patients/patient-2", {
        order: 1,
        lastVisitedAt: 700,
      }),
    ];

    useWorkspaceTabsStore.setState({
      hydrated: true,
      tabs,
      recentWorkspaces: [
        createRecentWorkspace("/patients/patient-9", "Recent patient", 900),
        createRecentWorkspace("/patients/patient-2", "Ward round", 700),
      ],
      activeTabId: "tab-2",
      homeHref: "/patients/patient-1",
      ownerUserId: "user-a",
    });

    render(<WorkspaceTabs />);

    fireEvent.contextMenu(screen.getByRole("tab", { name: /Ward round/i }));
    fireEvent.click(await screen.findByText("Configure tabs & home"));

    const clearButton = screen.getByRole("button", { name: "Clear my tabs" });
    clearButton.focus();
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockToastDestructiveAction).toHaveBeenCalledWith(
        "Clear your workspace tabs?",
        expect.objectContaining({
          description:
            "This will remove your open tabs and recent workspaces for this account on this browser.",
        })
      );
      expect(clearButton).toHaveFocus();
    });
  });
});
