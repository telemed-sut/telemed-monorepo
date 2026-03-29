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

    useWorkspaceTabsStore.getState().hydrate("en", "/patients");

    const state = useWorkspaceTabsStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it("opens and activates a workspace tab for nested patient routes", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123");

    const state = useWorkspaceTabsStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

    expect(state.tabs).toHaveLength(1);
    expect(activeTab).toMatchObject({
      href: "/patients/abc-123",
      title: "Patient Workspace",
      closable: true,
    });
  });

  it("keeps a custom tab name across route resync for workspace routes", async () => {
    const useWorkspaceTabsStore = await loadWorkspaceTabsStore();

    useWorkspaceTabsStore
      .getState()
      .hydrate("en", "/patients/abc-123");
    const workspaceTab = useWorkspaceTabsStore.getState().tabs[0];

    expect(workspaceTab).toBeTruthy();

    useWorkspaceTabsStore
      .getState()
      .renameTab(workspaceTab!.id, "Ward round", "en");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("th", "/patients/abc-123");

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
      .hydrate("en", "/patients/abc-123");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/heart-sound");
    useWorkspaceTabsStore
      .getState()
      .syncCurrentRoute("en", "/patients/abc-123/dense");

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
      .hydrate("en", "/patients/abc-123/dense");

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
      .hydrate("en", "/patients/abc-123");

    const nextTab = useWorkspaceTabsStore
      .getState()
      .resetTabs("en", "/patients");

    expect(nextTab).toBeNull();
    expect(useWorkspaceTabsStore.getState().tabs).toEqual([]);
    expect(useWorkspaceTabsStore.getState().activeTabId).toBeNull();
  });
});
