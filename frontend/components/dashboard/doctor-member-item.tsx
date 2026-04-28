"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Briefcase01Icon,
  Database01Icon,
  PaintBoardIcon,
  QuillWrite01Icon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

interface DoctorPickerItem {
  id: string;
  label: string;
  online: boolean;
  role: string;
  status: string;
  roleType: "pm" | "designer" | "data" | "creator";
  avatar?: string;
}

interface DoctorMemberItemProps {
  member: DoctorPickerItem;
  selectedId?: string;
  onSelect: (item: DoctorPickerItem) => void;
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

const DoctorRoleBadge = ({
  type,
  label,
}: {
  type: DoctorPickerItem["roleType"];
  label: string;
}) => {
  const styles = {
    pm: {
      bg: "bg-[#FFFCEB]",
      text: "text-[#856404]",
      border: "border-[#FFEBA5]",
      icon: Briefcase01Icon,
    },
    designer: {
      bg: "bg-[#F0F7FF]",
      text: "text-[#004085]",
      border: "border-[#B8DAFF]",
      icon: PaintBoardIcon,
    },
    data: {
      bg: "bg-[#F3FAF4]",
      text: "text-[#155724]",
      border: "border-[#C3E6CB]",
      icon: Database01Icon,
    },
    creator: {
      bg: "bg-[#FCF5FF]",
      text: "text-[#522785]",
      border: "border-[#E8D1FF]",
      icon: QuillWrite01Icon,
    },
  };

  const style = styles[type];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1",
        style.bg,
        style.text,
        style.border
      )}
    >
      <HugeiconsIcon icon={Icon} size={12} strokeWidth={1.8} />
      <span className="max-w-[72px] truncate whitespace-nowrap text-xs font-normal uppercase tracking-tight sm:max-w-none">
        {label}
      </span>
    </div>
  );
};

export function DoctorMemberItem({
  member,
  selectedId,
  onSelect,
}: DoctorMemberItemProps) {
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
      <div className="mr-4 shrink-0">
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
        {member.online && (
          <div className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background shadow-sm">
            <div className="h-2 w-2 rounded-full bg-green-500" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1.5 truncate text-base font-semibold leading-none tracking-tight text-foreground">
          {member.label}
        </h3>
        <div className="flex items-center gap-1.5 opacity-80">
          {member.online && <div className="h-1.5 w-1.5 rounded-full bg-green-500" />}
          <p
            className={cn(
              "text-sm font-medium leading-none",
              member.online ? "text-green-600" : "text-muted-foreground"
            )}
          >
            {member.status}
          </p>
        </div>
      </div>
      <div className="shrink-0">
        <DoctorRoleBadge type={member.roleType} label={member.role} />
      </div>
    </motion.button>
  );
}
