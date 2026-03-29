"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Check,
  HeartPulse,
  Languages,
  Pin,
  UserRound,
  Video,
  X,
} from "lucide-react";

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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { APP_LANGUAGE_OPTIONS } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";
import type { WorkspaceTab } from "@/store/workspace-tabs-store";
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
    done: "Done",
    workspaceTabs: "Open work",
    pinned: "Pinned",
    language: "Language",
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
    done: "เสร็จสิ้น",
    workspaceTabs: "งานที่เปิดอยู่",
    pinned: "ปักหมุด",
    language: "ภาษา",
  },
} as const;

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

function WorkspaceTabChip({
  tab,
  isActive,
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
  pinnedLabel: string;
  canCloseTabsToLeft: boolean;
  canCloseTabsToRight: boolean;
  onSelect: (tab: WorkspaceTab) => void;
  onClose: (event: React.MouseEvent<HTMLButtonElement>, tab: WorkspaceTab) => void;
  onPrefetch: (href: string) => void;
  onRequestRename: (tab: WorkspaceTab) => void;
  onRequestConfigure: () => void;
}) {
  const tabAppearance = getWorkspaceTabAppearance(tab.href);
  const TabIcon = tabAppearance.icon;

  return (
    <WorkspaceTabContextMenu
      tab={tab}
      canCloseTabsToLeft={canCloseTabsToLeft}
      canCloseTabsToRight={canCloseTabsToRight}
      onRequestRename={onRequestRename}
      onRequestConfigure={onRequestConfigure}
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
          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
            aria-label={`Close ${tab.title}`}
            className={cn(
              "ml-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-full transition-[background-color,color,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              isActive
                ? "text-slate-400 hover:bg-white/12 hover:text-white"
                : "text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100"
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
  const t = labels[language];
  const tabs = useWorkspaceTabsStore((state) => state.tabs);
  const activeTabId = useWorkspaceTabsStore((state) => state.activeTabId);
  const homeHref = useWorkspaceTabsStore((state) => state.homeHref);
  const hydrate = useWorkspaceTabsStore((state) => state.hydrate);
  const activateTab = useWorkspaceTabsStore((state) => state.activateTab);
  const closeTab = useWorkspaceTabsStore((state) => state.closeTab);
  const renameTab = useWorkspaceTabsStore((state) => state.renameTab);
  const setHomeHref = useWorkspaceTabsStore((state) => state.setHomeHref);
  const resetTabs = useWorkspaceTabsStore((state) => state.resetTabs);
  const [renameTarget, setRenameTarget] = useState<WorkspaceTab | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [configOpen, setConfigOpen] = useState(false);

  const selectedLanguageLabel =
    APP_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ||
    APP_LANGUAGE_OPTIONS.find((option) => option.value === "en")?.label;

  useEffect(() => {
    hydrate(language, pathname);
  }, [hydrate, language, pathname]);

  useEffect(() => {
    tabs.forEach((tab) => {
      router.prefetch(tab.href);
    });
  }, [router, tabs]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
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
    setRenameTarget(tab);
    setRenameValue(tab.customTitle ?? tab.title);
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
    const nextTab = resetTabs(language, pathname);
    if (nextTab && nextTab.href !== pathname) {
      router.push(nextTab.href);
    }
    setConfigOpen(false);
  };

  if (tabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="w-full border-b border-slate-200/70 bg-background px-2 pt-2 sm:px-4">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div
              aria-label={t.workspaceTabs}
              className="flex min-w-max items-end gap-1.5"
              role="tablist"
            >
              {tabs.map((tab, index) => (
                <WorkspaceTabChip
                  key={tab.id}
                  canCloseTabsToLeft={tabs
                    .slice(0, index)
                    .some((candidate) => candidate.closable)}
                  canCloseTabsToRight={tabs
                    .slice(index + 1)
                    .some((candidate) => candidate.closable)}
                  isActive={tab.id === activeTab?.id}
                  pinnedLabel={t.pinned}
                  tab={tab}
                  onClose={handleClose}
                  onPrefetch={router.prefetch}
                  onRequestConfigure={() => setConfigOpen(true)}
                  onRequestRename={handleRequestRename}
                  onSelect={handleTabSelect}
                />
              ))}
            </div>
          </div>

          <div className="shrink-0 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                id="header-language-button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-background px-3 text-[0.92rem] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-muted hover:text-slate-900"
              >
                <Languages className="size-4" />
                <span className="hidden md:inline">{selectedLanguageLabel}</span>
                <span className="md:hidden">{language.toUpperCase()}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t.language}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
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
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
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

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.configureTitle}</DialogTitle>
            <DialogDescription>{t.configureDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm font-medium">{t.chooseHome}</div>
            <div className="grid gap-2">
              {uniqueHomeOptions.map((tab) => {
                const isSelected = tab.href === homeHref;

                return (
                  <button
                    key={tab.href}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-border bg-muted"
                        : "border-border/60 hover:border-border hover:bg-muted/60"
                    )}
                    type="button"
                    onClick={() => handleHomeChange(tab)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{tab.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {tab.href}
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
          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={handleResetTabs}>
              {t.resetTabs}
            </Button>
            <Button onClick={() => setConfigOpen(false)}>{t.done}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
