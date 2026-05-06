"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Copy,
  ExternalLink,
  Link2,
  PencilLine,
  Pin,
  Settings2,
  X,
} from "lucide-react";

import { toast } from "@/components/ui/toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  isMeetingCallHref,
  requestMeetingCallNavigation,
} from "@/lib/meeting-call-navigation";
import type { WorkspaceTab } from "@/store/workspace-tabs-store";
import { useWorkspaceTabsStore } from "@/store/workspace-tabs-store";
import { useLanguageStore } from "@/store/language-store";

const labels = {
  en: {
    pinTab: "Pin tab",
    unpinTab: "Unpin tab",
    duplicateTab: "Duplicate tab",
    copyUrl: "Copy URL",
    copied: "URL copied to clipboard",
    copyFailed: "Could not copy the tab URL",
    renameTab: "Rename tab",
    openInBrowserTab: "Open in new browser tab",
    configureTabs: "Configure tabs & home",
    closeTab: "Close tab",
    closeLeft: "Close tabs to the left",
    closeRight: "Close tabs to the right",
    openFailed: "Could not open the tab in a new browser tab",
  },
  th: {
    pinTab: "ปักหมุดแท็บ",
    unpinTab: "เลิกปักหมุดแท็บ",
    duplicateTab: "ทำสำเนาแท็บ",
    copyUrl: "คัดลอก URL",
    copied: "คัดลอก URL แล้ว",
    copyFailed: "ไม่สามารถคัดลอก URL ได้",
    renameTab: "เปลี่ยนชื่อแท็บ",
    openInBrowserTab: "เปิดในแท็บเบราว์เซอร์ใหม่",
    configureTabs: "ตั้งค่าแท็บและหน้าแรก",
    closeTab: "ปิดแท็บ",
    closeLeft: "ปิดแท็บทางซ้าย",
    closeRight: "ปิดแท็บทางขวา",
    openFailed: "ไม่สามารถเปิดแท็บในเบราว์เซอร์ใหม่ได้",
  },
} as const;

export function WorkspaceTabContextMenu({
  tab,
  canCloseTabsToLeft,
  canCloseTabsToRight,
  onRequestRename,
  onRequestConfigure,
  children,
}: {
  tab: WorkspaceTab;
  canCloseTabsToLeft: boolean;
  canCloseTabsToRight: boolean;
  onRequestRename: (tab: WorkspaceTab) => void;
  onRequestConfigure: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const language = useLanguageStore((state) => state.language);
  const t = labels[language];
  const pinTab = useWorkspaceTabsStore((state) => state.pinTab);
  const duplicateTab = useWorkspaceTabsStore((state) => state.duplicateTab);
  const closeTab = useWorkspaceTabsStore((state) => state.closeTab);
  const closeTabsToLeft = useWorkspaceTabsStore((state) => state.closeTabsToLeft);
  const closeTabsToRight = useWorkspaceTabsStore((state) => state.closeTabsToRight);

  const absoluteUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return tab.href;
    }

    return new URL(tab.href, window.location.origin).toString();
  }, [tab.href]);

  const navigateIfNeeded = (nextTab: WorkspaceTab | null) => {
    if (!nextTab) {
      return;
    }

    if (nextTab.href !== pathname) {
      if (isMeetingCallHref(pathname) && !isMeetingCallHref(nextTab.href)) {
        requestMeetingCallNavigation(nextTab.href);
        return;
      }
      router.push(nextTab.href);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      toast.success(t.copied);
    } catch {
      toast.error(t.copyFailed);
    }
  };

  const handleOpenInBrowserTab = () => {
    if (typeof window === "undefined") {
      return;
    }

    const popup = window.open(absoluteUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      toast.error(t.openFailed);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-72">
        <ContextMenuItem onClick={() => pinTab(tab.id)}>
          <Pin className="size-4" />
          {tab.pinned ? t.unpinTab : t.pinTab}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => duplicateTab(tab.id, language)}>
          <Copy className="size-4" />
          {t.duplicateTab}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyUrl}>
          <Link2 className="size-4" />
          {t.copyUrl}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRequestRename(tab)}>
          <PencilLine className="size-4" />
          {t.renameTab}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenInBrowserTab}>
          <ExternalLink className="size-4" />
          {t.openInBrowserTab}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRequestConfigure}>
          <Settings2 className="size-4" />
          {t.configureTabs}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!tab.closable}
          onClick={() => navigateIfNeeded(closeTab(tab.id))}
        >
          <X className="size-4" />
          {t.closeTab}
          <ContextMenuShortcut>
            {typeof navigator !== "undefined" &&
            navigator.userAgent.toLowerCase().includes("mac")
              ? "⌘W"
              : "Ctrl+W"}
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canCloseTabsToLeft}
          onClick={() => navigateIfNeeded(closeTabsToLeft(tab.id))}
        >
          {t.closeLeft}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canCloseTabsToRight}
          onClick={() => navigateIfNeeded(closeTabsToRight(tab.id))}
        >
          {t.closeRight}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
