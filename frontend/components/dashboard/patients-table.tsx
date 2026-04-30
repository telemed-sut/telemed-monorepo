"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EyeIcon } from "@/components/ui/eye-icon";
import { toast } from "@/components/ui/toast";
import { getLocalizedDashboardErrorMessage } from "@/components/dashboard/dashboard-error-message";
import { getPatientWorkspaceHrefs } from "@/components/dashboard/dashboard-route-utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  SmartPhone01Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import {
  canManageUsers,
  canWriteClinicalData,
  createPatient,
  deletePatient,
  fetchPatientContactDetails,
  fetchPatients,
  generatePatientRegistrationCode,
  type Patient,
  type PatientContactDetails,
  type PatientRegistrationCodeResponse,
  updatePatient,
} from "@/lib/api";
import { preloadPatientWorkspaceBundles } from "@/lib/patient-workspace-prefetch";
import { buildProfileSeed, getProfileOrbStyle } from "@/components/ui/profile-avatar-orb";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 200];
const PAGE_PREFETCH_DELAY_MS = 300;
const PATIENTS_CACHE_MAX_ENTRIES = 24;

interface PatientsCacheEntry {
  items: Patient[];
  total: number;
}

interface PatientsTableProps {
  showStats?: boolean;
  showTable?: boolean;
}

const patientsListCache = new Map<string, PatientsCacheEntry>();

function getPatientsListCacheEntry(key: string) {
  const entry = patientsListCache.get(key);
  if (!entry) {
    return null;
  }

  patientsListCache.delete(key);
  patientsListCache.set(key, entry);
  return entry;
}

function setPatientsListCacheEntry(key: string, entry: PatientsCacheEntry) {
  if (patientsListCache.has(key)) {
    patientsListCache.delete(key);
  }
  patientsListCache.set(key, entry);

  while (patientsListCache.size > PATIENTS_CACHE_MAX_ENTRIES) {
    const oldestKey = patientsListCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    patientsListCache.delete(oldestKey);
  }
}

function clearPatientsListCache() {
  patientsListCache.clear();
}

const AnimatedCalendar = dynamic(
  () =>
    import("@/components/ui/calender").then((module) => ({
      default: module.AnimatedCalendar,
    })),
  {
    loading: () => (
      <div className="h-11 w-full rounded-md border bg-muted/60 animate-pulse" />
    ),
    ssr: false,
  }
);

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

export function PatientsTable({
  showStats = true,
  showTable = true,
}: PatientsTableProps = {}) {
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
  const [revealedContactDetails, setRevealedContactDetails] = useState<
    Record<string, PatientContactDetails>
  >({});
  const [rowContactDetailsVisible, setRowContactDetailsVisible] = useState<Record<string, boolean>>(
    {},
  );
  const [rowContactDetailsLoading, setRowContactDetailsLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [contactDetailsVisible, setContactDetailsVisible] = useState(false);
  const [revealingContactDetails, setRevealingContactDetails] = useState(false);
  const [contactDetailsError, setContactDetailsError] = useState<string | null>(null);

  const [regCodeOpen, setRegCodeOpen] = useState(false);
  const [regCodeData, setRegCodeData] = useState<PatientRegistrationCodeResponse | null>(null);
  const [regCodePatient, setRegCodePatient] = useState<{ id: string; name: string } | null>(null);
  const [generatingRegCode, setGeneratingRegCode] = useState(false);

  const handleGenerateRegCode = useCallback(async (patientId: string, patientName: string) => {
    if (!token) return;
    setRegCodePatient({ id: patientId, name: patientName });
    setRegCodeOpen(true);
    setRegCodeData(null);
    setGeneratingRegCode(true);
    try {
      const res = await generatePatientRegistrationCode(patientId, token);
      setRegCodeData(res);
      toast.success(tr(language, "Registration code generated", "สร้างรหัสลงทะเบียนสำเร็จ"));
    } catch (err) {
      toast.error(getLocalizedDashboardErrorMessage(err, tr(language, "Failed to generate code", "สร้างรหัสไม่สำเร็จ"), language));
    } finally {
      setGeneratingRegCode(false);
    }
  }, [language, token]);

  const canManagePatients = canWriteClinicalData(role);
  const canDeletePatients = canManageUsers(role);
  const isAssignmentScopedRole = role === "doctor" || role === "medical_student";

  const isInitialLoading = loading && patients.length === 0;
  const isRefetching = loading && patients.length > 0;

  const startEntry = total === 0 ? 0 : (page - 1) * limit + 1;
  const endEntry = total === 0 ? 0 : Math.min(page * limit, total);

  // Statistics for overview cards
  const stats = useMemo(() => {
    const totalPatients = total;
    const documentedProfiles = patients.filter((patient) => !!patient.gender).length;
    const recentPatients = patients.filter((p) => {
      if (!p.created_at) return false;
      const created = new Date(p.created_at);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return created >= weekAgo;
    }).length;

    return {
      total: totalPatients,
      documented: documentedProfiles,
      recent: recentPatients,
    };
  }, [total, patients]);
  const documentedProfileRate =
    stats.total > 0 ? Math.round((stats.documented / stats.total) * 100) : 0;

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / limit));
  }, [total, limit]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  // Cache for pages to enable instant navigation across tab switches.
  const prefetchTimeoutRef = useRef<number | null>(null);
  const lastRevealRequestKeyRef = useRef<string | null>(null);

  const getCacheKey = useCallback(
    (p: number) => `${p}-${limit}-${debouncedSearch}-${sort}-${order}`,
    [limit, debouncedSearch, sort, order]
  );

  const getRevealRequestKey = useCallback(
    () => `${page}-${limit}-${debouncedSearch}-${sort}-${order}-${patients.map((patient) => patient.id).join("|")}`,
    [debouncedSearch, limit, order, page, patients, sort],
  );

  const openPatientWorkspace = useCallback(
    (patientId: string) => {
      router.push(`/patients/${patientId}`);
    },
    [router]
  );

  const prefetchPatientWorkspace = useCallback(
    (patientId: string) => {
      getPatientWorkspaceHrefs(patientId).forEach((href) => {
        router.prefetch(href);
      });
      void preloadPatientWorkspaceBundles();
    },
    [router]
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const cacheKey = getCacheKey(page);
    const cached = getPatientsListCacheEntry(cacheKey);

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
          setPatientsListCacheEntry(cacheKey, { items: res.items, total: res.total });

          if (prefetchTimeoutRef.current !== null) {
            window.clearTimeout(prefetchTimeoutRef.current);
            prefetchTimeoutRef.current = null;
          }

          const nextPage = page + 1;
          const maxPages = Math.ceil(res.total / limit);

          if (nextPage <= maxPages) {
            prefetchTimeoutRef.current = window.setTimeout(() => {
              if (cancelled) return;

              const prefetchCacheKey = getCacheKey(nextPage);
              if (patientsListCache.has(prefetchCacheKey)) {
                return;
              }

              void fetchPatients(
                { page: nextPage, limit, q: debouncedSearch, sort, order },
                token
              )
                .then((prefetchRes) => {
                  setPatientsListCacheEntry(prefetchCacheKey, {
                    items: prefetchRes.items,
                    total: prefetchRes.total,
                  });
                })
                .catch(() => undefined);
            }, PAGE_PREFETCH_DELAY_MS);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const status = (err as { status?: number }).status;
          if (status === 401) {
            clearToken();
            router.replace("/login");
            return;
          }
          const message = getLocalizedDashboardErrorMessage(
            err,
            language,
            "Failed to load patients",
            "โหลดข้อมูลผู้ป่วยไม่สำเร็จ"
          );
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
      if (prefetchTimeoutRef.current !== null) {
        window.clearTimeout(prefetchTimeoutRef.current);
        prefetchTimeoutRef.current = null;
      }
    };
  }, [token, page, limit, debouncedSearch, sort, order, clearToken, getCacheKey, language, router]);

  useEffect(() => {
    patients.slice(0, 3).forEach((patient) => {
      prefetchPatientWorkspace(patient.id);
    });
  }, [patients, prefetchPatientWorkspace]);

  const resetRevealedContactState = useCallback(() => {
    setContactDetailsVisible(false);
    setRevealedContactDetails({});
    setRowContactDetailsVisible({});
    setRowContactDetailsLoading({});
    setContactDetailsError(null);
    lastRevealRequestKeyRef.current = null;
  }, []);

  const hideRevealedContactDetails = useCallback(() => {
    setContactDetailsVisible(false);
    setRowContactDetailsVisible({});
    setContactDetailsError(null);
  }, []);

  const revealRowContactDetails = useCallback(async (patientId: string) => {
    if (!token) {
      router.replace("/login");
      return;
    }

    if (revealedContactDetails[patientId]) {
      setRowContactDetailsVisible((current) => ({
        ...current,
        [patientId]: true,
      }));
      return;
    }

    setRowContactDetailsLoading((current) => ({
      ...current,
      [patientId]: true,
    }));
    setContactDetailsError(null);

    try {
      const details = await fetchPatientContactDetails(patientId, token);
      setRevealedContactDetails((current) => ({
        ...current,
        [patientId]: details,
      }));
      setRowContactDetailsVisible((current) => ({
        ...current,
        [patientId]: true,
      }));
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }

      const message = getLocalizedDashboardErrorMessage(
        err,
        language,
        "Protected patient details could not be revealed on this page.",
        "ยังไม่สามารถแสดงข้อมูลผู้ป่วยที่ถูกปกป้องในหน้านี้ได้",
      );
      setContactDetailsError(message);
      toast.error(message);
    } finally {
      setRowContactDetailsLoading((current) => ({
        ...current,
        [patientId]: false,
      }));
    }
  }, [clearToken, language, revealedContactDetails, router, token]);

  const handleToggleRowContactDetails = useCallback(async (patientId: string) => {
    if (contactDetailsVisible) {
      return;
    }

    if (rowContactDetailsVisible[patientId]) {
      setRowContactDetailsVisible((current) => ({
        ...current,
        [patientId]: false,
      }));
      return;
    }

    await revealRowContactDetails(patientId);
  }, [contactDetailsVisible, revealRowContactDetails, rowContactDetailsVisible]);

  const revealVisibleContactDetails = useCallback(async () => {
    if (!token) {
      router.replace("/login");
      return;
    }

    if (patients.length === 0) {
      return;
    }

    setRevealingContactDetails(true);
    setContactDetailsError(null);

    try {
      const detailsEntries = await Promise.all(
        patients.map(async (patient) => {
          const details = await fetchPatientContactDetails(patient.id, token);
          return [patient.id, details] as const;
        }),
      );

      setRevealedContactDetails((current) => ({
        ...current,
        ...Object.fromEntries(detailsEntries),
      }));
      setContactDetailsVisible(true);
      lastRevealRequestKeyRef.current = getRevealRequestKey();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }

      const message = getLocalizedDashboardErrorMessage(
        err,
        language,
        "Protected patient details could not be revealed on this page.",
        "ยังไม่สามารถแสดงข้อมูลผู้ป่วยที่ถูกปกป้องในหน้านี้ได้",
      );
      setContactDetailsError(message);
      setContactDetailsVisible(false);
      toast.error(message);
    } finally {
      setRevealingContactDetails(false);
    }
  }, [clearToken, getRevealRequestKey, language, patients, router, token]);

  useEffect(() => {
    if (!contactDetailsVisible) {
      return;
    }

    if (patients.length === 0) {
      hideRevealedContactDetails();
      return;
    }

    const revealRequestKey = getRevealRequestKey();
    if (lastRevealRequestKeyRef.current === revealRequestKey) {
      return;
    }

    void revealVisibleContactDetails();
  }, [
    contactDetailsVisible,
    getRevealRequestKey,
    hideRevealedContactDetails,
    patients.length,
    revealVisibleContactDetails,
  ]);

  const handleToggleContactDetailsVisibility = useCallback(async () => {
    if (contactDetailsVisible) {
      hideRevealedContactDetails();
      return;
    }

    await revealVisibleContactDetails();
  }, [contactDetailsVisible, hideRevealedContactDetails, revealVisibleContactDetails]);

  const resetForm = () => {
    setFormData(emptyForm);
    setEditing(null);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEditForm = async (patient: Patient) => {
    if (!token) return;

    setError(null);
    setFormErrors({});

    try {
      const contactDetails = await fetchPatientContactDetails(patient.id, token);
      setFormData({
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender ?? "",
        phone: contactDetails.phone ?? "",
        email: contactDetails.email ?? "",
        address: contactDetails.address ?? "",
      });
      setEditing(patient);
      setFormOpen(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      const message = getLocalizedDashboardErrorMessage(
        err,
        language,
        "Protected patient details could not be loaded for editing.",
        "ยังไม่สามารถโหลดข้อมูลติดต่อผู้ป่วยเพื่อแก้ไขได้",
      );
      setError(message);
      toast.error(message);
    }
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

  const savePatientRecord = useCallback(async () => {
    if (!token) return;

    setSaving(true);
    setError(null);

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
      clearPatientsListCache();
      resetRevealedContactState();
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
      const rawMessage = err instanceof Error ? err.message : "";
      try {
        const parsed = JSON.parse(rawMessage);
        if (Array.isArray(parsed)) {
          const newFormErrors: Record<string, string> = {};
          parsed.forEach((item: { loc?: string[]; msg?: string }) => {
            if (item.loc && item.loc.length >= 2) {
              const field = item.loc[1]; // e.g., "phone", "email", "address"
              newFormErrors[field] = item.msg || tr(language, "Invalid value", "ค่าข้อมูลไม่ถูกต้อง");
            }
          });
          if (Object.keys(newFormErrors).length > 0) {
            setFormErrors((prev) => ({ ...prev, ...newFormErrors }));
            toast.error(tr(language, "Please fix the validation errors", "กรุณาแก้ไขข้อผิดพลาดการตรวจสอบข้อมูล"));
          } else {
            toast.error(tr(language, "Validation failed. Please check your input.", "การตรวจสอบข้อมูลไม่ผ่าน กรุณาตรวจสอบข้อมูลที่กรอก"));
          }
        } else {
          toast.error(
            getLocalizedDashboardErrorMessage(err, language, "Save failed", "บันทึกไม่สำเร็จ")
          );
        }
      } catch {
        // If parsing fails, show a generic toast error instead of setting error state
        toast.error(
          getLocalizedDashboardErrorMessage(err, language, "Save failed", "บันทึกไม่สำเร็จ")
        );
      }
    } finally {
      setSaving(false);
    }
  }, [
    clearToken,
    debouncedSearch,
    editing,
    formData.address,
    formData.date_of_birth,
    formData.email,
    formData.first_name,
    formData.gender,
    formData.last_name,
    formData.phone,
    language,
    limit,
    order,
    resetRevealedContactState,
    router,
    sort,
    token,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!validateForm()) {
      toast.error(tr(language, "Please fix the errors in the form", "กรุณาแก้ไขข้อมูลในฟอร์มให้ถูกต้อง"));
      return;
    }

    await savePatientRecord();
  };

  const confirmDelete = async (id: string) => {
    if (!token) return;
    setError(null);
    try {
      await deletePatient(id, token);
      clearPatientsListCache();
      resetRevealedContactState();
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
      const message = getLocalizedDashboardErrorMessage(
        err,
        language,
        "Delete failed",
        "ลบข้อมูลไม่สำเร็จ"
      );
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

  const emptyStateTitle = search
    ? tr(language, "No patients found", "ไม่พบผู้ป่วย")
    : isAssignmentScopedRole
      ? tr(language, "No assigned patients yet", "ยังไม่มีผู้ป่วยในความดูแล")
      : tr(language, "No patients found", "ไม่พบผู้ป่วย");

  const directoryDescription = role === "doctor"
    ? tr(
        language,
        "This list shows only patients assigned to your account. Open this page to reveal contact details, or open a workspace for the full record.",
        "รายการนี้จะแสดงเฉพาะผู้ป่วยที่มอบหมายให้บัญชีของคุณ เปิดดูหน้านี้เพื่อแสดงข้อมูลติดต่อ หรือเข้า workspace เพื่อดูข้อมูลเต็ม",
      )
    : role === "medical_student"
      ? tr(
          language,
          "This list shows only patients assigned to your account. Open a workspace to review the full record you are allowed to access.",
          "รายการนี้จะแสดงเฉพาะผู้ป่วยที่มอบหมายให้บัญชีของคุณ เข้า workspace เพื่อดูข้อมูลผู้ป่วยตามสิทธิ์ที่ได้รับ",
        )
      : tr(
          language,
          "Patient directory shows masked contact details by default. Use this page to reveal contact details, or open a workspace for the full record.",
          "รายชื่อผู้ป่วยจะแสดงข้อมูลติดต่อแบบปกปิดเป็นค่าเริ่มต้น เปิดดูหน้านี้เพื่อแสดงข้อมูลติดต่อ หรือเข้า workspace เพื่อดูข้อมูลเต็ม",
        );

  const emptyStateDescription = search
    ? tr(
        language,
        "We couldn't find any patients matching your search query. Try adjusting your filters.",
        "ไม่พบผู้ป่วยที่ตรงกับคำค้นหา ลองปรับตัวกรองแล้วค้นหาอีกครั้ง",
      )
    : role === "doctor"
      ? tr(
          language,
          "This doctor account only shows assigned patients. Ask an admin to grant access, or add a new patient here to assign one automatically.",
          "บัญชีแพทย์นี้จะแสดงเฉพาะผู้ป่วยที่ได้รับมอบหมายให้ดูแล หากยังไม่พบข้อมูล โปรดให้ผู้ดูแลระบบมอบหมายสิทธิ์ หรือเพิ่มผู้ป่วยใหม่เพื่อผูกเข้าบัญชีนี้อัตโนมัติ",
        )
      : role === "medical_student"
        ? tr(
            language,
            "This medical student account can view only assigned patients. Ask an admin to assign access before reviewing records.",
            "บัญชีนักศึกษาแพทย์นี้จะเห็นได้เฉพาะผู้ป่วยที่มอบหมายให้เท่านั้น ขอให้ผู้ดูแลระบบมอบหมายสิทธิ์ก่อนจึงจะเริ่มดูข้อมูลผู้ป่วยได้",
          )
        : tr(
            language,
            "Get started by adding your first patient to the system.",
            "เริ่มต้นโดยเพิ่มผู้ป่วยคนแรกเข้าสู่ระบบ",
          );

  const emptyStateContent = (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
      <div className="relative mb-7 group">
        <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl scale-150 animate-pulse opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div className="relative p-6 bg-background rounded-full border border-border shadow-lg group-hover:scale-110 transition-transform duration-300">
          <HugeiconsIcon icon={UserGroupIcon} className="size-10 text-primary/80" />
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="font-bold text-xl tracking-tight text-foreground">{emptyStateTitle}</h3>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {emptyStateDescription}
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
      {!search && canManagePatients && (
        <Button onClick={() => resetForm()} size="lg" className="mt-6 shadow-md hover:shadow-lg transition-all rounded-full">
          <HugeiconsIcon icon={Add01Icon} className="size-4 mr-2" />
          {tr(language, "Add first patient", "เพิ่มผู้ป่วยคนแรก")}
        </Button>
      )}
      </div>
    </div>
  );

  return (
    <LazyMotion features={domAnimation}>
    <div className="space-y-5">
      {/* Stats Cards */}
      {showStats ? (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="group relative overflow-hidden border-none bg-gradient-to-br from-background via-background to-primary/5 shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="absolute top-0 right-0 p-3 opacity-10 transition-opacity group-hover:opacity-20">
            <HugeiconsIcon icon={UserGroupIcon} className="h-20 w-20 translate-x-3 -translate-y-3 rotate-12 text-primary" />
          </div>
          <CardHeader className="relative z-10 flex flex-row items-center justify-between space-y-0 px-5 pb-2 pt-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr(language, "Total Patients", "ผู้ป่วยทั้งหมด")}</CardTitle>
            <div className="rounded-lg bg-primary/10 p-1.5 transition-colors group-hover:bg-primary/20">
              <HugeiconsIcon icon={UserGroupIcon} className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10 px-5 pb-5 pt-0">
            <div className="text-[1.75rem] font-bold tracking-tight text-foreground">{stats.total}</div>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <span className="text-primary font-medium">{tr(language, "Synced", "ซิงก์แล้ว")}</span> {tr(language, "in system", "ในระบบ")}
            </p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-none bg-gradient-to-br from-background via-background to-emerald-500/5 shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="absolute top-0 right-0 p-3 opacity-10 transition-opacity group-hover:opacity-20">
            <HugeiconsIcon icon={UserIcon} className="h-20 w-20 translate-x-3 -translate-y-3 rotate-12 text-emerald-500" />
          </div>
          <CardHeader className="relative z-10 flex flex-row items-center justify-between space-y-0 px-5 pb-2 pt-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr(language, "Profile Coverage", "ความครบถ้วนโปรไฟล์")}</CardTitle>
            <div className="rounded-lg bg-emerald-500/10 p-1.5 transition-colors group-hover:bg-emerald-500/20">
              <HugeiconsIcon icon={UserIcon} className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10 px-5 pb-5 pt-0">
            <div className="text-[1.75rem] font-bold tracking-tight text-foreground">{stats.documented}</div>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <span className="text-emerald-500 font-medium">{documentedProfileRate}%</span> {tr(language, "records include profile markers", "ของระเบียนมีตัวบ่งชี้โปรไฟล์")}
            </p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-none bg-gradient-to-br from-background via-background to-amber-500/5 shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="absolute top-0 right-0 p-3 opacity-10 transition-opacity group-hover:opacity-20">
            <HugeiconsIcon icon={CalendarAddIcon} className="h-20 w-20 translate-x-3 -translate-y-3 rotate-12 text-amber-500" />
          </div>
          <CardHeader className="relative z-10 flex flex-row items-center justify-between space-y-0 px-5 pb-2 pt-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr(language, "New This Week", "ใหม่สัปดาห์นี้")}</CardTitle>
            <div className="rounded-lg bg-amber-500/10 p-1.5 transition-colors group-hover:bg-amber-500/20">
              <HugeiconsIcon icon={CalendarAddIcon} className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10 px-5 pb-5 pt-0">
            <div className="text-[1.75rem] font-bold tracking-tight text-foreground">{stats.recent}</div>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <span className="text-amber-500 font-medium">+{stats.recent}</span> {tr(language, "last 7 days", "7 วันที่ผ่านมา")}
            </p>
          </CardContent>
        </Card>
      </div>
      ) : null}

      {/* Main Patient Table */}
      {showTable ? (
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-lg tracking-tight sm:text-xl">
                  <div className="flex items-center justify-center rounded-lg bg-primary/10 p-1.5">
                    <HugeiconsIcon icon={MedicalMaskIcon} className="size-4 text-primary" />
                  </div>
                {tr(language, "Patient Directory", "รายชื่อผู้ป่วย")}
              </CardTitle>
              <CardDescription className="ml-9 text-sm">
                {directoryDescription}
              </CardDescription>
              {contactDetailsError ? (
                <p className="ml-9 text-sm text-amber-700 dark:text-amber-300">
                  {contactDetailsError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={contactDetailsVisible ? "default" : "outline"}
                className={cn(
                  "h-9 gap-2 px-3.5 shadow-sm",
                  contactDetailsVisible && "bg-black text-white hover:bg-black/90 dark:bg-black dark:text-white dark:hover:bg-black/90",
                )}
                aria-pressed={contactDetailsVisible}
                disabled={patients.length === 0 || revealingContactDetails}
                title={tr(
                  language,
                  contactDetailsVisible ? "Hide protected details on this page" : "Reveal protected details on this page",
                  contactDetailsVisible ? "ซ่อนข้อมูลที่ถูกปกป้องในหน้านี้" : "แสดงข้อมูลที่ถูกปกป้องในหน้านี้",
                )}
                onClick={() => {
                  void handleToggleContactDetailsVisibility();
                }}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full transition-colors",
                    contactDetailsVisible ? "bg-white/10 text-white" : "text-primary",
                  )}
                >
                  <EyeIcon size={16} className="size-4" aria-hidden="true" />
                </span>
                {revealingContactDetails
                  ? tr(language, "Opening this page", "กำลังเปิดดูหน้านี้")
                  : contactDetailsVisible
                    ? tr(language, "Hide this page", "ซ่อนหน้านี้")
                    : tr(language, "Open this page", "เปิดดูหน้านี้")}
              </Button>

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
                  className="h-9 w-full bg-background/50 pl-9 shadow-sm transition-all hover:border-input focus-visible:ring-primary/20 sm:w-[240px]"
                />
              </div>
              {canManagePatients ? (
                <Button
                  variant="default"
                  className="h-9 gap-2 bg-black px-3.5 text-sm text-white hover:bg-black/90 dark:bg-black dark:text-white dark:hover:bg-black/90"
                  onClick={() => resetForm()}
                >
                  <HugeiconsIcon icon={Add01Icon} className="size-4" />
                  {tr(language, "Add Patient", "เพิ่มผู้ป่วย")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="icon"
                className="size-9 shadow-sm"
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
                        const message = getLocalizedDashboardErrorMessage(
                          err,
                          language,
                          "Unable to reset filters",
                          "ไม่สามารถรีเซ็ตตัวกรองได้"
                        );
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

          <div className="max-h-[460px] overflow-x-auto overflow-y-auto border-b scroll-smooth lg:max-h-[560px]">
            <table className={cn("w-full caption-bottom text-sm border-separate border-spacing-0", isRefetching && "opacity-60 grayscale transition-all duration-300")}>
              <TableHeader className="[&_tr]:border-b">
                <TableRow className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 hover:bg-transparent shadow-sm border-b transition-colors data-[state=selected]:bg-muted">
                  <TableHead className="h-12 w-[60px] px-4 text-center align-middle text-sm font-medium text-muted-foreground">
                    #
                  </TableHead>
                  <TableHead className="h-12 min-w-[200px] px-4 text-left align-middle text-sm font-medium text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={UserIcon} className="size-4" />
                      {tr(language, "Patient", "ผู้ป่วย")}
                    </div>
                  </TableHead>
                  <TableHead className="h-12 min-w-[120px] px-4 text-left align-middle text-sm font-medium text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Calendar03Icon} className="size-4" />
                      {tr(language, "Age & DOB", "อายุและวันเกิด")}
                    </div>
                  </TableHead>
                  <TableHead className="hidden h-12 min-w-[100px] px-4 text-left align-middle text-sm font-medium text-muted-foreground md:table-cell">
                    {tr(language, "Gender", "เพศ")}
                  </TableHead>
                  <TableHead className="hidden h-12 min-w-[180px] px-4 text-left align-middle text-sm font-medium text-muted-foreground lg:table-cell">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={AiPhone01Icon} className="size-4" />
                      {tr(language, "Contact", "ติดต่อ")}
                    </div>
                  </TableHead>
                  <TableHead className="hidden h-12 min-w-[200px] px-4 text-left align-middle text-sm font-medium text-muted-foreground xl:table-cell">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Location01Icon} className="size-4" />
                      {tr(language, "Address", "ที่อยู่")}
                    </div>
                  </TableHead>
                  <TableHead className="h-12 min-w-[100px] px-4 text-right align-middle text-sm font-medium text-muted-foreground">
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
                      <TableCell className="p-3"><Skeleton className="mx-auto h-4 w-8" /></TableCell>
                      <TableCell className="p-3">
                        <div className="flex items-center gap-2.5">
                          <Skeleton className="h-9 w-9 rounded-full" />
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-16" />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="p-3">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-12" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden p-3 md:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="hidden p-3 lg:table-cell">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden p-3 xl:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="p-3 text-right"><Skeleton className="ml-auto h-8 w-8 rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : patients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>{emptyStateContent}</TableCell>
                  </TableRow>
                ) : (
                  <AnimatePresence initial={false}>
                    {patients.map((patient, index) => {
                      const age = getAgeFromDOB(patient.date_of_birth);
                      const rowNumber = (page - 1) * limit + index + 1;
                      const profileSeed = buildProfileSeed(
                        patient.id,
                        patient.first_name,
                        patient.last_name,
                        null
                      );
                      const rowContactDetails = revealedContactDetails[patient.id];
                      const isRowContactVisible =
                        contactDetailsVisible || Boolean(rowContactDetailsVisible[patient.id]);
                      const isRevealedRowPending =
                        Boolean(rowContactDetailsLoading[patient.id]) ||
                        (contactDetailsVisible && revealingContactDetails && !rowContactDetails);

                      return (
                        <m.tr
                          key={patient.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.08 }}
                          className="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted group"
                        >
                          <TableCell className="p-3 align-middle text-center font-medium text-muted-foreground">
                            {rowNumber}
                          </TableCell>
                          <TableCell className="p-3 align-middle">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-9 ring-2 ring-background transition-shadow group-hover:ring-primary/20">
                                <AvatarFallback
                                  className="transition-transform duration-200 group-hover:scale-[1.03]"
                                  style={getProfileOrbStyle(profileSeed)}
                                >
                                  <span className="sr-only">
                                    {patient.first_name} {patient.last_name}
                                  </span>
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => openPatientWorkspace(patient.id)}
                                  onFocus={() => prefetchPatientWorkspace(patient.id)}
                                  onMouseEnter={() => prefetchPatientWorkspace(patient.id)}
                                  className="text-left text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                                  aria-label={tr(
                                    language,
                                    `Open ${patient.first_name} ${patient.last_name} workspace`,
                                    `เปิดพื้นที่ทำงานของ ${patient.first_name} ${patient.last_name}`
                                  )}
                                >
                                  {patient.first_name} {patient.last_name}
                                </button>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="p-3 align-middle">
                              <div className="space-y-0.5">
                              <div className="text-sm font-medium text-foreground">
                                {age} {tr(language, "years", "ปี")} <span className="text-muted-foreground font-normal">{tr(language, "old", "อายุ")}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(patient.date_of_birth).toLocaleDateString(language === "th" ? "th-TH" : "en-GB")}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="hidden p-3 align-middle md:table-cell">
                            {patient.gender ? (
                              <Badge variant="secondary" className="capitalize font-normal border-transparent bg-secondary/50 hover:bg-secondary">
                                {getGenderLabel(patient.gender)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="hidden p-3 align-middle whitespace-normal lg:table-cell">
                            {isRowContactVisible ? (
                              <div className="space-y-1">
                                <div className="flex items-start gap-2 text-sm">
                                  <div className="rounded-sm bg-primary/5 p-1 text-primary">
                                    <HugeiconsIcon icon={AiPhone01Icon} className="size-3" />
                                  </div>
                                  <span
                                    className={cn(
                                      "min-w-0 break-all text-foreground",
                                      !rowContactDetails?.phone && "text-muted-foreground",
                                    )}
                                  >
                                    {isRevealedRowPending
                                      ? tr(language, "Loading protected details...", "กำลังโหลดข้อมูลที่ถูกปกป้อง...")
                                      : rowContactDetails?.phone
                                        ? rowContactDetails.phone
                                        : tr(language, "No phone recorded", "ยังไม่มีเบอร์โทร")}
                                  </span>
                                </div>
                                <div className="flex items-start gap-2 text-sm">
                                  <div className="rounded-sm bg-muted p-1 text-muted-foreground">
                                    <HugeiconsIcon icon={Mail01Icon} className="size-3" />
                                  </div>
                                  <span
                                    className={cn(
                                      "min-w-0 break-all text-foreground",
                                      !rowContactDetails?.email && "text-muted-foreground",
                                    )}
                                  >
                                    {isRevealedRowPending
                                      ? tr(language, "Loading protected details...", "กำลังโหลดข้อมูลที่ถูกปกป้อง...")
                                      : rowContactDetails?.email
                                        ? rowContactDetails.email
                                        : tr(language, "No email recorded", "ยังไม่มีอีเมล")}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <div className="rounded-sm bg-primary/5 p-1 text-primary">
                                    <HugeiconsIcon icon={AiPhone01Icon} className="size-3" />
                                  </div>
                                  {tr(language, "Protected in workspace", "ข้อมูลถูกปกป้องใน workspace")}
                                </div>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <div className="rounded-sm bg-muted p-1 text-muted-foreground">
                                    <HugeiconsIcon icon={Mail01Icon} className="size-3" />
                                  </div>
                                  {tr(language, "Protected until secure reveal", "ข้อมูลถูกปกป้องจนกว่าจะยืนยันเพิ่ม")}
                                </div>
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="hidden p-3 align-middle whitespace-normal xl:table-cell">
                            {isRowContactVisible ? (
                              <div
                                className={cn(
                                  "max-w-[240px] text-sm leading-5 text-foreground",
                                  !rowContactDetails?.address && "text-muted-foreground",
                                )}
                              >
                                {isRevealedRowPending
                                  ? tr(language, "Loading protected details...", "กำลังโหลดข้อมูลที่ถูกปกป้อง...")
                                  : rowContactDetails?.address
                                    ? rowContactDetails.address
                                    : tr(language, "No address recorded", "ไม่มีที่อยู่ที่บันทึกไว้")}
                              </div>
                            ) : (
                              <div className="max-w-[200px] truncate text-sm text-muted-foreground">
                                {tr(language, "Protected in workspace", "ข้อมูลถูกปกป้องใน workspace")}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="p-3 align-middle text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant={isRowContactVisible ? "default" : "ghost"}
                                size="icon-xs"
                                className={cn(
                                  "rounded-full",
                                  isRowContactVisible && "bg-black text-white hover:bg-black/90 dark:bg-black dark:text-white dark:hover:bg-black/90",
                                )}
                                aria-label={tr(
                                  language,
                                  contactDetailsVisible
                                    ? `${patient.first_name} ${patient.last_name} details are opened by the page toggle`
                                    : isRowContactVisible
                                      ? `Hide protected details for ${patient.first_name} ${patient.last_name}`
                                      : `Reveal protected details for ${patient.first_name} ${patient.last_name}`,
                                  contactDetailsVisible
                                    ? `ข้อมูลของ ${patient.first_name} ${patient.last_name} ถูกเปิดโดยปุ่มของทั้งหน้าอยู่`
                                    : isRowContactVisible
                                      ? `ซ่อนข้อมูลที่ถูกปกป้องของ ${patient.first_name} ${patient.last_name}`
                                      : `แสดงข้อมูลที่ถูกปกป้องของ ${patient.first_name} ${patient.last_name}`,
                                )}
                                title={tr(
                                  language,
                                  contactDetailsVisible
                                    ? "This row is open because the whole page is revealed"
                                    : isRowContactVisible
                                      ? "Hide this patient's protected details"
                                      : "Reveal this patient's protected details",
                                  contactDetailsVisible
                                    ? "แถวนี้เปิดอยู่เพราะทั้งหน้าถูกเปิดดู"
                                    : isRowContactVisible
                                      ? "ซ่อนข้อมูลที่ถูกปกป้องของผู้ป่วยคนนี้"
                                      : "แสดงข้อมูลที่ถูกปกป้องของผู้ป่วยคนนี้",
                                )}
                                disabled={contactDetailsVisible || isRevealedRowPending}
                                onClick={() => {
                                  void handleToggleRowContactDetails(patient.id);
                                }}
                              >
                                <EyeIcon size={14} className="size-3.5" aria-hidden="true" />
                              </Button>

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
                                  <DropdownMenuItem
                                    onFocus={() => prefetchPatientWorkspace(patient.id)}
                                    onMouseEnter={() => prefetchPatientWorkspace(patient.id)}
                                    onClick={() => openPatientWorkspace(patient.id)}
                                  >
                                    <HugeiconsIcon icon={UserIcon} className="size-4 mr-2" />
                                    {tr(language, "Open Workspace", "เปิดพื้นที่ทำงาน")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                    navigator.clipboard.writeText(patient.id);
                                    toast.success(tr(language, "ID copied to clipboard", "คัดลอก ID แล้ว"));
                                  }}>
                                    <HugeiconsIcon icon={Copy01Icon} className="size-4 mr-2" />
                                    {tr(language, "Copy ID", "คัดลอก ID")}
                                  </DropdownMenuItem>
                                  {role === "admin" && (
                                    <DropdownMenuItem onClick={() => { void handleGenerateRegCode(patient.id, `${patient.first_name} ${patient.last_name}`); }}>
                                      <HugeiconsIcon icon={SmartPhone01Icon} className="size-4 mr-2" />
                                      {tr(language, "Generate App Code", "สร้างรหัสแอป")}
                                    </DropdownMenuItem>
                                  )}
                                  {canManagePatients ? (
                                    <DropdownMenuItem onClick={() => { void openEditForm(patient); }}>
                                      <HugeiconsIcon icon={Edit01Icon} className="size-4 mr-2" />
                                      {tr(language, "Edit Patient", "แก้ไขผู้ป่วย")}
                                    </DropdownMenuItem>
                                  ) : null}
                                  {canDeletePatients ? (
                                    <DropdownMenuItem
                                      onClick={() => handleDelete(patient.id)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <HugeiconsIcon icon={Delete01Icon} className="size-4 mr-2" />
                                      {tr(language, "Delete", "ลบ")}
                                    </DropdownMenuItem>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </m.tr>
                      );
                    })}
                  </AnimatePresence>
                )}
              </TableBody>
            </table>
          </div>
        </CardContent>

        <div className="sticky bottom-0 z-20 flex flex-col gap-3 border-t bg-background/80 px-4 py-3 backdrop-blur-md transition-all sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 sm:gap-6 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="size-7 rounded-full shadow-sm"
                aria-label={tr(language, "Previous page", "หน้าก่อนหน้า")}
                title={tr(language, "Previous page", "หน้าก่อนหน้า")}
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
                      <span key="ellipsis" className="px-2 py-1 text-sm text-muted-foreground">
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
                        "size-7 rounded-full p-0 text-sm font-medium transition-all",
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
                className="size-7 rounded-full shadow-sm"
                aria-label={tr(language, "Next page", "หน้าถัดไป")}
                title={tr(language, "Next page", "หน้าถัดไป")}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
            <span className="rounded-full bg-muted/30 px-3 py-1 text-sm font-medium text-muted-foreground">
              {tr(language, "Showing", "แสดง")} {startEntry}-{endEntry} {tr(language, "of", "จาก")} {total}
            </span>

            <div className="flex items-center gap-2">
              <Select value={`${sort}-${order}`} onValueChange={(val) => {
                if (!val) return;
                const [newSort, newOrder] = val.split("-");
                setSort(newSort);
                setOrder(newOrder as "asc" | "desc");
              }}>
              <SelectTrigger variant="glass" className="h-9 w-[160px] rounded-full text-sm font-medium shadow-sm transition-all focus:ring-primary/20">
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
                <DropdownMenuTrigger className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3 text-sm font-medium shadow-[4px_4px_12px_rgba(0,0,0,0.08),-4px_-4px_12px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl transition-all hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10">
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
                      className={cn(limit === size && "bg-muted", "justify-center text-sm cursor-pointer")}
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
      ) : null}

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
                    <p className="text-sm text-red-500">{formErrors.first_name}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{tr(language, "Patient's given name", "ชื่อจริงของผู้ป่วย")}</p>
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
                    <p className="text-sm text-red-500">{formErrors.last_name}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{tr(language, "Patient's family name", "นามสกุลของผู้ป่วย")}</p>
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
                  <AnimatedCalendar
                    mode="single"
                    value={formData.date_of_birth ? new Date(`${formData.date_of_birth}T00:00:00`) : undefined}
                    onChange={(value) => {
                      if (value instanceof Date) {
                        setFormData({ ...formData, date_of_birth: format(value, "yyyy-MM-dd") });
                        setFormErrors({ ...formErrors, date_of_birth: "" });
                        return;
                      }
                      setFormData({ ...formData, date_of_birth: "" });
                    }}
                    minDate={new Date("1900-01-01")}
                    maxDate={new Date()}
                    localeStrings={{
                      today: tr(language, "Today", "วันนี้"),
                      clear: tr(language, "Clear", "ล้าง"),
                      selectTime: tr(language, "Select time", "เลือกเวลา"),
                      backToCalendar: tr(language, "Back to calendar", "กลับไปปฏิทิน"),
                      selected: tr(language, "selected", "ที่เลือก"),
                    }}
                    placeholder={tr(language, "Pick a date", "เลือกวันที่")}
                    showWeekNumbers
                    showTodayButton
                    showClearButton={false}
                    closeOnSelect
                    error={!!formErrors.date_of_birth}
                    className="!w-full h-11"
                  />
                  {formErrors.date_of_birth ? (
                    <p className="text-sm text-red-500">{formErrors.date_of_birth}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{tr(language, "Patient's date of birth", "วันเกิดของผู้ป่วย")}</p>
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
                  <p className="text-sm text-muted-foreground">{tr(language, "Optional: Patient's gender identity", "ไม่บังคับ: อัตลักษณ์ทางเพศของผู้ป่วย")}</p>
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
                    <p className="text-sm text-red-500">{formErrors.phone}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{tr(language, "Contact phone number", "หมายเลขโทรศัพท์ติดต่อ")}</p>
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
                    <p className="text-sm text-red-500">{formErrors.email}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{tr(language, "Email address for contact", "อีเมลสำหรับติดต่อ")}</p>
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
                  <p className="text-sm text-red-500">{formErrors.address}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr(language, "Complete residential address", "ที่อยู่ปัจจุบันโดยละเอียด")}</p>
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

      {/* Registration Code Dialog */}
      <Dialog open={regCodeOpen} onOpenChange={setRegCodeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tr(language, "Mobile App Registration", "การลงทะเบียนแอปมือถือ")}
            </DialogTitle>
            <DialogDescription>
              {tr(language, "Registration code for patient:", "รหัสลงทะเบียนสำหรับผู้ป่วย:")}{" "}
              <span className="font-semibold text-foreground">{regCodePatient?.name}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center space-y-6 py-6">
            <div className="flex size-16 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <HugeiconsIcon icon={SmartPhone01Icon} className="size-8" />
            </div>

            {generatingRegCode ? (
              <div className="flex flex-col items-center space-y-3">
                <HugeiconsIcon icon={RefreshIcon} className="size-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {tr(language, "Generating code...", "กำลังสร้างรหัส...")}
                </p>
              </div>
            ) : regCodeData ? (
              <div className="flex flex-col items-center space-y-4 w-full">
                <div className="rounded-2xl bg-muted/50 px-8 py-4 border-2 border-dashed border-blue-200 text-center">
                  <span className="text-4xl font-bold tracking-[0.2em] text-blue-700">
                    {regCodeData.code}
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
                  {tr(language, "Expires in 15 minutes", "หมดอายุใน 15 นาที")}
                </div>

                <div className="grid grid-cols-2 gap-3 w-full mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(regCodeData.code);
                      toast.success(tr(language, "Code copied", "คัดลอกรหัสแล้ว"));
                    }}
                  >
                    <HugeiconsIcon icon={Copy01Icon} className="mr-2 size-4" />
                    {tr(language, "Copy Code", "คัดลอกรหัส")}
                  </Button>
                  <Button onClick={() => setRegCodeOpen(false)}>
                    {tr(language, "Done", "เสร็จสิ้น")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-red-500">
                {tr(language, "Failed to generate code.", "ไม่สามารถสร้างรหัสได้")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
    </LazyMotion>
  );
}
