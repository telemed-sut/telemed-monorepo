"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
} from "@hugeicons/core-free-icons";
import { fetchPatients, createPatient, updatePatient, deletePatient, type Patient } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 10000];

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

export function PatientsTable() {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const clearToken = useAuthStore((state) => state.clearToken);
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [formData, setFormData] = useState<PatientFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState<string | null>(null);

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
    const loadPatients = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchPatients(
          { page, limit, q: debouncedSearch, sort, order },
          token
        );
        if (!cancelled) {
          setPatients(res.items);
          setTotal(res.total);
        }
      } catch (err) {
        if (!cancelled) {
          const status = (err as { status?: number }).status;
          if (status === 401) {
            clearToken();
            router.replace("/login");
            return;
          }
          const message = err instanceof Error ? err.message : "Failed to load patients";
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
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setSaving(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updatePatient(editing.id, formData, token);
      } else {
        await createPatient(formData, token);
      }
      toast.success(editing ? "Patient updated successfully" : "Patient created successfully");
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

      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    setPatientToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!token || !patientToDelete) return;
    setError(null);
    try {
      await deletePatient(patientToDelete, token);
      toast.success("Patient deleted successfully");
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
      const message = err instanceof Error ? err.message : "Delete failed";
      setError(message);
      toast.error(message);
    } finally {
      setDeleteDialogOpen(false);
      setPatientToDelete(null);
    }
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

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative mb-6 group">
        <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl scale-150 animate-pulse opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div className="relative p-6 bg-background rounded-full border border-border shadow-lg group-hover:scale-110 transition-transform duration-300">
          <HugeiconsIcon icon={UserGroupIcon} className="size-10 text-primary/80" />
        </div>
      </div>
      <div className="space-y-2 max-w-sm mx-auto">
        <h3 className="font-bold text-xl tracking-tight text-foreground">No patients found</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {search ? "We couldn't find any patients matching your search query. Try adjusting your filters." : "Get started by adding your first patient to the system."}
        </p>
      </div>
      {search && (
        <Button
          variant="outline"
          className="mt-6 gap-2 rounded-full border-dashed border-primary/30 hover:bg-primary/5 hover:border-primary/60 transition-all"
          onClick={() => setSearch("")}
        >
          <HugeiconsIcon icon={RefreshIcon} className="size-4" />
          Clear Search
        </Button>
      )}
      {!search && (
        <Button onClick={() => resetForm()} size="lg" className="mt-6 shadow-md hover:shadow-lg transition-all rounded-full">
          <HugeiconsIcon icon={Add01Icon} className="size-4 mr-2" />
          Add first patient
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Patients</CardTitle>
            <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
              <HugeiconsIcon icon={UserGroupIcon} className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-bold tracking-tight text-foreground">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="text-primary font-medium">Synced</span> in system
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-emerald-500/5 hover:shadow-lg transition-all duration-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <HugeiconsIcon icon={AiPhone01Icon} className="w-24 h-24 text-emerald-500 transform rotate-12 translate-x-4 -translate-y-4" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Contacts</CardTitle>
            <div className="p-2 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
              <HugeiconsIcon icon={AiPhone01Icon} className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-bold tracking-tight text-foreground">{stats.active}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="text-emerald-500 font-medium">{(stats.active / stats.total * 100).toFixed(0)}%</span> response rate
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-amber-500/5 hover:shadow-lg transition-all duration-300 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <HugeiconsIcon icon={CalendarAddIcon} className="w-24 h-24 text-amber-500 transform rotate-12 translate-x-4 -translate-y-4" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">New This Week</CardTitle>
            <div className="p-2 bg-amber-500/10 rounded-lg group-hover:bg-amber-500/20 transition-colors">
              <HugeiconsIcon icon={CalendarAddIcon} className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-bold tracking-tight text-foreground">{stats.recent}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="text-amber-500 font-medium">+{stats.recent}</span> last 7 days
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
                Patient Directory
              </CardTitle>
              <CardDescription className="ml-11">
                Manage your patient records, appointments, and contact details.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-none group">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-primary transition-colors"
                />
                <Input
                  placeholder="Search patients..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 w-full sm:w-[280px] h-10 bg-background/50 border-input/60 hover:border-input focus-visible:ring-primary/20 transition-all shadow-sm"
                />
              </div>
              <Button className="gap-2 shadow-md hover:shadow-lg transition-all" onClick={() => resetForm()}>
                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                Add Patient
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-10 shadow-sm"
                title="Reset Filters"
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
                        console.error("Reset error:", err);
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
                      Patient
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Calendar03Icon} className="size-4" />
                      Age & DOB
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell min-w-[100px]">
                    Gender
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={AiPhone01Icon} className="size-4" />
                      Contact
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Location01Icon} className="size-4" />
                      Address
                    </div>
                  </TableHead>
                  <TableHead className="h-12 px-4 align-middle font-medium text-muted-foreground text-right min-w-[100px]">
                    Actions
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
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2, delay: index * 0.05 }}
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
                              <div className="font-medium text-foreground">{age} years <span className="text-muted-foreground font-normal">old</span></div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(patient.date_of_birth).toLocaleDateString('en-GB')}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="p-4 align-middle hidden md:table-cell">
                            {patient.gender ? (
                              <Badge variant="secondary" className="capitalize font-normal border-transparent bg-secondary/50 hover:bg-secondary">
                                {patient.gender}
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
                                <span className="sr-only">Open menu</span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground">
                                  <circle cx="12" cy="12" r="1" />
                                  <circle cx="19" cy="12" r="1" />
                                  <circle cx="5" cy="12" r="1" />
                                </svg>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={() => {
                                  navigator.clipboard.writeText(patient.id);
                                  toast.success("ID copied to clipboard");
                                }}>
                                  <HugeiconsIcon icon={Copy01Icon} className="size-4 mr-2" />
                                  Copy ID
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => resetForm(patient)}>
                                  <HugeiconsIcon icon={Edit01Icon} className="size-4 mr-2" />
                                  Edit Patient
                                </DropdownMenuItem>
                                {role === "admin" && (
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(patient.id)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <HugeiconsIcon icon={Delete01Icon} className="size-4 mr-2" />
                                    Delete
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
              {startEntry}-{endEntry} of {total}
            </span>

            <div className="flex items-center gap-2">
              <Select value={`${sort}-${order}`} onValueChange={(val) => {
                if (!val) return;
                const [newSort, newOrder] = val.split("-");
                setSort(newSort);
                setOrder(newOrder as "asc" | "desc");
              }}>
                <SelectTrigger className="w-[140px] h-8 text-xs bg-background/50 rounded-full border-input/60 focus:ring-primary/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at-desc">Newest First</SelectItem>
                  <SelectItem value="created_at-asc">Oldest First</SelectItem>
                  <SelectItem value="first_name-asc">Name (A-Z)</SelectItem>
                  <SelectItem value="first_name-desc">Name (Z-A)</SelectItem>
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-full border border-input/60 bg-background/50 hover:bg-muted shadow-sm text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20">
                  {limit === 10000 ? "All" : limit} / page
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
                      {size === 10000 ? "All" : size}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </Card>

      {/* Patient Form Sheet */}
      <Sheet
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeForm();
          } else {
            setFormOpen(true);
          }
        }}
      >
        <SheetContent side="center">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit patient" : "Add patient"}</SheetTitle>
            <SheetDescription>
              Required fields: first name, last name, date of birth.
            </SheetDescription>
          </SheetHeader>

          <div className="px-6 pb-6 pt-2">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {/* Name Fields */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first_name" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    First name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="first_name"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    placeholder="Enter first name"
                    required
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Patient's given name</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="last_name" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Last name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="last_name"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    placeholder="Enter last name"
                    required
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Patient's family name</p>
                </div>
              </div>

              {/* Date of Birth & Gender */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date_of_birth" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Date of birth <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="date_of_birth"
                    type="date"
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                    required
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Patient's date of birth</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gender" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="8" r="4" strokeWidth={2} />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12v9m-4-7l4 4 4-4" />
                    </svg>
                    Gender
                  </Label>
                  <Input
                    id="gender"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    placeholder="e.g., Male, Female, Other"
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Optional: Patient's gender identity</p>
                </div>
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    Phone
                  </Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="e.g., +66 12-345-6789"
                    type="tel"
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Contact phone number</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="patient@example.com"
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Email address for contact</p>
                </div>
              </div>

              {/* Address */}
              <div className="space-y-2">
                <Label htmlFor="address" className="text-sm font-medium flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Address
                </Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Enter full address including street, city, postal code..."
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">Complete residential address</p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-4 border border-red-200 dark:border-red-900">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-red-800 dark:text-red-300">Validation Error</h4>
                      <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <Button variant="ghost" type="button" onClick={closeForm} disabled={saving} className="min-w-[100px]">
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} className="min-w-[140px]">
                  {saving ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {editing ? "Save changes" : "Create patient"}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <div className="flex items-start space-x-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30">
              <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Patient Record</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">Are you sure you want to delete this patient record?</span>
                <span className="block text-sm text-muted-foreground/80 dark:text-muted-foreground/60">
                  This action cannot be undone. The patient's information will be permanently removed from the system.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPatientToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Patient
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
