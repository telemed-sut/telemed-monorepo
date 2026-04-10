"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Check,
  Clock3,
  HeartPulse,
  Languages,
  MoreHorizontal,
  Pin,
  TriangleAlert,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  getDashboardPageTitle,
  normalizeDashboardHref,
} from "@/components/dashboard/dashboard-route-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { APP_LANGUAGE_OPTIONS, APP_LOCALE_MAP } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";
import type {
  RecentWorkspace,
  WorkspaceTab,
} from "@/store/workspace-tabs-store";
import { useWorkspaceTabsStore } from "@/store/workspace-tabs-store";

import { WorkspaceTabContextMenu } from "@/components/dashboard/tab-context-menu";

const labels = {
  en: {
    renameTitle: "Rename tab",
    renameDescription: "Use a custom label for this tab without changing the underlying route.",
    renameLabel: "Tab name",
    renamePlaceholder: "Enter a tab name",
    save: "Save",
    cancel: "Cancel",
    configureTitle: "Configure tabs & home",
    configureDescription: "Choose which open tab should act as your home tab and reset the workspace if needed.",
    chooseHome: "Home tab",
    currentHome: "Current home",
    resetTabs: "Reset tabs",
    more: "More",
    hiddenTabs: "Hidden tabs",
    done: "Done",
    workspaceTabs: "Open tabs",
    pinned: "Pinned",
    language: "Language",
    recentWorkspaces: "Recent workspaces",
    recentEmpty: "No recent workspaces yet",
    recentHint: "Open a patient workspace to see it here.",
    lastOpened: "Last opened",
    clearWorkspaceTitle: "Clear my workspace tabs",
    clearWorkspaceDescription:
      "Remove this account's open tabs and remembered workspace history from this browser.",
    clearWorkspaceAction: "Clear my tabs",
    clearWorkspaceConfirmTitle: "Clear your workspace tabs?",
    clearWorkspaceConfirmDescription:
      "This will remove your open tabs and recent workspaces for this account on this browser.",
    clearWorkspaceConfirmAction: "Clear workspace",
    openNow: "Open now",
    reopen: "Reopen",
  },
  th: {
    renameTitle: "เปลี่ยนชื่อแท็บ",
    renameDescription: "ตั้งชื่อแท็บเฉพาะใน UI ได้โดยไม่กระทบ route จริง",
    renameLabel: "ชื่อแท็บ",
    renamePlaceholder: "ใส่ชื่อแท็บ",
    save: "บันทึก",
    cancel: "ยกเลิก",
    configureTitle: "ตั้งค่าแท็บและหน้าแรก",
    configureDescription: "เลือกแท็บที่เปิดอยู่ให้เป็นหน้าแรก และรีเซ็ตชุดแท็บได้จากตรงนี้",
    chooseHome: "แท็บหน้าแรก",
    currentHome: "หน้าแรกปัจจุบัน",
    resetTabs: "รีเซ็ตแท็บ",
    more: "เพิ่มเติม",
    hiddenTabs: "แท็บที่ซ่อนอยู่",
    done: "เสร็จสิ้น",
    workspaceTabs: "แท็บที่เปิดอยู่",
    pinned: "ปักหมุด",
    language: "ภาษา",
    recentWorkspaces: "พื้นที่ทำงานล่าสุด",
    recentEmpty: "ยังไม่มีพื้นที่ทำงานล่าสุด",
    recentHint: "เมื่อเปิดพื้นที่ทำงานผู้ป่วย ระบบจะแสดงไว้ที่นี่",
    lastOpened: "เปิดล่าสุด",
    clearWorkspaceTitle: "ล้างแท็บพื้นที่ทำงานของฉัน",
    clearWorkspaceDescription:
      "ลบแท็บที่เปิดอยู่และประวัติพื้นที่ทำงานของบัญชีนี้ออกจากเบราว์เซอร์นี้",
    clearWorkspaceAction: "ล้างแท็บของฉัน",
    clearWorkspaceConfirmTitle: "ล้างแท็บพื้นที่ทำงานใช่ไหม",
    clearWorkspaceConfirmDescription:
      "การทำงานนี้จะลบทั้งแท็บที่เปิดอยู่และพื้นที่ทำงานล่าสุดของบัญชีนี้ในเบราว์เซอร์นี้",
    clearWorkspaceConfirmAction: "ล้างพื้นที่ทำงาน",
    openNow: "เปิดอยู่ตอนนี้",
    reopen: "เปิดอีกครั้ง",
  },
} as const;

const MAX_VISIBLE_WORKSPACE_TABS = 5;
const MEDIUM_DESKTOP_VISIBLE_TABS = 4;
const NARROW_DESKTOP_BREAKPOINT = 1024;
const HEADER_LANGUAGE_BUTTON_ID = "header-language-button";
const CLEAR_WORKSPACE_BUTTON_ID = "clear-workspace-button";

function formatCompactWorkspaceId(value: string) {
  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getWorkspaceSecondaryLabel(
  href: string,
  language: "th" | "en"
) {
  const normalizedHref = normalizeDashboardHref(href);

  if (normalizedHref.startsWith("/patients/")) {
    const [patientId, section] = normalizedHref
      .replace("/patients/", "")
      .split("/");
    const compactPatientId = formatCompactWorkspaceId(patientId ?? "");

    if (section === "heart-sound") {
      return language === "th"
        ? `ผู้ป่วย ${compactPatientId} • เสียงหัวใจ`
        : `Patient ${compactPatientId} • Heart Sound`;
    }

    if (section === "dense") {
      return language === "th"
        ? `ผู้ป่วย ${compactPatientId} • โหมดโฟกัส`
        : `Patient ${compactPatientId} • Focus Mode`;
    }

    return language === "th"
      ? `ผู้ป่วย ${compactPatientId}`
      : `Patient ${compactPatientId}`;
  }

  if (normalizedHref.startsWith("/meetings/call/")) {
    const callId = normalizedHref.replace("/meetings/call/", "");
    const compactCallId = formatCompactWorkspaceId(callId);

    return language === "th"
      ? `สายสนทนา ${compactCallId}`
      : `Call ${compactCallId}`;
  }

  return normalizedHref;
}

function getCloseTabLabel(language: "th" | "en", title: string) {
  return language === "th" ? `ปิดแท็บ ${title}` : `Close tab ${title}`;
}

function getWorkspaceTabAppearance(href: string) {
  if (href.endsWith("/heart-sound")) {
    return {
      icon: HeartPulse,
      iconColor: "text-rose-500",
      chipTone: "bg-rose-50 border-rose-100",
    };
  }

  if (href.endsWith("/dense")) {
    return {
      icon: Activity,
      iconColor: "text-violet-500",
      chipTone: "bg-violet-50 border-violet-100",
    };
  }

  if (href.startsWith("/meetings/call/")) {
    return {
      icon: Video,
      iconColor: "text-sky-500",
      chipTone: "bg-sky-50 border-sky-100",
    };
  }

  return {
    icon: UserRound,
    iconColor: "text-emerald-500",
    chipTone: "bg-emerald-50 border-emerald-100",
  };
}

function formatRecentWorkspaceTime(
  lastVisitedAt: number,
  language: "th" | "en"
) {
  const diffSec = Math.floor((Date.now() - lastVisitedAt) / 1000);
  const rtf = new Intl.RelativeTimeFormat(APP_LOCALE_MAP[language], {
    numeric: "auto",
  });

  if (diffSec < 45) {
    return language === "th" ? "เมื่อสักครู่" : "Just now";
  }

  if (diffSec < 3600) {
    return rtf.format(-Math.floor(diffSec / 60), "minute");
  }

  if (diffSec < 86400) {
    return rtf.format(-Math.floor(diffSec / 3600), "hour");
  }

  if (diffSec < 604800) {
    return rtf.format(-Math.floor(diffSec / 86400), "day");
  }

  return new Date(lastVisitedAt).toLocaleDateString(APP_LOCALE_MAP[language]);
}

function getWorkspaceTabVisibility(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  visibleTabLimit: number
) {
  if (tabs.length <= visibleTabLimit) {
    return {
      visibleTabs: tabs,
      overflowTabs: [] as WorkspaceTab[],
    };
  }

  const visibleTabIds = new Set(
    tabs.filter((tab) => tab.pinned).map((tab) => tab.id)
  );

  if (activeTabId) {
    visibleTabIds.add(activeTabId);
  }

  const remainingSlots = Math.max(
    0,
    visibleTabLimit - visibleTabIds.size
  );

  const mostRecentUnpinnedTabs = [...tabs]
    .filter((tab) => !tab.pinned && !visibleTabIds.has(tab.id))
    .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
    .slice(0, remainingSlots);

  mostRecentUnpinnedTabs.forEach((tab) => visibleTabIds.add(tab.id));

  return {
    visibleTabs: tabs.filter((tab) => visibleTabIds.has(tab.id)),
    overflowTabs: [...tabs]
      .filter((tab) => !visibleTabIds.has(tab.id))
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt),
  };
}

function getVisibleTabLimit(viewportWidth: number) {
  return viewportWidth <= NARROW_DESKTOP_BREAKPOINT
    ? MEDIUM_DESKTOP_VISIBLE_TABS
    : MAX_VISIBLE_WORKSPACE_TABS;
}

function getWorkspaceItemMeta(
  href: string,
  language: "th" | "en",
  titleOverride?: string | null
) {
  const appearance = getWorkspaceTabAppearance(href);
  return {
    ...appearance,
    title: titleOverride?.trim() || getDashboardPageTitle(href, language),
  };
}

function WorkspaceTabChip({
  tab,
  isActive,
  language,
  pinnedLabel,
  canCloseTabsToLeft,
  canCloseTabsToRight,
  onSelect,
  onClose,
  onPrefetch,
  onRequestRename,
  onRequestConfigure,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  language: "th" | "en";
  pinnedLabel: string;
  canCloseTabsToLeft: boolean;
  canCloseTabsToRight: boolean;
  onSelect: (tab: WorkspaceTab) => void;
  onClose: (event: React.MouseEvent<HTMLButtonElement>, tab: WorkspaceTab) => void;
  onPrefetch: (href: string) => void;
  onRequestRename: (tab: WorkspaceTab) => void;
  onRequestConfigure: (tab: WorkspaceTab) => void;
}) {
  const tabAppearance = getWorkspaceTabAppearance(tab.href);
  const TabIcon = tabAppearance.icon;

  return (
    <WorkspaceTabContextMenu
      tab={tab}
      canCloseTabsToLeft={canCloseTabsToLeft}
      canCloseTabsToRight={canCloseTabsToRight}
      onRequestRename={onRequestRename}
      onRequestConfigure={() => onRequestConfigure(tab)}
    >
      <div
        className={cn(
          "group relative flex min-w-0 shrink-0 items-center rounded-t-[18px] border border-b-0 px-3 pt-2.5 pb-2 transition-[background-color,border-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          isActive
            ? "border-slate-950 bg-slate-950 shadow-[0_-1px_0_rgba(15,23,42,0.08),0_8px_18px_rgba(15,23,42,0.12)]"
            : "border-slate-200/80 bg-muted/70 text-slate-600 hover:border-slate-300 hover:bg-white hover:shadow-[0_10px_22px_rgba(15,23,42,0.08)]"
        )}
      >
        <button
          aria-controls={`workspace-tab-panel-${tab.id}`}
          aria-selected={isActive}
          className={cn(
            "flex min-w-0 cursor-pointer items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-sky-200 focus-visible:ring-offset-2",
            isActive
              ? "focus-visible:ring-offset-slate-950"
              : "focus-visible:ring-offset-white"
          )}
          id={`workspace-tab-${tab.id}`}
          role="tab"
          type="button"
          onFocus={() => onPrefetch(tab.href)}
          onMouseEnter={() => onPrefetch(tab.href)}
          onClick={() => onSelect(tab)}
        >
          <span
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow] duration-150",
              isActive
                ? "border-white/15 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                : `${tabAppearance.chipTone} group-hover:shadow-[0_8px_16px_rgba(15,23,42,0.08)]`
            )}
          >
            <TabIcon
              className={cn(
                "size-3.5",
                isActive ? "text-white" : tabAppearance.iconColor
              )}
            />
          </span>
          {tab.pinned && (
            <Pin
              aria-label={pinnedLabel}
              className={cn(
                "size-3.5 shrink-0",
                isActive ? "text-slate-300" : "text-slate-400"
              )}
            />
          )}
          <span
            className={cn(
              "max-w-[160px] truncate text-[0.95rem] font-medium transition-transform duration-150 sm:max-w-[220px]",
              isActive ? "text-white" : "text-slate-700"
            )}
          >
            {tab.title}
          </span>
        </button>

        {tab.closable && (
          <button
            aria-label={getCloseTabLabel(language, tab.title)}
            className={cn(
              "ml-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-full outline-none transition-[background-color,color,opacity,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-sky-200/90 focus-visible:ring-offset-2",
              isActive
                ? "text-slate-400 hover:bg-white/12 hover:text-white focus-visible:ring-offset-slate-950"
                : "text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100 focus-visible:ring-offset-white"
            )}
            data-tab-action="true"
            type="button"
            onClick={(event) => onClose(event, tab)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </WorkspaceTabContextMenu>
  );
}

export function WorkspaceTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const userId = useAuthStore((state) => state.userId);
  const t = labels[language];
  const {
    tabs,
    activeTabId,
    homeHref,
    ownerUserId,
    recentWorkspaces,
    hydrate,
    syncCurrentRoute,
    activateTab,
    closeTab,
    renameTab,
    setHomeHref,
    resetTabs,
    clearAllTabsForUser,
  } = useWorkspaceTabsStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      homeHref: state.homeHref,
      ownerUserId: state.ownerUserId,
      recentWorkspaces: state.recentWorkspaces,
      hydrate: state.hydrate,
      syncCurrentRoute: state.syncCurrentRoute,
      activateTab: state.activateTab,
      closeTab: state.closeTab,
      renameTab: state.renameTab,
      setHomeHref: state.setHomeHref,
      resetTabs: state.resetTabs,
      clearAllTabsForUser: state.clearAllTabsForUser,
    }))
  );
  const [renameTarget, setRenameTarget] = useState<WorkspaceTab | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [visibleTabLimit, setVisibleTabLimit] = useState(MAX_VISIBLE_WORKSPACE_TABS);
  const renameReturnFocusRef = useRef<HTMLElement | null>(null);
  const configReturnFocusRef = useRef<HTMLElement | null>(null);
  const configReturnTabIdRef = useRef<string | null>(null);
  const prefetchedTabHrefsRef = useRef<Set<string>>(new Set());
  const selectedLanguageLabel =
    APP_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ||
    APP_LANGUAGE_OPTIONS.find((option) => option.value === "en")?.label;

  useEffect(() => {
    hydrate(language, pathname, userId);
  }, [hydrate, language, pathname, userId]);

  useEffect(() => {
    tabs.forEach((tab) => {
      if (prefetchedTabHrefsRef.current.has(tab.href)) {
        return;
      }

      prefetchedTabHrefsRef.current.add(tab.href);
      router.prefetch(tab.href);
    });
  }, [router, tabs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let resizeTimeout: number | null = null;

    const updateVisibleTabLimit = () => {
      const nextLimit = getVisibleTabLimit(window.innerWidth);
      setVisibleTabLimit((currentLimit) =>
        currentLimit === nextLimit ? currentLimit : nextLimit
      );
    };
    const handleResize = () => {
      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }

      resizeTimeout = window.setTimeout(updateVisibleTabLimit, 150);
    };

    updateVisibleTabLimit();
    window.addEventListener("resize", handleResize);

    return () => {
      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }

      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const { visibleTabs, overflowTabs } = useMemo(
    () => getWorkspaceTabVisibility(tabs, activeTabId, visibleTabLimit),
    [tabs, activeTabId, visibleTabLimit]
  );
  const uniqueHomeOptions = useMemo(() => {
    const seen = new Set<string>();

    return tabs.filter((tab) => {
      if (seen.has(tab.href)) {
        return false;
      }

      seen.add(tab.href);
      return true;
    });
  }, [tabs]);
  const uniqueRecentWorkspaces = useMemo(() => {
    const seen = new Set<string>();

    return recentWorkspaces.filter((workspace) => {
      if (seen.has(workspace.href)) {
        return false;
      }

      seen.add(workspace.href);
      return true;
    });
  }, [recentWorkspaces]);

  const restoreWorkspaceFocus = (
    preferredElement: HTMLElement | null,
    preferredTabId: string | null = null
  ) => {
    window.setTimeout(() => {
      if (preferredElement?.isConnected) {
        preferredElement.focus();
        return;
      }

      if (preferredTabId) {
        const preferredTab = document.getElementById(
          `workspace-tab-${preferredTabId}`
        );
        if (preferredTab instanceof HTMLElement) {
          preferredTab.focus();
          return;
        }
      }

      if (activeTabId) {
        const activeTabElement = document.getElementById(
          `workspace-tab-${activeTabId}`
        );
        if (activeTabElement instanceof HTMLElement) {
          activeTabElement.focus();
          return;
        }
      }

      if (tabs[0]) {
        const firstTabElement = document.getElementById(
          `workspace-tab-${tabs[0].id}`
        );
        if (firstTabElement instanceof HTMLElement) {
          firstTabElement.focus();
          return;
        }
      }

      const languageButton = document.getElementById(HEADER_LANGUAGE_BUTTON_ID);
      if (languageButton instanceof HTMLElement) {
        languageButton.focus();
      }
    }, 0);
  };

  const handleTabSelect = (tab: WorkspaceTab) => {
    activateTab(tab.id);
    if (tab.href !== pathname) {
      router.push(tab.href);
    }
  };

  const handleClose = (
    event: React.MouseEvent<HTMLButtonElement>,
    tab: WorkspaceTab
  ) => {
    event.stopPropagation();
    const nextTab = closeTab(tab.id);
    if (nextTab && nextTab.href !== pathname) {
      router.push(nextTab.href);
    }
  };

  const handleRenameSubmit = () => {
    if (!renameTarget) {
      return;
    }

    renameTab(renameTarget.id, renameValue, language);
    setRenameTarget(null);
  };

  const handleRequestRename = (tab: WorkspaceTab) => {
    renameReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setRenameTarget(tab);
    setRenameValue(tab.customTitle ?? tab.title);
  };

  const handleRenameOpenChange = (open: boolean) => {
    if (open) {
      return;
    }

    setRenameTarget(null);
    restoreWorkspaceFocus(renameReturnFocusRef.current);
  };

  const handleRequestConfigure = (tab: WorkspaceTab) => {
    configReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    configReturnTabIdRef.current = tab.id;
    setConfigOpen(true);
  };

  const handleConfigOpenChange = (open: boolean) => {
    setConfigOpen(open);

    if (!open) {
      restoreWorkspaceFocus(
        configReturnFocusRef.current,
        configReturnTabIdRef.current
      );
    }
  };

  const handleHomeChange = (tab: WorkspaceTab) => {
    const nextHomeTab = setHomeHref(tab.href, language);
    if (!nextHomeTab) {
      return;
    }

    if (tab.href === pathname) {
      activateTab(nextHomeTab.id);
    }
  };

  const handleResetTabs = () => {
    const nextTab = resetTabs(language, pathname, userId);
    if (nextTab && nextTab.href !== pathname) {
      router.push(nextTab.href);
    }
    setConfigOpen(false);
  };

  const handleRecentWorkspaceSelect = (workspace: RecentWorkspace) => {
    const existingTab = tabs.find((tab) => tab.href === workspace.href) ?? null;

    if (existingTab) {
      activateTab(existingTab.id);
      if (existingTab.href !== pathname) {
        router.push(existingTab.href);
      }
      setConfigOpen(false);
      return;
    }

    if (workspace.href === pathname) {
      syncCurrentRoute(language, workspace.href, userId);
      setConfigOpen(false);
      return;
    }

    router.push(workspace.href);
    setConfigOpen(false);
  };

  const handleClearWorkspaceTabs = () => {
    clearAllTabsForUser(userId);
    setConfigOpen(false);
  };

  const requestClearWorkspaceTabs = () => {
    toast.destructiveAction(t.clearWorkspaceConfirmTitle, {
      description: t.clearWorkspaceConfirmDescription,
      button: {
        title: t.clearWorkspaceConfirmAction,
        onClick: handleClearWorkspaceTabs,
      },
    });
  };

  if (ownerUserId !== (userId?.trim() || null) || tabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="w-full border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] px-2 pt-2 sm:px-4">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1 overflow-x-auto pb-0.5">
            <div
              aria-label={t.workspaceTabs}
              className="flex min-w-max items-end gap-2 pr-2"
              role="tablist"
            >
              {visibleTabs.map((tab) => {
                const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);

                return (
                  <WorkspaceTabChip
                    key={tab.id}
                    canCloseTabsToLeft={tabs
                      .slice(0, tabIndex)
                      .some((candidate) => candidate.closable)}
                    canCloseTabsToRight={tabs
                      .slice(tabIndex + 1)
                      .some((candidate) => candidate.closable)}
                    isActive={tab.id === activeTab?.id}
                    language={language}
                    pinnedLabel={t.pinned}
                    tab={tab}
                    onClose={handleClose}
                    onPrefetch={router.prefetch}
                    onRequestConfigure={handleRequestConfigure}
                    onRequestRename={handleRequestRename}
                    onSelect={handleTabSelect}
                  />
                );
              })}
            </div>
          </div>

          {overflowTabs.length > 0 && (
            <div className="shrink-0 pb-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${t.more} (${overflowTabs.length})`}
                  className="inline-flex h-11 items-center gap-2 rounded-t-[18px] border border-b-0 border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] px-3 pt-2.5 pb-2 text-[0.92rem] font-medium text-slate-600 outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-slate-300 hover:bg-white hover:text-slate-900 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)] focus-visible:-translate-y-px focus-visible:border-slate-300 focus-visible:bg-white focus-visible:text-slate-900 focus-visible:ring-[3px] focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  type="button"
                >
                  <span className="inline-flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <MoreHorizontal className="size-4" />
                  </span>
                  <span className="hidden sm:inline">{t.more}</span>
                  <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[0.72rem] text-white shadow-[0_4px_10px_rgba(15,23,42,0.14)]">
                    {overflowTabs.length}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200/80 bg-white/98 p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)] supports-backdrop-filter:backdrop-blur-sm"
                >
                  <DropdownMenuLabel className="flex items-center justify-between px-2.5 py-2">
                    <span className="text-slate-700">{t.hiddenTabs}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.72rem] text-slate-500">
                      {overflowTabs.length}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {overflowTabs.map((tab) => {
                    const tabMeta = getWorkspaceItemMeta(
                      tab.href,
                      language,
                      tab.customTitle ?? tab.title
                    );
                    const secondaryLabel = getWorkspaceSecondaryLabel(
                      tab.href,
                      language
                    );
                    const TabIcon = tabMeta.icon;

                    return (
                      <DropdownMenuItem
                        key={tab.id}
                        className={cn(
                          "rounded-xl px-3 py-3 focus:bg-slate-50 focus:text-slate-950",
                          tab.id === activeTab?.id && "bg-sky-50/70"
                        )}
                        onClick={() => handleTabSelect(tab)}
                      >
                        <span
                          className={cn(
                            "inline-flex size-9 shrink-0 items-center justify-center rounded-2xl border",
                            tabMeta.chipTone
                          )}
                        >
                          <TabIcon className={cn("size-4", tabMeta.iconColor)} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-800">
                              {tab.title}
                            </span>
                            {tab.pinned && (
                              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[0.68rem] font-medium text-slate-500">
                                {t.pinned}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {secondaryLabel}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[0.7rem] font-medium text-slate-500">
                            {formatRecentWorkspaceTime(tab.lastVisitedAt, language)}
                          </div>
                          {tab.id === activeTab?.id && (
                            <div className="mt-1 rounded-full bg-sky-50 px-2 py-0.5 text-[0.68rem] font-medium text-sky-700">
                              {t.openNow}
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="shrink-0 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                id={HEADER_LANGUAGE_BUTTON_ID}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-white/88 px-3 text-[0.92rem] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white hover:text-slate-900 focus-visible:ring-[3px] focus-visible:ring-sky-200 focus-visible:ring-offset-2"
                type="button"
              >
                <Languages className="size-4" />
                <span className="hidden md:inline">{selectedLanguageLabel}</span>
                <span className="md:hidden">{language.toUpperCase()}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
                <DropdownMenuLabel>{t.language}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {APP_LANGUAGE_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className="flex items-center justify-between"
                    onClick={() => setLanguage(option.value)}
                  >
                    <span>{option.label}</span>
                    {option.value === language && (
                      <Check className="size-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(renameTarget)} onOpenChange={handleRenameOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.renameTitle}</DialogTitle>
            <DialogDescription>{t.renameDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="workspace-tab-name">{t.renameLabel}</Label>
            <Input
              id="workspace-tab-name"
              placeholder={t.renamePlaceholder}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleRenameSubmit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t.cancel}
            </Button>
            <Button onClick={handleRenameSubmit}>{t.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={configOpen} onOpenChange={handleConfigOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader className="space-y-1">
            <DialogTitle>{t.configureTitle}</DialogTitle>
            <DialogDescription>{t.configureDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <section className="space-y-3 rounded-3xl border border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.94))] p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{t.chooseHome}</div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.72rem] text-slate-500">
                  {uniqueHomeOptions.length}
                </span>
              </div>
              <div className="grid gap-2">
                {uniqueHomeOptions.map((tab) => {
                  const isSelected = tab.href === homeHref;
                  const tabMeta = getWorkspaceItemMeta(
                    tab.href,
                    language,
                    tab.customTitle ?? tab.title
                  );
                  const TabIcon = tabMeta.icon;

                  return (
                    <button
                      key={tab.href}
                    className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 text-left outline-none transition-[border-color,background-color,transform,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-sky-200 focus-visible:ring-offset-2",
                        isSelected
                          ? "border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,1),rgba(241,245,249,0.94))] shadow-[0_10px_22px_rgba(15,23,42,0.06)]"
                          : "border-border/60 hover:-translate-y-px hover:border-border hover:bg-muted/60"
                      )}
                      type="button"
                      onClick={() => handleHomeChange(tab)}
                    >
                      <span
                        className={cn(
                          "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border",
                          tabMeta.chipTone
                        )}
                      >
                        <TabIcon className={cn("size-4", tabMeta.iconColor)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-800">
                          {tab.title}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {getWorkspaceSecondaryLabel(tab.href, language)}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="rounded-full bg-background px-2 py-1 text-[0.7rem] font-medium text-muted-foreground">
                          {t.currentHome}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3 rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock3 className="size-4 text-slate-500" />
                  <span>{t.recentWorkspaces}</span>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.72rem] text-slate-500">
                  {uniqueRecentWorkspaces.length}
                </span>
              </div>
              {uniqueRecentWorkspaces.length > 0 ? (
                <div className="grid gap-2">
                  {uniqueRecentWorkspaces.map((workspace) => {
                    const existingTab =
                      tabs.find((tab) => tab.href === workspace.href) ?? null;
                    const workspaceMeta = getWorkspaceItemMeta(
                      workspace.href,
                      language,
                      workspace.customTitle ??
                        existingTab?.customTitle ??
                        existingTab?.title
                    );
                    const secondaryLabel = getWorkspaceSecondaryLabel(
                      workspace.href,
                      language
                    );
                    const WorkspaceIcon = workspaceMeta.icon;

                    return (
                      <button
                        key={workspace.href}
                        className={cn(
                          "group flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-border/60 px-3 py-3 text-left outline-none transition-[border-color,background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:border-slate-300 hover:bg-white hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)] focus-visible:ring-[3px] focus-visible:ring-sky-200 focus-visible:ring-offset-2",
                          existingTab && "border-sky-100 bg-sky-50/40"
                        )}
                        type="button"
                        onClick={() => handleRecentWorkspaceSelect(workspace)}
                      >
                        <span
                          className={cn(
                            "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border",
                            workspaceMeta.chipTone
                          )}
                        >
                          <WorkspaceIcon
                            className={cn("size-4", workspaceMeta.iconColor)}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-800">
                              {workspaceMeta.title}
                            </span>
                            {existingTab && (
                              <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[0.68rem] font-medium text-sky-700">
                                {t.openNow}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {secondaryLabel}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
                            {t.lastOpened}
                          </div>
                          <div className="text-xs font-medium text-slate-600">
                            {formatRecentWorkspaceTime(
                              workspace.lastVisitedAt,
                              language
                            )}
                          </div>
                          {!existingTab && (
                            <div className="mt-1 text-[0.68rem] font-medium text-slate-500">
                              {t.reopen}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.9),rgba(241,245,249,0.6))] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
                      <Clock3 className="size-4" />
                    </span>
                    <div>
                      <div className="text-sm font-medium text-slate-700">
                        {t.recentEmpty}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t.recentHint}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <div className="rounded-2xl border border-rose-200/70 bg-[linear-gradient(180deg,rgba(255,241,242,0.72),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_10px_24px_rgba(244,63,94,0.06)]">
              <div className="flex items-start gap-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-rose-200 bg-white text-rose-500">
                  <TriangleAlert className="size-4" />
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-rose-900">
                    {t.clearWorkspaceTitle}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-rose-700/80">
                    {t.clearWorkspaceDescription}
                  </div>
                  <Button
                    id={CLEAR_WORKSPACE_BUTTON_ID}
                    className="mt-3 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    type="button"
                    variant="outline"
                    onClick={requestClearWorkspaceTabs}
                  >
                    {t.clearWorkspaceAction}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 border-t border-slate-200/70 pt-4 sm:flex-row sm:justify-between">
            <Button className="w-full sm:w-auto" variant="outline" onClick={handleResetTabs}>
              {t.resetTabs}
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => setConfigOpen(false)}>
              {t.done}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
