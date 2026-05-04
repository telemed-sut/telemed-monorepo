"use client";

import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { th as thLocale, enGB } from "date-fns/locale";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PencilEdit02Icon,
  Delete02Icon,
  RefreshIcon,
  Tick02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchPatientWeightRecords,
  updatePatientWeightRecord,
  deletePatientWeightRecord,
} from "@/lib/api-patients";
import type { AppLanguage } from "@/store/language-config";
import type { WeightRecord } from "@/lib/api-types";
import { useAuthStore } from "@/store/auth-store";

interface PatientVitalsManagerProps {
  patientId: string;
  language: AppLanguage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecordsChanged: () => void; // Trigger graph reload
}

export function PatientVitalsManager({
  patientId,
  language,
  open,
  onOpenChange,
  onRecordsChanged,
}: PatientVitalsManagerProps) {
  const { token } = useAuthStore();
  const [records, setRecords] = useState<WeightRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit form state
  const [editWeight, setEditWeight] = useState("");
  const [editHeight, setEditHeight] = useState("");

  const isTh = language === "th";
  const dateLocale = isTh ? thLocale : enGB;

  const tr = (en: string, th: string) => (isTh ? th : en);

  const loadRecords = async () => {
    if (!token || !open) return;
    setLoading(true);
    try {
      const res = await fetchPatientWeightRecords(patientId, token);
      setRecords(res.items);
    } catch (err) {
      console.error("Failed to load weight records", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadRecords();
      setEditingId(null);
    }
  }, [open, patientId, token]);

  const handleEditClick = (record: WeightRecord) => {
    setEditingId(record.id);
    setEditWeight(record.weight_kg.toString());
    setEditHeight(record.height_cm ? record.height_cm.toString() : "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (recordId: string) => {
    if (!token) return;
    try {
      const w = parseFloat(editWeight);
      const h = editHeight ? parseFloat(editHeight) : null;
      if (isNaN(w)) return;

      await updatePatientWeightRecord(
        patientId,
        recordId,
        {
          weight_kg: w,
          height_cm: h,
        },
        token
      );
      setEditingId(null);
      await loadRecords();
      onRecordsChanged(); // Notify parent to reload graph
    } catch (err) {
      console.error("Failed to update record", err);
    }
  };

  const handleDelete = async (recordId: string) => {
    if (!token) return;
    if (!confirm(tr("Are you sure you want to delete this record?", "คุณแน่ใจหรือไม่ที่จะลบข้อมูลนี้?"))) {
      return;
    }
    try {
      await deletePatientWeightRecord(patientId, recordId, token);
      await loadRecords();
      onRecordsChanged(); // Notify parent
    } catch (err) {
      console.error("Failed to delete record", err);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{tr("Manage Vitals Records", "จัดการข้อมูลสัญญาณชีพ")}</SheetTitle>
          <SheetDescription>
            {tr(
              "View, edit, or delete historical weight and height records. Changes will be reflected on the trend chart immediately.",
              "ดู แก้ไข หรือลบประวัติข้อมูลน้ำหนักและส่วนสูง การเปลี่ยนแปลงจะแสดงผลบนกราฟทันที"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-medium">
            {tr("Record History", "ประวัติการบันทึกข้อมูล")}
          </h3>
          <Button variant="ghost" size="sm" onClick={loadRecords} disabled={loading}>
            <HugeiconsIcon icon={RefreshIcon} className="size-4 mr-2" />
            {tr("Refresh", "รีเฟรช")}
          </Button>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("Date", "วันที่")}</TableHead>
                <TableHead>{tr("Weight (kg)", "น้ำหนัก (กก.)")}</TableHead>
                <TableHead>{tr("Height (cm)", "ส่วนสูง (ซม.)")}</TableHead>
                <TableHead className="text-right">{tr("Actions", "จัดการ")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                    {tr("No records found", "ไม่พบข้อมูล")}
                  </TableCell>
                </TableRow>
              ) : (
                records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {format(parseISO(record.measured_at || record.created_at), "d MMM yyyy, HH:mm", {
                        locale: dateLocale,
                      })}
                    </TableCell>
                    
                    {/* Weight Column */}
                    <TableCell>
                      {editingId === record.id ? (
                        <Input
                          type="number"
                          step="0.1"
                          value={editWeight}
                          onChange={(e) => setEditWeight(e.target.value)}
                          className="w-20 h-8"
                        />
                      ) : (
                        record.weight_kg
                      )}
                    </TableCell>

                    {/* Height Column */}
                    <TableCell>
                      {editingId === record.id ? (
                        <Input
                          type="number"
                          step="0.1"
                          value={editHeight}
                          onChange={(e) => setEditHeight(e.target.value)}
                          className="w-20 h-8"
                        />
                      ) : (
                        record.height_cm || "—"
                      )}
                    </TableCell>

                    {/* Actions Column */}
                    <TableCell className="text-right">
                      {editingId === record.id ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => handleSaveEdit(record.id)}
                          >
                            <HugeiconsIcon icon={Tick02Icon} className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500"
                            onClick={handleCancelEdit}
                          >
                            <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-blue-600"
                            onClick={() => handleEditClick(record)}
                          >
                            <HugeiconsIcon icon={PencilEdit02Icon} className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => handleDelete(record.id)}
                          >
                            <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
