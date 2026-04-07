"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  ProfileIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

import { t as tr } from "@/lib/i18n-utils";
import { includesSearchQuery, normalizeSearchText } from "@/lib/search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AppLanguage } from "@/store/language-config";

import { PatientMemberItem } from "./patient-member-item";

interface PatientPickerItem {
  id: string;
  label: string;
  description?: string;
  status: string;
  avatar?: string;
}

interface PatientDirectoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  items: PatientPickerItem[];
  selectedId?: string;
  loading: boolean;
  onSelect: (item: PatientPickerItem) => void;
  language: AppLanguage;
}

function getNameInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function PatientDirectoryDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  selectedId,
  loading,
  onSelect,
  language,
}: PatientDirectoryDialogProps) {
  const [expanded, setExpanded] = useState(false);
  const filteredAllPatients = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return items;
    return items.filter(
      (patient) =>
        includesSearchQuery(patient.label, query) ||
        includesSearchQuery(patient.status, query) ||
        includesSearchQuery(patient.description || "", query)
    );
  }, [items, query]);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setExpanded(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );
  const handlePatientSelect = useCallback(
    (patient: PatientPickerItem) => {
      onSelect(patient);
      handleOpenChange(false);
    },
    [onSelect, handleOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden bg-muted/50 p-0 sm:max-w-[560px]" showCloseButton={false}>
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="text-sm font-semibold text-foreground">
            {tr(language, "Select Patient", "เลือกผู้ป่วย")}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-muted-foreground"
            onClick={() => handleOpenChange(false)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2.2} />
          </Button>
        </div>

        <div className="p-4">
          <div className="relative w-full rounded-[28px] border border-border bg-background pb-5">
            <div className="px-6 pb-3 pt-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                  {tr(language, "Patient Directory", "ไดเรกทอรีผู้ป่วย")}
                  <span className="mt-0.5 rounded-full bg-muted px-2 py-1 text-xs font-normal leading-none text-muted-foreground">
                    {filteredAllPatients.length}
                  </span>
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full border-border/50 text-muted-foreground hover:bg-muted/50"
                  onClick={() => setExpanded((prev) => !prev)}
                >
                  <HugeiconsIcon icon={Add01Icon} size={18} strokeWidth={2.5} />
                </Button>
              </div>

              <div className="relative mb-4">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60"
                  size={16}
                />
                <Input
                  placeholder={tr(language, "Search patients...", "ค้นหาผู้ป่วย...")}
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  className="box-border h-11 w-full rounded-2xl border-none bg-muted/40 pl-11 pr-4 text-base text-foreground placeholder:text-muted-foreground/50 transition-all focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto px-6 pb-20">
              <motion.div
                initial={false}
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
                className="space-y-0.5"
              >
                {loading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tr(language, "Searching patients...", "กำลังค้นหาผู้ป่วย...")}
                  </p>
                ) : filteredAllPatients.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {tr(language, "No patients found.", "ไม่พบผู้ป่วย")}
                  </p>
                ) : (
                  filteredAllPatients.map((patient) => (
                    <PatientMemberItem
                      key={`patient-${patient.id}`}
                      member={patient}
                      selectedId={selectedId}
                      onSelect={handlePatientSelect}
                    />
                  ))
                )}
              </motion.div>
            </div>

            <motion.div
              layout
              initial={false}
              animate={{
                height: expanded ? "calc(100% - 20px)" : "68px",
                width: expanded ? "calc(100% - 20px)" : "calc(100% - 40px)",
                bottom: expanded ? "10px" : "20px",
                left: expanded ? "10px" : "20px",
                borderRadius: expanded ? "32px" : "24px",
              }}
              transition={{
                type: "spring",
                stiffness: 240,
                damping: 30,
                mass: 0.8,
                ease: "easeInOut",
              }}
              className="group/bar absolute z-50 flex flex-col overflow-hidden border border-border bg-card shadow-none"
              style={{ cursor: expanded ? "default" : "pointer" }}
              onClick={() => !expanded && setExpanded(true)}
            >
              <div
                className={cn(
                  "flex h-[68px] shrink-0 items-center justify-between px-3 transition-colors",
                  expanded ? "border-b border-border/40" : "hover:bg-muted/20"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-transform group-hover/bar:scale-105">
                    <HugeiconsIcon icon={ProfileIcon} size={20} strokeWidth={2} />
                  </div>
                  <motion.div layout="position">
                    <h4 className="text-base font-medium leading-none tracking-tight text-foreground">
                      {tr(language, "Patient Directory", "ไดเรกทอรีผู้ป่วย")}
                    </h4>
                    <p className="mt-1 text-xs font-normal leading-none text-muted-foreground">
                      {tr(
                        language,
                        `${items.length} patients registered`,
                        `มีผู้ป่วยในระบบ ${items.length} คน`
                      )}
                    </p>
                  </motion.div>
                </div>

                <div className="flex items-center gap-3">
                  {!expanded && (
                    <div className="flex items-center gap-0">
                      <div className="flex -space-x-3">
                        {items.slice(0, 3).map((patient) => (
                          <motion.div
                            key={`sum-${patient.id}`}
                            layoutId={`patient-avatar-${patient.id}`}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground shadow-sm ring-1 ring-background"
                          >
                            {getNameInitials(patient.label)}
                          </motion.div>
                        ))}
                        <div className="relative z-0 flex h-10 w-10 items-center justify-center rounded-full bg-muted shadow-sm ring-1 ring-background">
                          <span className="text-sm font-normal leading-none text-muted-foreground">
                            +{Math.max(items.length - 3, 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground transition-all hover:text-foreground active:scale-90"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(false);
                      }}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="px-5 py-4"
                    >
                      <div className="relative">
                        <HugeiconsIcon
                          icon={Search01Icon}
                          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/50"
                          size={15}
                        />
                        <Input
                          placeholder={tr(language, "Search patients...", "ค้นหาผู้ป่วย...")}
                          value={query}
                          onChange={(event) => onQueryChange(event.target.value)}
                          className="box-border h-10 w-full rounded-xl border-none bg-muted/30 pl-10 text-sm text-foreground placeholder:text-muted-foreground/40 transition-all focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex-1 overflow-y-auto px-5 py-2">
                  <motion.div
                    initial="hidden"
                    animate={expanded ? "visible" : "hidden"}
                    variants={{
                      visible: { transition: { staggerChildren: 0.03, delayChildren: 0.1 } },
                      hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
                    }}
                    className="space-y-0.5"
                  >
                    {filteredAllPatients.map((patient) => (
                      <PatientMemberItem
                        key={`list-${patient.id}`}
                        member={patient}
                        selectedId={selectedId}
                        onSelect={handlePatientSelect}
                      />
                    ))}
                    {filteredAllPatients.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {tr(language, "No patients found.", "ไม่พบผู้ป่วย")}
                      </p>
                    )}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
