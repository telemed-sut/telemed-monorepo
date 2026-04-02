"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { exportAuditLogs, fetchAuditLogs, getRoleLabel, type ApiError, type AuditLogItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import {
    ScrollText,
    Search,
    RefreshCw,
    ShieldAlert,
    Activity,
    Users,
    Eye,
    ChevronRight,
    Download,
} from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { useLanguageStore } from "@/store/language-store";
import { getLocalizedDashboardErrorMessage } from "./dashboard-error-message";

// ── Constants ──

type AuditLanguage = AppLanguage;

const I18N = {
    en: {
        language: "Language",
        allActions: "All Actions",
        allResources: "All Resources",
        allEvents: "All Events",
        breakGlassOnly: "Break Glass Only",
        allResults: "All Results",
        success: "Success",
        failure: "Failure",
        justNow: "Just now",
        searchLogs: "Search logs...",
        userEmailOrName: "User email/name",
        from: "From",
        to: "To",
        pause: "Pause",
        resume: "Resume",
        autoRefresh: "auto-refresh",
        exportCsv: "Export CSV",
        auditLogs: "Audit Logs",
        systemActivityAndSecurityEvents: "System activity and security events. Total:",
        autoRefreshing: "Auto-refreshing",
        totalLogs: "Total Logs",
        allAuditEntries: "All audit entries",
        breakGlass: "Break Glass",
        requiresReview: "Requires review",
        noIncidents: "No incidents",
        uniqueUsers: "Unique Users",
        inCurrentView: "In current view",
        todaysActivity: "Today's Activity",
        eventsToday: "Events today",
        time: "Time",
        user: "User",
        action: "Action",
        result: "Result",
        resource: "Resource",
        ipAddress: "IP Address",
        breakGlassColumn: "Break Glass",
        noAuditLogsFound: "No audit logs found.",
        yes: "Yes",
        pageOf: "Page",
        previous: "Previous",
        next: "Next",
        perPage: "/ page",
        auditLogDetailView: "Audit log detail view",
        unknown: "Unknown",
        userId: "User ID",
        resourceType: "Type",
        resourceId: "Resource ID",
        breakGlassAccess: "Break Glass Access",
        noReasonProvided: "No reason provided",
        details: "Details",
        changeHistory: "Change History",
        noSpecificChangesDetected: "No specific changes detected.",
        field: "Field",
        oldValue: "Old Value",
        newValue: "New Value",
        logId: "Log ID",
        loadAuditLogsFailed: "Failed to load audit logs",
        cannotLoadAuditLogs: "Unable to load audit logs",
        exportAuditLogsFailed: "Failed to export audit logs",
        cannotExportAuditLogs: "Unable to export audit logs",
    },
    th: {
        language: "ภาษา",
        allActions: "ทุกการกระทำ",
        allResources: "ทุกทรัพยากร",
        allEvents: "ทุกเหตุการณ์",
        breakGlassOnly: "เฉพาะการเข้าถึงฉุกเฉิน",
        allResults: "ทุกผลลัพธ์",
        success: "สำเร็จ",
        failure: "ล้มเหลว",
        justNow: "เมื่อสักครู่",
        searchLogs: "ค้นหาบันทึก...",
        userEmailOrName: "อีเมล/ชื่อผู้ใช้",
        from: "จาก",
        to: "ถึง",
        pause: "หยุด",
        resume: "เล่นต่อ",
        autoRefresh: "รีเฟรชอัตโนมัติ",
        exportCsv: "ส่งออก CSV",
        auditLogs: "บันทึก Audit",
        systemActivityAndSecurityEvents: "กิจกรรมระบบและเหตุการณ์ความปลอดภัย ทั้งหมด:",
        autoRefreshing: "กำลังรีเฟรชอัตโนมัติ",
        totalLogs: "จำนวน Log ทั้งหมด",
        allAuditEntries: "รายการบันทึกทั้งหมด",
        breakGlass: "การเข้าถึงฉุกเฉิน",
        requiresReview: "ต้องตรวจสอบ",
        noIncidents: "ไม่มีเหตุการณ์",
        uniqueUsers: "ผู้ใช้ไม่ซ้ำ",
        inCurrentView: "ในมุมมองปัจจุบัน",
        todaysActivity: "กิจกรรมวันนี้",
        eventsToday: "เหตุการณ์วันนี้",
        time: "เวลา",
        user: "ผู้ใช้",
        action: "การกระทำ",
        result: "ผลลัพธ์",
        resource: "ทรัพยากร",
        ipAddress: "ไอพีแอดเดรส",
        breakGlassColumn: "ฉุกเฉิน",
        noAuditLogsFound: "ไม่พบบันทึก Audit",
        yes: "ใช่",
        pageOf: "หน้า",
        previous: "ก่อนหน้า",
        next: "ถัดไป",
        perPage: "/ หน้า",
        auditLogDetailView: "รายละเอียดบันทึก Audit",
        unknown: "ไม่ทราบ",
        userId: "รหัสผู้ใช้",
        resourceType: "ประเภท",
        resourceId: "รหัสทรัพยากร",
        breakGlassAccess: "การเข้าถึงฉุกเฉิน",
        noReasonProvided: "ไม่ได้ระบุเหตุผล",
        details: "รายละเอียด",
        changeHistory: "ประวัติการเปลี่ยนแปลง",
        noSpecificChangesDetected: "ไม่พบการเปลี่ยนแปลงที่เฉพาะเจาะจง",
        field: "ฟิลด์",
        oldValue: "ค่าเดิม",
        newValue: "ค่าใหม่",
        logId: "รหัสบันทึก",
        loadAuditLogsFailed: "โหลด Audit Logs ไม่สำเร็จ",
        cannotLoadAuditLogs: "ไม่สามารถโหลด Audit Logs ได้",
        exportAuditLogsFailed: "ส่งออก Audit Logs ไม่สำเร็จ",
        cannotExportAuditLogs: "ไม่สามารถส่งออก Audit Logs ได้",
    },
} as const;

type TranslationKey = keyof (typeof I18N)["en"];

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const ACTION_OPTIONS = [
    "all",
    "user_create",
    "user_update",
    "user_delete",
    "user_delete_denied",
    "user_verify",
    "user_invite",
    "user_invite_resend",
    "user_invite_revoke",
    "user_restore",
    "user_restore_denied",
    "user_bulk_delete_denied",
    "user_bulk_delete_summary",
    "user_bulk_restore_summary",
    "user_purge_deleted_denied",
    "user_purge_deleted_summary",
    "invite_accept",
    "update_patient",
    "patient_assignment_create",
    "patient_assignment_update",
    "patient_assignment_delete",
    "patient_access_denied",
    "http_403_denied",
    "admin_emergency_unlock",
    "admin_force_2fa_reset",
    "admin_force_2fa_reset_denied",
    "admin_force_password_reset",
    "admin_force_password_reset_denied",
    "two_factor_verified",
    "two_factor_disabled",
    "two_factor_reset",
    "two_factor_backup_codes_regenerated",
    "two_factor_backup_code_used",
    "two_factor_challenge",
    "trusted_device_created",
    "trusted_device_revoked",
    "trusted_devices_revoked_all",
    "login_failed",
    "login_failed_2fa",
    "login_with_backup_code",
    "view_patient_summary",
    "view_patient_timeline",
    "view_active_orders",
    "view_lab_trends",
    "create_medication_order",
    "create_lab_order",
    "create_imaging_order",
    "create_note",
    "break_glass",
    "acknowledge_alert",
];

const RESOURCE_TYPE_OPTIONS = [
    "all",
    "user",
    "user_invite",
    "patient",
    "doctor_patient_assignment",
    "http_request",
    "user_trusted_device",
    "note",
    "alert",
    "medication",
    "lab",
    "imaging",
];

const BREAK_GLASS_OPTIONS = ["all", "true"];

const RESULT_OPTIONS = ["all", "success", "failure"];

const ACTION_LABELS: Record<AuditLanguage, Record<string, string>> = {
    en: {
        patient_assignment_create: "Create Patient Assignment",
        patient_assignment_update: "Update Patient Assignment",
        patient_assignment_delete: "Delete Patient Assignment",
        patient_access_denied: "Patient Access Denied",
        http_403_denied: "HTTP 403 Denied",
        invite_accept: "Invite Accepted",
        user_invite_resend: "Resend User Invite",
        user_invite_revoke: "Revoke User Invite",
    },
    th: {
        user_create: "สร้างผู้ใช้",
        user_update: "อัปเดตผู้ใช้",
        user_delete: "ลบผู้ใช้",
        user_delete_denied: "ปฏิเสธการลบผู้ใช้",
        user_verify: "ยืนยันผู้ใช้",
        user_invite: "ส่งคำเชิญผู้ใช้",
        user_invite_resend: "ส่งคำเชิญซ้ำ",
        user_invite_revoke: "เพิกถอนคำเชิญ",
        user_restore: "กู้คืนผู้ใช้",
        user_restore_denied: "ปฏิเสธการกู้คืนผู้ใช้",
        user_bulk_delete_denied: "ปฏิเสธการลบผู้ใช้แบบกลุ่ม",
        user_bulk_delete_summary: "สรุปการลบผู้ใช้แบบกลุ่ม",
        user_bulk_restore_summary: "สรุปการกู้คืนผู้ใช้แบบกลุ่ม",
        user_purge_deleted_denied: "ปฏิเสธการล้างข้อมูลถาวร",
        user_purge_deleted_summary: "สรุปการล้างข้อมูลถาวร",
        invite_accept: "ตอบรับคำเชิญ",
        update_patient: "อัปเดตข้อมูลผู้ป่วย",
        patient_assignment_create: "เพิ่มการมอบหมายผู้ป่วย",
        patient_assignment_update: "แก้ไขการมอบหมายผู้ป่วย",
        patient_assignment_delete: "ลบการมอบหมายผู้ป่วย",
        patient_access_denied: "ปฏิเสธการเข้าถึงผู้ป่วย",
        http_403_denied: "ปฏิเสธ HTTP 403",
        admin_emergency_unlock: "ปลดล็อกฉุกเฉินโดยผู้ดูแล",
        admin_force_2fa_reset: "รีเซ็ต 2FA โดยผู้ดูแล",
        admin_force_2fa_reset_denied: "ปฏิเสธการรีเซ็ต 2FA โดยผู้ดูแล",
        admin_force_password_reset: "รีเซ็ตรหัสผ่านโดยผู้ดูแล",
        admin_force_password_reset_denied: "ปฏิเสธการรีเซ็ตรหัสผ่านโดยผู้ดูแล",
        two_factor_verified: "ยืนยัน 2FA สำเร็จ",
        two_factor_disabled: "ปิดการใช้งาน 2FA",
        two_factor_reset: "รีเซ็ต 2FA",
        two_factor_backup_codes_regenerated: "สร้างรหัสสำรอง 2FA ใหม่",
        two_factor_backup_code_used: "ใช้รหัสสำรอง 2FA",
        two_factor_challenge: "ทดสอบยืนยันตัวตน 2FA",
        trusted_device_created: "เพิ่มอุปกรณ์ที่เชื่อถือได้",
        trusted_device_revoked: "เพิกถอนอุปกรณ์ที่เชื่อถือได้",
        trusted_devices_revoked_all: "เพิกถอนอุปกรณ์ที่เชื่อถือได้ทั้งหมด",
        login_failed: "เข้าสู่ระบบล้มเหลว",
        login_failed_2fa: "เข้าสู่ระบบล้มเหลว (2FA)",
        login_with_backup_code: "เข้าสู่ระบบด้วยรหัสสำรอง",
        view_patient_summary: "ดูสรุปผู้ป่วย",
        view_patient_timeline: "ดูไทม์ไลน์ผู้ป่วย",
        view_active_orders: "ดูคำสั่งที่ยังใช้งาน",
        view_lab_trends: "ดูแนวโน้มผลแล็บ",
        create_medication_order: "สร้างคำสั่งยา",
        create_lab_order: "สร้างคำสั่งแล็บ",
        create_imaging_order: "สร้างคำสั่งภาพถ่าย",
        create_note: "สร้างบันทึก",
        break_glass: "เข้าถึงฉุกเฉิน",
        acknowledge_alert: "รับทราบการแจ้งเตือน",
    },
};

const RESOURCE_LABELS: Record<AuditLanguage, Record<string, string>> = {
    en: {
        user_invite: "User Invite",
        doctor_patient_assignment: "Doctor-Patient Assignment",
        http_request: "HTTP Request",
        user_trusted_device: "Trusted Device",
    },
    th: {
        user: "ผู้ใช้",
        user_invite: "คำเชิญผู้ใช้",
        patient: "ผู้ป่วย",
        doctor_patient_assignment: "การมอบหมายแพทย์-ผู้ป่วย",
        http_request: "คำขอ HTTP",
        user_trusted_device: "อุปกรณ์ที่เชื่อถือได้",
        note: "บันทึก",
        alert: "การแจ้งเตือน",
        medication: "ยา",
        lab: "แล็บ",
        imaging: "ภาพถ่าย",
    },
};

const FIELD_LABELS: Record<AuditLanguage, Record<string, string>> = {
    en: {},
    th: {
        first_name: "ชื่อ",
        last_name: "นามสกุล",
        full_name: "ชื่อเต็ม",
        email: "อีเมล",
        phone: "เบอร์โทรศัพท์",
        role: "บทบาท",
        status: "สถานะ",
        verification_status: "สถานะการยืนยัน",
        is_active: "สถานะใช้งาน",
        is_verified: "ยืนยันแล้ว",
        two_factor_enabled: "เปิดใช้งาน 2FA",
        setup_required: "ต้องตั้งค่าเพิ่มเติม",
        required: "บังคับใช้",
        enabled: "เปิดใช้งาน",
        trusted_device_days: "จำนวนวันอุปกรณ์ที่เชื่อถือได้",
        assigned_at: "วันที่มอบหมาย",
        reason: "เหตุผล",
        resource_type: "ประเภททรัพยากร",
        resource_id: "รหัสทรัพยากร",
        ip_address: "ไอพีแอดเดรส",
        user_id: "รหัสผู้ใช้",
        date_of_birth: "วันเกิด",
        gender: "เพศ",
        address: "ที่อยู่",
        created_at: "สร้างเมื่อ",
        updated_at: "อัปเดตเมื่อ",
        deleted_at: "ลบเมื่อ",
    },
};

const STATUS_VALUE_LABELS: Record<AuditLanguage, Record<string, string>> = {
    en: {},
    th: {
        pending: "รอดำเนินการ",
        active: "ใช้งาน",
        inactive: "ไม่ใช้งาน",
        verified: "ยืนยันแล้ว",
        unverified: "ยังไม่ยืนยัน",
        success: "สำเร็จ",
        failure: "ล้มเหลว",
        true: "ใช่",
        false: "ไม่ใช่",
    },
};

// ── Helpers ──

function getActionColor(action: string): string {
    if (action.includes("delete")) return "bg-red-500/10 text-red-500 border-red-500/20";
    if (action === "break_glass") return "bg-red-600/10 text-red-600 border-red-600/20";
    if (action.includes("create") || action.includes("invite")) return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (action.includes("update") || action.includes("verify")) return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    if (action.includes("view") || action.includes("acknowledge")) return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    return "bg-muted text-muted-foreground border-border";
}

function formatActionLabel(action: string): string {
    return action
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function translateResourceLabel(resourceType: string | null, language: AuditLanguage): string {
    if (!resourceType) return I18N[language].unknown;
    return RESOURCE_LABELS[language][resourceType] ?? formatActionLabel(resourceType);
}

function translateFieldLabel(field: string, language: AuditLanguage): string {
    return FIELD_LABELS[language][field] ?? formatActionLabel(field);
}

function translateFieldValue(field: string, value: unknown, language: AuditLanguage): string {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);

    const normalized = String(value);
    if (field === "role") {
        return getRoleLabel(normalized, language);
    }
    if (field === "status" || field === "verification_status" || field.startsWith("is_")) {
        return STATUS_VALUE_LABELS[language][normalized] ?? normalized;
    }
    return normalized;
}

function timeAgo(dateStr: string, language: AuditLanguage): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);
    const rtf = new Intl.RelativeTimeFormat(APP_LOCALE_MAP[language], { numeric: "auto" });

    if (diffSec < 45) return I18N[language].justNow;
    if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), "minute");
    if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), "hour");
    if (diffSec < 604800) return rtf.format(-Math.floor(diffSec / 86400), "day");
    return new Date(dateStr).toLocaleDateString(APP_LOCALE_MAP[language]);
}

function shortenId(id: string | null): string {
    if (!id) return "-";
    return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

function tryFormatJson(text: string | null): string {
    if (!text) return "-";
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

// ── Stats Cards ──

function AuditStatsCards({
    logs,
    t,
}: {
    logs: AuditLogItem[];
    t: (key: TranslationKey) => string;
}) {
    const breakGlassCount = logs.filter((l) => l.is_break_glass).length;
    const uniqueUsers = new Set(logs.map((l) => l.user_id).filter(Boolean)).size;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = logs.filter(
        (l) => new Date(l.created_at) >= todayStart
    ).length;

    const stats = [
        {
            title: t("totalLogs"),
            value: logs.length,
            subtitle: t("inCurrentView"),
            icon: ScrollText,
            iconColor: "text-[var(--med-primary-light)]",
            bgColor: "bg-[var(--med-primary-light)]/10",
        },
        {
            title: t("breakGlass"),
            value: breakGlassCount,
            subtitle: breakGlassCount > 0 ? t("requiresReview") : t("noIncidents"),
            icon: ShieldAlert,
            iconColor: breakGlassCount > 0 ? "text-red-500" : "text-muted-foreground",
            bgColor: breakGlassCount > 0 ? "bg-red-500/10" : "bg-muted/50",
        },
        {
            title: t("uniqueUsers"),
            value: uniqueUsers,
            subtitle: t("inCurrentView"),
            icon: Users,
            iconColor: "text-emerald-500",
            bgColor: "bg-emerald-500/10",
        },
        {
            title: t("todaysActivity"),
            value: todayCount,
            subtitle: t("eventsToday"),
            icon: Activity,
            iconColor: "text-amber-500",
            bgColor: "bg-amber-500/10",
        },
    ];

    return (
        <div className="bg-card rounded-xl border">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x">
                {stats.map((stat) => (
                    <div key={stat.title} className="flex items-start gap-3 p-4 sm:p-5">
                        <div className={`p-2.5 rounded-lg ${stat.bgColor}`}>
                            <stat.icon className={`size-5 ${stat.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-muted-foreground">
                                {stat.title}
                            </p>
                            <p className="text-[28px] font-semibold leading-tight tracking-tight mt-0.5">
                                {stat.value}
                            </p>
                            <p className="mt-1 text-sm font-medium text-muted-foreground">
                                {stat.subtitle}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main Content ──

export function AuditLogsContent() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);
    const clearToken = useAuthStore((state) => state.clearToken);
    const language = useLanguageStore((state) => state.language);

    // Data
    const [logs, setLogs] = useState<AuditLogItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [limit, setLimit] = useState(50);

    // Filters
    const [search, setSearch] = useState("");
    const [actionFilter, setActionFilter] = useState("all");
    const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
    const [breakGlassFilter, setBreakGlassFilter] = useState("all");
    const [resultFilter, setResultFilter] = useState("all");
    const [userFilter, setUserFilter] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    // UI
    const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
    const [isPolling, setIsPolling] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    const t = useCallback(
        (key: TranslationKey) => I18N[language][key] ?? I18N.en[key],
        [language]
    );

    const localizeDateTime = useCallback(
        (value: string) => new Date(value).toLocaleString(APP_LOCALE_MAP[language]),
        [language]
    );

    const actionLabel = useCallback(
        (action: string) => ACTION_LABELS[language][action] ?? formatActionLabel(action),
        [language]
    );

    const resourceLabel = useCallback(
        (resourceType: string | null) => translateResourceLabel(resourceType, language),
        [language]
    );

    const resultLabel = useCallback(
        (result: "success" | "failure") => (result === "failure" ? t("failure") : t("success")),
        [t]
    );

    // Auth guard
    useEffect(() => {
        if (hydrated && !token) {
            router.replace("/login");
        }
    }, [hydrated, token, router]);

    const loadLogs = useCallback(async (silent = false, isLoadMore = false) => {
        if (!token) return;

        try {
            if (!silent) {
                if (isLoadMore) setLoadingMore(true);
                else setLoading(true);
            }

            const params: {
                cursor?: string | null;
                limit: number;
                search?: string;
                user?: string;
                action?: string;
                resource_type?: string;
                is_break_glass?: boolean;
                result?: "success" | "failure";
                date_from?: string;
                date_to?: string;
            } = { limit };

            if (isLoadMore && nextCursor) {
                params.cursor = nextCursor;
            }

            if (search) params.search = search;
            if (userFilter) params.user = userFilter;
            if (actionFilter !== "all") params.action = actionFilter;
            if (resourceTypeFilter !== "all") params.resource_type = resourceTypeFilter;
            if (breakGlassFilter === "true") params.is_break_glass = true;
            if (resultFilter !== "all") params.result = resultFilter as "success" | "failure";
            if (dateFrom) params.date_from = dateFrom;
            if (dateTo) params.date_to = dateTo;

            const response = await fetchAuditLogs(token, params);

            if (isLoadMore) {
                setLogs(prev => [...prev, ...response.items]);
            } else {
                setLogs(response.items);
            }
            setNextCursor(response.next_cursor || null);
        } catch (err: unknown) {
            const apiError = err as ApiError;
            if (apiError.status === 401) {
                clearToken();
                router.replace("/login");
                return;
            }
            if (!silent) {
                toast.error(t("loadAuditLogsFailed"), {
                    description: getLocalizedDashboardErrorMessage(
                        apiError,
                        language,
                        I18N.en.cannotLoadAuditLogs,
                        I18N.th.cannotLoadAuditLogs
                    ),
                });
            }
        } finally {
            if (!silent) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [token, limit, nextCursor, search, userFilter, actionFilter, resourceTypeFilter, breakGlassFilter, resultFilter, dateFrom, dateTo, clearToken, router, t, language]);

    // Debounce search & filter changes
    useEffect(() => {
        const timer = setTimeout(() => {
            // Drop current cursor when filters change
            setNextCursor(null);
            loadLogs(false, false);
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, userFilter, actionFilter, resourceTypeFilter, breakGlassFilter, resultFilter, dateFrom, dateTo]);

    // Limit change
    useEffect(() => {
        setNextCursor(null);
        loadLogs(false, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [limit]);

    // Polling every 10s
    useEffect(() => {
        if (!isPolling || !token) return;

        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                loadLogs(true);
            }
        }, 10000);

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                loadLogs(true);
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [isPolling, token, loadLogs]);

    const handleExport = async () => {
        if (!token) return;
        try {
            setIsExporting(true);
            const blob = await exportAuditLogs(token, {
                user_id: undefined, // Filters not implemented yet for export in UI, but API supports it. 
                // Let's pass current filters
                search: search || undefined,
                user: userFilter || undefined,
                action: actionFilter !== "all" ? actionFilter : undefined,
                resource_type: resourceTypeFilter !== "all" ? resourceTypeFilter : undefined,
                is_break_glass: breakGlassFilter === "true" ? true : undefined,
                result: resultFilter !== "all" ? (resultFilter as "success" | "failure") : undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
            });

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `audit_logs_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast.success(t("success"), {
                description: t("exportCsv"),
            });
        } catch (err: unknown) {
            toast.error(t("exportAuditLogsFailed"), {
                description: getLocalizedDashboardErrorMessage(
                    err,
                    language,
                    I18N.en.cannotExportAuditLogs,
                    I18N.th.cannotExportAuditLogs
                ),
            });
        } finally {
            setIsExporting(false);
        }
    };

    if (!hydrated || !token) {
        return null;
    }

    return (
        <LazyMotion features={domAnimation}>
            <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
                <AuditStatsCards logs={logs} t={t} />

                <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                    <CardHeader>
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-xl font-semibold flex items-center gap-2">
                                    <ScrollText className="w-5 h-5 text-primary" />
                                    {t("auditLogs")}
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2">
                                    {t("systemActivityAndSecurityEvents")}
                                    {isPolling && (
                                        <span className="inline-flex items-center gap-1 text-sm text-emerald-500">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                            </span>
                                            {t("autoRefreshing")}
                                        </span>
                                    )}
                                </CardDescription>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder={t("searchLogs")}
                                        className="pl-9 w-full sm:w-[200px] bg-background/50 border-white/10"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>

                                <Input
                                    placeholder={t("userEmailOrName")}
                                    className="w-full sm:w-[180px] bg-background/50 border-white/10"
                                    value={userFilter}
                                    onChange={(e) => setUserFilter(e.target.value)}
                                />

                                <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? "")}>
                                    <SelectTrigger className="w-[180px] bg-background/50 border-white/10">
                                        <SelectValue>
                                            {actionFilter === "all" ? t("allActions") : actionLabel(actionFilter)}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ACTION_OPTIONS.map((action) => (
                                            <SelectItem key={action} value={action}>
                                                {action === "all" ? t("allActions") : actionLabel(action)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={resourceTypeFilter} onValueChange={(v) => setResourceTypeFilter(v ?? "")}>
                                    <SelectTrigger className="w-[160px] bg-background/50 border-white/10">
                                        <SelectValue>
                                            {resourceTypeFilter === "all" ? t("allResources") : resourceLabel(resourceTypeFilter)}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {RESOURCE_TYPE_OPTIONS.map((resourceType) => (
                                            <SelectItem key={resourceType} value={resourceType}>
                                                {resourceType === "all" ? t("allResources") : resourceLabel(resourceType)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={breakGlassFilter} onValueChange={(v) => setBreakGlassFilter(v ?? "")}>
                                    <SelectTrigger className="w-[160px] bg-background/50 border-white/10">
                                        <SelectValue>
                                            {breakGlassFilter === "true" ? t("breakGlassOnly") : t("allEvents")}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {BREAK_GLASS_OPTIONS.map((breakGlassOption) => (
                                            <SelectItem key={breakGlassOption} value={breakGlassOption}>
                                                {breakGlassOption === "true" ? t("breakGlassOnly") : t("allEvents")}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={resultFilter} onValueChange={(v) => setResultFilter(v ?? "")}>
                                    <SelectTrigger className="w-[150px] bg-background/50 border-white/10">
                                        <SelectValue>
                                            {resultFilter === "all" ? t("allResults") : resultLabel(resultFilter as "success" | "failure")}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {RESULT_OPTIONS.map((resultOption) => (
                                            <SelectItem key={resultOption} value={resultOption}>
                                                {resultOption === "all" ? t("allResults") : resultLabel(resultOption as "success" | "failure")}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Date Range Filters */}
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">{t("from")}:</span>
                                <Input
                                    type="date"
                                    className="w-[160px] bg-background/50 border-white/10"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">{t("to")}:</span>
                                <Input
                                    type="date"
                                    className="w-[160px] bg-background/50 border-white/10"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                />
                            </div>

                            <Button
                                variant="outline"
                                size="icon"
                                className="bg-background/50 border-white/10"
                                onClick={() => loadLogs()}
                                disabled={loading}
                            >
                                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-sm"
                                onClick={() => setIsPolling((p) => !p)}
                            >
                                {isPolling ? t("pause") : t("resume")} {t("autoRefresh")}
                            </Button>

                            <Button
                                variant="default"
                                size="sm"
                                className="ml-auto gap-2 text-sm lg:ml-0"
                                onClick={handleExport}
                                disabled={isExporting || logs.length === 0}
                            >
                                {isExporting ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Download className="h-3.5 w-3.5" />
                                )}
                                {t("exportCsv")}
                            </Button>
                        </div>
                    </CardHeader>

                    <CardContent>
                        <div className="rounded-md border border-white/10 overflow-hidden">
                            <div className="max-h-[500px] overflow-auto lg:max-h-[620px]">
                                <Table>
                                    <TableHeader className="sticky top-0 z-20 bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
                                        <TableRow className="hover:bg-transparent border-white/10">
                                            <TableHead className="w-[120px]">{t("time")}</TableHead>
                                            <TableHead>{t("user")}</TableHead>
                                            <TableHead>{t("action")}</TableHead>
                                            <TableHead>{t("result")}</TableHead>
                                            <TableHead>{t("resource")}</TableHead>
                                            <TableHead>{t("ipAddress")}</TableHead>
                                            <TableHead>{t("breakGlassColumn")}</TableHead>
                                            <TableHead className="w-[40px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loading && logs.length === 0 ? (
                                            Array.from({ length: 8 }).map((_, i) => (
                                                <TableRow key={i} className="border-white/10">
                                                    <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                                    <TableCell><Skeleton className="h-4 w-[20px]" /></TableCell>
                                                </TableRow>
                                            ))
                                        ) : logs.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                                    {t("noAuditLogsFound")}
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            <AnimatePresence mode="popLayout">
                                                {logs.map((log) => (
                                                    <m.tr
                                                        key={log.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: -10 }}
                                                        transition={{ duration: 0.15 }}
                                                        className={cn(
                                                            "group border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer",
                                                            log.is_break_glass && "bg-red-500/5 hover:bg-red-500/10"
                                                        )}
                                                        onClick={() => setSelectedLog(log)}
                                                    >
                                                        <TableCell className="text-sm">
                                                            <div title={localizeDateTime(log.created_at)}>
                                                                <span className="text-muted-foreground">{timeAgo(log.created_at, language)}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="min-w-0">
                                                                <span className="block text-sm font-medium truncate">
                                                                    {log.user_name || "-"}
                                                                </span>
                                                                <span className="block text-sm text-muted-foreground truncate">
                                                                    {log.user_email || "-"}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="outline" className={cn("text-sm", getActionColor(log.action))}>
                                                                {actionLabel(log.action)}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    "text-sm",
                                                                    log.result === "failure"
                                                                        ? "border-red-500/20 text-red-500 bg-red-500/10"
                                                                        : "border-emerald-500/20 text-emerald-500 bg-emerald-500/10"
                                                                )}
                                                            >
                                                                {resultLabel(log.result)}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="min-w-0">
                                                                <span className="block text-sm">{resourceLabel(log.resource_type)}</span>
                                                                <span className="block text-sm font-mono text-muted-foreground">
                                                                    {shortenId(log.resource_id)}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground font-mono">
                                                            {log.ip_address || "-"}
                                                        </TableCell>
                                                        <TableCell>
                                                            {log.is_break_glass ? (
                                                                <Badge variant="outline" className="border-red-500/20 text-red-500 bg-red-500/10 flex items-center gap-1 w-fit">
                                                                    <ShieldAlert className="w-3 h-3" />
                                                                    {t("yes")}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-sm text-muted-foreground">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                                        </TableCell>
                                                    </m.tr>
                                                ))}
                                            </AnimatePresence>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>

                        {/* Pagination - Load More */}
                        <div className="flex flex-col gap-3 border-t border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-sm font-medium text-muted-foreground">
                                    {logs.length} {t("allAuditEntries")}
                                </span>
                                <Select
                                    value={limit.toString()}
                                    onValueChange={(val) => {
                                        setLimit(Number(val));
                                    }}
                                >
                                    <SelectTrigger variant="glass" className="h-9 w-[108px] rounded-full text-sm shadow-sm">
                                        <SelectValue>{limit}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent side="top">
                                        {PAGE_SIZE_OPTIONS.map((size) => (
                                            <SelectItem key={size} value={size.toString()}>
                                                {size}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span className="text-sm text-muted-foreground">{t("perPage")}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                {nextCursor && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 rounded-full border-white/20 bg-white/5 px-4 text-sm shadow-sm hover:bg-white/10"
                                        onClick={() => loadLogs(false, true)}
                                        disabled={loadingMore || loading}
                                    >
                                        {loadingMore ? (
                                            <>
                                                <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                                                Loading...
                                            </>
                                        ) : (
                                            t("next") || "Load More"
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Detail Sheet — Centered Modal */}
                <Sheet open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
                    <SheetContent side="center" className="w-[min(94vw,640px)] max-h-[88vh] p-0 overflow-hidden rounded-2xl border border-border/60 bg-background/95">
                        {selectedLog && (
                            <>
                                {/* Header with action badge */}
                                <SheetHeader className="px-6 pt-6 pb-4 border-b bg-muted/20">
                                    <SheetTitle className="flex items-center gap-3">
                                        <div className={cn(
                                            "p-2 rounded-lg",
                                            selectedLog.is_break_glass ? "bg-red-500/10" : "bg-primary/10"
                                        )}>
                                            {selectedLog.is_break_glass
                                                ? <ShieldAlert className="w-5 h-5 text-red-500" />
                                                : <Eye className="w-5 h-5 text-primary" />
                                            }
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Badge variant="outline" className={cn("text-sm", getActionColor(selectedLog.action))}>
                                                    {actionLabel(selectedLog.action)}
                                                </Badge>
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        "text-sm",
                                                        selectedLog.result === "failure"
                                                            ? "border-red-500/20 text-red-500 bg-red-500/10"
                                                            : "border-emerald-500/20 text-emerald-500 bg-emerald-500/10"
                                                    )}
                                                >
                                                    {resultLabel(selectedLog.result)}
                                                </Badge>
                                                {selectedLog.is_break_glass && (
                                                    <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-sm text-red-500">
                                                        {t("breakGlass")}
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {localizeDateTime(selectedLog.created_at)} ({timeAgo(selectedLog.created_at, language)})
                                            </p>
                                        </div>
                                    </SheetTitle>
                                    <SheetDescription className="sr-only">
                                        {t("auditLogDetailView")}
                                    </SheetDescription>
                                </SheetHeader>

                                <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(88vh-100px)]">
                                    {/* User Section */}
                                    <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                                            <Users className="w-3.5 h-3.5" />
                                            {t("user")}
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm uppercase shrink-0">
                                                {selectedLog.user_name ? selectedLog.user_name[0] : selectedLog.user_email ? selectedLog.user_email[0] : "?"}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium truncate">{selectedLog.user_name || t("unknown")}</p>
                                                <p className="text-sm text-muted-foreground truncate">{selectedLog.user_email || "-"}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-2 gap-3">
                                            <div>
                                                <p className="text-sm uppercase tracking-wider text-muted-foreground">{t("userId")}</p>
                                                <p className="mt-0.5 truncate text-sm font-mono text-muted-foreground">{selectedLog.user_id || "-"}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm uppercase tracking-wider text-muted-foreground">{t("ipAddress")}</p>
                                                <p className="mt-0.5 text-sm font-mono text-muted-foreground">{selectedLog.ip_address || "-"}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Resource Section */}
                                    <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                                            <Activity className="w-3.5 h-3.5" />
                                            {t("resource")}
                                        </p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <p className="text-sm uppercase tracking-wider text-muted-foreground">{t("resourceType")}</p>
                                                <p className="text-sm mt-0.5">{resourceLabel(selectedLog.resource_type)}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm uppercase tracking-wider text-muted-foreground">{t("resourceId")}</p>
                                                <p className="mt-0.5 break-all text-sm font-mono text-muted-foreground">{selectedLog.resource_id || "-"}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Break Glass Section */}
                                    {selectedLog.is_break_glass && (
                                        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-2">
                                            <p className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-red-500">
                                                <ShieldAlert className="w-3.5 h-3.5" />
                                                {t("breakGlassAccess")}
                                            </p>
                                            {selectedLog.break_glass_reason ? (
                                                <p className="text-sm text-foreground">{selectedLog.break_glass_reason}</p>
                                            ) : (
                                                <p className="text-sm text-muted-foreground italic">{t("noReasonProvided")}</p>
                                            )}
                                        </div>
                                    )}

                                    {/* Details Section */}
                                    {selectedLog.details && (
                                        <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                            <p className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                                                <ScrollText className="w-3.5 h-3.5" />
                                                {t("details")}
                                            </p>
                                            <pre className="text-sm bg-background rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground border border-border/40">
                                                {typeof selectedLog.details === "string" ? tryFormatJson(selectedLog.details) : JSON.stringify(selectedLog.details, null, 2)}
                                            </pre>
                                        </div>
                                    )}

                                    {/* Change History Section */}
                                    {(selectedLog.old_values || selectedLog.new_values) && (
                                        <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                            <p className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                                                <Activity className="w-3.5 h-3.5" />
                                                {t("changeHistory")}
                                            </p>
                                            <div className="space-y-4">
                                                {(() => {
                                                    const oldVals = selectedLog.old_values || {};
                                                    const newVals = selectedLog.new_values || {};
                                                    // Find all keys that exist in either
                                                    const allKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));
                                                    // Filter keys where values are different
                                                    const changedKeys = allKeys.filter(key => JSON.stringify(oldVals[key]) !== JSON.stringify(newVals[key]));

                                                    if (changedKeys.length === 0) {
                                                        return <p className="text-sm text-muted-foreground italic">{t("noSpecificChangesDetected")}</p>;
                                                    }

                                                    return (
                                                        <div className="rounded-md border border-border/40 overflow-hidden">
                                                            <Table>
                                                                <TableHeader className="bg-muted/30">
                                                                    <TableRow className="border-border/40 hover:bg-transparent">
                                                                        <TableHead className="h-8 text-sm font-medium">{t("field")}</TableHead>
                                                                        <TableHead className="h-8 text-sm font-medium text-red-500/80">{t("oldValue")}</TableHead>
                                                                        <TableHead className="h-8 text-sm font-medium text-emerald-500/80">{t("newValue")}</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {changedKeys.map((key) => (
                                                                        <TableRow key={key} className="border-border/40 hover:bg-transparent">
                                                                            <TableCell className="py-2 text-sm font-medium font-mono text-muted-foreground">
                                                                                {translateFieldLabel(key, language)}
                                                                            </TableCell>
                                                                            <TableCell className="py-2 text-sm font-mono text-red-600/90 break-all bg-red-500/5">
                                                                                {translateFieldValue(key, oldVals[key], language)}
                                                                            </TableCell>
                                                                            <TableCell className="py-2 text-sm font-mono text-emerald-600/90 break-all bg-emerald-500/5">
                                                                                {translateFieldValue(key, newVals[key], language)}
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                </TableBody>
                                                            </Table>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    {/* Metadata Footer */}
                                    <div className="pt-2 border-t border-border/40">
                                        <p className="text-sm uppercase tracking-wider text-muted-foreground">{t("logId")}</p>
                                        <p className="mt-0.5 break-all text-sm font-mono text-muted-foreground">{selectedLog.id}</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </SheetContent>
                </Sheet >
            </main >
        </LazyMotion>
    );
}
