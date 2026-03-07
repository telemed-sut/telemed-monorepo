"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
    UserIcon,
    AiPhone01Icon,
    Mail01Icon,
    Location01Icon,
    MedicalMaskIcon,
    CalendarAddIcon,
    Stethoscope02Icon,
} from "@hugeicons/core-free-icons";
import {
    fetchPatient,
    fetchMeetings,
    type Patient,
    type Meeting,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

interface PatientDetailContentProps {
    patientId: string;
}

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;

const getGenderLabel = (value: string | null | undefined, language: AppLanguage): string => {
    if (!value) return "—";
    const normalized = value.toLowerCase();
    if (normalized === "male") return tr(language, "Male", "ชาย");
    if (normalized === "female") return tr(language, "Female", "หญิง");
    if (normalized === "other") return tr(language, "Other", "อื่น ๆ");
    return value;
};

export function PatientDetailContent({ patientId }: PatientDetailContentProps) {
    const token = useAuthStore((state) => state.token);
    const clearToken = useAuthStore((state) => state.clearToken);
    const language = useLanguageStore((state) => state.language);
    const router = useRouter();

    const [patient, setPatient] = useState<Patient | null>(null);
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [meetingsTotal, setMeetingsTotal] = useState(0);
    const [loadingPatient, setLoadingPatient] = useState(true);
    const [loadingMeetings, setLoadingMeetings] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;

        const loadPatient = async () => {
            setLoadingPatient(true);
            setError(null);
            try {
                const data = await fetchPatient(patientId, token);
                if (!cancelled) setPatient(data);
            } catch (err) {
                if (cancelled) return;
                const status = (err as { status?: number }).status;
                if (status === 401) {
                    clearToken();
                    router.replace("/login");
                    return;
                }
                setError(
                    status === 404
                        ? tr(language, "Patient not found", "ไม่พบผู้ป่วย")
                        : err instanceof Error
                            ? err.message
                            : tr(language, "Failed to load patient", "โหลดข้อมูลผู้ป่วยไม่สำเร็จ")
                );
            } finally {
                if (!cancelled) setLoadingPatient(false);
            }
        };

        loadPatient();
        return () => { cancelled = true; };
    }, [token, patientId, language, clearToken, router]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;

        const loadMeetings = async () => {
            setLoadingMeetings(true);
            try {
                const res = await fetchMeetings(
                    { patient_id: patientId, limit: 100, sort: "date_time", order: "desc" },
                    token
                );
                if (!cancelled) {
                    setMeetings(res.items);
                    setMeetingsTotal(res.total);
                }
            } catch (err) {
                if (cancelled) return;
                const status = (err as { status?: number }).status;
                if (status === 401) {
                    clearToken();
                    router.replace("/login");
                }
            } finally {
                if (!cancelled) setLoadingMeetings(false);
            }
        };

        loadMeetings();
        return () => { cancelled = true; };
    }, [token, patientId, clearToken, router]);

    const getAge = (dateOfBirth: string) => {
        const dob = new Date(dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
        return age;
    };

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString(language === "th" ? "th-TH" : "en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
        });

    const formatDateTime = (dateStr: string) =>
        new Date(dateStr).toLocaleString(language === "th" ? "th-TH" : "en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

    // ── Loading ──
    if (loadingPatient) {
        return (
            <div className="space-y-6 py-2">
                <div className="flex items-center gap-3">
                    <Skeleton className="size-12 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 w-full rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-40 w-full rounded-xl" />
            </div>
        );
    }

    // ── Error ──
    if (error || !patient) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="p-5 bg-background rounded-full border border-border shadow-sm mb-4">
                    <HugeiconsIcon icon={MedicalMaskIcon} className="size-8 text-destructive/60" />
                </div>
                <h3 className="font-bold text-lg text-foreground mb-1">
                    {error || tr(language, "Patient not found", "ไม่พบผู้ป่วย")}
                </h3>
                <p className="text-sm text-muted-foreground">
                    {tr(language, "Unable to load patient data.", "ไม่สามารถโหลดข้อมูลผู้ป่วยได้")}
                </p>
            </div>
        );
    }

    const age = getAge(patient.date_of_birth);
    const hasContact = !!(patient.phone || patient.email);

    return (
        <LazyMotion features={domAnimation}>
        <div className="space-y-6 py-2 overflow-y-auto">
            {/* Patient Header */}
            <m.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3"
            >
                <Avatar className="size-12 ring-2 ring-primary/20">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold text-lg">
                        {(patient.first_name?.charAt(0) || "") + (patient.last_name?.charAt(0) || "")}
                    </AvatarFallback>
                </Avatar>
                <div>
                    <h2 className="text-lg font-bold tracking-tight text-foreground">
                        {patient.first_name} {patient.last_name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {tr(
                            language,
                            `${age} years old`,
                            `${age} ปี`
                        )} • {patient.gender ? getGenderLabel(patient.gender, language) : tr(language, "N/A", "ไม่มีข้อมูล")}
                    </p>
                </div>
            </m.div>

            {/* Clinical View Link */}
            <m.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.03 }}
            >
                <button
                    onClick={() => router.push(`/patients/${patientId}/dense`)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors text-left group"
                >
                    <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                        <HugeiconsIcon icon={Stethoscope02Icon} className="size-4 text-primary" />
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">{tr(language, "Open Clinical View", "เปิดมุมมองคลินิก")}</p>
                        <p className="text-sm text-muted-foreground">{tr(language, "View full clinical dashboard with timeline, orders & notes", "ดูแดชบอร์ดคลินิกเต็มรูปแบบพร้อมไทม์ไลน์ คำสั่ง และบันทึก")}</p>
                    </div>
                    <svg className="size-4 text-muted-foreground group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </m.div>

            {/* Info Sections */}
            <m.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className="space-y-3"
            >
                {/* Personal Info */}
                <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                        <div className="p-1.5 bg-primary/10 rounded-md">
                            <HugeiconsIcon icon={UserIcon} className="size-3.5 text-primary" />
                        </div>
                        {tr(language, "Personal Info", "ข้อมูลส่วนตัว")}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <span className="text-sm text-muted-foreground">{tr(language, "Date of Birth", "วันเกิด")}</span>
                            <p className="font-medium text-foreground">{formatDate(patient.date_of_birth)}</p>
                        </div>
                        <div>
                            <span className="text-sm text-muted-foreground">{tr(language, "Age", "อายุ")}</span>
                            <p className="font-medium text-foreground">{tr(language, `${age} years`, `${age} ปี`)}</p>
                        </div>
                        <div>
                            <span className="text-sm text-muted-foreground">{tr(language, "Gender", "เพศ")}</span>
                            <p className="font-medium text-foreground capitalize">{getGenderLabel(patient.gender, language)}</p>
                        </div>
                    </div>
                </div>

                {/* Contact */}
                <div className="rounded-xl border bg-gradient-to-r from-emerald-500/5 to-transparent p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                        <div className="p-1.5 bg-emerald-500/10 rounded-md">
                            <HugeiconsIcon icon={AiPhone01Icon} className="size-3.5 text-emerald-500" />
                        </div>
                        {tr(language, "Contact", "ช่องทางติดต่อ")}
                    </div>
                    <div className="space-y-2 text-sm">
                        {patient.phone && (
                            <div className="flex items-center gap-2">
                                <HugeiconsIcon icon={AiPhone01Icon} className="size-3.5 text-muted-foreground" />
                                <span className="text-foreground">{patient.phone}</span>
                            </div>
                        )}
                        {patient.email && (
                            <div className="flex items-center gap-2">
                                <HugeiconsIcon icon={Mail01Icon} className="size-3.5 text-muted-foreground" />
                                <span className="text-foreground truncate">{patient.email}</span>
                            </div>
                        )}
                        {!hasContact && (
                            <p className="text-sm text-muted-foreground/60">{tr(language, "No contact info available", "ไม่มีข้อมูลติดต่อ")}</p>
                        )}
                    </div>
                </div>

                {/* Address */}
                <div className="rounded-xl border bg-gradient-to-r from-amber-500/5 to-transparent p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                        <div className="p-1.5 bg-amber-500/10 rounded-md">
                            <HugeiconsIcon icon={Location01Icon} className="size-3.5 text-amber-500" />
                        </div>
                        {tr(language, "Address", "ที่อยู่")}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">
                        {patient.address || <span className="text-muted-foreground/60">{tr(language, "No address recorded", "ไม่มีที่อยู่ที่บันทึกไว้")}</span>}
                    </p>
                </div>
            </m.div>

            {/* Meetings History */}
            <m.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.1 }}
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <div className="p-1.5 bg-primary/10 rounded-md">
                            <HugeiconsIcon icon={CalendarAddIcon} className="size-3.5 text-primary" />
                        </div>
                        {tr(language, "Appointment History", "ประวัติการนัดหมาย")}
                    </div>
                    {meetingsTotal > 0 && (
                        <Badge variant="secondary" className="border-transparent bg-primary/10 text-sm text-primary">
                            {meetingsTotal}
                        </Badge>
                    )}
                </div>

                {loadingMeetings ? (
                    <div className="space-y-2">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <Skeleton key={i} className="h-16 w-full rounded-xl" />
                        ))}
                    </div>
                ) : meetings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-dashed border-border/60">
                        <HugeiconsIcon icon={CalendarAddIcon} className="size-6 text-muted-foreground/40 mb-2" />
                        <p className="text-sm font-medium text-muted-foreground">{tr(language, "No appointments yet", "ยังไม่มีการนัดหมาย")}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground/60">
                            {tr(language, "Appointments will appear here", "การนัดหมายจะแสดงที่นี่")}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <AnimatePresence mode="wait">
                            {meetings.map((meeting, index) => {
                                const isPast = new Date(meeting.date_time) < new Date();
                                const doctorName = meeting.doctor
                                    ? [meeting.doctor.first_name, meeting.doctor.last_name].filter(Boolean).join(" ") || meeting.doctor.email
                                    : null;

                                return (
                                    <m.div
                                        key={meeting.id}
                                        initial={{ opacity: 0, y: 3 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.1, delay: index * 0.02 }}
                                        className={`relative p-3 rounded-xl border transition-all ${isPast
                                                ? "bg-muted/20 border-border/40"
                                                : "bg-gradient-to-r from-primary/5 to-transparent border-primary/20"
                                            }`}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <div
                                                className={`mt-1.5 flex-shrink-0 size-2.5 rounded-full ring-3 ${isPast
                                                        ? "bg-muted-foreground/30 ring-muted/40"
                                                        : "bg-primary ring-primary/20"
                                                    }`}
                                            />
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-semibold text-foreground">
                                                        {formatDateTime(meeting.date_time)}
                                                    </span>
                                                    <Badge
                                                        variant={isPast ? "secondary" : "default"}
                                                        className={`h-4 px-1.5 py-0 text-xs font-normal ${isPast
                                                                ? "bg-muted text-muted-foreground"
                                                                : "bg-primary/10 text-primary border-transparent"
                                                            }`}
                                                    >
                                                        {isPast
                                                            ? tr(language, "Completed", "เสร็จสิ้น")
                                                            : tr(language, "Upcoming", "กำลังจะมาถึง")}
                                                    </Badge>
                                                </div>

                                                {meeting.description && (
                                                    <p className="text-sm text-foreground/80 line-clamp-2">
                                                        {meeting.description}
                                                    </p>
                                                )}

                                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                                    {doctorName && (
                                                        <span className="flex items-center gap-1">
                                                            <HugeiconsIcon icon={UserIcon} className="size-2.5" />
                                                            {tr(language, "Dr.", "นพ.")} {doctorName}
                                                        </span>
                                                    )}
                                                    {meeting.room && (
                                                        <span className="flex items-center gap-1">
                                                            <HugeiconsIcon icon={Location01Icon} className="size-2.5" />
                                                            {tr(language, "Room", "ห้อง")} {meeting.room}
                                                        </span>
                                                    )}
                                                </div>

                                                {meeting.note && (
                                                    <p className="border-l-2 border-muted-foreground/20 pl-2 text-sm italic text-muted-foreground/70">
                                                        {meeting.note}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </m.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </m.div>
        </div>
        </LazyMotion>
    );
}
