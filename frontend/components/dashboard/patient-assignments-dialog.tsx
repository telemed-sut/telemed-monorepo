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
  createPatientAssignment,
  deletePatientAssignment,
  fetchPatientAssignments,
  fetchUsers,
  type PatientAssignment,
  type User,
  updatePatientAssignment,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";

interface PatientAssignmentsDialogProps {
  open: boolean;
  patientId: string | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
}

function displayName(user: User | undefined): string {
  if (!user) return "Unknown Doctor";
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
          role: "doctor",
          clinical_only: true,
          sort: "first_name",
          order: "asc",
        },
        token
      );

      doctors.push(...response.items.filter((item) => item.role === "doctor"));
      total = response.total;
      page += 1;
    } while (doctors.length < total);

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
      const message = error instanceof Error ? error.message : "Failed to load assignments";
      toast.error("Load failed", { description: message });
    } finally {
      setLoading(false);
    }
  }, [fetchAllDoctors, patientId, token]);

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
      toast.success("Doctor assigned");
      setSelectedDoctorId("");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to assign doctor";
      toast.error("Assign failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMakePrimary = async (assignmentId: string) => {
    if (!token || !patientId || submitting) return;
    setSubmitting(true);
    try {
      await updatePatientAssignment(patientId, assignmentId, { role: "primary" }, token);
      toast.success("Primary doctor updated");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update assignment";
      toast.error("Update failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (assignmentId: string) => {
    if (!token || !patientId || submitting) return;
    setSubmitting(true);
    try {
      await deletePatientAssignment(patientId, assignmentId, token);
      toast.success("Doctor removed from patient");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove assignment";
      toast.error("Remove failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Doctors</DialogTitle>
          <DialogDescription>
            จัดการแพทย์ผู้ดูแลของผู้ป่วย: <span className="font-medium">{patientName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3">
            <Label className="text-sm font-medium">Add doctor</Label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Select value={selectedDoctorId} onValueChange={(value) => setSelectedDoctorId(value ?? "")}>
                <SelectTrigger className="sm:flex-1">
                  {selectedDoctorId ? (
                    <SelectValue />
                  ) : (
                    <span className="text-sm text-muted-foreground">Select doctor</span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {availableDoctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {displayName(doctor)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => void handleAddDoctor()}
                disabled={!selectedDoctorId || submitting}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Assigned doctors</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading assignments...</p>
            ) : assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No doctors assigned.</p>
            ) : (
              <div className="space-y-2">
                {assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">{assignmentName(assignment)}</p>
                      <p className="text-xs text-muted-foreground">
                        {assignment.doctor?.email ?? assignment.doctor_id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={assignment.role === "primary" ? "default" : "secondary"}>
                        {assignment.role === "primary" ? "Primary" : "Consulting"}
                      </Badge>
                      {assignment.role !== "primary" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={submitting}
                          onClick={() => void handleMakePrimary(assignment.id)}
                        >
                          Make Primary
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={submitting}
                        onClick={() => void handleRemove(assignment.id)}
                      >
                        Remove
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
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
