"use client";

import { cn } from "@/lib/utils";

type AuthMessageTone = "error" | "success" | "info";

interface AuthMessageProps {
  children: React.ReactNode;
  className?: string;
  tone?: AuthMessageTone;
}

const toneClasses: Record<AuthMessageTone, { container: string; role: "alert" | "status" }> = {
  error: {
    container: "border-destructive/20 bg-destructive/5 text-destructive",
    role: "alert",
  },
  success: {
    container: "border-emerald-200 bg-emerald-50 text-emerald-700",
    role: "status",
  },
  info: {
    container: "border-sky-200 bg-sky-50 text-sky-900",
    role: "status",
  },
};

export function AuthMessage({
  children,
  className,
  tone = "error",
}: AuthMessageProps) {
  const toneConfig = toneClasses[tone];

  return (
    <p
      role={toneConfig.role}
      className={cn(
        "rounded-lg border px-3 py-2 text-[0.95rem] leading-6",
        toneConfig.container,
        className
      )}
    >
      {children}
    </p>
  );
}
