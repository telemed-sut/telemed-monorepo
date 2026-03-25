"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  CARE_TEAM_ASSIGNMENT_ROLES,
  createPatientAssignment,
  deletePatientAssignment,
  fetchPatientAssignments,
  fetchUsers,
  getErrorMessage,
  type PatientAssignment,
  type User,
  updatePatientAssignment,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

interface PatientAssignmentsDialogProps {
  open: boolean;
  patientId: string | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
}

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function displayName(user: User | undefined, language: AppLanguage): string {
  if (!user) return tr(language, "Unknown Care Team Member", "ไม่พบข้อมูลทีมดูแล");
  const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return fullName || user.email;
}

function assignmentName(item: PatientAssignment): string {
  const fullName = `${item.doctor?.first_name ?? ""} ${item.doctor?.last_name ?? ""}`.trim();
  return fullName || item.doctor?.email || item.doctor_id;
}

export function PatientAssignmentsDialog({
  open,
  patientId,
  patientName,
  onOpenChange,
}: PatientAssignmentsDialogProps) {
  const USERS_PAGE_LIMIT = 100;
  const token = useAuthStore((state) => state.token);
  const language = useLanguageStore((state) => state.language);

  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [doctorOptions, setDoctorOptions] = useState<User[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAllDoctors = useCallback(async () => {
    if (!token) return [] as User[];

    let page = 1;
    let total = 0;
    const doctors: User[] = [];

    do {
      const response = await fetchUsers(
        {
          page,
          limit: USERS_PAGE_LIMIT,
          sort: "first_name",
          order: "asc",
        },
        token
      );

      doctors.push(
        ...response.items.filter((item) => CARE_TEAM_ASSIGNMENT_ROLES.has(item.role))
      );
      total = response.total;
      page += 1;
    } while (doctors.length < total && (page - 1) * USERS_PAGE_LIMIT < total);

    return doctors;
  }, [token]);

  const refreshData = useCallback(async () => {
    if (!token || !patientId) return;
    setLoading(true);
    try {
      const [assignmentRes, doctors] = await Promise.all([
        fetchPatientAssignments(patientId, token),
        fetchAllDoctors(),
      ]);
      setAssignments(assignmentRes.items);
      setDoctorOptions(doctors);
    } catch (error) {
      toast.error(tr(language, "Load failed", "โหลดไม่สำเร็จ"), {
        description: getErrorMessage(error, "ไม่สามารถโหลดรายการการ assign แพทย์ได้"),
      });
    } finally {
      setLoading(false);
    }
  }, [fetchAllDoctors, patientId, token, language]);

  useEffect(() => {
    if (!open || !patientId) return;
    void refreshData();
  }, [open, patientId, refreshData]);

  const assignedDoctorIds = useMemo(
    () => new Set(assignments.map((item) => item.doctor_id)),
    [assignments]
  );

  const availableDoctors = useMemo(
    () => doctorOptions.filter((doctor) => !assignedDoctorIds.has(doctor.id)),
    [doctorOptions, assignedDoctorIds]
  );

  const handleAddDoctor = async () => {
    if (!token || !patientId || !selectedDoctorId || submitting) return;
    setSubmitting(true);
    try {
      await createPatientAssignment(patientId, { doctor_id: selectedDoctorId }, token);
      toast.success(tr(language, "Care team member assigned", "เพิ่มสมาชิกทีมดูแลแล้ว"));
      setSelectedDoctorId("");
      await refreshData();
    } catch (error) {
      toast.error(tr(language, "Assign failed", "มอบหมายไม่สำเร็จ"), {
        description: getErrorMessage(error, "ไม่สามารถเพิ่มสมาชิกทีมดูแลให้ผู้ป่วยได้"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMakePrimary = async (assignmentId: string) => {
    if (!token || !patientId || submitting) return;
    setSubmitting(true);
    try {
      await updatePatientAssignment(patientId, assignmentId, { role: "primary" }, token);
      toast.success(tr(language, "Primary assignee updated", "อัปเดตผู้ดูแลหลักแล้ว"));
      await refreshData();
    } catch (error) {
      toast.error(tr(language, "Update failed", "อัปเดตไม่สำเร็จ"), {
        description: getErrorMessage(error, "ไม่สามารถเปลี่ยนผู้ดูแลหลักได้"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (assignmentId: string) => {
    if (!token || !patientId || submitting) return;
    setSubmitting(true);
    try {
      await deletePatientAssignment(patientId, assignmentId, token);
      toast.success(tr(language, "Care team member removed from patient", "ถอดสมาชิกทีมดูแลออกจากผู้ป่วยแล้ว"));
      await refreshData();
    } catch (error) {
      toast.error(tr(language, "Remove failed", "ถอดไม่สำเร็จ"), {
        description: getErrorMessage(error, "ไม่สามารถถอดสมาชิกทีมดูแลออกจากผู้ป่วยได้"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr(language, "Manage Care Team", "จัดการทีมดูแล")}</DialogTitle>
          <DialogDescription>
            {tr(language, "Manage care team assignments for patient:", "จัดการทีมดูแลของผู้ป่วย:")} <span className="font-medium">{patientName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3">
            <Label className="text-sm font-medium">{tr(language, "Add care team member", "เพิ่มสมาชิกทีมดูแล")}</Label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Select value={selectedDoctorId} onValueChange={(value) => setSelectedDoctorId(value ?? "")}>
                <SelectTrigger className="sm:flex-1">
                  {selectedDoctorId ? (
                    <SelectValue />
                  ) : (
                    <span className="text-sm text-muted-foreground">{tr(language, "Select care team member", "เลือกสมาชิกทีมดูแล")}</span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {availableDoctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {displayName(doctor, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => void handleAddDoctor()}
                disabled={!selectedDoctorId || submitting}
              >
                {tr(language, "Add", "เพิ่ม")}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">{tr(language, "Assigned care team", "ทีมดูแลที่มอบหมายแล้ว")}</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tr(language, "Loading assignments...", "กำลังโหลดข้อมูลการมอบหมาย...")}</p>
            ) : assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr(language, "No care team members assigned.", "ยังไม่มีการมอบหมายทีมดูแล")}</p>
            ) : (
              <div className="space-y-2">
                {assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">{assignmentName(assignment)}</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.doctor?.email ?? assignment.doctor_id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={assignment.role === "primary" ? "default" : "secondary"}>
                        {assignment.role === "primary"
                          ? tr(language, "Primary", "แพทย์หลัก")
                          : tr(language, "Consulting", "ที่ปรึกษา")}
                      </Badge>
                      {assignment.role !== "primary" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={submitting}
                          onClick={() => void handleMakePrimary(assignment.id)}
                        >
                          {tr(language, "Make Primary", "ตั้งเป็นแพทย์หลัก")}
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={submitting}
                        onClick={() => void handleRemove(assignment.id)}
                      >
                        {tr(language, "Remove", "ถอดออก")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr(language, "Close", "ปิด")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
