import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadWorkspaceTabsStore() {
  vi.resetModules();
  const workspaceTabsModule = await import("@/store/workspace-tabs-store");
  return workspaceTabsModule.useWorkspaceTabsStore;
}

describe("workspace tabs store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("does not create top tabs for sidebar routes", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore.getState().hydrate("en", "/patients", "user-a");

    const state = useWorkspaceTabsStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it("opens and activates a workspace tab for nested patient routes", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");

    const state = useWorkspaceTabsStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

    expect(state.tabs).toHaveLength(1);
    expect(activeTab).toMatchObject({
      href: "/patients/abc-123",
      title: "Patient Workspace",
      closable: true,
    });
    expect(state.recentWorkspaces).toEqual([
      expect.objectContaining({
        href: "/patients/abc-123",
      }),
    ]);
  });

  it("keeps a custom tab name across route resync for workspace routes", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");
    const workspaceTab = useWorkspaceTabsStore.getState().tabs[0];

    expect(workspaceTab).toBeTruthy();

    useWorkspaceTabsStore
      .getState()
      .renameTab(workspaceTab!.id, "Ward round", "en");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("th", "/patients/abc-123", "user-a");

    const renamedTab = useWorkspaceTabsStore
      .getState()
      .tabs.find((tab) => tab.id === workspaceTab!.id);

    expect(renamedTab?.title).toBe("Ward round");
    expect(renamedTab?.customTitle).toBe("Ward round");
  });

  it("reorders workspace tabs and keeps the order after hydrate", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/heart-sound", "user-a");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/dense", "user-a");

    const stateBeforeReorder = useWorkspaceTabsStore.getState();
    const workspaceTab = stateBeforeReorder.tabs.find(
      (tab) => tab.href === "/patients/abc-123"
    );
    const heartSoundTab = stateBeforeReorder.tabs.find(
      (tab) => tab.href === "/patients/abc-123/heart-sound"
    );

    expect(workspaceTab).toBeTruthy();
    expect(heartSoundTab).toBeTruthy();

    useWorkspaceTabsStore
      .getState()
      .reorderTabs(heartSoundTab!.id, workspaceTab!.id, "before");

    expect(useWorkspaceTabsStore.getState().tabs.map((tab) => tab.href)).toEqual([
      "/patients/abc-123/heart-sound",
      "/patients/abc-123",
      "/patients/abc-123/dense",
    ]);

    const reloadedStore = await loadWorkspaceTabsStore();
    reloadedStore
      .getState()
      .hydrate("en", "/patients/abc-123/dense", "user-a");

    expect(reloadedStore.getState().tabs.map((tab) => tab.href)).toEqual([
      "/patients/abc-123/heart-sound",
      "/patients/abc-123",
      "/patients/abc-123/dense",
    ]);
  });

  it("resets tabs back to empty when the current route is a sidebar page", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");

    const nextTab = useWorkspaceTabsStore
      .getState()
      .resetTabs("en", "/patients", "user-a");

    expect(nextTab).toBeNull();
    expect(useWorkspaceTabsStore.getState().tabs).toEqual([]);
    expect(useWorkspaceTabsStore.getState().activeTabId).toBeNull();
  });

  it("does not reuse tabs from a different signed-in user", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/heart-sound", "user-a");

    const reloadedStore = await loadWorkspaceTabsStore();
    reloadedStore
      .getState()
      .hydrate("en", "/patients/xyz-789", "user-b");

    expect(reloadedStore.getState().tabs.map((tab) => tab.href)).toEqual([
      "/patients/xyz-789",
    ]);
    expect(reloadedStore.getState().ownerUserId).toBe("user-b");

    reloadedStore
      .getState()
      .syncCurrentRoute("en", "/patients/xyz-789/heart-sound", "user-b");

    const userAReloadedStore = await loadWorkspaceTabsStore();
    userAReloadedStore
      .getState()
      .hydrate("en", "/patients/abc-123/dense", "user-a");

    expect(userAReloadedStore.getState().tabs.map((tab) => tab.href)).toEqual([
      "/patients/abc-123",
      "/patients/abc-123/heart-sound",
      "/patients/abc-123/dense",
    ]);
    expect(userAReloadedStore.getState().ownerUserId).toBe("user-a");
  });

  it("uses lastVisitedAt when deciding which remembered tab to evict", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-02T03:00:00Z"));

      for (let index = 1; index <= 11; index += 1) {
        const href = `/patients/patient-${index}`;

        if (index === 1) {
          useWorkspaceTabsStore.getState().hydrate("en", href, "user-a");
          continue;
        }

        useWorkspaceTabsStore
          .getState()
          .syncCurrentRoute("en", href, "user-a");

        vi.advanceTimersByTime(60_000);
      }

      useWorkspaceTabsStore
        .getState()
        .activateTab(
          useWorkspaceTabsStore
            .getState()
            .tabs.find((tab) => tab.href === "/patients/patient-1")!.id
        );

      expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(11);

      const reloadedStore = await loadWorkspaceTabsStore();
      reloadedStore
        .getState()
        .hydrate("en", "/patients/patient-11", "user-a");

      expect(reloadedStore.getState().tabs).toHaveLength(10);
      expect(reloadedStore.getState().tabs.map((tab) => tab.href)).not.toContain(
        "/patients/patient-2"
      );
      expect(reloadedStore.getState().tabs.map((tab) => tab.href)).toContain(
        "/patients/patient-11"
      );
      expect(reloadedStore.getState().tabs.map((tab) => tab.href)).toContain(
        "/patients/patient-1"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps recent workspaces after a tab is closed", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/heart-sound", "user-a");

    const heartSoundTab = useWorkspaceTabsStore
      .getState()
      .tabs.find((tab) => tab.href === "/patients/abc-123/heart-sound");

    expect(heartSoundTab).toBeTruthy();

    useWorkspaceTabsStore.getState().closeTab(heartSoundTab!.id);

    expect(
      useWorkspaceTabsStore.getState().recentWorkspaces.map((tab) => tab.href)
    ).toContain("/patients/abc-123/heart-sound");
  });

  it("clears tabs and history only for the selected user", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123", "user-a");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/heart-sound", "user-a");

    const userBStore = await loadWorkspaceTabsStore();
    userBStore
      .getState()
      .hydrate("en", "/patients/xyz-789", "user-b");

    const userAReloadedStore = await loadWorkspaceTabsStore();
    userAReloadedStore
      .getState()
      .hydrate("en", "/patients/abc-123/heart-sound", "user-a");
    userAReloadedStore.getState().clearAllTabsForUser("user-a");

    expect(userAReloadedStore.getState().tabs).toEqual([]);
    expect(userAReloadedStore.getState().recentWorkspaces).toEqual([]);

    const userBReloadedStore = await loadWorkspaceTabsStore();
    userBReloadedStore
      .getState()
      .hydrate("en", "/patients/xyz-789", "user-b");

    expect(userBReloadedStore.getState().tabs.map((tab) => tab.href)).toEqual([
      "/patients/xyz-789",
    ]);
    expect(
      userBReloadedStore.getState().recentWorkspaces.map((tab) => tab.href)
    ).toContain("/patients/xyz-789");
  });
});
