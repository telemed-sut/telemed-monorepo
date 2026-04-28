"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SettingsPanelNavButtonProps {
  title: string;
  summary: string;
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
  isModalPresentation?: boolean;
}

export function SettingsPanelNavButton({
  title,
  summary,
  active,
  icon,
  onClick,
  isModalPresentation,
}: SettingsPanelNavButtonProps) {
  if (isModalPresentation) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-colors",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
        aria-pressed={active}
      >
        <span
          className={cn(
            "flex shrink-0 transition-colors [&>svg]:size-4",
            active
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {icon}
        </span>
        <span className="truncate text-sm">{title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-14 min-w-0 w-full cursor-pointer items-start gap-3.5 overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-[border-color,background-color,color,box-shadow]",
        active
          ? "border-primary/30 bg-background text-foreground shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/70 hover:text-foreground",
      )}
      aria-pressed={active}
    >
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border transition-[background-color,border-color,color]",
          active
            ? "border-primary/20 bg-primary/10 text-primary"
            : "border-border/70 bg-background text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-[0.95rem] font-semibold">{title}</span>
        <span className="mt-1 block line-clamp-2 text-sm leading-5 text-muted-foreground break-words">
          {summary}
        </span>
      </span>
    </button>
  );
}
