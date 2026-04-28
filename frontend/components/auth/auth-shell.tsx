"use client";

import type { ReactNode } from "react";

import { Logo } from "@/components/ui/logo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { APP_LANGUAGE_OPTIONS } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

interface AuthShellProps {
  title: string;
  subtitle: string;
  metaText?: string;
  children: ReactNode;
  headerContent?: ReactNode;
  cardClassName?: string;
  contentClassName?: string;
}

export function AuthShell({
  title,
  subtitle,
  metaText,
  children,
  headerContent,
  cardClassName,
  contentClassName,
}: AuthShellProps) {
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(30,64,175,0.12),transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] px-4 py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[8%] top-[14%] h-32 w-32 rounded-full bg-sky-200/40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[12%] right-[10%] h-40 w-40 rounded-full bg-blue-300/30 blur-3xl"
      />

      <Card
        className={cn(
          "mx-4 w-full max-w-lg border-white/70 bg-white/92 pb-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl",
          cardClassName
        )}
      >
        <CardHeader className="mb-2 mt-4 space-y-2 text-center">
          <div className="flex justify-end">
            <div className="inline-flex rounded-md border border-input bg-background p-0.5">
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "h-8 rounded px-2.5 text-[0.9rem] transition-colors",
                    option.value === language
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setLanguage(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 flex justify-center">
            <div className="relative flex size-24 items-center justify-center rounded-[28px] border border-sky-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.92))] shadow-[0_18px_32px_rgba(14,116,144,0.12)]">
              <div className="absolute inset-2 rounded-[22px] bg-[radial-gradient(circle_at_top,rgba(186,230,253,0.7),transparent_60%)]" />
              <Logo className="relative size-20" />
            </div>
          </div>

          {headerContent}

          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
            <p className="text-[0.98rem] text-muted-foreground">{subtitle}</p>
            {metaText ? (
              <p className="text-[0.88rem] text-muted-foreground">{metaText}</p>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className={cn("space-y-6", contentClassName)}>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
