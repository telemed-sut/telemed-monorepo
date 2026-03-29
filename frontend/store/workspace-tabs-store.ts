import { create } from "zustand";

import {
  DASHBOARD_HOME_HREF,
  getDashboardPageTitle,
  isWorkspaceTabRoute,
  normalizeDashboardHref,
} from "@/components/dashboard/dashboard-route-utils";
import type { AppLanguage } from "@/store/language-config";

const WORKSPACE_TABS_STORAGE_KEY = "workspace_tabs_state_v1";

export interface WorkspaceTab {
  id: string;
  title: string;
  href: string;
  closable: boolean;
  pinned: boolean;
  customTitle: string | null;
  createdAt: number;
  order: number;
}

interface WorkspaceTabsSnapshot {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  homeHref: string;
}

interface WorkspaceTabsState extends WorkspaceTabsSnapshot {
  hydrated: boolean;
  hydrate: (language: AppLanguage, currentHref: string) => void;
  syncCurrentRoute: (language: AppLanguage, currentHref: string) => void;
  activateTab: (tabId: string) => void;
  setTabOrder: (orderedTabIds: string[]) => void;
  reorderTabs: (
    sourceTabId: string,
    targetTabId: string,
    position: "before" | "after"
  ) => void;
  setHomeHref: (href: string, language: AppLanguage) => WorkspaceTab | null;
  pinTab: (tabId: string) => void;
  duplicateTab: (tabId: string, language: AppLanguage) => WorkspaceTab | null;
  renameTab: (tabId: string, nextTitle: string, language: AppLanguage) => void;
  closeTab: (tabId: string) => WorkspaceTab | null;
  closeTabsToLeft: (tabId: string) => WorkspaceTab | null;
  closeTabsToRight: (tabId: string) => WorkspaceTab | null;
  resetTabs: (language: AppLanguage, currentHref: string) => WorkspaceTab | null;
}

function createTab(
  href: string,
  language: AppLanguage,
  options: Partial<
    Pick<
      WorkspaceTab,
      "closable" | "pinned" | "customTitle" | "title" | "order"
    >
  > = {}
): WorkspaceTab {
  const normalizedHref = normalizeDashboardHref(href);
  const customTitle = options.customTitle?.trim() || null;
  const title =
    customTitle ??
    options.title?.trim() ??
    getDashboardPageTitle(normalizedHref, language);
  const now = Date.now();

  return {
    id: `tab_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    href: normalizedHref,
    closable: options.closable ?? normalizedHref !== DASHBOARD_HOME_HREF,
    pinned: options.pinned ?? normalizedHref === DASHBOARD_HOME_HREF,
    customTitle,
    createdAt: now,
    order: options.order ?? now,
  };
}

function sortTabs(tabs: WorkspaceTab[]): WorkspaceTab[] {
  return [...tabs].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.createdAt - right.createdAt;
  });
}

function assignTabOrders(tabs: WorkspaceTab[]): WorkspaceTab[] {
  return tabs.map((tab, index) => ({
    ...tab,
    order: index,
  }));
}

function getNextTabOrder(tabs: WorkspaceTab[]): number {
  if (tabs.length === 0) {
    return 0;
  }

  return Math.max(...tabs.map((tab) => tab.order)) + 1;
}

function sanitizeTabs(
  tabs: WorkspaceTab[] | undefined,
  language: AppLanguage,
  homeHref: string
): WorkspaceTab[] {
  const normalizedHomeHref = normalizeDashboardHref(homeHref);

  return assignTabOrders(
    sortTabs(
    (tabs ?? [])
      .filter((tab): tab is WorkspaceTab => Boolean(tab?.id && tab?.href))
      .map((tab, index) => {
        const normalizedHref = normalizeDashboardHref(tab.href);

        if (!isWorkspaceTabRoute(normalizedHref)) {
          return null;
        }

        const customTitle = tab.customTitle?.trim() || null;

        return {
          ...tab,
          href: normalizedHref,
          customTitle,
          title: customTitle ?? getDashboardPageTitle(normalizedHref, language),
          pinned: tab.pinned || normalizedHref === normalizedHomeHref,
          closable: normalizedHref === normalizedHomeHref ? false : true,
          createdAt:
            typeof tab.createdAt === "number" && Number.isFinite(tab.createdAt)
              ? tab.createdAt
              : Date.now(),
          order:
            typeof tab.order === "number" && Number.isFinite(tab.order)
              ? tab.order
              : index,
          };
        })
      .filter((tab): tab is WorkspaceTab => Boolean(tab))
    )
  );
}

function readSnapshot(): WorkspaceTabsSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as WorkspaceTabsSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: WorkspaceTabsSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      WORKSPACE_TABS_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // Ignore storage write failures and keep the in-memory tab state usable.
  }
}

function ensureHomeTab(
  tabs: WorkspaceTab[],
  homeHref: string,
  language: AppLanguage
): WorkspaceTab[] {
  const normalizedHomeHref = normalizeDashboardHref(homeHref);
  if (!isWorkspaceTabRoute(normalizedHomeHref)) {
    return assignTabOrders(sortTabs(tabs));
  }
  const existingHomeTab = tabs.find((tab) => tab.href === normalizedHomeHref);

  if (existingHomeTab) {
    return assignTabOrders(
      sortTabs(
      tabs.map((tab) =>
        tab.id === existingHomeTab.id
          ? {
              ...tab,
              title: tab.customTitle ?? getDashboardPageTitle(normalizedHomeHref, language),
              pinned: true,
              closable: false,
            }
          : tab
      )
      )
    );
  }

  return assignTabOrders(sortTabs([
    createTab(normalizedHomeHref, language, {
      closable: false,
      pinned: true,
      order: getNextTabOrder(tabs),
    }),
    ...tabs,
  ]));
}

function ensureCurrentTab(
  tabs: WorkspaceTab[],
  currentHref: string,
  language: AppLanguage,
  homeHref: string
): WorkspaceTab[] {
  const normalizedCurrentHref = normalizeDashboardHref(currentHref);
  if (!isWorkspaceTabRoute(normalizedCurrentHref)) {
    return assignTabOrders(sortTabs(tabs));
  }
  const existingTab = tabs.find((tab) => tab.href === normalizedCurrentHref);

  if (existingTab) {
    return assignTabOrders(
      sortTabs(
      tabs.map((tab) =>
        tab.id === existingTab.id
          ? {
              ...tab,
              title: tab.customTitle ?? getDashboardPageTitle(normalizedCurrentHref, language),
              pinned: tab.pinned || normalizedCurrentHref === homeHref,
              closable: normalizedCurrentHref === homeHref ? false : true,
            }
          : tab
      )
      )
    );
  }

  return assignTabOrders(sortTabs([
    ...tabs,
    createTab(normalizedCurrentHref, language, {
      closable: normalizedCurrentHref !== homeHref,
      pinned: normalizedCurrentHref === homeHref,
      order: getNextTabOrder(tabs),
    }),
  ]));
}

function refreshTabTitles(
  tabs: WorkspaceTab[],
  language: AppLanguage,
  homeHref: string
): WorkspaceTab[] {
  return assignTabOrders(
    sortTabs(
    tabs.map((tab) => {
      const normalizedHref = normalizeDashboardHref(tab.href);
      if (!isWorkspaceTabRoute(normalizedHref)) {
        return null;
      }

      return {
        ...tab,
        href: normalizedHref,
        title: tab.customTitle ?? getDashboardPageTitle(normalizedHref, language),
        pinned: tab.pinned || normalizedHref === homeHref,
        closable: normalizedHref === homeHref ? false : true,
      };
    })
    .filter((tab): tab is WorkspaceTab => Boolean(tab))
    )
  );
}

function getNextActiveTab(
  tabs: WorkspaceTab[],
  removedTabId: string,
  fallbackTabId: string | null
): WorkspaceTab | null {
  if (tabs.length === 0) {
    return null;
  }

  const fallbackTab = fallbackTabId
    ? tabs.find((tab) => tab.id === fallbackTabId) ?? null
    : null;

  if (fallbackTab) {
    return fallbackTab;
  }

  const orderedTabs = sortTabs(tabs);
  const previousIndex = orderedTabs.findIndex((tab) => tab.id === removedTabId);
  const effectiveIndex =
    previousIndex === -1 ? orderedTabs.length - 1 : Math.min(previousIndex, orderedTabs.length - 1);

  return orderedTabs[effectiveIndex] ?? orderedTabs[orderedTabs.length - 1] ?? null;
}

function reorderTabList(
  tabs: WorkspaceTab[],
  sourceTabId: string,
  targetTabId: string,
  position: "before" | "after"
): WorkspaceTab[] {
  if (sourceTabId === targetTabId) {
    return tabs;
  }

  const orderedTabs = sortTabs(tabs);
  const sourceTab = orderedTabs.find((tab) => tab.id === sourceTabId);
  const targetTab = orderedTabs.find((tab) => tab.id === targetTabId);

  if (!sourceTab || !targetTab || sourceTab.pinned !== targetTab.pinned) {
    return tabs;
  }

  const tabsWithoutSource = orderedTabs.filter((tab) => tab.id !== sourceTabId);
  const targetIndex = tabsWithoutSource.findIndex((tab) => tab.id === targetTabId);

  if (targetIndex === -1) {
    return tabs;
  }

  const insertionIndex = position === "after" ? targetIndex + 1 : targetIndex;
  tabsWithoutSource.splice(insertionIndex, 0, sourceTab);

  return assignTabOrders(tabsWithoutSource);
}

function applyTabOrder(
  tabs: WorkspaceTab[],
  orderedTabIds: string[]
): WorkspaceTab[] {
  if (orderedTabIds.length !== tabs.length) {
    return tabs;
  }

  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const orderedTabs = orderedTabIds
    .map((tabId) => tabsById.get(tabId) ?? null)
    .filter((tab): tab is WorkspaceTab => Boolean(tab));

  if (orderedTabs.length !== tabs.length) {
    return tabs;
  }

  let hasSeenUnpinnedTab = false;
  for (const tab of orderedTabs) {
    if (!tab.pinned) {
      hasSeenUnpinnedTab = true;
      continue;
    }

    if (hasSeenUnpinnedTab) {
      return tabs;
    }
  }

  return assignTabOrders(orderedTabs);
}

function persistState(state: WorkspaceTabsSnapshot) {
  writeSnapshot({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    homeHref: state.homeHref,
  });
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set, get) => ({
  hydrated: false,
  tabs: [],
  activeTabId: null,
  homeHref: DASHBOARD_HOME_HREF,
  hydrate: (language, currentHref) => {
    if (get().hydrated) {
      get().syncCurrentRoute(language, currentHref);
      return;
    }

    const storedSnapshot = readSnapshot();
    const homeHref = normalizeDashboardHref(
      storedSnapshot?.homeHref ?? DASHBOARD_HOME_HREF
    );
    let tabs = sanitizeTabs(storedSnapshot?.tabs, language, homeHref);
    tabs = ensureHomeTab(tabs, homeHref, language);
    tabs = ensureCurrentTab(tabs, currentHref, language, homeHref);

    const normalizedCurrentHref = normalizeDashboardHref(currentHref);
    const preferredActiveTab =
      isWorkspaceTabRoute(normalizedCurrentHref)
        ? tabs.find((tab) => tab.href === normalizedCurrentHref) ??
          tabs.find((tab) => tab.id === storedSnapshot?.activeTabId) ??
          tabs[0] ??
          null
        : null;

    const nextState = {
      hydrated: true,
      tabs,
      activeTabId: preferredActiveTab?.id ?? null,
      homeHref,
    };

    persistState(nextState);
    set(nextState);
  },
  syncCurrentRoute: (language, currentHref) => {
    if (!get().hydrated) {
      get().hydrate(language, currentHref);
      return;
    }

    const normalizedCurrentHref = normalizeDashboardHref(currentHref);
    const homeHref = normalizeDashboardHref(get().homeHref);
    let tabs = refreshTabTitles(get().tabs, language, homeHref);
    tabs = ensureHomeTab(tabs, homeHref, language);
    tabs = ensureCurrentTab(tabs, normalizedCurrentHref, language, homeHref);

    const activeTab =
      isWorkspaceTabRoute(normalizedCurrentHref)
        ? tabs.find((tab) => tab.href === normalizedCurrentHref) ??
          tabs.find(
            (tab) =>
              tab.id === get().activeTabId &&
              isWorkspaceTabRoute(tab.href)
          ) ??
          tabs[0] ??
          null
        : null;

    const nextState = {
      tabs,
      activeTabId: activeTab?.id ?? null,
      homeHref,
    };

    persistState(nextState);
    set(nextState);
  },
  activateTab: (tabId) => {
    const state = get();
    if (!state.tabs.some((tab) => tab.id === tabId)) {
      return;
    }

    const nextState = {
      tabs: state.tabs,
      activeTabId: tabId,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set({ activeTabId: tabId });
  },
  setTabOrder: (orderedTabIds) => {
    const state = get();
    const tabs = applyTabOrder(state.tabs, orderedTabIds);

    if (
      tabs.length === state.tabs.length &&
      tabs.every((tab, index) => tab.id === state.tabs[index]?.id)
    ) {
      return;
    }

    const nextState = {
      tabs,
      activeTabId: state.activeTabId,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set({ tabs });
  },
  reorderTabs: (sourceTabId, targetTabId, position) => {
    const state = get();
    const tabs = reorderTabList(state.tabs, sourceTabId, targetTabId, position);

    if (
      tabs.length === state.tabs.length &&
      tabs.every((tab, index) => tab.id === state.tabs[index]?.id)
    ) {
      return;
    }

    const nextState = {
      tabs,
      activeTabId: state.activeTabId,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set({ tabs });
  },
  setHomeHref: (href, language) => {
    const normalizedHomeHref = normalizeDashboardHref(href);
    let selectedTab: WorkspaceTab | null = null;

    set((state) => {
      let tabs = refreshTabTitles(state.tabs, language, normalizedHomeHref).map(
        (tab) => ({
          ...tab,
          pinned: tab.pinned || tab.href === normalizedHomeHref,
          closable: tab.href === normalizedHomeHref ? false : true,
        })
      );

      tabs = ensureHomeTab(tabs, normalizedHomeHref, language);
      selectedTab = tabs.find((tab) => tab.href === normalizedHomeHref) ?? null;

      const nextState = {
        tabs,
        activeTabId: state.activeTabId,
        homeHref: normalizedHomeHref,
      };

      persistState(nextState);
      return nextState;
    });

    return selectedTab;
  },
  pinTab: (tabId) => {
    const state = get();
    const sourceTab = state.tabs.find((tab) => tab.id === tabId);
    if (!sourceTab) {
      return;
    }

    const tabs = assignTabOrders(
      sortTabs(
      state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              pinned: tab.href === state.homeHref ? true : !tab.pinned,
              order: getNextTabOrder(state.tabs),
            }
          : tab
      )
      )
    );

    const nextState = {
      tabs,
      activeTabId: state.activeTabId,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set({ tabs });
  },
  duplicateTab: (tabId, language) => {
    const state = get();
    const sourceTab = state.tabs.find((tab) => tab.id === tabId);
    if (!sourceTab) {
      return null;
    }

    const duplicate = createTab(sourceTab.href, language, {
      title: sourceTab.title.endsWith("Copy")
        ? sourceTab.title
        : `${sourceTab.title} Copy`,
      customTitle:
        sourceTab.customTitle?.trim() ||
        (sourceTab.title.endsWith("Copy")
          ? sourceTab.title
          : `${sourceTab.title} Copy`),
      closable: sourceTab.href !== state.homeHref,
      pinned: false,
    });

    const tabs = assignTabOrders(sortTabs([
      ...state.tabs,
      {
        ...duplicate,
        order: getNextTabOrder(state.tabs),
      },
    ]));
    const nextState = {
      tabs,
      activeTabId: duplicate.id,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set(nextState);

    return duplicate;
  },
  renameTab: (tabId, nextTitle, language) => {
    const trimmedTitle = nextTitle.trim();
    const state = get();

    const tabs = state.tabs.map((tab) => {
      if (tab.id !== tabId) {
        return tab;
      }

      const derivedTitle = getDashboardPageTitle(tab.href, language);

      return {
        ...tab,
        customTitle: trimmedTitle || null,
        title: trimmedTitle || derivedTitle,
      };
    });

    const nextState = {
      tabs,
      activeTabId: state.activeTabId,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set({ tabs });
  },
  closeTab: (tabId) => {
    const state = get();
    const closingTab = state.tabs.find((tab) => tab.id === tabId);
    if (!closingTab || !closingTab.closable) {
      return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
    }

    const remainingTabs = assignTabOrders(
      state.tabs.filter((tab) => tab.id !== tabId)
    );
    const fallbackActiveTabId =
      state.activeTabId === tabId ? null : state.activeTabId;
    const nextActiveTab = getNextActiveTab(
      remainingTabs,
      tabId,
      fallbackActiveTabId
    );
    const nextState = {
      tabs: remainingTabs,
      activeTabId: nextActiveTab?.id ?? null,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set(nextState);

    return nextActiveTab;
  },
  closeTabsToLeft: (tabId) => {
    const state = get();
    const orderedTabs = sortTabs(state.tabs);
    const targetIndex = orderedTabs.findIndex((tab) => tab.id === tabId);
    if (targetIndex <= 0) {
      return orderedTabs.find((tab) => tab.id === state.activeTabId) ?? null;
    }

    const tabs = assignTabOrders(orderedTabs.filter((tab, index) => {
      if (index >= targetIndex) {
        return true;
      }

      return !tab.closable;
    }));

    const nextActiveTab =
      tabs.find((tab) => tab.id === state.activeTabId) ??
      tabs.find((tab) => tab.id === tabId) ??
      tabs[0] ??
      null;

    const nextState = {
      tabs,
      activeTabId: nextActiveTab?.id ?? null,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set(nextState);

    return nextActiveTab;
  },
  closeTabsToRight: (tabId) => {
    const state = get();
    const orderedTabs = sortTabs(state.tabs);
    const targetIndex = orderedTabs.findIndex((tab) => tab.id === tabId);
    if (targetIndex === -1 || targetIndex === orderedTabs.length - 1) {
      return orderedTabs.find((tab) => tab.id === state.activeTabId) ?? null;
    }

    const tabs = assignTabOrders(orderedTabs.filter((tab, index) => {
      if (index <= targetIndex) {
        return true;
      }

      return !tab.closable;
    }));

    const nextActiveTab =
      tabs.find((tab) => tab.id === state.activeTabId) ??
      tabs.find((tab) => tab.id === tabId) ??
      tabs[tabs.length - 1] ??
      null;

    const nextState = {
      tabs,
      activeTabId: nextActiveTab?.id ?? null,
      homeHref: state.homeHref,
    };

    persistState(nextState);
    set(nextState);

    return nextActiveTab;
  },
  resetTabs: (language, currentHref) => {
    const homeHref = normalizeDashboardHref(get().homeHref);
    const normalizedCurrentHref = normalizeDashboardHref(currentHref);
    const currentTab = isWorkspaceTabRoute(normalizedCurrentHref)
      ? createTab(currentHref, language, {
          closable: true,
          pinned: false,
        })
      : null;
    const tabs = currentTab
      ? assignTabOrders([currentTab])
      : [];
    const nextState = {
      tabs,
      activeTabId: currentTab?.id ?? null,
      homeHref,
    };

    persistState(nextState);
    set({
      hydrated: true,
      ...nextState,
    });

    return currentTab;
  },
}));
