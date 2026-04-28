"use client";

import type { ReactNode } from "react";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SettingsDisclosureProps {
  title: string;
  description: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  tone?: "default" | "danger";
}

export function SettingsDisclosure({
  title,
  description,
  summary,
  open,
  onOpenChange,
  children,
  tone = "default",
}: SettingsDisclosureProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "rounded-2xl border bg-background px-3 py-2.5",
          tone === "danger"
            ? "border-destructive/20 bg-destructive/3"
            : "border-border",
        )}
      >
        <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-start justify-between gap-3 overflow-hidden rounded-xl text-left transition-[color,background-color] hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block min-w-0 flex-1 overflow-hidden">
            <span className="block break-words text-sm font-medium text-foreground">
              {title}
            </span>
            <span className="block break-words text-xs text-muted-foreground">
              {description}
            </span>
          </span>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-2.5 text-xs text-muted-foreground group-hover:text-foreground">
            {summary ? (
              <span className="hidden max-w-[14rem] truncate text-right sm:block">{summary}</span>
            ) : null}
            {open ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <div
            className={cn(
              "mt-2 border-t pt-3",
              tone === "danger" ? "border-destructive/15" : "border-border/70",
            )}
          >
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
