"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from "@tanstack/react-table";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  Clock3,
  PencilLine,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
  PlusCircle,
} from "lucide-react";

import {
  createDeviceRegistration,
  deleteDeviceRegistration,
  fetchDeviceRegistrations,
  updateDeviceRegistration,
  type ApiError,
  type DeviceExamMeasurementType,
  type DeviceRegistration,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getLocalizedDashboardErrorMessage } from "./dashboard-error-message";

const tr = (language: AppLanguage, en: string, th: string) => (language === "th" ? th : en);
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";
const DEVICE_REGISTRY_LIVE_SYNC_MS = 15_000;
const DEVICE_REGISTRY_VALIDATION_TOAST_ID = "device-registry-required-fields";
const DEVICE_REGISTRY_RESULT_TOAST_ID = "device-registry-result";
const DEFAULT_MEASUREMENT_TYPE: DeviceExamMeasurementType = "lung_sound";
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const MEASUREMENT_OPTIONS: DeviceExamMeasurementType[] = [
  "lung_sound",
  "heart_sound",
  "blood_pressure",
  "multi",
];

type DeviceFilter = "all" | "active" | "inactive";
type CreateDeviceFormErrors = {
  deviceId?: string;
  displayName?: string;
};
type EditDeviceFormErrors = {
  displayName?: string;
};
type PendingDeviceAction = {
  type: "delete" | "toggle";
  device: DeviceRegistration;
};
type LoadDeviceOptions = {
  silent?: boolean;
  showErrorToast?: boolean;
  page?: number;
  searchQuery?: string;
  filter?: DeviceFilter;
  skipCache?: boolean;
};

function formatLastSeen(lastSeen: string | null, language: AppLanguage): string {
  if (!lastSeen) return tr(language, "No data yet", "ยังไม่มีข้อมูล");
  const value = new Date(lastSeen);
  return value.toLocaleString(localeOf(language), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function measurementLabel(value: DeviceExamMeasurementType, language: AppLanguage): string {
  switch (value) {
    case "lung_sound":
      return tr(language, "Lung sound", "เสียงปอด");
    case "heart_sound":
      return tr(language, "Heart sound", "เสียงหัวใจ");
    case "blood_pressure":
      return tr(language, "Blood pressure", "ความดัน");
    default:
      return tr(language, "Multi-mode", "หลายโหมด");
  }
}

function MeasurementTypeBadge({
  value,
  language,
}: {
  value: DeviceExamMeasurementType;
  language: AppLanguage;
}) {
  return (
    <Badge 
      variant="outline" 
      className="inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium border-0 bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/50 hover:bg-sky-50"
    >
      {measurementLabel(value, language)}
    </Badge>
  );
}

function deviceMatchesView(device: DeviceRegistration, filter: DeviceFilter, searchQuery: string): boolean {
  if (filter === "active" && !device.is_active) return false;
  if (filter === "inactive" && device.is_active) return false;

  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;

  return (
    device.device_id.toLowerCase().includes(query) ||
    device.display_name.toLowerCase().includes(query)
  );
}

function createOptimisticDeviceRegistration(
  deviceId: string,
  displayName: string,
  notes: string,
  defaultMeasurementType: DeviceExamMeasurementType,
): DeviceRegistration {
  const now = new Date().toISOString();
  return {
    id: `pending-${deviceId}-${Date.now()}`,
    device_id: deviceId,
    display_name: displayName,
    notes: notes || null,
    default_measurement_type: defaultMeasurementType,
    is_active: true,
    last_seen_at: null,
    deactivated_at: null,
    created_at: now,
    updated_at: now,
  };
}

function DeviceStatusBadge({
  device,
  language,
  className,
}: {
  device: DeviceRegistration;
  language: AppLanguage;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border-0",
        device.is_active
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/50 hover:bg-emerald-50"
          : "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/50 hover:bg-slate-100",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          device.is_active ? "bg-emerald-500" : "bg-slate-400"
        )}
      />
      {device.is_active
        ? tr(language, "Active", "ใช้งานอยู่")
        : tr(language, "Inactive", "ปิดใช้งาน")}
    </Badge>
  );
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
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [deviceId, setDeviceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [defaultMeasurementType, setDefaultMeasurementType] =
    useState<DeviceExamMeasurementType>(DEFAULT_MEASUREMENT_TYPE);
  const [formErrors, setFormErrors] = useState<CreateDeviceFormErrors>({});
  const [editFormErrors, setEditFormErrors] = useState<EditDeviceFormErrors>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceRegistration | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDefaultMeasurementType, setEditDefaultMeasurementType] =
    useState<DeviceExamMeasurementType>(DEFAULT_MEASUREMENT_TYPE);
  const [pendingAction, setPendingAction] = useState<PendingDeviceAction | null>(null);
  const routerRef = useRef(router);
  const deviceIdInputRef = useRef<HTMLInputElement | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const editDisplayNameInputRef = useRef<HTMLInputElement | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paginationPages = useMemo(() => {
    const pages = new Set([1, totalPages, page - 1, page, page + 1]);
    return Array.from(pages)
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((a, b) => a - b);
  }, [page, totalPages]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  const activeCount = useMemo(() => devices.filter((d) => d.is_active).length, [devices]);
  const inactiveCount = useMemo(() => devices.filter((d) => !d.is_active).length, [devices]);
  const noSignalCount = useMemo(() => devices.filter((d) => !d.last_seen_at).length, [devices]);

  const handleAuthError = useCallback(
    (error: ApiError) => {
      if (error.status === 401) {
        clearToken();
        routerRef.current.replace("/login");
      }
    },
    [clearToken],
  );

  const loadDevices = useCallback(
    async (options?: LoadDeviceOptions) => {
      if (!token) return;
      const silent = options?.silent ?? false;
      const showErrorToast = options?.showErrorToast ?? !silent;
      const targetPage = options?.page ?? page;
      const targetSearchQuery = options?.searchQuery ?? searchQuery;
      const targetFilter = options?.filter ?? filter;
      if (!silent) setLoading(true);
      if (silent) setRefreshing(true);

      try {
        const response = await fetchDeviceRegistrations(
          {
            page: targetPage,
            limit: pageSize,
            q: targetSearchQuery || undefined,
            is_active: targetFilter === "all" ? undefined : targetFilter === "active",
            skipCache: options?.skipCache ?? true,
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
    [token, page, pageSize, searchQuery, filter, handleAuthError, language],
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
    if (!token) return;

    const intervalId = window.setInterval(() => {
      if (loading || refreshing || submitting || Boolean(savingId)) return;
      void loadDevices({ silent: true, showErrorToast: false, skipCache: true });
    }, DEVICE_REGISTRY_LIVE_SYNC_MS);

    return () => window.clearInterval(intervalId);
  }, [token, loading, refreshing, submitting, savingId, loadDevices]);

  const upsertVisibleDevice = useCallback(
    (device: DeviceRegistration, viewFilter: DeviceFilter = filter, viewSearchQuery: string = searchQuery) => {
      setDevices((currentDevices) => {
        const existingIndex = currentDevices.findIndex((item) => item.id === device.id);
        const matchesView = deviceMatchesView(device, viewFilter, viewSearchQuery);

        if (!matchesView) {
          return existingIndex >= 0
            ? currentDevices.filter((item) => item.id !== device.id)
            : currentDevices;
        }

        if (existingIndex >= 0) {
          return currentDevices.map((item) => (item.id === device.id ? device : item));
        }

        return [device, ...currentDevices].slice(0, pageSize);
      });
    },
    [filter, pageSize, searchQuery],
  );

  const resetForm = () => {
    setDeviceId("");
    setDisplayName("");
    setNotes("");
    setDefaultMeasurementType(DEFAULT_MEASUREMENT_TYPE);
    setFormErrors({});
    toast.dismiss(DEVICE_REGISTRY_VALIDATION_TOAST_ID);
  };

  const openEditSheet = useCallback((device: DeviceRegistration) => {
    setEditingDevice(device);
    setEditDisplayName(device.display_name);
    setEditNotes(device.notes ?? "");
    setEditDefaultMeasurementType(device.default_measurement_type);
    setEditFormErrors({});
    setEditSheetOpen(true);
  }, []);

  const resetEditForm = useCallback(() => {
    setEditingDevice(null);
    setEditDisplayName("");
    setEditNotes("");
    setEditDefaultMeasurementType(DEFAULT_MEASUREMENT_TYPE);
    setEditFormErrors({});
  }, []);

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
    const normalizedNotes = notes.trim();
    const optimisticDevice = createOptimisticDeviceRegistration(
      normalizedDeviceId,
      normalizedName,
      normalizedNotes,
      defaultMeasurementType,
    );
    resetForm();
    setRegisterDialogOpen(false);
    setFilter("all");
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
    setDevices((currentDevices) => [
      optimisticDevice,
      ...currentDevices.filter((item) => item.id !== optimisticDevice.id),
    ].slice(0, pageSize));
    setTotal((currentTotal) => currentTotal + 1);

    try {
      const created = await createDeviceRegistration(
        {
          device_id: normalizedDeviceId,
          display_name: normalizedName,
          notes: normalizedNotes || undefined,
          default_measurement_type: defaultMeasurementType,
          is_active: true,
        },
        token,
      );
      const visibleCreatedDevice: DeviceRegistration = {
        ...created.device,
        device_id: normalizedDeviceId,
        display_name: normalizedName,
        notes: normalizedNotes || null,
        default_measurement_type: defaultMeasurementType,
        is_active: true,
      };
      setDevices((currentDevices) => [
        visibleCreatedDevice,
        ...currentDevices.filter(
          (item) => item.id !== optimisticDevice.id && item.id !== visibleCreatedDevice.id
        ),
      ].slice(0, pageSize));
      toast.success(tr(language, "Device registered successfully", "ลงทะเบียนอุปกรณ์สำเร็จแล้ว"));
      void loadDevices({
        silent: true,
        showErrorToast: false,
        page: 1,
        searchQuery: "",
        filter: "all",
        skipCache: true,
      });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      setDevices((currentDevices) => currentDevices.filter((item) => item.id !== optimisticDevice.id));
      setTotal((currentTotal) => Math.max(0, currentTotal - 1));
      setDeviceId(normalizedDeviceId);
      setDisplayName(normalizedName);
      setNotes(normalizedNotes);
      setDefaultMeasurementType(defaultMeasurementType);
      setRegisterDialogOpen(true);
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

  const handleSaveDeviceDetails = useCallback(async () => {
    if (!token || !editingDevice) return;
    const normalizedName = editDisplayName.trim();
    const normalizedNotes = editNotes.trim();

    if (!normalizedName) {
      setEditFormErrors({
        displayName: tr(language, "Please enter Device Name", "กรุณากรอกชื่ออุปกรณ์"),
      });
      editDisplayNameInputRef.current?.focus();
      return;
    }

    setEditFormErrors({});
    setSavingId(editingDevice.id);
    const optimisticDevice: DeviceRegistration = {
      ...editingDevice,
      display_name: normalizedName,
      notes: normalizedNotes || null,
      default_measurement_type: editDefaultMeasurementType,
      updated_at: new Date().toISOString(),
    };
    upsertVisibleDevice(optimisticDevice);
    setEditSheetOpen(false);

    try {
      const updatedDevice = await updateDeviceRegistration(
        editingDevice.device_id,
        {
          display_name: normalizedName,
          notes: normalizedNotes || null,
          default_measurement_type: editDefaultMeasurementType,
        },
        token,
      );
      upsertVisibleDevice(updatedDevice);
      toast.success(tr(language, "Device details updated", "อัปเดตรายละเอียดอุปกรณ์แล้ว"), {
        id: DEVICE_REGISTRY_RESULT_TOAST_ID,
      });
      resetEditForm();
      void loadDevices({ silent: true, showErrorToast: false, skipCache: true });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      upsertVisibleDevice(editingDevice);
      handleAuthError(apiError);
      setEditingDevice(editingDevice);
      setEditDisplayName(normalizedName);
      setEditNotes(normalizedNotes);
      setEditDefaultMeasurementType(editDefaultMeasurementType);
      setEditSheetOpen(true);
      toast.error(tr(language, "Unable to update device details", "ไม่สามารถอัปเดตรายละเอียดอุปกรณ์ได้"), {
        description: getLocalizedDashboardErrorMessage(
          apiError,
          language,
          "Unable to update device details",
          "ไม่สามารถอัปเดตรายละเอียดอุปกรณ์ได้",
        ),
      });
    } finally {
      setSavingId(null);
    }
  }, [
    editDefaultMeasurementType,
    editDisplayName,
    editNotes,
    editingDevice,
    handleAuthError,
    language,
    loadDevices,
    resetEditForm,
    token,
    upsertVisibleDevice,
  ]);

  const handleToggleActive = async (device: DeviceRegistration) => {
    if (!token) return;
    const now = new Date().toISOString();
    const optimisticDevice: DeviceRegistration = {
      ...device,
      is_active: !device.is_active,
      deactivated_at: device.is_active ? now : null,
      updated_at: now,
    };
    const removedFromCurrentView = !deviceMatchesView(optimisticDevice, filter, searchQuery);
    setSavingId(device.id);
    upsertVisibleDevice(optimisticDevice);
    if (removedFromCurrentView) {
      setTotal((currentTotal) => Math.max(0, currentTotal - 1));
    }

    try {
      const updatedDevice = await updateDeviceRegistration(device.device_id, { is_active: !device.is_active }, token);
      const stillMatches = deviceMatchesView(updatedDevice, filter, searchQuery);
      upsertVisibleDevice(updatedDevice);
      if (!removedFromCurrentView && !stillMatches) {
        setTotal((currentTotal) => Math.max(0, currentTotal - 1));
      } else if (removedFromCurrentView && stillMatches) {
        setTotal((currentTotal) => currentTotal + 1);
      }
      toast.success(
        device.is_active
          ? tr(language, "Device deactivated", "ปิดการใช้งานอุปกรณ์แล้ว")
          : tr(language, "Device activated", "เปิดการใช้งานอุปกรณ์แล้ว"),
        { id: DEVICE_REGISTRY_RESULT_TOAST_ID },
      );
      void loadDevices({ silent: true, showErrorToast: false, skipCache: true });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      upsertVisibleDevice(device);
      if (removedFromCurrentView) {
        setTotal((currentTotal) => currentTotal + 1);
      }
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

  const requestToggleActive = useCallback((device: DeviceRegistration) => {
    setPendingAction({ type: "toggle", device });
  }, []);

  const requestDeleteDevice = useCallback((device: DeviceRegistration) => {
    setPendingAction({ type: "delete", device });
  }, []);

  const columns = useMemo<ColumnDef<DeviceRegistration>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => {
          const isAllSelected = table.getIsAllPageRowsSelected();
          const isSomeSelected = table.getIsSomePageRowsSelected();
          return (
            <Checkbox
              aria-label={tr(language, "Select all visible devices", "เลือกอุปกรณ์ที่แสดงทั้งหมด")}
              checked={isAllSelected}
              indeterminate={isSomeSelected && !isAllSelected}
              onCheckedChange={(value) => {
                table.toggleAllPageRowsSelected(Boolean(value));
              }}
            />
          );
        },
        cell: ({ row }) => (
          <Checkbox
            aria-label={tr(language, `Select ${row.original.display_name}`, `เลือก ${row.original.display_name}`)}
            checked={row.getIsSelected()}
            onCheckedChange={(value) => {
              row.toggleSelected(Boolean(value));
            }}
          />
        ),
      },
      {
        accessorKey: "display_name",
        header: () => <div className="min-w-0">{tr(language, "Device", "อุปกรณ์")}</div>,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-full">
            <p className="break-words font-medium leading-5 text-slate-950">{row.original.display_name}</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">{row.original.device_id}</p>
          </div>
        ),
      },
      {
        accessorKey: "is_active",
        header: () => <div>{tr(language, "Status", "สถานะ")}</div>,
        cell: ({ row }) => <DeviceStatusBadge device={row.original} language={language} className="whitespace-nowrap" />,
      },
      {
        accessorKey: "last_seen_at",
        header: () => <div>{tr(language, "Last seen", "รับข้อมูลล่าสุด")}</div>,
        cell: ({ row }) => (
          <div className="whitespace-normal break-words text-sm leading-5 text-slate-600">
            {formatLastSeen(row.original.last_seen_at, language)}
          </div>
        ),
      },
      {
        accessorKey: "default_measurement_type",
        header: () => <div>{tr(language, "Default mode", "โหมดตั้งต้น")}</div>,
        cell: ({ row }) => (
          <MeasurementTypeBadge
            value={row.original.default_measurement_type}
            language={language}
          />
        ),
      },
      {
        accessorKey: "notes",
        header: () => <div>{tr(language, "Notes", "หมายเหตุ")}</div>,
        cell: ({ row }) => (
          <div
            className="w-full whitespace-normal break-words text-sm leading-5 text-slate-600"
            title={row.original.notes ?? undefined}
          >
            <p className="line-clamp-2">
              {row.original.notes || tr(language, "No notes", "ไม่มีหมายเหตุ")}
            </p>
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">{tr(language, "Actions", "การทำงาน")}</div>,
        cell: ({ row }) => {
          const device = row.original;
          return (
            <div
              data-testid={`device-actions-${device.id}`}
              className="flex flex-wrap justify-end gap-2"
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openEditSheet(device)}
                disabled={savingId === device.id}
                aria-label={tr(language, `Edit ${device.display_name}`, `แก้ไข ${device.display_name}`)}
                className="h-9 max-w-full shrink rounded-full px-3 whitespace-normal text-right sm:whitespace-nowrap"
              >
                <PencilLine data-icon="inline-start" />
                {tr(language, "Edit", "แก้ไข")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={device.is_active ? "outline" : "secondary"}
                onClick={() => requestToggleActive(device)}
                disabled={savingId === device.id}
                aria-label={tr(
                  language,
                  device.is_active
                    ? `Disable ${device.display_name}`
                    : `Enable ${device.display_name}`,
                  device.is_active
                    ? `ปิดใช้งาน ${device.display_name}`
                    : `เปิดใช้งาน ${device.display_name}`,
                )}
                className={cn(
                  "h-9 max-w-full shrink rounded-full px-3 whitespace-normal text-right sm:whitespace-nowrap",
                  device.is_active
                    ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                )}
              >
                {savingId === device.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : device.is_active ? (
                  <PowerOff data-icon="inline-start" />
                ) : (
                  <Power data-icon="inline-start" />
                )}
                {device.is_active
                  ? tr(language, "Disable", "ปิดใช้งาน")
                  : tr(language, "Enable", "เปิดใช้งาน")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => requestDeleteDevice(device)}
                disabled={savingId === device.id}
                aria-label={tr(language, `Delete ${device.display_name}`, `ลบ ${device.display_name}`)}
                className="h-9 max-w-full shrink rounded-full px-3 whitespace-normal text-right sm:whitespace-nowrap"
              >
                {savingId === device.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Trash2 data-icon="inline-start" />
                )}
                {tr(language, "Delete", "ลบ")}
              </Button>
            </div>
          );
        },
      },
    ],
    [language, openEditSheet, requestDeleteDevice, requestToggleActive, savingId],
  );

  const table = useReactTable({
    data: devices,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
  });

  const selectedRowCount = table.getSelectedRowModel().rows.length;

  useEffect(() => {
    setRowSelection({});
  }, [devices]);

  const handlePageSizeChange = useCallback((value: string | null) => {
    if (!value) return;
    const nextPageSize = Number(value);
    if (!PAGE_SIZE_OPTIONS.includes(nextPageSize as (typeof PAGE_SIZE_OPTIONS)[number])) {
      return;
    }
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  const handleDeleteDevice = async (device: DeviceRegistration) => {
    if (!token) return;
    setSavingId(device.id);
    setDevices((currentDevices) => currentDevices.filter((item) => item.id !== device.id));
    setTotal((currentTotal) => Math.max(0, currentTotal - 1));
    try {
      await deleteDeviceRegistration(device.device_id, token);
      toast.success(tr(language, "Device deleted", "ลบอุปกรณ์เรียบร้อยแล้ว"), {
        id: DEVICE_REGISTRY_RESULT_TOAST_ID,
      });
      if (devices.length === 1 && page > 1) {
        setPage((prev) => Math.max(1, prev - 1));
      } else {
        void loadDevices({ silent: true, showErrorToast: false, skipCache: true });
      }
    } catch (error: unknown) {
      const apiError = error as ApiError;
      upsertVisibleDevice(device);
      setTotal((currentTotal) => currentTotal + 1);
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

  const handleConfirmPendingAction = () => {
    const action = pendingAction;
    if (!action) return;

    setPendingAction(null);
    if (action.type === "delete") {
      void handleDeleteDevice(action.device);
      return;
    }

    void handleToggleActive(action.device);
  };

  if (!hydrated || !token) return null;

  return (
    <>
      <main className="flex-1 overflow-auto bg-slate-50/80 p-3 sm:p-5 lg:p-7">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-5 border-b border-slate-100 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                  <ServerCog className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium uppercase tracking-[0.12em] text-slate-500">
                    {tr(language, "Device Operations", "จัดการอุปกรณ์")}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                    {tr(language, "Device Registry", "ทะเบียนอุปกรณ์")}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    {tr(
                      language,
                      "Search registered devices, check signal freshness, and control device access from one workspace.",
                      "ค้นหาอุปกรณ์ ตรวจสอบความสดของสัญญาณ และควบคุมสิทธิ์อุปกรณ์จากพื้นที่เดียว",
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void loadDevices({ silent: true, showErrorToast: true, skipCache: true })}
                  className="h-11 justify-center px-4 text-sm"
                  disabled={refreshing}
                >
                  <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
                  {tr(language, "Refresh", "รีเฟรช")}
                </Button>
                <Button
                  type="button"
                  onClick={() => setRegisterDialogOpen(true)}
                  className="h-11 justify-center bg-blue-600 px-5 text-sm text-white hover:bg-blue-700"
                >
                  <PlusCircle className="mr-2 size-4" />
                  {tr(language, "New device", "เพิ่มอุปกรณ์")}
                </Button>
              </div>
            </div>

            <dl className="grid grid-cols-2 lg:grid-cols-4">
              <div className="border-r border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4 lg:border-r">
                <dt className="flex items-center gap-2 text-sm text-slate-500">
                  <ShieldCheck className="size-4 text-blue-600" />
                  {tr(language, "Total records", "รายการทั้งหมด")}
                </dt>
                <dd className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{total}</dd>
              </div>
              <div className="border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4 lg:border-r">
                <dt className="flex items-center gap-2 text-sm text-slate-500">
                  <Activity className="size-4 text-emerald-600" />
                  {tr(language, "Visible active", "ใช้งานอยู่ที่แสดง")}
                </dt>
                <dd className="mt-2 text-2xl font-semibold text-emerald-700 sm:text-3xl">{activeCount}</dd>
              </div>
              <div className="border-r border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4 lg:border-r">
                <dt className="flex items-center gap-2 text-sm text-slate-500">
                  <PowerOff className="size-4 text-slate-500" />
                  {tr(language, "Visible inactive", "ปิดใช้งานที่แสดง")}
                </dt>
                <dd className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{inactiveCount}</dd>
              </div>
              <div className="border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
                <dt className="flex items-center gap-2 text-sm text-slate-500">
                  <Clock3 className="size-4 text-amber-600" />
                  {tr(language, "No signal shown", "ยังไม่มีสัญญาณที่แสดง")}
                </dt>
                <dd className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{noSignalCount}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-4 border-b border-slate-100 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-950">
                  {tr(language, "Registered devices", "อุปกรณ์ที่ลงทะเบียนแล้ว")}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {tr(
                    language,
                    "Filter the worklist before changing access. Destructive actions require confirmation.",
                    "กรองรายการก่อนเปลี่ยนสิทธิ์ การทำงานที่เสี่ยงต้องยืนยันก่อนเสมอ",
                  )}
                </p>
              </div>
              <div className="text-sm text-slate-500">
                {tr(language, "Page", "หน้า")} {page} / {totalPages}
              </div>
            </div>

            <div className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={tr(language, "Search by Device ID or Name", "ค้นหาด้วยรหัสอุปกรณ์หรือชื่อ")}
                  className="h-12 border-slate-200 bg-slate-50 pl-10 text-base shadow-none focus-visible:bg-white"
                />
              </div>
              <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto">
                <Button
                  type="button"
                  variant={filter === "all" ? "default" : "ghost"}
                  onClick={() => {
                    setPage(1);
                    setFilter("all");
                  }}
                  className="h-10 flex-1 text-sm sm:flex-none"
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
                  className="h-10 flex-1 text-sm sm:flex-none"
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
                  className="h-10 flex-1 text-sm sm:flex-none"
                >
                  {tr(language, "Inactive", "ปิดใช้งาน")}
                </Button>
              </div>
            </div>

            <div className="px-4 pb-4 sm:px-6">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table className="w-full bg-white">
                  <TableHeader className="bg-slate-50">
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="hover:bg-slate-50">
                        {headerGroup.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            className={cn(
                              "h-12 whitespace-normal break-words px-4 text-sm font-semibold text-slate-700",
                              header.id === "select" && "w-12",
                              header.id === "actions" && "text-right",
                            )}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow
                        key={`device-skeleton-${index}`}
                        className="hover:bg-transparent"
                      >
                        <TableCell className="px-4 py-4">
                          <Skeleton className="size-4 rounded-[4px]" />
                        </TableCell>
                        <TableCell className="px-4 py-4">
                          <Skeleton className="h-5 w-40" />
                          <Skeleton className="mt-2 h-4 w-52" />
                        </TableCell>
                        <TableCell className="px-4 py-4">
                          <Skeleton className="h-6 w-24 rounded-full" />
                        </TableCell>
                        <TableCell className="px-4 py-4">
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell className="px-4 py-4">
                          <Skeleton className="h-4 w-48" />
                        </TableCell>
                        <TableCell className="px-4 py-4 text-right">
                          <Skeleton className="ml-auto h-9 w-9 rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : devices.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="px-4 py-10 text-center">
                        <div className="grid min-h-48 place-items-center text-center">
                          <div>
                            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                              <Search className="size-5" />
                            </div>
                            <p className="mt-3 text-base font-medium text-slate-900">
                              {tr(language, "No devices found", "ไม่พบอุปกรณ์")}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {tr(language, "Try a different search or filter.", "ลองเปลี่ยนคำค้นหาหรือตัวกรอง")}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() ? "selected" : undefined}
                        className="hover:bg-blue-50/40"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className={cn(
                              "px-4 py-4 align-middle whitespace-normal break-words",
                              cell.column.id === "select" && "w-12",
                              cell.column.id === "actions" && "text-right",
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                  </TableBody>
                  <TableFooter className="bg-slate-50/80">
                    <TableRow className="hover:bg-slate-50/80">
                      <TableCell colSpan={4} className="px-4 py-3 text-sm text-slate-600">
                        {selectedRowCount > 0
                          ? tr(
                              language,
                              `${selectedRowCount} device${selectedRowCount === 1 ? "" : "s"} selected on this page`,
                              `เลือกอุปกรณ์ ${selectedRowCount} รายการในหน้านี้`,
                            )
                          : tr(language, "Showing current page results", "กำลังแสดงผลลัพธ์หน้าปัจจุบัน")}
                      </TableCell>
                      <TableCell colSpan={2} className="px-4 py-3 text-right text-sm font-medium text-slate-700">
                        {tr(language, "Visible records", "รายการที่แสดง")} {devices.length}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <p className="text-sm text-slate-500">
                    {tr(language, "Showing current page results", "กำลังแสดงผลลัพธ์หน้าปัจจุบัน")}
                  </p>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span>{tr(language, "Rows per page", "แสดงต่อหน้า")}</span>
                    <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                      <SelectTrigger className="h-9 w-[92px] rounded-xl bg-white">
                        <SelectValue>{pageSize}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Pagination className="mx-0 w-full justify-start lg:w-auto lg:justify-end">
                  <PaginationContent className="flex-wrap justify-start">
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        disabled={page <= 1 || loading}
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((prev) => Math.max(1, prev - 1));
                        }}
                      />
                    </PaginationItem>
                    {paginationPages.map((pageNumber, index) => {
                      const previousPage = paginationPages[index - 1];
                      return (
                        <Fragment key={pageNumber}>
                          {previousPage && pageNumber - previousPage > 1 ? (
                            <PaginationItem>
                              <PaginationEllipsis />
                            </PaginationItem>
                          ) : null}
                          <PaginationItem>
                            <PaginationLink
                              href="#"
                              isActive={pageNumber === page}
                              disabled={loading}
                              onClick={(event) => {
                                event.preventDefault();
                                setPage(pageNumber);
                              }}
                            >
                              {pageNumber}
                            </PaginationLink>
                          </PaginationItem>
                        </Fragment>
                      );
                    })}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        disabled={page >= totalPages || loading}
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((prev) => Math.min(totalPages, prev + 1));
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Sheet open={registerDialogOpen} onOpenChange={setRegisterDialogOpen}>
        <SheetContent
          side="center"
          className="w-[min(94vw,760px)] max-h-[86vh] overflow-hidden rounded-2xl border border-slate-200 p-0 shadow-2xl sm:w-[min(88vw,760px)]"
        >
          <SheetHeader className="border-b border-slate-100 px-6 py-5">
            <SheetTitle className="text-xl">
              {tr(language, "Register new device", "ลงทะเบียนอุปกรณ์ใหม่")}
            </SheetTitle>
            <SheetDescription>
              {tr(
                language,
                "Add the device identity used by the ingest API, and set a default examination mode doctors can change later.",
                "เพิ่มตัวตนอุปกรณ์สำหรับ ingest API และตั้งค่าโหมดการตรวจเริ่มต้นที่ยังแก้ไขภายหลังได้",
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="grid max-h-[calc(86vh-168px)] gap-6 overflow-y-auto px-6 py-5">
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>{tr(language, "Device ID", "รหัสอุปกรณ์")}</FieldLabel>
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
                      formErrors.deviceId && "border-amber-400 ring-amber-200 focus-visible:border-amber-500",
                    )}
                  />
                  <FieldDescription>
                    {tr(
                      language,
                      "Use the stable ID the physical device sends to our backend.",
                      "ใช้รหัสถาวรที่ตัวเครื่องจะส่งเข้ามายังระบบ",
                    )}
                  </FieldDescription>
                  <FieldError>{formErrors.deviceId}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>{tr(language, "Device Name", "ชื่ออุปกรณ์")}</FieldLabel>
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
                      formErrors.displayName && "border-amber-400 ring-amber-200 focus-visible:border-amber-500",
                    )}
                  />
                  <FieldDescription>
                    {tr(language, "Shown in the live workflow board and registry.", "แสดงในบอร์ดใช้งานสดและทะเบียนอุปกรณ์")}
                  </FieldDescription>
                  <FieldError>{formErrors.displayName}</FieldError>
                </Field>
              </div>
              <Field>
                <FieldLabel>{tr(language, "Default measurement mode", "โหมดการตรวจตั้งต้น")}</FieldLabel>
                <Select
                  value={defaultMeasurementType}
                  onValueChange={(value) =>
                    setDefaultMeasurementType(value as DeviceExamMeasurementType)
                  }
                >
                  <SelectTrigger className="h-12">
                    <SelectValue>{measurementLabel(defaultMeasurementType, language)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MEASUREMENT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {measurementLabel(option, language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {tr(
                    language,
                    "This pre-fills the exam mode when the doctor picks this device, but they can still change it before starting the session.",
                    "ค่านี้จะช่วยเติมโหมดการตรวจอัตโนมัติเมื่อหมอเลือกเครื่อง แต่ยังเปลี่ยนได้ก่อนเริ่ม session",
                  )}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{tr(language, "Notes (optional)", "หมายเหตุ (ไม่บังคับ)")}</FieldLabel>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={tr(language, "Where this device is placed", "ตำแหน่งวางอุปกรณ์")}
                  className="min-h-24 text-base"
                />
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter className="border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={resetForm} className="h-11 px-5 text-base">
              {tr(language, "Clear form", "ล้างฟอร์ม")}
            </Button>
            <Button type="button" onClick={handleCreate} disabled={submitting} className="h-11 px-6 text-base">
              {submitting ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}
              {tr(language, "Register device", "ลงทะเบียนอุปกรณ์")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={editSheetOpen}
        onOpenChange={(open) => {
          setEditSheetOpen(open);
          if (!open) {
            resetEditForm();
          }
        }}
      >
        <SheetContent
          side="center"
          className="w-[min(94vw,680px)] max-h-[86vh] overflow-hidden rounded-2xl border border-slate-200 p-0 shadow-2xl sm:w-[min(88vw,680px)]"
        >
          <SheetHeader className="border-b border-slate-100 px-6 py-5">
            <SheetTitle className="text-xl">
              {tr(language, "Edit device", "แก้ไขอุปกรณ์")}
            </SheetTitle>
            <SheetDescription>
              {tr(
                language,
                "Update the display details and the default examination mode for this device.",
                "แก้ไขรายละเอียดการแสดงผลและโหมดการตรวจตั้งต้นของอุปกรณ์นี้",
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="grid max-h-[calc(86vh-168px)] gap-6 overflow-y-auto px-6 py-5">
            <FieldGroup>
              <Field>
                <FieldLabel>{tr(language, "Device ID", "รหัสอุปกรณ์")}</FieldLabel>
                <Input value={editingDevice?.device_id ?? ""} disabled className="h-12 text-base" />
                <FieldDescription>
                  {tr(language, "This identifier stays fixed after registration.", "รหัสนี้จะคงที่หลังจากลงทะเบียนแล้ว")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{tr(language, "Device Name", "ชื่ออุปกรณ์")}</FieldLabel>
                <Input
                  ref={editDisplayNameInputRef}
                  value={editDisplayName}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setEditDisplayName(nextValue);
                    if (nextValue.trim()) {
                      setEditFormErrors((prev) => ({ ...prev, displayName: undefined }));
                    }
                  }}
                  aria-invalid={Boolean(editFormErrors.displayName)}
                  className={cn(
                    "h-12 text-base",
                    editFormErrors.displayName && "border-amber-400 ring-amber-200 focus-visible:border-amber-500",
                  )}
                />
                <FieldError>{editFormErrors.displayName}</FieldError>
              </Field>
              <Field>
                <FieldLabel>{tr(language, "Default measurement mode", "โหมดการตรวจตั้งต้น")}</FieldLabel>
                <Select
                  value={editDefaultMeasurementType}
                  onValueChange={(value) =>
                    setEditDefaultMeasurementType(value as DeviceExamMeasurementType)
                  }
                >
                  <SelectTrigger className="h-12">
                    <SelectValue>{measurementLabel(editDefaultMeasurementType, language)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MEASUREMENT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {measurementLabel(option, language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {tr(
                    language,
                    "Doctors see this as the starting mode when they begin a new session with this device.",
                    "หมอจะเห็นค่านี้เป็นโหมดเริ่มต้นเมื่อเริ่ม session ใหม่ด้วยเครื่องนี้",
                  )}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{tr(language, "Notes (optional)", "หมายเหตุ (ไม่บังคับ)")}</FieldLabel>
                <Textarea
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  placeholder={tr(language, "Where this device is placed", "ตำแหน่งวางอุปกรณ์")}
                  className="min-h-24 text-base"
                />
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter className="border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditSheetOpen(false);
                resetEditForm();
              }}
              className="h-11 px-5 text-base"
            >
              {tr(language, "Cancel", "ยกเลิก")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveDeviceDetails()}
              disabled={!editingDevice || savingId === editingDevice?.id}
              className="h-11 px-6 text-base"
            >
              {savingId === editingDevice?.id ? (
                <RefreshCw className="mr-2 size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 size-4" />
              )}
              {tr(language, "Save changes", "บันทึกการเปลี่ยนแปลง")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia
              className={cn(
                pendingAction?.type === "delete"
                  ? "bg-red-50 text-red-600"
                  : pendingAction?.device.is_active
                    ? "bg-amber-50 text-amber-600"
                    : "bg-blue-50 text-blue-600",
              )}
            >
              {pendingAction?.type === "delete" ? (
                <Trash2 className="size-8" />
              ) : pendingAction?.device.is_active ? (
                <PowerOff className="size-8" />
              ) : (
                <Power className="size-8" />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {pendingAction?.type === "delete"
                ? tr(language, "Delete this device?", "ลบอุปกรณ์นี้?")
                : pendingAction?.device.is_active
                  ? tr(language, "Disable this device?", "ปิดใช้งานอุปกรณ์นี้?")
                  : tr(language, "Enable this device?", "เปิดใช้งานอุปกรณ์นี้?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "delete"
                ? tr(
                    language,
                    `This removes ${pendingAction.device.display_name} from the registry. Device ingest will stop for ${pendingAction.device.device_id}.`,
                    `จะลบ ${pendingAction.device.display_name} ออกจากทะเบียน และหยุด ingest สำหรับ ${pendingAction.device.device_id}`,
                  )
                : pendingAction?.device.is_active
                  ? tr(
                      language,
                      `This blocks ingest for ${pendingAction.device.display_name} until it is enabled again.`,
                      `จะบล็อก ingest ของ ${pendingAction.device.display_name} จนกว่าจะเปิดใช้งานอีกครั้ง`,
                    )
                  : tr(
                      language,
                      `This allows ${pendingAction?.device.display_name ?? ""} to send data again.`,
                      `จะอนุญาตให้ ${pendingAction?.device.display_name ?? ""} ส่งข้อมูลอีกครั้ง`,
                    )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr(language, "Cancel", "ยกเลิก")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPendingAction}
              variant={pendingAction?.type === "delete" || pendingAction?.device.is_active ? "destructive" : "default"}
            >
              {pendingAction?.type === "delete"
                ? tr(language, "Delete device", "ลบอุปกรณ์")
                : pendingAction?.device.is_active
                  ? tr(language, "Disable device", "ปิดใช้งานอุปกรณ์")
                  : tr(language, "Enable device", "เปิดใช้งานอุปกรณ์")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
