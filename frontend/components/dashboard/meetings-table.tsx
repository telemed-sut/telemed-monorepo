"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
    Search01Icon,
    Add01Icon,
    RefreshIcon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Edit01Icon,
    Delete01Icon,
    Copy01Icon,
} from "@hugeicons/core-free-icons";
import {
    fetchMeetings,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    fetchAllPatients,
    type Meeting,
    type Patient,
    type MeetingCreatePayload,
    type MeetingUpdatePayload,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";
import { CalendarDays, CalendarPlus, Clock, Stethoscope, DoorOpen, FileText, StickyNote, User } from "lucide-react";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

interface MeetingFormState {
    date_time: string;
    description: string;
    doctor_id: string;
    note: string;
    room: string;
    user_id: string;
}

const emptyForm: MeetingFormState = {
    date_time: "",
    description: "",
    doctor_id: "",
    note: "",
    room: "",
    user_id: "",
};

export function MeetingsTable() {
    const token = useAuthStore((state) => state.token);
    const role = useAuthStore((state) => state.role);
    const userId = useAuthStore((state) => state.userId);
    const clearToken = useAuthStore((state) => state.clearToken);
    const router = useRouter();

    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const sort = "date_time";
    const order: "asc" | "desc" = "desc";
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Meeting | null>(null);
    const [formData, setFormData] = useState<MeetingFormState>(emptyForm);
    const [saving, setSaving] = useState(false);

    const [patients, setPatients] = useState<Patient[]>([]);

    const isInitialLoading = loading && meetings.length === 0;
    const isRefetching = loading && meetings.length > 0;

    const startEntry = total === 0 ? 0 : (page - 1) * limit + 1;
    const endEntry = total === 0 ? 0 : Math.min(page * limit, total);

    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

    // Stats
    const stats = useMemo(() => {
        const upcoming = meetings.filter((m) => new Date(m.date_time) > new Date()).length;
        const today = meetings.filter((m) => {
            const d = new Date(m.date_time);
            const now = new Date();
            return d.toDateString() === now.toDateString();
        }).length;
        return { total, upcoming, today };
    }, [total, meetings]);

    useEffect(() => {
        const id = setTimeout(() => setDebouncedSearch(search), 350);
        return () => clearTimeout(id);
    }, [search]);

    // Load patients for form dropdown
    useEffect(() => {
        if (!token) return;
        fetchAllPatients({ sort: "first_name", order: "asc" }, token, { maxItems: 5000 })
            .then((items) => setPatients(items))
            .catch(() => { });
    }, [token]);

    // Fetch meetings
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        const loadMeetings = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetchMeetings(
                    { page, limit, q: debouncedSearch, sort, order },
                    token
                );
                if (!cancelled) {
                    setMeetings(res.items);
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
                    setError(err instanceof Error ? err.message : "Failed to load meetings");
                    setMeetings([]);
                    setTotal(0);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadMeetings();
        return () => { cancelled = true; };
    }, [token, page, limit, debouncedSearch, sort, order, clearToken, router]);

    const resetForm = (meeting?: Meeting) => {
        if (meeting) {
            setFormData({
                date_time: meeting.date_time ? new Date(meeting.date_time).toISOString().slice(0, 16) : "",
                description: meeting.description ?? "",
                doctor_id: meeting.doctor_id ?? "",
                note: meeting.note ?? "",
                room: meeting.room ?? "",
                user_id: meeting.user_id ?? "",
            });
            setEditing(meeting);
        } else {
            setFormData({ ...emptyForm, doctor_id: userId ?? "" });
            setEditing(null);
        }
        setFormErrors({});
        setFormOpen(true);
    };

    const validateForm = () => {
        const errors: Record<string, string> = {};
        if (!formData.date_time) errors.date_time = "Date & time is required";
        if (!formData.doctor_id) errors.doctor_id = "Doctor is required";
        if (!formData.user_id) errors.user_id = "Patient is required";
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
            toast.error("Please fix the errors in the form");
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                date_time: new Date(formData.date_time).toISOString(),
                description: formData.description || undefined,
                doctor_id: formData.doctor_id,
                note: formData.note || undefined,
                room: formData.room || undefined,
                user_id: formData.user_id,
            };

            if (editing) {
                await updateMeeting(editing.id, payload as MeetingUpdatePayload, token);
                toast.success("Meeting updated successfully");
            } else {
                await createMeeting(payload as MeetingCreatePayload, token);
                toast.success("Meeting created successfully");
            }
            closeForm();
            setPage(1);
            const res = await fetchMeetings({ page: 1, limit, q: debouncedSearch, sort, order }, token);
            setMeetings(res.items);
            setTotal(res.total);
        } catch (err) {
            const status = (err as { status?: number }).status;
            if (status === 401) {
                clearToken();
                router.replace("/login");
                return;
            }
            const message = err instanceof Error ? err.message : "Save failed";
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async (id: string) => {
        if (!token) return;
        try {
            await deleteMeeting(id, token);
            toast.success("Meeting deleted successfully");
            const res = await fetchMeetings({ page, limit, q: debouncedSearch, sort, order }, token);
            setMeetings(res.items);
            setTotal(res.total);
            if (res.items.length === 0 && page > 1) setPage((p) => Math.max(1, p - 1));
        } catch (err) {
            const status = (err as { status?: number }).status;
            if (status === 401) {
                clearToken();
                router.replace("/login");
                return;
            }
            toast.error(err instanceof Error ? err.message : "Delete failed");
        }
    };

    const handleDelete = (id: string) => {
        toast.destructiveAction("Delete meeting?", {
            description: "This action cannot be undone.",
            button: {
                title: "Delete",
                onClick: () => {
                    void confirmDelete(id);
                },
            },
            duration: 9000,
        });
    };

    const formatDateTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
            " · " +
            d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    };

    const isUpcoming = (iso: string) => new Date(iso) > new Date();

    const emptyStateContent = (
        <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-6 group">
                <div className="absolute inset-0 bg-violet-500/20 rounded-full blur-xl scale-150 animate-pulse opacity-50 group-hover:opacity-100 transition-opacity" />
                <div className="relative p-6 bg-background rounded-full border border-border shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <CalendarDays className="size-10 text-violet-500/80" />
                </div>
            </div>
            <div className="space-y-2 max-w-sm mx-auto">
                <h3 className="font-bold text-xl tracking-tight text-foreground">No meetings found</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {search
                        ? "We couldn't find any meetings matching your search. Try adjusting your filters."
                        : "Get started by scheduling your first meeting."}
                </p>
            </div>
            {search ? (
                <Button
                    variant="outline"
                    className="mt-6 gap-2 rounded-full border-dashed border-violet-500/30 hover:bg-violet-500/5 hover:border-violet-500/60 transition-all"
                    onClick={() => setSearch("")}
                >
                    <HugeiconsIcon icon={RefreshIcon} className="size-4" />
                    Clear Search
                </Button>
            ) : (
                <Button onClick={() => resetForm()} size="lg" className="mt-6 shadow-md hover:shadow-lg transition-all rounded-full bg-violet-600 hover:bg-violet-700">
                    <HugeiconsIcon icon={Add01Icon} className="size-4 mr-2" />
                    Schedule first meeting
                </Button>
            )}
        </div>
    );

    return (
        <LazyMotion features={domAnimation}>
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-violet-500/5 hover:shadow-lg transition-all duration-300 group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CalendarDays className="w-24 h-24 text-violet-500 transform rotate-12 translate-x-4 -translate-y-4" />
                    </div>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Meetings</CardTitle>
                        <div className="p-2 bg-violet-500/10 rounded-lg group-hover:bg-violet-500/20 transition-colors">
                            <CalendarDays className="h-4 w-4 text-violet-500" />
                        </div>
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="text-3xl font-bold tracking-tight text-foreground">{stats.total}</div>
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                            <span className="text-violet-500 font-medium">All</span> scheduled meetings
                        </p>
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-emerald-500/5 hover:shadow-lg transition-all duration-300 group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Clock className="w-24 h-24 text-emerald-500 transform rotate-12 translate-x-4 -translate-y-4" />
                    </div>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming</CardTitle>
                        <div className="p-2 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
                            <Clock className="h-4 w-4 text-emerald-500" />
                        </div>
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="text-3xl font-bold tracking-tight text-foreground">{stats.upcoming}</div>
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                            <span className="text-emerald-500 font-medium">Future</span> appointments
                        </p>
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-amber-500/5 hover:shadow-lg transition-all duration-300 group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CalendarPlus className="w-24 h-24 text-amber-500 transform rotate-12 translate-x-4 -translate-y-4" />
                    </div>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Today</CardTitle>
                        <div className="p-2 bg-amber-500/10 rounded-lg group-hover:bg-amber-500/20 transition-colors">
                            <CalendarPlus className="h-4 w-4 text-amber-500" />
                        </div>
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="text-3xl font-bold tracking-tight text-foreground">{stats.today}</div>
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                            <span className="text-amber-500 font-medium">Scheduled</span> for today
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Meetings Table */}
            <Card className="flex flex-col overflow-hidden">
                <CardHeader className="pb-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
                                <div className="flex items-center justify-center p-2 rounded-lg bg-violet-500/10">
                                    <CalendarDays className="size-5 text-violet-500" />
                                </div>
                                Meetings Directory
                            </CardTitle>
                            <CardDescription className="ml-11">
                                Manage appointments, schedules, and meeting details.
                            </CardDescription>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 sm:flex-none group">
                                <HugeiconsIcon
                                    icon={Search01Icon}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-violet-500 transition-colors"
                                />
                                <Input
                                    placeholder="Search meetings..."
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value);
                                        setPage(1);
                                    }}
                                    className="pl-9 w-full sm:w-[280px] h-10 bg-background/50 border-input/60 hover:border-input focus-visible:ring-violet-500/20 transition-all shadow-sm"
                                />
                            </div>
                            <Button
                                className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                                onClick={() => resetForm()}
                            >
                                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                                New Meeting
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="size-10 shadow-sm"
                                title="Refresh"
                                onClick={async () => {
                                    if (!token) return;
                                    setLoading(true);
                                    try {
                                        const res = await fetchMeetings({ page, limit, q: debouncedSearch, sort, order }, token);
                                        setMeetings(res.items);
                                        setTotal(res.total);
                                    } catch (err) {
                                        const status = (err as { status?: number }).status;
                                        if (status === 401) {
                                            clearToken();
                                            router.replace("/login");
                                        }
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                            >
                                <HugeiconsIcon icon={RefreshIcon} className="size-4" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-0 relative flex-1 overflow-hidden">
                    {error && (
                        <div className="px-6 py-3 text-sm text-destructive bg-destructive/5 border-b">
                            <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-destructive" />
                                {error}
                            </div>
                        </div>
                    )}

                    {isRefetching && (
                        <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background/90 to-transparent pointer-events-none animate-pulse z-10" />
                    )}

                    <div className="overflow-x-auto max-h-[500px] lg:max-h-[600px] overflow-y-auto scroll-smooth border-b">
                        <table className={cn("w-full caption-bottom text-sm border-separate border-spacing-0", isRefetching && "opacity-60 grayscale transition-all duration-300")}>
                            <TableHeader className="[&_tr]:border-b">
                                <TableRow className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 hover:bg-transparent shadow-sm border-b transition-colors">
                                    <TableHead className="h-12 px-4 text-center align-middle font-medium text-muted-foreground w-[60px]">
                                        #
                                    </TableHead>
                                    <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[180px]">
                                        <div className="flex items-center gap-2">
                                            <CalendarDays className="size-4" />
                                            Date & Time
                                        </div>
                                    </TableHead>
                                    <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[160px]">
                                        <div className="flex items-center gap-2">
                                            <Stethoscope className="size-4" />
                                            Doctor
                                        </div>
                                    </TableHead>
                                    <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[160px]">
                                        <div className="flex items-center gap-2">
                                            <User className="size-4" />
                                            Patient
                                        </div>
                                    </TableHead>
                                    <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell min-w-[100px]">
                                        <div className="flex items-center gap-2">
                                            <DoorOpen className="size-4" />
                                            Room
                                        </div>
                                    </TableHead>
                                    <TableHead className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell min-w-[200px]">
                                        <div className="flex items-center gap-2">
                                            <FileText className="size-4" />
                                            Description
                                        </div>
                                    </TableHead>
                                    <TableHead className="h-12 px-4 align-middle font-medium text-muted-foreground text-right min-w-[100px]">
                                        Actions
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="[&_tr:last-child]:border-0 transition-opacity duration-200">
                                {isInitialLoading ? (
                                    Array.from({ length: 8 }).map((_, i) => (
                                        <TableRow key={`skeleton-${i}`} className="hover:bg-muted/5">
                                            <TableCell className="p-4"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                                            <TableCell className="p-4"><Skeleton className="h-4 w-32" /></TableCell>
                                            <TableCell className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <Skeleton className="h-8 w-8 rounded-full" />
                                                    <Skeleton className="h-4 w-20" />
                                                </div>
                                            </TableCell>
                                            <TableCell className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <Skeleton className="h-8 w-8 rounded-full" />
                                                    <Skeleton className="h-4 w-20" />
                                                </div>
                                            </TableCell>
                                            <TableCell className="p-4 hidden md:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                            <TableCell className="p-4 hidden lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                                            <TableCell className="p-4 text-right"><Skeleton className="h-8 w-8 ml-auto rounded-md" /></TableCell>
                                        </TableRow>
                                    ))
                                ) : meetings.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7}>{emptyStateContent}</TableCell>
                                    </TableRow>
                                ) : (
                                    <AnimatePresence mode="wait">
                                        {meetings.map((meeting, index) => {
                                            const rowNumber = (page - 1) * limit + index + 1;
                                            const upcoming = isUpcoming(meeting.date_time);

                                            return (
                                                <m.tr
                                                    key={meeting.id}
                                                    initial={{ opacity: 0, y: 5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0 }}
                                                    transition={{ duration: 0.12, delay: index * 0.02 }}
                                                    className="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted group"
                                                >
                                                    <TableCell className="p-4 align-middle text-center font-medium text-muted-foreground">
                                                        {rowNumber}
                                                    </TableCell>

                                                    {/* Date & Time */}
                                                    <TableCell className="p-4 align-middle">
                                                        <div className="space-y-1">
                                                            <div className="font-medium text-foreground text-sm">
                                                                {formatDateTime(meeting.date_time)}
                                                            </div>
                                                            <Badge
                                                                variant="secondary"
                                                                className={cn(
                                                                    "text-xs font-normal border-transparent",
                                                                    upcoming
                                                                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                                        : "bg-muted text-muted-foreground"
                                                                )}
                                                            >
                                                                {upcoming ? "Upcoming" : "Past"}
                                                            </Badge>
                                                        </div>
                                                    </TableCell>

                                                    {/* Doctor */}
                                                    <TableCell className="p-4 align-middle">
                                                        <div className="flex items-center gap-2">
                                                            <Avatar className="size-8 ring-2 ring-background transition-shadow group-hover:ring-violet-500/20">
                                                                <AvatarFallback className="bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-semibold">
                                                                    {meeting.doctor
                                                                        ? `${meeting.doctor.first_name?.charAt(0) ?? ""}${meeting.doctor.last_name?.charAt(0) ?? ""}`.toUpperCase() || "DR"
                                                                        : "DR"}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                                                {meeting.doctor
                                                                    ? `${meeting.doctor.first_name ?? ""} ${meeting.doctor.last_name ?? ""}`.trim() || meeting.doctor.email
                                                                    : "—"}
                                                            </div>
                                                        </div>
                                                    </TableCell>

                                                    {/* Patient */}
                                                    <TableCell className="p-4 align-middle">
                                                        <div className="flex items-center gap-2">
                                                            <Avatar className="size-8 ring-2 ring-background transition-shadow group-hover:ring-primary/20">
                                                                <AvatarFallback className="bg-primary/5 text-primary text-xs font-semibold">
                                                                    {meeting.patient
                                                                        ? `${meeting.patient.first_name.charAt(0)}${meeting.patient.last_name.charAt(0)}`.toUpperCase()
                                                                        : "PA"}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                                                {meeting.patient
                                                                    ? `${meeting.patient.first_name} ${meeting.patient.last_name}`
                                                                    : "—"}
                                                            </div>
                                                        </div>
                                                    </TableCell>

                                                    {/* Room */}
                                                    <TableCell className="p-4 align-middle hidden md:table-cell">
                                                        {meeting.room ? (
                                                            <Badge variant="secondary" className="font-normal border-transparent bg-secondary/50 hover:bg-secondary">
                                                                {meeting.room}
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>

                                                    {/* Description */}
                                                    <TableCell className="p-4 align-middle hidden lg:table-cell">
                                                        <div className="text-sm text-muted-foreground max-w-[200px] truncate" title={meeting.description || undefined}>
                                                            {meeting.description || <span className="text-muted-foreground/50">—</span>}
                                                        </div>
                                                    </TableCell>

                                                    {/* Actions */}
                                                    <TableCell className="p-4 align-middle text-right">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors data-[state=open]:bg-muted">
                                                                <span className="sr-only">Open menu</span>
                                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground">
                                                                    <circle cx="12" cy="12" r="1" />
                                                                    <circle cx="19" cy="12" r="1" />
                                                                    <circle cx="5" cy="12" r="1" />
                                                                </svg>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-40">
                                                                <DropdownMenuItem onClick={() => {
                                                                    navigator.clipboard.writeText(meeting.id);
                                                                    toast.success("ID copied to clipboard");
                                                                }}>
                                                                    <HugeiconsIcon icon={Copy01Icon} className="size-4 mr-2" />
                                                                    Copy ID
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => resetForm(meeting)}>
                                                                    <HugeiconsIcon icon={Edit01Icon} className="size-4 mr-2" />
                                                                    Edit
                                                                </DropdownMenuItem>
                                                                {role === "admin" && (
                                                                    <DropdownMenuItem onClick={() => handleDelete(meeting.id)} className="text-destructive focus:text-destructive">
                                                                        <HugeiconsIcon icon={Delete01Icon} className="size-4 mr-2" />
                                                                        Delete
                                                                    </DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </TableCell>
                                                </m.tr>
                                            );
                                        })}
                                    </AnimatePresence>
                                )}
                            </TableBody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {total > 0 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4">
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span>
                                    Showing <span className="font-medium text-foreground">{startEntry}</span> to{" "}
                                    <span className="font-medium text-foreground">{endEntry}</span> of{" "}
                                    <span className="font-medium text-foreground">{total}</span>
                                </span>
                                <Select value={limit.toString()} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
                                    <SelectTrigger className="h-8 w-[72px] shadow-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAGE_SIZE_OPTIONS.map((size) => (
                                            <SelectItem key={size} value={size.toString()}>
                                                {size}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span className="text-sm">per page</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    className="gap-1 shadow-sm"
                                >
                                    <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                                    Prev
                                </Button>
                                <div className="flex items-center gap-1">
                                    <span className="text-sm font-medium text-foreground px-2">
                                        {page} / {totalPages}
                                    </span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    className="gap-1 shadow-sm"
                                >
                                    Next
                                    <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create / Edit Form Sheet */}
            <Sheet open={formOpen} onOpenChange={(open) => { if (!open) closeForm(); }}>
                <SheetContent className="sm:max-w-lg overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-violet-500/10">
                                <CalendarDays className="size-5 text-violet-500" />
                            </div>
                            {editing ? "Edit Meeting" : "Schedule New Meeting"}
                        </SheetTitle>
                        <SheetDescription>
                            {editing ? "Update the meeting details below." : "Fill in the details to schedule a new meeting."}
                        </SheetDescription>
                    </SheetHeader>

                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-5 mt-6 px-1"
                    >
                        {/* Date & Time */}
                        <div className="space-y-2">
                            <Label htmlFor="date_time" className="flex items-center gap-2 text-sm font-medium">
                                <Clock className="size-4 text-violet-500" /> Date & Time *
                            </Label>
                            <Input
                                id="date_time"
                                type="datetime-local"
                                value={formData.date_time}
                                onChange={(e) => setFormData({ ...formData, date_time: e.target.value })}
                                className={cn(formErrors.date_time && "border-destructive")}
                            />
                            {formErrors.date_time && <p className="text-sm text-destructive">{formErrors.date_time}</p>}
                        </div>

                        {/* Doctor */}
                        <div className="space-y-2">
                            <Label htmlFor="doctor_id" className="flex items-center gap-2 text-sm font-medium">
                                <Stethoscope className="size-4 text-violet-500" /> Doctor *
                            </Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="doctor_id"
                                    value={formData.doctor_id}
                                    onChange={(e) => setFormData({ ...formData, doctor_id: e.target.value })}
                                    className={cn("flex-1", formErrors.doctor_id && "border-destructive")}
                                    readOnly={!!userId}
                                />
                                {userId && formData.doctor_id !== userId && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="shrink-0 text-sm"
                                        onClick={() => setFormData({ ...formData, doctor_id: userId })}
                                    >
                                        Use my ID
                                    </Button>
                                )}
                            </div>
                            {userId && formData.doctor_id === userId && (
                                <p className="flex items-center gap-1 text-sm text-emerald-500">
                                    <Stethoscope className="size-3" /> Assigned to you (current user)
                                </p>
                            )}
                            {formErrors.doctor_id && <p className="text-sm text-destructive">{formErrors.doctor_id}</p>}
                        </div>

                        {/* Patient */}
                        <div className="space-y-2">
                            <Label htmlFor="user_id" className="flex items-center gap-2 text-sm font-medium">
                                <User className="size-4 text-violet-500" /> Patient *
                            </Label>
                            {patients.length > 0 ? (
                                <Select value={formData.user_id || ""} onValueChange={(v: string | null) => setFormData({ ...formData, user_id: v ?? "" })}>
                                    <SelectTrigger className={cn(formErrors.user_id && "border-destructive")}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {patients.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.first_name} {p.last_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    id="user_id"
                                    placeholder="Enter patient UUID"
                                    value={formData.user_id}
                                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                                    className={cn(formErrors.user_id && "border-destructive")}
                                />
                            )}
                            {formErrors.user_id && <p className="text-sm text-destructive">{formErrors.user_id}</p>}
                        </div>

                        {/* Room */}
                        <div className="space-y-2">
                            <Label htmlFor="room" className="flex items-center gap-2 text-sm font-medium">
                                <DoorOpen className="size-4 text-violet-500" /> Room
                            </Label>
                            <Input
                                id="room"
                                placeholder="e.g. Room 301"
                                value={formData.room}
                                onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                            />
                        </div>

                        {/* Description */}
                        <div className="space-y-2">
                            <Label htmlFor="description" className="flex items-center gap-2 text-sm font-medium">
                                <FileText className="size-4 text-violet-500" /> Description
                            </Label>
                            <Textarea
                                id="description"
                                placeholder="Meeting description..."
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                rows={3}
                            />
                        </div>

                        {/* Note */}
                        <div className="space-y-2">
                            <Label htmlFor="note" className="flex items-center gap-2 text-sm font-medium">
                                <StickyNote className="size-4 text-violet-500" /> Note
                            </Label>
                            <Textarea
                                id="note"
                                placeholder="Additional notes..."
                                value={formData.note}
                                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                                rows={3}
                            />
                        </div>

                        {/* Buttons */}
                        <div className="flex items-center gap-3 pt-2">
                            <Button
                                type="submit"
                                disabled={saving}
                                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white gap-2"
                            >
                                {saving ? (
                                    <>
                                        <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <HugeiconsIcon icon={editing ? Edit01Icon : Add01Icon} className="size-4" />
                                        {editing ? "Update Meeting" : "Create Meeting"}
                                    </>
                                )}
                            </Button>
                            <Button type="button" variant="outline" onClick={closeForm}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </SheetContent>
            </Sheet>

        </div>
        </LazyMotion>
    );
}
