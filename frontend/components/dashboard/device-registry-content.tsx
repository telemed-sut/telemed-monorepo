"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Trash2,
  MoreHorizontal,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

import {
  createDeviceRegistration,
  deleteDeviceRegistration,
  fetchDeviceRegistrations,
  updateDeviceRegistration,
  type ApiError,
  type DeviceRegistration,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getLocalizedDashboardErrorMessage } from "./dashboard-error-message";

const tr = (language: AppLanguage, en: string, th: string) => (language === "th" ? th : en);
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";
const DEVICE_REGISTRY_AUTO_REFRESH_MS = 15_000;
const DEVICE_REGISTRY_VALIDATION_TOAST_ID = "device-registry-required-fields";

type DeviceFilter = "all" | "active" | "inactive";
type CreateDeviceFormErrors = {
  deviceId?: string;
  displayName?: string;
};

function formatDateTime(dateTime: string, language: AppLanguage): string {
  return new Date(dateTime).toLocaleString(localeOf(language), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatLastSeen(lastSeen: string | null, language: AppLanguage): string {
  if (!lastSeen) return tr(language, "No data yet", "ยังไม่มีข้อมูล");
  const value = new Date(lastSeen);
  return value.toLocaleString(localeOf(language), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DeviceRegistryContent() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);

  const [devices, setDevices] = useState<DeviceRegistration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [deviceId, setDeviceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [formErrors, setFormErrors] = useState<CreateDeviceFormErrors>({});
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const deviceIdInputRef = useRef<HTMLInputElement | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  const activeCount = useMemo(() => devices.filter((d) => d.is_active).length, [devices]);

  const handleAuthError = useCallback(
    (error: ApiError) => {
      if (error.status === 401) {
        clearToken();
        router.replace("/login");
      }
    },
    [clearToken, router],
  );

  const loadDevices = useCallback(
    async (options?: { silent?: boolean; showErrorToast?: boolean }) => {
      if (!token) return;
      const silent = options?.silent ?? false;
      const showErrorToast = options?.showErrorToast ?? !silent;
      if (!silent) setLoading(true);
      if (silent) setRefreshing(true);

      try {
        const response = await fetchDeviceRegistrations(
          {
            page,
            limit: pageSize,
            q: searchQuery || undefined,
            is_active: filter === "all" ? undefined : filter === "active",
          },
          token,
        );
        setDevices(response.items);
        setTotal(response.total);
      } catch (error: unknown) {
        const apiError = error as ApiError;
        handleAuthError(apiError);
        if (showErrorToast) {
          toast.error(tr(language, "Unable to load device list", "ไม่สามารถโหลดรายการอุปกรณ์ได้"), {
            description: getLocalizedDashboardErrorMessage(
              apiError,
              language,
              "Unable to load device list",
              "ไม่สามารถโหลดรายการอุปกรณ์ได้"
            ),
          });
        }
      } finally {
        if (!silent) setLoading(false);
        if (silent) setRefreshing(false);
      }
    },
    [token, page, searchQuery, filter, handleAuthError, language],
  );

  useEffect(() => {
    if (!token) return;
    void loadDevices();
  }, [token, loadDevices]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      setPage((prev) => (prev === 1 ? prev : 1));
      setSearchQuery((prev) => (prev === trimmed ? prev : trimmed));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!token || !autoRefreshEnabled) return;

    const intervalId = window.setInterval(() => {
      if (loading || refreshing || submitting || Boolean(savingId)) return;
      void loadDevices({ silent: true, showErrorToast: false });
    }, DEVICE_REGISTRY_AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [token, autoRefreshEnabled, loading, refreshing, submitting, savingId, loadDevices]);

  const resetForm = () => {
    setDeviceId("");
    setDisplayName("");
    setNotes("");
    setFormErrors({});
    toast.dismiss(DEVICE_REGISTRY_VALIDATION_TOAST_ID);
  };

  const handleCreate = async () => {
    if (!token) return;
    const normalizedDeviceId = deviceId.trim();
    const normalizedName = displayName.trim();

    const nextErrors: CreateDeviceFormErrors = {};
    if (!normalizedDeviceId) {
      nextErrors.deviceId = tr(language, "Please enter Device ID", "กรุณากรอก Device ID");
    }
    if (!normalizedName) {
      nextErrors.displayName = tr(language, "Please enter Device Name", "กรุณากรอกชื่ออุปกรณ์");
    }

    if (nextErrors.deviceId || nextErrors.displayName) {
      setFormErrors(nextErrors);
      toast.warning(tr(language, "Please fill Device ID and Device Name", "กรุณากรอก Device ID และชื่ออุปกรณ์"), {
        id: DEVICE_REGISTRY_VALIDATION_TOAST_ID,
        description: tr(
          language,
          "Complete the required fields before registering a device.",
          "กรอกข้อมูลที่จำเป็นให้ครบก่อนลงทะเบียนอุปกรณ์"
        ),
      });

      if (nextErrors.deviceId) {
        deviceIdInputRef.current?.focus();
        return;
      }

      displayNameInputRef.current?.focus();
      return;
    }

    setFormErrors({});
    toast.dismiss(DEVICE_REGISTRY_VALIDATION_TOAST_ID);

    setSubmitting(true);
    try {
      await createDeviceRegistration(
        {
          device_id: normalizedDeviceId,
          display_name: normalizedName,
          notes: notes.trim() || undefined,
          is_active: true,
        },
        token,
      );
      resetForm();
      toast.success(tr(language, "Device registered successfully", "ลงทะเบียนอุปกรณ์สำเร็จแล้ว"));
      setPage(1);
      void loadDevices({ silent: true });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      handleAuthError(apiError);
      toast.error(tr(language, "Unable to register device", "ไม่สามารถลงทะเบียนอุปกรณ์ได้"), {
        description: getLocalizedDashboardErrorMessage(
          apiError,
          language,
          "Unable to register device",
          "ไม่สามารถลงทะเบียนอุปกรณ์ได้"
        ),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (device: DeviceRegistration) => {
    if (!token) return;
    setSavingId(device.id);
    try {
      await updateDeviceRegistration(device.device_id, { is_active: !device.is_active }, token);
      toast.success(
        device.is_active
          ? tr(language, "Device deactivated", "ปิดการใช้งานอุปกรณ์แล้ว")
          : tr(language, "Device activated", "เปิดการใช้งานอุปกรณ์แล้ว"),
      );
      void loadDevices({ silent: true });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      handleAuthError(apiError);
      toast.error(tr(language, "Unable to update device status", "ไม่สามารถอัปเดตสถานะอุปกรณ์ได้"), {
        description: getLocalizedDashboardErrorMessage(
          apiError,
          language,
          "Unable to update device status",
          "ไม่สามารถอัปเดตสถานะอุปกรณ์ได้"
        ),
      });
    } finally {
      setSavingId(null);
    }
  };

  const requestToggleActive = (device: DeviceRegistration) => {
    const isDeactivating = device.is_active;
    const title = isDeactivating
      ? tr(language, "Deactivate device?", "ปิดการใช้งานอุปกรณ์นี้ใช่ไหม?")
      : tr(language, "Activate device?", "เปิดการใช้งานอุปกรณ์นี้ใช่ไหม?");
    const description = isDeactivating
      ? tr(
          language,
          `${device.display_name} will stop accepting new device activity until it is activated again.`,
          `${device.display_name} จะหยุดรับการทำงานใหม่จนกว่าจะถูกเปิดใช้งานอีกครั้ง`
        )
      : tr(
          language,
          `${device.display_name} will be available for monitoring again immediately.`,
          `${device.display_name} จะกลับมาใช้งานสำหรับการมอนิเตอร์ได้ทันที`
        );

    const notify = isDeactivating ? toast.warningAction : toast.action;
    notify(title, {
      description,
      button: {
        title: isDeactivating
          ? tr(language, "Deactivate", "ปิดใช้งาน")
          : tr(language, "Activate", "เปิดใช้งาน"),
        onClick: () => {
          void handleToggleActive(device);
        },
      },
    });
  };

  const requestDeleteDevice = (device: DeviceRegistration) => {
    toast.destructiveAction(tr(language, "Delete device?", "ลบอุปกรณ์นี้ใช่ไหม?"), {
      description: tr(
        language,
        `${device.display_name} (${device.device_id}) will be removed permanently from the registry.`,
        `${device.display_name} (${device.device_id}) จะถูกลบออกจากทะเบียนอุปกรณ์อย่างถาวร`
      ),
      button: {
        title: tr(language, "Delete device", "ลบอุปกรณ์"),
        onClick: () => {
          void handleDeleteDevice(device);
        },
      },
    });
  };

  const handleDeleteDevice = async (device: DeviceRegistration) => {
    if (!token) return;
    setSavingId(device.id);
    try {
      await deleteDeviceRegistration(device.device_id, token);
      toast.success(tr(language, "Device deleted", "ลบอุปกรณ์เรียบร้อยแล้ว"));
      if (devices.length === 1 && page > 1) {
        setPage((prev) => Math.max(1, prev - 1));
      } else {
        void loadDevices({ silent: true });
      }
    } catch (error: unknown) {
      const apiError = error as ApiError;
      handleAuthError(apiError);
      toast.error(tr(language, "Unable to delete device", "ไม่สามารถลบอุปกรณ์ได้"), {
        description: getLocalizedDashboardErrorMessage(
          apiError,
          language,
          "Unable to delete device",
          "ไม่สามารถลบอุปกรณ์ได้"
        ),
      });
    } finally {
      setSavingId(null);
    }
  };

  if (!hydrated || !token) return null;

  return (
    <main className="flex-1 overflow-auto p-3 sm:p-5 lg:p-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <Card className="border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-white to-cyan-50">
          <CardHeader className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <CardTitle className="text-2xl font-semibold">
                  {tr(language, "Device Registration Center", "ศูนย์ลงทะเบียนอุปกรณ์")}
                </CardTitle>
                <CardDescription className="mt-2 text-base leading-7 text-slate-700">
                  {tr(
                    language,
                    "Register blood pressure devices, issue secure secrets, and control each device status from one screen.",
                    "ลงทะเบียนเครื่องวัดความดัน ออกรหัสลับ และควบคุมสถานะอุปกรณ์ได้จากหน้าจอนี้หน้าเดียว",
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-white/90 p-4">
                <p className="text-sm text-slate-600">{tr(language, "Total devices", "อุปกรณ์ทั้งหมด")}</p>
                <p className="mt-1 text-3xl font-semibold text-slate-900">{total}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-white/90 p-4">
                <p className="text-sm text-slate-600">{tr(language, "Active in this page", "ที่เปิดใช้งานในหน้านี้")}</p>
                <p className="mt-1 text-3xl font-semibold text-emerald-700">{activeCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-white/90 p-4">
                <p className="text-sm text-slate-600">{tr(language, "Current page", "หน้าปัจจุบัน")}</p>
                <p className="mt-1 text-3xl font-semibold text-slate-900">
                  {page}/{totalPages}
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{tr(language, "Register new device", "ลงทะเบียนอุปกรณ์ใหม่")}</CardTitle>
            <CardDescription className="text-base">
              {tr(language, "Fill 2 required fields and click register.", "กรอกข้อมูลจำเป็น 2 ช่อง แล้วกดลงทะเบียน")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-base font-medium">{tr(language, "Device ID", "รหัสอุปกรณ์")}</span>
                <Input
                  ref={deviceIdInputRef}
                  value={deviceId}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDeviceId(nextValue);
                    if (nextValue.trim()) {
                      setFormErrors((prev) => ({ ...prev, deviceId: undefined }));
                    }
                  }}
                  placeholder={tr(language, "e.g. ward-bp-001", "เช่น ward-bp-001")}
                  aria-invalid={Boolean(formErrors.deviceId)}
                  className={cn(
                    "h-12 text-base",
                    formErrors.deviceId && "border-amber-400 ring-amber-200 focus-visible:border-amber-500"
                  )}
                />
                {formErrors.deviceId ? (
                  <p className="text-sm font-medium text-amber-700">{formErrors.deviceId}</p>
                ) : null}
              </label>
              <label className="grid gap-2">
                <span className="text-base font-medium">{tr(language, "Device Name", "ชื่ออุปกรณ์")}</span>
                <Input
                  ref={displayNameInputRef}
                  value={displayName}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDisplayName(nextValue);
                    if (nextValue.trim()) {
                      setFormErrors((prev) => ({ ...prev, displayName: undefined }));
                    }
                  }}
                  placeholder={tr(language, "e.g. Ward Bed 1 monitor", "เช่น เครื่องวัดเตียง 1")}
                  aria-invalid={Boolean(formErrors.displayName)}
                  className={cn(
                    "h-12 text-base",
                    formErrors.displayName && "border-amber-400 ring-amber-200 focus-visible:border-amber-500"
                  )}
                />
                {formErrors.displayName ? (
                  <p className="text-sm font-medium text-amber-700">{formErrors.displayName}</p>
                ) : null}
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-base font-medium">{tr(language, "Notes (optional)", "หมายเหตุ (ไม่บังคับ)")}</span>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={tr(language, "Where this device is placed", "ตำแหน่งวางอุปกรณ์")}
                className="min-h-24 text-base"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleCreate} disabled={submitting} className="h-12 px-7 text-base">
                {submitting ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}
                {tr(language, "Register device", "ลงทะเบียนอุปกรณ์")}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="h-12 px-6 text-base">
                {tr(language, "Clear form", "ล้างฟอร์ม")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-xl">{tr(language, "Registered devices", "อุปกรณ์ที่ลงทะเบียนแล้ว")}</CardTitle>
                <CardDescription className="text-base">
                  {tr(language, "Search and activate/deactivate devices.", "ค้นหา และเปิด/ปิดการใช้งานอุปกรณ์")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={autoRefreshEnabled ? "default" : "outline"}
                  onClick={() => setAutoRefreshEnabled((prev) => !prev)}
                  className="h-11 px-4 text-base"
                >
                  <RefreshCw className={cn("mr-2 size-4", autoRefreshEnabled && "animate-spin")} />
                  {autoRefreshEnabled
                    ? tr(language, "Auto refresh on", "รีเฟรชอัตโนมัติ: เปิด")
                    : tr(language, "Auto refresh off", "รีเฟรชอัตโนมัติ: ปิด")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void loadDevices({ silent: true, showErrorToast: true })}
                  className="h-11 px-4 text-base"
                  disabled={refreshing}
                >
                  <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
                  {tr(language, "Refresh", "รีเฟรช")}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={tr(language, "Search by Device ID or Name", "ค้นหาด้วยรหัสอุปกรณ์หรือชื่อ")}
                  className="h-12 pl-10 text-base"
                />
              </div>
              <div className="inline-flex rounded-xl border p-1">
                <Button
                  type="button"
                  variant={filter === "all" ? "default" : "ghost"}
                  onClick={() => {
                    setPage(1);
                    setFilter("all");
                  }}
                  className="h-10 text-sm"
                >
                  {tr(language, "All", "ทั้งหมด")}
                </Button>
                <Button
                  type="button"
                  variant={filter === "active" ? "default" : "ghost"}
                  onClick={() => {
                    setPage(1);
                    setFilter("active");
                  }}
                  className="h-10 text-sm"
                >
                  {tr(language, "Active", "ใช้งานอยู่")}
                </Button>
                <Button
                  type="button"
                  variant={filter === "inactive" ? "default" : "ghost"}
                  onClick={() => {
                    setPage(1);
                    setFilter("inactive");
                  }}
                  className="h-10 text-sm"
                >
                  {tr(language, "Inactive", "ปิดใช้งาน")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-xl border">
              <Table className="text-sm sm:text-base">
                <TableHeader className="[&_tr]:border-b bg-muted/40">
                  <TableRow className="hover:bg-muted/40">
                    <TableHead className="h-12 px-4 min-w-[180px]">
                      {tr(language, "Device", "อุปกรณ์")}
                    </TableHead>
                    <TableHead className="h-12 px-4 min-w-[100px]">
                      {tr(language, "Status", "สถานะ")}
                    </TableHead>
                    <TableHead className="h-12 px-4 min-w-[140px]">
                      {tr(language, "Last seen", "รับข้อมูลล่าสุด")}
                    </TableHead>
                    <TableHead className="h-12 px-4 hidden lg:table-cell min-w-[150px]">
                      {tr(language, "Created", "สร้างเมื่อ")}
                    </TableHead>
                    <TableHead className="h-12 px-4 hidden xl:table-cell min-w-[170px]">
                      {tr(language, "Notes", "หมายเหตุ")}
                    </TableHead>
                    <TableHead className="h-12 px-4 text-right min-w-[180px]">
                      {tr(language, "Actions", "การทำงาน")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={`device-skeleton-${index}`}>
                        <TableCell className="px-4 py-3">
                          <Skeleton className="h-5 w-40" />
                          <Skeleton className="mt-2 h-4 w-52" />
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Skeleton className="h-6 w-24 rounded-full" />
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Skeleton className="h-4 w-36" />
                        </TableCell>
                        <TableCell className="px-4 py-3 hidden lg:table-cell">
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell className="px-4 py-3 hidden xl:table-cell">
                          <Skeleton className="h-4 w-48" />
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <div className="ml-auto flex w-full max-w-[180px] gap-2">
                            <Skeleton className="h-9 w-20" />
                            <Skeleton className="h-9 w-20" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : devices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-28 text-center text-base text-muted-foreground">
                        {tr(language, "No devices found", "ไม่พบอุปกรณ์")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    devices.map((device) => (
                      <TableRow key={device.id}>
                        <TableCell className="px-4 py-3 align-top whitespace-normal">
                          <p className="font-semibold">{device.display_name}</p>
                          <p className="mt-1 font-mono text-sm text-muted-foreground break-all">{device.device_id}</p>
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top">
                          <Badge
                            className={cn(
                              "rounded-full px-3 py-1 text-sm",
                              device.is_active
                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                                : "bg-slate-200 text-slate-700 hover:bg-slate-200",
                            )}
                          >
                            {device.is_active
                              ? tr(language, "Active", "ใช้งานอยู่")
                              : tr(language, "Inactive", "ปิดใช้งาน")}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top text-sm text-muted-foreground whitespace-normal">
                          {formatLastSeen(device.last_seen_at, language)}
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top text-sm text-muted-foreground whitespace-normal hidden lg:table-cell">
                          {formatDateTime(device.created_at, language)}
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top text-sm text-muted-foreground whitespace-normal hidden xl:table-cell max-w-[300px]">
                          {device.notes || tr(language, "-", "-")}
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top">
                          <div className="hidden sm:flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => requestDeleteDevice(device)}
                              disabled={savingId === device.id}
                              className="h-10 text-sm text-destructive hover:text-destructive"
                            >
                              <Trash2 className="mr-2 size-4" />
                              {tr(language, "Delete", "ลบ")}
                            </Button>
                            <Button
                              type="button"
                              variant={device.is_active ? "destructive" : "default"}
                              onClick={() => requestToggleActive(device)}
                              disabled={savingId === device.id}
                              className="h-10 text-sm"
                            >
                              {device.is_active ? <PowerOff className="mr-2 size-4" /> : <Power className="mr-2 size-4" />}
                              {device.is_active
                                ? tr(language, "Disable", "ปิดใช้งาน")
                                : tr(language, "Enable", "เปิดใช้งาน")}
                            </Button>
                          </div>
                          <div className="flex justify-end sm:hidden">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                disabled={savingId === device.id}
                                aria-label={tr(language, "More actions", "การทำงานเพิ่มเติม")}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                              >
                                {savingId === device.id ? (
                                  <RefreshCw className="size-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="size-4" />
                                )}
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  onClick={() => requestDeleteDevice(device)}
                                  disabled={savingId === device.id}
                                  variant="destructive"
                                >
                                  <Trash2 className="size-4" />
                                  {tr(language, "Delete", "ลบ")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => requestToggleActive(device)}
                                  disabled={savingId === device.id}
                                  variant={device.is_active ? "destructive" : "default"}
                                >
                                  {device.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                                  {device.is_active
                                    ? tr(language, "Disable", "ปิดใช้งาน")
                                    : tr(language, "Enable", "เปิดใช้งาน")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {tr(language, "Page", "หน้า")} {page} / {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1 || loading}
                  className="h-10"
                >
                  {tr(language, "Previous", "ก่อนหน้า")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages || loading}
                  className="h-10"
                >
                  {tr(language, "Next", "ถัดไป")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
