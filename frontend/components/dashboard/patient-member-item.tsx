"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

interface PatientPickerItem {
  id: string;
  label: string;
  status: string;
  avatar?: string;
}

interface PatientMemberItemProps {
  member: PatientPickerItem;
  selectedId?: string;
  onSelect: (item: PatientPickerItem) => void;
}

const sweepSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 35,
  mass: 0.5,
};

function getNameInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function PatientMemberItem({
  member,
  selectedId,
  onSelect,
}: PatientMemberItemProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(member)}
      variants={{
        hidden: { opacity: 0, x: 10, y: 15, rotate: 1 },
        visible: { opacity: 1, x: 0, y: 0, rotate: 0 },
      }}
      transition={sweepSpring}
      style={{ originX: 1, originY: 1 }}
      className={cn(
        "group flex w-full items-center border-b border-border/40 py-4 text-left first:pt-0 last:border-0",
        selectedId === member.id && "rounded-xl bg-accent/40 px-2"
      )}
    >
      <div className="relative mr-4 shrink-0">
        {member.avatar ? (
          <Image
            src={member.avatar}
            alt={member.label}
            width={48}
            height={48}
            className="h-12 w-12 rounded-full ring-2 ring-background shadow-sm grayscale-[0.1] transition-all duration-300 group-hover:grayscale-0"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground ring-2 ring-background">
            {getNameInitials(member.label)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1.5 truncate text-base font-semibold leading-none tracking-tight text-foreground">
          {member.label}
        </h3>
        <p className="text-sm font-medium leading-none text-muted-foreground/85">
          {member.status}
        </p>
      </div>
      <div className="shrink-0">
        {selectedId === member.id && (
          <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
        )}
      </div>
    </motion.button>
  );
}
