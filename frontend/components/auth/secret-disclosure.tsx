"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SecretDisclosureProps {
  label: string;
  value: string | null | undefined;
  showLabel: string;
  hideLabel: string;
  className?: string;
}

export function SecretDisclosure({
  label,
  value,
  showLabel,
  hideLabel,
  className,
}: SecretDisclosureProps) {
  const [isVisible, setIsVisible] = useState(false);

  if (!value) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0 text-[0.88rem] text-slate-500 hover:text-slate-700"
        aria-expanded={isVisible}
        onClick={() => setIsVisible((current) => !current)}
      >
        {isVisible ? hideLabel : showLabel}
      </Button>

      {isVisible ? (
        <p className="break-all font-mono text-[0.82rem] text-muted-foreground">
          {label}: {value}
        </p>
      ) : null}
    </div>
  );
}
