"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { th as thLocale, enGB } from "date-fns/locale";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import {
  Drawer,
  DrawerClose,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  createPatientWeightRecord,
  deletePatientWeightRecord,
  fetchPatientWeightRecords,
  updatePatientWeightRecord,
} from "@/lib/api-patients";
import { getErrorMessage, type ApiError } from "@/lib/api";
import type { AppLanguage } from "@/store/language-config";
import type { WeightRecord, WeightRecordPayload } from "@/lib/api-types";
import { useAuthStore } from "@/store/auth-store";

interface PatientVitalsManagerProps {
  patientId: string;
  language: AppLanguage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecordsChanged: () => void;
}

type FormValues = {
  weight: string;
  height: string;
};

const EMPTY_FORM: FormValues = { weight: "", height: "" };

const parseOptionalNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const formatNumber = (value: number) =>
  Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, "");

const isNotFoundError = (error: unknown): error is ApiError =>
  error instanceof Error && (error as ApiError).status === 404;

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
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newForm, setNewForm] = useState<FormValues>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<FormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isTh = language === "th";
  const dateLocale = isTh ? thLocale : enGB;
  const tr = useCallback((en: string, th: string) => (isTh ? th : en), [isTh]);

  const latestRecord = records[0] ?? null;
  const loadingRecordRows = Math.max(records.length, 1);
  const averageWeight = useMemo(() => {
    if (records.length === 0) return null;
    const total = records.reduce((sum, record) => sum + record.weight_kg, 0);
    return total / records.length;
  }, [records]);

  const formatDateTime = (dateValue: string | null) =>
    dateValue
      ? format(parseISO(dateValue), "d MMM yyyy, HH:mm", { locale: dateLocale })
      : tr("No timestamp", "ไม่มีเวลาบันทึก");

  const validateForm = (values: FormValues): WeightRecordPayload | null => {
    const weight = parseOptionalNumber(values.weight);
    const height = parseOptionalNumber(values.height);

    if (weight === null || Number.isNaN(weight) || weight <= 0 || weight > 500) {
      setFormError(tr("Enter a valid weight between 0 and 500 kg.", "กรอกน้ำหนักให้ถูกต้องระหว่าง 0 ถึง 500 กก."));
      return null;
    }

    if (height !== null && (Number.isNaN(height) || height <= 0 || height > 260)) {
      setFormError(tr("Enter a valid height between 0 and 260 cm.", "กรอกส่วนสูงให้ถูกต้องระหว่าง 0 ถึง 260 ซม."));
      return null;
    }

    setFormError(null);
    return { weight_kg: weight, height_cm: height };
  };

  const loadRecords = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!token || !open) return;
    if (!options.silent) {
      setLoading(true);
    }
    setLoadError(null);

    try {
      const res = await fetchPatientWeightRecords(patientId, token);
      setRecords(res.items);
    } catch (err) {
      const message = getErrorMessage(
        err,
        tr("Weight records could not be loaded.", "ยังไม่สามารถโหลดข้อมูลน้ำหนักได้")
      );
      setLoadError(message);
      toast.error(message);
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [open, patientId, token, tr]);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setNewForm(EMPTY_FORM);
    setEditForm(EMPTY_FORM);
    setFormError(null);
    void loadRecords();
  }, [open, patientId, token, loadRecords]);

  const refreshGraphAndList = async () => {
    await loadRecords({ silent: true });
    onRecordsChanged();
  };

  const handleCreate = async () => {
    if (!token || saving) return;
    const payload = validateForm(newForm);
    if (!payload) return;

    setSaving(true);
    try {
      await createPatientWeightRecord(patientId, payload, token);
      setNewForm(EMPTY_FORM);
      toast.success(tr("Weight record added", "เพิ่มข้อมูลน้ำหนักแล้ว"));
      await refreshGraphAndList();
    } catch (err) {
      toast.error(
        getErrorMessage(err, tr("Failed to add weight record", "เพิ่มข้อมูลน้ำหนักไม่สำเร็จ"))
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (record: WeightRecord) => {
    setEditingId(record.id);
    setFormError(null);
    setEditForm({
      weight: formatNumber(record.weight_kg),
      height: record.height_cm != null ? formatNumber(record.height_cm) : "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setFormError(null);
  };

  const handleSaveEdit = async (recordId: string) => {
    if (!token || saving) return;
    const payload = validateForm(editForm);
    if (!payload) return;

    setSaving(true);
    try {
      await updatePatientWeightRecord(patientId, recordId, payload, token);
      setEditingId(null);
      setEditForm(EMPTY_FORM);
      toast.success(tr("Weight record updated", "แก้ไขข้อมูลน้ำหนักแล้ว"));
      await refreshGraphAndList();
    } catch (err) {
      toast.error(
        getErrorMessage(err, tr("Failed to update weight record", "แก้ไขข้อมูลน้ำหนักไม่สำเร็จ"))
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: WeightRecord) => {
    if (!token || deletingId) return;
    setDeletingId(record.id);
    try {
      await deletePatientWeightRecord(patientId, record.id, token);
      toast.success(tr("Weight record deleted", "ลบข้อมูลน้ำหนักแล้ว"));
      await refreshGraphAndList();
    } catch (err) {
      if (isNotFoundError(err)) {
        setRecords((current) => current.filter((item) => item.id !== record.id));
        if (editingId === record.id) {
          handleCancelEdit();
        }
        toast.info(tr("Record already removed", "รายการนี้ถูกลบไปแล้ว"), {
          description: tr(
            "The list has been refreshed.",
            "รีเฟรชรายการให้แล้ว"
          ),
        });
        await refreshGraphAndList();
        return;
      }
      toast.error(
        getErrorMessage(err, tr("Failed to delete weight record", "ลบข้อมูลน้ำหนักไม่สำเร็จ"))
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAction = (record: WeightRecord) => {
    toast.destructiveAction(tr("Delete this weight record?", "ลบข้อมูลน้ำหนักรายการนี้ใช่ไหม?"), {
      description: tr(
        "The trend chart will update after this record is deleted.",
        "กราฟแนวโน้มจะอัปเดตหลังลบรายการนี้"
      ),
      button: {
        title: tr("Delete", "ลบ"),
        onClick: () => {
          void handleDelete(record);
        },
      },
      duration: 9000,
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerPopup showBar className="h-[78dvh] max-h-[720px] overflow-hidden">
        <DrawerHeader>
          <DrawerTitle>{tr("Manage chart records", "จัดการข้อมูลบนกราฟ")}</DrawerTitle>
        </DrawerHeader>

        <DrawerPanel>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">{tr("Latest weight", "น้ำหนักล่าสุด")}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {latestRecord ? `${formatNumber(latestRecord.weight_kg)} kg` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {latestRecord ? formatDateTime(latestRecord.measured_at ?? latestRecord.created_at) : tr("No record yet", "ยังไม่มีข้อมูล")}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">{tr("Latest BMI", "BMI ล่าสุด")}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {latestRecord?.bmi != null ? formatNumber(latestRecord.bmi) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {latestRecord?.height_cm != null
                  ? `${tr("Height", "ส่วนสูง")} ${formatNumber(latestRecord.height_cm)} cm`
                  : tr("Height not recorded", "ยังไม่บันทึกส่วนสูง")}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">{tr("Records", "จำนวนรายการ")}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{records.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {averageWeight != null
                  ? `${tr("Average", "เฉลี่ย")} ${formatNumber(averageWeight)} kg`
                  : tr("Waiting for data", "รอข้อมูล")}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {tr("Add a new weight reading", "เพิ่มค่าน้ำหนักใหม่")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr(
                    "The server will timestamp this as a new clinical record.",
                    "ระบบจะบันทึกเวลาให้อัตโนมัติเป็นรายการใหม่"
                  )}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => loadRecords()} disabled={loading || saving}>
                <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
                {tr("Refresh", "รีเฟรช")}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="new-weight">{tr("Weight (kg)", "น้ำหนัก (กก.)")}</Label>
                <Input
                  id="new-weight"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="500"
                  step="0.1"
                  value={newForm.weight}
                  onChange={(event) => setNewForm((current) => ({ ...current, weight: event.target.value }))}
                  placeholder="72.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-height">{tr("Height (cm)", "ส่วนสูง (ซม.)")}</Label>
                <Input
                  id="new-height"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="260"
                  step="0.1"
                  value={newForm.height}
                  onChange={(event) => setNewForm((current) => ({ ...current, height: event.target.value }))}
                  placeholder="170"
                />
              </div>
              <Button className="sm:min-w-28" onClick={handleCreate} disabled={saving || loading}>
                <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />
                {saving ? tr("Saving", "กำลังบันทึก") : tr("Add", "เพิ่ม")}
              </Button>
            </div>

            {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}
            {loadError ? <p className="mt-3 text-sm text-red-600">{loadError}</p> : null}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {tr("Record history", "ประวัติข้อมูล")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {tr("Newest first", "รายการล่าสุดอยู่บนสุด")}
              </span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: loadingRecordRows }).map((_, index) => (
                  <div key={index} className="rounded-xl border border-border/70 p-4">
                    <Skeleton className="h-4 w-44" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {tr("No weight records yet", "ยังไม่มีข้อมูลน้ำหนัก")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tr("Add the first reading above to start the trend.", "เพิ่มรายการแรกด้านบนเพื่อเริ่มกราฟแนวโน้ม")}
                </p>
              </div>
            ) : (
              records.map((record) => {
                const isEditing = editingId === record.id;
                const isDeleting = deletingId === record.id;

                return (
                  <div key={record.id} className="rounded-xl border border-border/70 bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {formatDateTime(record.measured_at ?? record.created_at)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {record.recorded_by
                            ? tr("Recorded by care team", "บันทึกโดยทีมดูแล")
                            : tr("Recorded by patient app or system", "บันทึกจากแอปผู้ป่วยหรือระบบ")}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                              onClick={() => handleSaveEdit(record.id)}
                              disabled={saving}
                              aria-label={tr("Save record", "บันทึกรายการ")}
                            >
                              <HugeiconsIcon icon={Tick02Icon} className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground"
                              onClick={handleCancelEdit}
                              disabled={saving}
                              aria-label={tr("Cancel edit", "ยกเลิกการแก้ไข")}
                            >
                              <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-blue-600"
                              onClick={() => handleEditClick(record)}
                              aria-label={tr("Edit record", "แก้ไขรายการ")}
                            >
                              <HugeiconsIcon icon={PencilEdit02Icon} className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                              onClick={() => handleDeleteAction(record)}
                              disabled={isDeleting}
                              aria-label={tr("Delete record", "ลบรายการ")}
                            >
                              <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`edit-weight-${record.id}`}>{tr("Weight (kg)", "น้ำหนัก (กก.)")}</Label>
                          <Input
                            id={`edit-weight-${record.id}`}
                            inputMode="decimal"
                            type="number"
                            min="0"
                            max="500"
                            step="0.1"
                            value={editForm.weight}
                            onChange={(event) => setEditForm((current) => ({ ...current, weight: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-height-${record.id}`}>{tr("Height (cm)", "ส่วนสูง (ซม.)")}</Label>
                          <Input
                            id={`edit-height-${record.id}`}
                            inputMode="decimal"
                            type="number"
                            min="0"
                            max="260"
                            step="0.1"
                            value={editForm.height}
                            onChange={(event) => setEditForm((current) => ({ ...current, height: event.target.value }))}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="text-xs text-muted-foreground">{tr("Weight", "น้ำหนัก")}</p>
                          <p className="mt-1 text-base font-semibold text-foreground">
                            {formatNumber(record.weight_kg)} kg
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="text-xs text-muted-foreground">{tr("Height", "ส่วนสูง")}</p>
                          <p className="mt-1 text-base font-semibold text-foreground">
                            {record.height_cm != null ? `${formatNumber(record.height_cm)} cm` : "—"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="text-xs text-muted-foreground">BMI</p>
                          <p className="mt-1 text-base font-semibold text-foreground">
                            {record.bmi != null ? formatNumber(record.bmi) : "—"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DrawerPanel>
        <DrawerFooter>
          <DrawerClose render={<Button variant="outline" />}>
            {tr("Close", "ปิด")}
          </DrawerClose>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
}
