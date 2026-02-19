"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserGroupIcon,
  Search01Icon,
  Add01Icon,
  RefreshIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Edit01Icon,
  Delete01Icon,
  MedicalMaskIcon,
  CalendarAddIcon,
  AiPhone01Icon,
  Mail01Icon,
  Location01Icon,
  Calendar03Icon,
  UserIcon,
  Copy01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  FilterHorizontalIcon,
  Stethoscope02Icon,
} from "@hugeicons/core-free-icons";
import { fetchPatients, createPatient, updatePatient, deletePatient, type Patient } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";
import { PatientAssignmentsDialog } from "./patient-assignments-dialog";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 200];

interface PatientFormState {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
}

const emptyForm: PatientFormState = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  gender: "",
  phone: "",
  email: "",
  address: "",
};

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

export function PatientsTable() {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [formData, setFormData] = useState<PatientFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);
  const [assignmentPatient, setAssignmentPatient] = useState<Patient | null>(null);

  const isInitialLoading = loading && patients.length === 0;
  const isRefetching = loading && patients.length > 0;
  const loadingRef = useRef(false);

  const startEntry = total === 0 ? 0 : (page - 1) * limit + 1;
  const endEntry = total === 0 ? 0 : Math.min(page * limit, total);

  // Statistics for overview cards
  const stats = useMemo(() => {
    const totalPatients = total;
    const activePatients = patients.filter(p => !!p.phone || !!p.email).length;
    const recentPatients = patients.filter(p => {
      if (!p.created_at) return false;
      const created = new Date(p.created_at);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return created >= weekAgo;
    }).length;

    return {
      total: totalPatients,
      active: activePatients,
      recent: recentPatients,
    };
  }, [total, patients]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / limit));
  }, [total, limit]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  // Cache for pages to enable instant navigation
  const cacheRef = useRef<Map<string, { items: Patient[]; total: number }>>(new Map());

  const getCacheKey = (p: number) => `${p}-${limit}-${debouncedSearch}-${sort}-${order}`;

  // Track when a fetch finishes to animate new rows without hiding existing ones
  useEffect(() => {
    if (loadingRef.current && !loading) {
      setJustLoaded(true);
      const id = setTimeout(() => setJustLoaded(false), 220);
      return () => clearTimeout(id);
    }
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const cacheKey = getCacheKey(page);
    const cached = cacheRef.current.get(cacheKey);

    // If we have cached data, show it immediately
    if (cached) {
      setPatients(cached.items);
      setTotal(cached.total);
      setLoading(false);
    }

    const loadPatients = async () => {
      // Only show loading if we don't have cached data
      if (!cached) {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await fetchPatients(
          { page, limit, q: debouncedSearch, sort, order },
          token
        );
        if (!cancelled) {
          setPatients(res.items);
          setTotal(res.total);
          // Cache this page
          cacheRef.current.set(cacheKey, { items: res.items, total: res.total });

          // Prefetch adjacent pages in background (next and previous)
          const maxPages = Math.ceil(res.total / limit);
          const pagesToPrefetch = [page - 1, page + 1].filter(p => p >= 1 && p <= maxPages);

          pagesToPrefetch.forEach(prefetchPage => {
            const prefetchCacheKey = getCacheKey(prefetchPage);
            if (!cacheRef.current.has(prefetchCacheKey)) {
              fetchPatients({ page: prefetchPage, limit, q: debouncedSearch, sort, order }, token)
                .then((prefetchRes) => {
                  cacheRef.current.set(prefetchCacheKey, { items: prefetchRes.items, total: prefetchRes.total });
                })
                .catch(() => { }); // Silently fail prefetch
            }
          });
        }
      } catch (err) {
        if (!cancelled) {
          const status = (err as { status?: number }).status;
          if (status === 401) {
            clearToken();
            router.replace("/login");
            return;
          }
          const message = err instanceof Error ? err.message : tr(language, "Failed to load patients", "โหลดข้อมูลผู้ป่วยไม่สำเร็จ");
          setError(message);
          setPatients([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    loadPatients();
    return () => {
      cancelled = true;
    };
  }, [token, page, limit, debouncedSearch, sort, order]);

  const resetForm = (patient?: Patient) => {
    if (patient) {
      setFormData({
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender ?? "",
        phone: patient.phone ?? "",
        email: patient.email ?? "",
        address: patient.address ?? "",
      });
      setEditing(patient);
    } else {
      setFormData(emptyForm);
      setEditing(null);
    }
    setFormErrors({});
    setFormOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.first_name.trim()) errors.first_name = tr(language, "First name is required", "จำเป็นต้องกรอกชื่อ");
    if (!formData.last_name.trim()) errors.last_name = tr(language, "Last name is required", "จำเป็นต้องกรอกนามสกุล");
    if (!formData.date_of_birth) errors.date_of_birth = tr(language, "Date of birth is required", "จำเป็นต้องระบุวันเกิด");

    if (formData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        errors.email = tr(language, "Invalid email format", "รูปแบบอีเมลไม่ถูกต้อง");
      }
    }

    if (formData.phone) {
      if (formData.phone.length < 8) {
        errors.phone = tr(language, "Phone number must be at least 8 characters", "หมายเลขโทรศัพท์ต้องมีอย่างน้อย 8 ตัวอักษร");
      }
    }

    if (formData.address) {
      if (formData.address.length < 5) {
        errors.address = tr(language, "Address must be at least 5 characters", "ที่อยู่ต้องมีอย่างน้อย 5 ตัวอักษร");
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setSaving(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!validateForm()) {
      toast.error(tr(language, "Please fix the errors in the form", "กรุณาแก้ไขข้อมูลในฟอร์มให้ถูกต้อง"));
      return;
    }

    setSaving(true);
    setError(null);

    // Clean up optional fields - send undefined instead of empty strings
    const cleanedData = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      date_of_birth: formData.date_of_birth,
      gender: formData.gender || undefined,
      phone: formData.phone || undefined,
      email: formData.email || undefined,
      address: formData.address || undefined,
    };

    try {
      if (editing) {
        await updatePatient(editing.id, cleanedData, token);
      } else {
        await createPatient(cleanedData, token);
      }
      toast.success(
        editing
          ? tr(language, "Patient updated successfully", "อัปเดตผู้ป่วยสำเร็จ")
          : tr(language, "Patient created successfully", "สร้างผู้ป่วยสำเร็จ")
      );
      closeForm();
      // Refresh list and reset to first page to show new record
      setPage(1);
      const res = await fetchPatients({ page: 1, limit, q: debouncedSearch, sort, order }, token);
      setPatients(res.items);
      setTotal(res.total);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }

      // Try to parse backend validation errors and map them to form fields
      const message = err instanceof Error ? err.message : tr(language, "Save failed", "บันทึกไม่สำเร็จ");
      try {
        const parsed = JSON.parse(message);
        if (Array.isArray(parsed)) {
          const newFormErrors: Record<string, string> = {};
          parsed.forEach((item: { loc?: string[]; msg?: string }) => {
            if (item.loc && item.loc.length >= 2) {
              const field = item.loc[1]; // e.g., "phone", "email", "address"
              newFormErrors[field] = item.msg || tr(language, "Invalid value", "ค่าข้อมูลไม่ถูกต้อง");
            }
          });
          if (Object.keys(newFormErrors).length > 0) {
            setFormErrors(prev => ({ ...prev, ...newFormErrors }));
            toast.error(tr(language, "Please fix the validation errors", "กรุณาแก้ไขข้อผิดพลาดการตรวจสอบข้อมูล"));
          } else {
            toast.error(tr(language, "Validation failed. Please check your input.", "การตรวจสอบข้อมูลไม่ผ่าน กรุณาตรวจสอบข้อมูลที่กรอก"));
          }
        } else {
          toast.error(message);
        }
      } catch {
        // If parsing fails, show a generic toast error instead of setting error state
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id: string) => {
    if (!token) return;
    setError(null);
    try {
      await deletePatient(id, token);
      toast.success(tr(language, "Patient deleted successfully", "ลบข้อมูลผู้ป่วยสำเร็จ"));
      const res = await fetchPatients({ page, limit, q: debouncedSearch, sort, order }, token);
      setPatients(res.items);
      setTotal(res.total);
      if (res.items.length === 0 && page > 1) {
        setPage((p) => Math.max(1, p - 1));
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      const message = err instanceof Error ? err.message : tr(language, "Delete failed", "ลบข้อมูลไม่สำเร็จ");
      setError(message);
      toast.error(message);
    }
  };

  const handleDelete = (id: string) => {
    toast.destructiveAction(tr(language, "Delete patient record?", "ลบข้อมูลผู้ป่วยนี้ใช่ไหม?"), {
      description: tr(language, "This action cannot be undone.", "การกระทำนี้ไม่สามารถย้อนกลับได้"),
      button: {
        title: tr(language, "Delete", "ลบ"),
        onClick: () => {
          void confirmDelete(id);
        },
      },
      duration: 9000,
    });
  };

  const getPatientInitials = (patient: Patient) => {
    const firstInitial = patient.first_name?.charAt(0)?.toUpperCase() || '';
    const lastInitial = patient.last_name?.charAt(0)?.toUpperCase() || '';
    return `${firstInitial}${lastInitial}` || 'PA';
  };

  const getAgeFromDOB = (dateOfBirth: string) => {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  };

  const getGenderLabel = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized === "male") return tr(language, "Male", "ชาย");
    if (normalized === "female") return tr(language, "Female", "หญิง");
    if (normalized === "other") return tr(language, "Other", "อื่น ๆ");
    return value;
  };

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative mb-6 group">
        <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl scale-150 animate-pulse opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div className="relative p-6 bg-background rounded-full border border-border shadow-lg group-hover:scale-110 transition-transform duration-300">
          <HugeiconsIcon icon={UserGroupIcon} className="size-10 text-primary/80" />
        </div>
      </div>
      <div className="space-y-2 max-w-sm mx-auto">
        <h3 className="font-bold text-xl tracking-tight text-foreground">{tr(language, "No patients found", "ไม่พบผู้ป่วย")}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {search
            ? tr(language, "We couldn't find any patients matching your search query. Try adjusting your filters.", "ไม่พบผู้ป่วยที่ตรงกับคำค้นหา ลองปรับตัวกรองแล้วค้นหาอีกครั้ง")
            : tr(language, "Get started by adding your first patient to the system.", "เริ่มต้นโดยเพิ่มผู้ป่วยคนแรกเข้าสู่ระบบ")}
        </p>
      </div>
      {search && (
        <Button
          variant="outline"
          className="mt-6 gap-2 rounded-full border-dashed border-primary/30 hover:bg-primary/5 hover:border-primary/60 transition-all"
          onClick={() => setSearch("")}
        >
          <HugeiconsIcon icon={RefreshIcon} className="size-4" />
          {tr(language, "Clear Search", "ล้างการค้นหา")}
        </Button>
      )}
      {!search && (
        <Button onClick={() => resetForm()} size="lg" className="mt-6 shadow-md hover:shadow-lg transition-all rounded-full">
          <HugeiconsIcon icon={Add01Icon} className="size-4 mr-2" />
          {tr(language, "Add first patient", "เพิ่มผู้ป่วยคนแรก")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-primary/5 hover:shadow-lg transition-all duration-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <HugeiconsIcon icon={UserGroupIcon} className="w-24 h-24 text-primary transform rotate-12 translate-x-4 -translate-y-4" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr(language, "Total Patients", "ผู้ป่วยทั้งหมด")}</CardTitle>
            <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
              <HugeiconsIcon icon={UserGroupIcon} className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-bold tracking-tight text-foreground">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="text-primary font-medium">{tr(language, "Synced", "ซิงก์แล้ว")}</span> {tr(language, "in system", "ในระบบ")}
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-emerald-500/5 hover:shadow-lg transition-all duration-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <HugeiconsIcon icon={AiPhone01Icon} className="w-24 h-24 text-emerald-500 transform rotate-12 translate-x-4 -translate-y-4" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr(language, "Active Contacts", "ผู้ติดต่อที่ใช้งานอยู่")}</CardTitle>
            <div className="p-2 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
              <HugeiconsIcon icon={AiPhone01Icon} className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-bold tracking-tight text-foreground">{stats.active}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="text-emerald-500 font-medium">{(stats.active / stats.total * 100).toFixed(0)}%</span> {tr(language, "response rate", "อัตราการตอบกลับ")}
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-amber-500/5 hover:shadow-lg transition-all duration-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <HugeiconsIcon icon={CalendarAddIcon} className="w-24 h-24 text-amber-500 transform rotate-12 translate-x-4 -translate-y-4" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr(language, "New This Week", "ใหม่สัปดาห์นี้")}</CardTitle>
            <div className="p-2 bg-amber-500/10 rounded-lg group-hover:bg-amber-500/20 transition-colors">
              <HugeiconsIcon icon={CalendarAddIcon} className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-bold tracking-tight text-foreground">{stats.recent}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="text-amber-500 font-medium">+{stats.recent}</span> {tr(language, "last 7 days", "7 วันที่ผ่านมา")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Patient Table */}
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
                  <div className="flex items-center justify-center p-2 rounded-lg bg-primary/10">
                    <HugeiconsIcon icon={MedicalMaskIcon} className="size-5 text-primary" />
                  </div>
                {tr(language, "Patient Directory", "รายชื่อผู้ป่วย")}
              </CardTitle>
              <CardDescription className="ml-11">
                {tr(language, "Manage your patient records, appointments, and contact details.", "จัดการข้อมูลผู้ป่วย การนัดหมาย และข้อมูลติดต่อ")}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-none group">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-primary transition-colors"
                />
                <Input
                  placeholder={tr(language, "Search patients...", "ค้นหาผู้ป่วย...")}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 w-full sm:w-[280px] h-10 bg-background/50 border-input/60 hover:border-input focus-visible:ring-primary/20 transition-all shadow-sm"
                />
              </div>
              <Button variant="glass-primary" className="gap-2" onClick={() => resetForm()}>
                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                {tr(language, "Add Patient", "เพิ่มผู้ป่วย")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-10 shadow-sm"
                title={tr(language, "Reset Filters", "รีเซ็ตตัวกรอง")}
                onClick={async () => {
                  setSearch("");
                  setDebouncedSearch("");
                  setPage(1);

                  // Force reload data
                  if (token) {
                    setLoading(true);
                    try {
                      const res = await fetchPatients(
                        { page: 1, limit, q: "", sort, order },
                        token
                      );
                      setPatients(res.items);
                      setTotal(res.total);
                    } catch (err) {
                      const status = (err as { status?: number }).status;
                      if (status === 401) {
                        clearToken();
                        router.replace("/login");
                      } else {
                        const message = err instanceof Error
                          ? err.message
                          : tr(language, "Unable to reset filters", "ไม่สามารถรีเซ็ตตัวกรองได้");
                        toast.error(message);
                      }
                    } finally {
                      setLoading(false);
                    }
                  }
                }}
              >
                <HugeiconsIcon icon={RefreshIcon} className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0 relative flex-1 overflow-hidden">
          {error ? (
            <div className="px-6 py-3 text-sm text-destructive bg-destructive/5 border-b">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-destructive" />
                {error}
              </div>
            </div>
          ) : null}

          {isRefetching ? (
            <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background/90 to-transparent pointer-events-none animate-pulse z-10" />
          ) : null}

          <div className="overflow-x-auto max-h-[500px] lg:max-h-[600px] overflow-y-auto scroll-smooth border-b">
            <table className={cn("w-full caption-bottom text-sm border-separate border-spacing-0", isRefetching && "opacity-60 grayscale transition-all duration-300")}>
              <TableHeader className="[&_tr]:border-b">
                <TableRow className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 hover:bg-transparent shadow-sm border-b transition-colors data-[state=selected]:bg-muted">
                  <TableHead className="h-12 px-4 text-center align-middle font-medium text-muted-foreground w-[60px]">
                    #
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={UserIcon} className="size-4" />
                      {tr(language, "Patient", "ผู้ป่วย")}
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Calendar03Icon} className="size-4" />
                      {tr(language, "Age & DOB", "อายุและวันเกิด")}
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell min-w-[100px]">
                    {tr(language, "Gender", "เพศ")}
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={AiPhone01Icon} className="size-4" />
                      {tr(language, "Contact", "ติดต่อ")}
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Location01Icon} className="size-4" />
                      {tr(language, "Address", "ที่อยู่")}
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 align-middle font-medium text-muted-foreground text-right min-w-[100px]">
                    {tr(language, "Actions", "การทำงาน")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody
                className="[&_tr:last-child]:border-0 transition-opacity duration-200"
              >
                {isInitialLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="hover:bg-muted/5">
                      <TableCell className="p-4"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                      <TableCell className="p-4">
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-10 w-10 rounded-full" />
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-16" />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="p-4">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-12" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </TableCell>
                      <TableCell className="p-4 hidden md:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="p-4 hidden lg:table-cell">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </TableCell>
                      <TableCell className="p-4 hidden xl:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="p-4 text-right"><Skeleton className="h-8 w-8 ml-auto rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : patients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>{renderEmptyState()}</TableCell>
                  </TableRow>
                ) : (
                  <AnimatePresence mode="wait">
                    {patients.map((patient, index) => {
                      const age = getAgeFromDOB(patient.date_of_birth);
                      const hasContact = !!(patient.phone || patient.email);
                      const rowNumber = (page - 1) * limit + index + 1;

                      return (
                        <motion.tr
                          key={patient.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.12, delay: index * 0.02 }}
                          className="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted group"
                        >
                          <TableCell className="p-4 align-middle text-center font-medium text-muted-foreground">
                            {rowNumber}
                          </TableCell>
                          <TableCell className="p-4 align-middle">
                            <div className="flex items-center gap-3">
                              <Avatar className="size-10 ring-2 ring-background transition-shadow group-hover:ring-primary/20">
                                <AvatarFallback className="bg-primary/5 text-primary font-semibold group-hover:bg-primary/10 transition-colors">
                                  {getPatientInitials(patient)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-semibold text-foreground">
                                  {patient.first_name} {patient.last_name}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="p-4 align-middle">
                              <div className="space-y-1">
                              <div className="font-medium text-foreground">
                                {age} {tr(language, "years", "ปี")} <span className="text-muted-foreground font-normal">{tr(language, "old", "อายุ")}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(patient.date_of_birth).toLocaleDateString(language === "th" ? "th-TH" : "en-GB")}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="p-4 align-middle hidden md:table-cell">
                            {patient.gender ? (
                              <Badge variant="secondary" className="capitalize font-normal border-transparent bg-secondary/50 hover:bg-secondary">
                                {getGenderLabel(patient.gender)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="p-4 align-middle hidden lg:table-cell">
                            <div className="space-y-1.5">
                              {patient.phone ? (
                                <div className="flex items-center gap-2 text-sm text-foreground/90">
                                  <div className="p-1 rounded-sm bg-primary/5 text-primary">
                                    <HugeiconsIcon icon={AiPhone01Icon} className="size-3" />
                                  </div>
                                  {patient.phone}
                                </div>
                              ) : null}
                              {patient.email ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <div className="p-1 rounded-sm bg-muted text-muted-foreground">
                                    <HugeiconsIcon icon={Mail01Icon} className="size-3" />
                                  </div>
                                  {patient.email}
                                </div>
                              ) : null}
                              {!hasContact && <span className="text-muted-foreground text-sm">—</span>}
                            </div>
                          </TableCell>

                          <TableCell className="p-4 align-middle hidden xl:table-cell">
                            <div className="text-sm text-muted-foreground max-w-[200px] truncate" title={patient.address || undefined}>
                              {patient.address || <span className="text-muted-foreground/50">—</span>}
                            </div>
                          </TableCell>

                          <TableCell className="p-4 align-middle text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors data-[state=open]:bg-muted">
                                <span className="sr-only">{tr(language, "Open menu", "เปิดเมนู")}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground">
                                  <circle cx="12" cy="12" r="1" />
                                  <circle cx="19" cy="12" r="1" />
                                  <circle cx="5" cy="12" r="1" />
                                </svg>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={() => {
                                  navigator.clipboard.writeText(patient.id);
                                  toast.success(tr(language, "ID copied to clipboard", "คัดลอก ID แล้ว"));
                                }}>
                                  <HugeiconsIcon icon={Copy01Icon} className="size-4 mr-2" />
                                  {tr(language, "Copy ID", "คัดลอก ID")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => resetForm(patient)}>
                                  <HugeiconsIcon icon={Edit01Icon} className="size-4 mr-2" />
                                  {tr(language, "Edit Patient", "แก้ไขผู้ป่วย")}
                                </DropdownMenuItem>
                                {role === "admin" && (
                                  <DropdownMenuItem onClick={() => setAssignmentPatient(patient)}>
                                    <HugeiconsIcon icon={Stethoscope02Icon} className="size-4 mr-2" />
                                    {tr(language, "Manage Doctors", "จัดการแพทย์")}
                                  </DropdownMenuItem>
                                )}
                                {role === "admin" && (
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(patient.id)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <HugeiconsIcon icon={Delete01Icon} className="size-4 mr-2" />
                                    {tr(language, "Delete", "ลบ")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                )}
              </TableBody>
            </table>
          </div>
        </CardContent>

        <div className="sticky bottom-0 z-20 flex flex-col gap-4 border-t px-6 py-4 bg-background/80 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between transition-all">
          <div className="flex items-center gap-2 sm:gap-6 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="size-8 rounded-full shadow-sm"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }

                  if (i === 3 && totalPages > 5 && page < totalPages - 2) {
                    return (
                      <span key="ellipsis" className="px-2 py-1 text-xs text-muted-foreground">
                        ...
                      </span>
                    );
                  }

                  if (i === 4 && totalPages > 5) {
                    pageNum = totalPages;
                  }

                  const isActive = page === pageNum;

                  return (
                    <Button
                      key={pageNum}
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      disabled={loading}
                      className={cn(
                        "size-8 rounded-full p-0 text-xs font-medium transition-all",
                        isActive ? "shadow-md scale-105" : "hover:bg-muted/80"
                      )}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                className="size-8 rounded-full shadow-sm"
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
            <span className="text-xs text-muted-foreground font-medium bg-muted/30 px-3 py-1 rounded-full">
              {startEntry}-{endEntry} {tr(language, "of", "จาก")} {total}
            </span>

            <div className="flex items-center gap-2">
              <Select value={`${sort}-${order}`} onValueChange={(val) => {
                if (!val) return;
                const [newSort, newOrder] = val.split("-");
                setSort(newSort);
                setOrder(newOrder as "asc" | "desc");
              }}>
                <SelectTrigger variant="glass" className="w-[160px] h-9 text-xs font-medium rounded-full focus:ring-primary/20 transition-all shadow-sm">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={FilterHorizontalIcon} className="size-3.5 text-muted-foreground" />
                    <span className="truncate">
                      {sort === 'created_at' && order === 'desc' && tr(language, "Newest First", "ใหม่สุดก่อน")}
                      {sort === 'created_at' && order === 'asc' && tr(language, "Oldest First", "เก่าสุดก่อน")}
                      {sort === 'first_name' && order === 'asc' && tr(language, "Name (A-Z)", "ชื่อ (ก-ฮ)")}
                      {sort === 'first_name' && order === 'desc' && tr(language, "Name (Z-A)", "ชื่อ (ฮ-ก)")}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent align="end" className="w-[200px]">
                  <SelectGroup>
                    <SelectLabel>{tr(language, "Date Added", "วันที่เพิ่ม")}</SelectLabel>
                    <SelectItem value="created_at-desc" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={CalendarAddIcon} className="size-4 text-muted-foreground" />
                        <span className="flex-1">{tr(language, "Newest First", "ใหม่สุดก่อน")}</span>
                        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 text-muted-foreground/50" />
                      </div>
                    </SelectItem>
                    <SelectItem value="created_at-asc" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={Calendar03Icon} className="size-4 text-muted-foreground" />
                        <span className="flex-1">{tr(language, "Oldest First", "เก่าสุดก่อน")}</span>
                        <HugeiconsIcon icon={ArrowUp01Icon} className="size-3 text-muted-foreground/50" />
                      </div>
                    </SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>{tr(language, "Patient Name", "ชื่อผู้ป่วย")}</SelectLabel>
                    <SelectItem value="first_name-asc" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={UserIcon} className="size-4 text-muted-foreground" />
                        <span className="flex-1">{tr(language, "Name (A-Z)", "ชื่อ (ก-ฮ)")}</span>
                        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 text-muted-foreground/50" />
                      </div>
                    </SelectItem>
                    <SelectItem value="first_name-desc" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={UserIcon} className="size-4 text-muted-foreground" />
                        <span className="flex-1">{tr(language, "Name (Z-A)", "ชื่อ (ฮ-ก)")}</span>
                        <HugeiconsIcon icon={ArrowUp01Icon} className="size-3 text-muted-foreground/50" />
                      </div>
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl border border-white/25 dark:border-white/15 bg-white/10 dark:bg-white/5 backdrop-blur-xl shadow-[4px_4px_12px_rgba(0,0,0,0.08),-4px_-4px_12px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-white/20 dark:hover:bg-white/10 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20">
                  {limit === 10000 ? tr(language, "All", "ทั้งหมด") : limit} / {tr(language, "page", "หน้า")}
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-2.5 rotate-90" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[4rem]">
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <DropdownMenuItem
                      key={size}
                      onClick={() => {
                        setLimit(size);
                        setPage(1);
                      }}
                      className={cn(limit === size && "bg-muted", "text-xs justify-center cursor-pointer")}
                    >
                      {size === 10000 ? tr(language, "All", "ทั้งหมด") : size}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </Card>

      {/* Patient Form Dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeForm();
          } else {
            setFormOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? tr(language, "Edit patient", "แก้ไขผู้ป่วย") : tr(language, "Add patient", "เพิ่มผู้ป่วย")}</DialogTitle>
            <DialogDescription>
              {tr(
                language,
                "Fields marked with",
                "ฟิลด์ที่มีเครื่องหมาย"
              )} <span className="text-red-500 font-medium">*</span> {tr(
                language,
                "are required. Other fields are optional.",
                "จำเป็นต้องกรอก ส่วนฟิลด์อื่นเป็นข้อมูลเพิ่มเติมได้"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-6 pt-2">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {/* Name Fields */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first_name" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {tr(language, "First name", "ชื่อ")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="first_name"
                    value={formData.first_name}
                    onChange={(e) => {
                      setFormData({ ...formData, first_name: e.target.value });
                      if (formErrors.first_name) setFormErrors({ ...formErrors, first_name: "" });
                    }}
                    placeholder={tr(language, "Enter first name", "กรอกชื่อ")}
                    className={cn("h-11", formErrors.first_name && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {formErrors.first_name ? (
                    <p className="text-xs text-red-500">{formErrors.first_name}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr(language, "Patient's given name", "ชื่อจริงของผู้ป่วย")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="last_name" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {tr(language, "Last name", "นามสกุล")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="last_name"
                    value={formData.last_name}
                    onChange={(e) => {
                      setFormData({ ...formData, last_name: e.target.value });
                      if (formErrors.last_name) setFormErrors({ ...formErrors, last_name: "" });
                    }}
                    placeholder={tr(language, "Enter last name", "กรอกนามสกุล")}
                    className={cn("h-11", formErrors.last_name && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {formErrors.last_name ? (
                    <p className="text-xs text-red-500">{formErrors.last_name}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr(language, "Patient's family name", "นามสกุลของผู้ป่วย")}</p>
                  )}
                </div>
              </div>

              {/* Date of Birth & Gender */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date_of_birth" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {tr(language, "Date of birth", "วันเกิด")} <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      value={formData.date_of_birth ? format(new Date(formData.date_of_birth), "PPP") : ""}
                      readOnly
                      placeholder={tr(language, "Pick a date", "เลือกวันที่")}
                      className={cn(
                        "h-11 pr-12 cursor-pointer",
                        formErrors.date_of_birth && "border-red-500 focus-visible:ring-red-500"
                      )}
                      onClick={() => document.getElementById("calendar-trigger")?.click()}
                    />
                    <Popover>
                      <PopoverTrigger
                        id="calendar-trigger"
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon" }),
                          "absolute right-1 top-1 h-9 w-9 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <HugeiconsIcon icon={Calendar03Icon} className="size-4" />
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="single"
                          selected={formData.date_of_birth ? new Date(formData.date_of_birth) : undefined}
                          onSelect={(date) => {
                            setFormData({ ...formData, date_of_birth: date ? format(date, "yyyy-MM-dd") : "" });
                            if (date) setFormErrors({ ...formErrors, date_of_birth: "" });
                          }}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          captionLayout="dropdown"
                          fromYear={1900}
                          toYear={new Date().getFullYear()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {formErrors.date_of_birth ? (
                    <p className="text-xs text-red-500">{formErrors.date_of_birth}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr(language, "Patient's date of birth", "วันเกิดของผู้ป่วย")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gender" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="8" r="4" strokeWidth={2} />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12v9m-4-7l4 4 4-4" />
                    </svg>
                    {tr(language, "Gender", "เพศ")}
                  </Label>
                  <Select
                    value={formData.gender || ""}
                    onValueChange={(value) => setFormData({ ...formData, gender: value || "" })}
                  >
                    <SelectTrigger id="gender" className="h-11">
                      {/* Manual placeholder handling since SelectValue might not support it in this version */}
                      {formData.gender ? <SelectValue /> : <span className="text-muted-foreground">{tr(language, "Select gender", "เลือกเพศ")}</span>}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">{tr(language, "Male", "ชาย")}</SelectItem>
                      <SelectItem value="Female">{tr(language, "Female", "หญิง")}</SelectItem>
                      <SelectItem value="Other">{tr(language, "Other", "อื่น ๆ")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{tr(language, "Optional: Patient's gender identity", "ไม่บังคับ: อัตลักษณ์ทางเพศของผู้ป่วย")}</p>
                </div>
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {tr(language, "Phone", "โทรศัพท์")}
                  </Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => {
                      setFormData({ ...formData, phone: e.target.value });
                      if (formErrors.phone) setFormErrors({ ...formErrors, phone: "" });
                    }}
                    placeholder={tr(language, "e.g., +66 12-345-6789", "เช่น +66 12-345-6789")}
                    type="tel"
                    className={cn("h-11", formErrors.phone && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {formErrors.phone ? (
                    <p className="text-xs text-red-500">{formErrors.phone}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr(language, "Contact phone number", "หมายเลขโทรศัพท์ติดต่อ")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {tr(language, "Email", "อีเมล")}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value });
                      if (formErrors.email) setFormErrors({ ...formErrors, email: "" });
                    }}
                    placeholder="patient@example.com"
                    className={cn("h-11", formErrors.email && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {formErrors.email ? (
                    <p className="text-xs text-red-500">{formErrors.email}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr(language, "Email address for contact", "อีเมลสำหรับติดต่อ")}</p>
                  )}
                </div>
              </div>

              {/* Address */}
              <div className="space-y-2">
                <Label htmlFor="address" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {tr(language, "Address", "ที่อยู่")}
                  </Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => {
                    setFormData({ ...formData, address: e.target.value });
                    if (formErrors.address) setFormErrors({ ...formErrors, address: "" });
                  }}
                  placeholder={tr(language, "Enter full address including street, city, postal code...", "กรอกที่อยู่โดยละเอียด เช่น ถนน เมือง รหัสไปรษณีย์")}
                  className={cn("resize-none min-h-[100px] max-h-[150px] overflow-y-auto", formErrors.address && "border-red-500 focus-visible:ring-red-500")}
                />
                {formErrors.address ? (
                  <p className="text-xs text-red-500">{formErrors.address}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{tr(language, "Complete residential address", "ที่อยู่ปัจจุบันโดยละเอียด")}</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <Button variant="ghost" type="button" onClick={closeForm} disabled={saving} className="min-w-[100px]">
                  {tr(language, "Cancel", "ยกเลิก")}
                </Button>
                <Button type="submit" disabled={saving} className="min-w-[140px]">
                  {saving ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {tr(language, "Saving...", "กำลังบันทึก...")}
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {editing
                        ? tr(language, "Save changes", "บันทึกการเปลี่ยนแปลง")
                        : tr(language, "Create patient", "สร้างผู้ป่วย")}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <PatientAssignmentsDialog
        open={Boolean(assignmentPatient)}
        patientId={assignmentPatient?.id ?? null}
        patientName={assignmentPatient ? `${assignmentPatient.first_name} ${assignmentPatient.last_name}` : ""}
        onOpenChange={(open) => {
          if (!open) {
            setAssignmentPatient(null);
          }
        }}
      />

    </div>
  );
}
