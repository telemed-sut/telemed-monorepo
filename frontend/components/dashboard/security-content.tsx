"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import {
    createIPBan,
    deleteIPBan,
    fetchIPBans,
    fetchLoginAttempts,
    fetchSecurityStats,
    getErrorMessage,
    type ApiError,
    type SecurityStats,
    type IPBan,
    type LoginAttemptRecord,
} from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import {
    ShieldAlert,
    ShieldOff,
    Activity,
    Lock,
    Unlock,
    RefreshCw,
    Search,
    CheckCircle2,
    XCircle,
    Clock,
    AlertTriangle,
} from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";

// ── Helpers ──

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

function timeAgo(dateStr: string, language: AppLanguage): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 60) return tr(language, "Just now", "เมื่อสักครู่");
    if (diffSec < 3600) return tr(language, `${Math.floor(diffSec / 60)}m ago`, `${Math.floor(diffSec / 60)} นาทีที่แล้ว`);
    if (diffSec < 86400) return tr(language, `${Math.floor(diffSec / 3600)}h ago`, `${Math.floor(diffSec / 3600)} ชั่วโมงที่แล้ว`);
    if (diffSec < 604800) return tr(language, `${Math.floor(diffSec / 86400)}d ago`, `${Math.floor(diffSec / 86400)} วันที่แล้ว`);
    return new Date(dateStr).toLocaleDateString(localeOf(language));
}

function formatBannedUntil(dateStr: string | null, language: AppLanguage): string {
    if (!dateStr) return tr(language, "Permanent", "ถาวร");
    const d = new Date(dateStr);
    const now = new Date();
    if (d <= now) return tr(language, "Expired", "หมดอายุ");
    const diffMin = Math.floor((d.getTime() - now.getTime()) / 60000);
    if (diffMin < 60) return tr(language, `${diffMin}m remaining`, `เหลือ ${diffMin} นาที`);
    if (diffMin < 1440) return tr(language, `${Math.floor(diffMin / 60)}h remaining`, `เหลือ ${Math.floor(diffMin / 60)} ชั่วโมง`);
    return d.toLocaleString(localeOf(language));
}

// ── Stats Cards ──

function SecurityStatsCards({
    stats,
    loading,
    language,
}: {
    stats: SecurityStats | null;
    loading: boolean;
    language: AppLanguage;
}) {
    const cards = [
        {
            title: tr(language, "Active IP Bans", "IP ที่ถูกแบนอยู่"),
            value: stats?.active_ip_bans ?? 0,
            subtitle: tr(language, "Currently blocked IPs", "จำนวน IP ที่ถูกบล็อก"),
            icon: ShieldAlert,
            iconColor: (stats?.active_ip_bans ?? 0) > 0 ? "text-red-500" : "text-muted-foreground",
            bgColor: (stats?.active_ip_bans ?? 0) > 0 ? "bg-red-500/10" : "bg-muted/50",
        },
        {
            title: tr(language, "Failed Logins (24h)", "ล็อกอินล้มเหลว (24 ชม.)"),
            value: stats?.failed_logins_24h ?? 0,
            subtitle: tr(language, "Failed attempts today", "ความพยายามล้มเหลววันนี้"),
            icon: XCircle,
            iconColor: (stats?.failed_logins_24h ?? 0) > 5 ? "text-amber-500" : "text-muted-foreground",
            bgColor: (stats?.failed_logins_24h ?? 0) > 5 ? "bg-amber-500/10" : "bg-muted/50",
        },
        {
            title: tr(language, "Locked Accounts", "บัญชีที่ถูกล็อก"),
            value: stats?.locked_accounts ?? 0,
            subtitle: tr(language, "Currently locked", "กำลังถูกล็อก"),
            icon: Lock,
            iconColor: (stats?.locked_accounts ?? 0) > 0 ? "text-red-500" : "text-emerald-500",
            bgColor: (stats?.locked_accounts ?? 0) > 0 ? "bg-red-500/10" : "bg-emerald-500/10",
        },
        {
            title: tr(language, "Total Attempts (24h)", "ความพยายามทั้งหมด (24 ชม.)"),
            value: stats?.total_attempts_24h ?? 0,
            subtitle: tr(language, "All login attempts", "ความพยายามล็อกอินทั้งหมด"),
            icon: Activity,
            iconColor: "text-[#7ac2f0]",
            bgColor: "bg-[#7ac2f0]/10",
        },
    ];

    return (
        <div className="bg-card rounded-xl border">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x">
                {cards.map((card) => (
                    <div key={card.title} className="flex items-start gap-3 p-4 sm:p-5">
                        <div className={`p-2.5 rounded-lg ${card.bgColor}`}>
                            <card.icon className={`size-5 ${card.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground font-medium">{card.title}</p>
                            {loading ? (
                                <Skeleton className="h-8 w-16 mt-1" />
                            ) : (
                                <p className="text-[28px] font-semibold leading-tight tracking-tight mt-0.5">
                                    {card.value}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground font-medium mt-1">{card.subtitle}</p>
                        </div>
                    </div>
                ))}
            </div>
            {!loading && stats && (
                <div className="border-t px-4 py-3 text-xs sm:text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                            403 (1h): {stats.forbidden_403_1h}
                        </Badge>
                        <Badge variant="outline">
                            {tr(language, "Failed login (1h)", "ล็อกอินล้มเหลว (1 ชม.)")}: {stats.failed_logins_1h}
                        </Badge>
                        <Badge variant="outline">
                            {tr(language, "Purge actions (24h)", "การลบถาวร (24 ชม.)")}: {stats.purge_actions_24h}
                        </Badge>
                        <Badge variant="outline">
                            {tr(language, "Emergency actions (24h)", "การกู้ฉุกเฉิน (24 ชม.)")}: {stats.emergency_actions_24h}
                        </Badge>
                        {stats.forbidden_403_spike && (
                            <Badge className="bg-red-500/90 text-white">{tr(language, "403 spike detected", "พบ 403 พุ่งสูงผิดปกติ")}</Badge>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Content ──

export function SecurityContent() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);
    const clearToken = useAuthStore((state) => state.clearToken);
    const language = useLanguageStore((state) => state.language);

    // Stats
    const [stats, setStats] = useState<SecurityStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    // IP Bans
    const [bans, setBans] = useState<IPBan[]>([]);
    const [bansTotal, setBansTotal] = useState(0);
    const [bansLoading, setBansLoading] = useState(true);
    const [bansPage, setBansPage] = useState(1);

    // Login Attempts
    const [attempts, setAttempts] = useState<LoginAttemptRecord[]>([]);
    const [attemptsTotal, setAttemptsTotal] = useState(0);
    const [attemptsLoading, setAttemptsLoading] = useState(true);
    const [attemptsPage, setAttemptsPage] = useState(1);
    const [attemptsFilter, setAttemptsFilter] = useState<"all" | "failed" | "success">("all");
    const [attemptsSearch, setAttemptsSearch] = useState("");

    // Polling
    const [isPolling, setIsPolling] = useState(true);

    // Auth guard
    useEffect(() => {
        if (hydrated && !token) {
            router.replace("/login");
        }
    }, [hydrated, token, router]);

    const loadStats = useCallback(async () => {
        if (!token) return;
        try {
            const data = await fetchSecurityStats(token);
            setStats(data);
        } catch (err: unknown) {
            const apiError = err as ApiError;
            if (apiError.status === 401) {
                clearToken();
                router.replace("/login");
            }
        } finally {
            setStatsLoading(false);
        }
    }, [token, clearToken, router]);

    const loadBans = useCallback(async (silent = false) => {
        if (!token) return;
        try {
            if (!silent) setBansLoading(true);
            const data = await fetchIPBans({ page: bansPage, limit: 20 }, token);
            setBans(data.items);
            setBansTotal(data.total);
        } catch (err: unknown) {
            const apiError = err as ApiError;
            if (apiError.status === 401) {
                clearToken();
                router.replace("/login");
            }
            if (!silent) {
                toast.error(tr(language, "Failed to load IP bans", "โหลดรายการ IP Ban ไม่สำเร็จ"), {
                    description: getErrorMessage(
                        apiError,
                        tr(language, "Unable to load blocked IP list", "ไม่สามารถโหลดรายการ IP ที่ถูกแบนได้")
                    ),
                });
            }
        } finally {
            if (!silent) setBansLoading(false);
        }
    }, [token, bansPage, clearToken, router, language]);

    const loadAttempts = useCallback(async (silent = false) => {
        if (!token) return;
        try {
            if (!silent) setAttemptsLoading(true);
            const params: { page: number; limit: number; email?: string; success?: boolean } = {
                page: attemptsPage,
                limit: 50,
            };
            if (attemptsFilter === "failed") params.success = false;
            if (attemptsFilter === "success") params.success = true;
            if (attemptsSearch) params.email = attemptsSearch;
            const data = await fetchLoginAttempts(params, token);
            setAttempts(data.items);
            setAttemptsTotal(data.total);
        } catch (err: unknown) {
            const apiError = err as ApiError;
            if (apiError.status === 401) {
                clearToken();
                router.replace("/login");
            }
            if (!silent) {
                toast.error(tr(language, "Failed to load login attempts", "โหลดประวัติการล็อกอินไม่สำเร็จ"), {
                    description: getErrorMessage(
                        apiError,
                        tr(language, "Unable to load login attempt history", "ไม่สามารถโหลดประวัติการล็อกอินได้")
                    ),
                });
            }
        } finally {
            if (!silent) setAttemptsLoading(false);
        }
    }, [token, attemptsPage, attemptsFilter, attemptsSearch, clearToken, router, language]);

    // Initial load
    useEffect(() => {
        loadStats();
        loadBans();
        loadAttempts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reload on page/filter changes
    useEffect(() => { loadBans(); }, [bansPage]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const timer = setTimeout(() => {
            setAttemptsPage(1);
            loadAttempts();
        }, 500);
        return () => clearTimeout(timer);
    }, [attemptsFilter, attemptsSearch]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { loadAttempts(); }, [attemptsPage]); // eslint-disable-line react-hooks/exhaustive-deps

    // Polling every 15s
    useEffect(() => {
        if (!isPolling || !token) return;
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                loadStats();
                loadBans(true);
                loadAttempts(true);
            }
        }, 15000);
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                loadStats();
                loadBans(true);
                loadAttempts(true);
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [isPolling, token, loadStats, loadBans, loadAttempts]);

    const handleUnban = async (ipAddress: string) => {
        if (!token) return;
        try {
            await deleteIPBan(ipAddress, token);
            toast.success(tr(language, `IP ${ipAddress} has been unbanned`, `ปลดแบน IP ${ipAddress} แล้ว`));
            loadBans();
            loadStats();
        } catch (err: unknown) {
            toast.error(tr(language, "Failed to unban IP", "ปลดแบน IP ไม่สำเร็จ"), {
                description: getErrorMessage(err, tr(language, "Unable to unban IP", "ไม่สามารถปลดแบน IP ได้")),
            });
        }
    };

    const handleBan = (ipAddress: string) => {
        toast.warningAction(tr(language, "Ban IP for 24 hours?", "แบน IP เป็นเวลา 24 ชั่วโมงใช่ไหม?"), {
            description: (
                <>
                    {tr(language, "Confirm to ban", "ยืนยันการแบน")} <span className="font-mono">{ipAddress}</span> {tr(language, "for 24 hours.", "เป็นเวลา 24 ชั่วโมง")}
                </>
            ),
            button: {
                title: tr(language, "Ban IP", "แบน IP"),
                onClick: async () => {
                    if (!token) return;
                    try {
                        await createIPBan(ipAddress, tr(language, "Manual ban by admin", "ผู้ดูแลแบนด้วยตนเอง"), 1440, token);
                        toast.success(tr(language, `IP ${ipAddress} has been banned for 24 hours`, `แบน IP ${ipAddress} เป็นเวลา 24 ชั่วโมงแล้ว`));
                        loadBans();
                        loadStats();
                    } catch (err: unknown) {
                        toast.error(tr(language, "Failed to ban IP", "แบน IP ไม่สำเร็จ"), {
                            description: getErrorMessage(err, tr(language, "Unable to ban IP", "ไม่สามารถแบน IP ได้")),
                        });
                    }
                },
            },
            duration: 9000,
        });
    };

    const refreshAll = () => {
        setStatsLoading(true);
        loadStats();
        loadBans();
        loadAttempts();
    };

    if (!hydrated || !token) {
        return null;
    }

    const bansTotalPages = Math.ceil(bansTotal / 20);
    const attemptsTotalPages = Math.ceil(attemptsTotal / 50);

    return (
        <LazyMotion features={domAnimation}>
        <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
            <SecurityStatsCards stats={stats} loading={statsLoading} language={language} />

            {/* IP Bans Section */}
            <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-semibold flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-red-500" />
                                {tr(language, "IP Bans", "การแบน IP")}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-2">
                                {tr(language, "Automatically or manually blocked IP addresses. Total:", "รายการ IP ที่ถูกบล็อกอัตโนมัติหรือด้วยผู้ดูแล ทั้งหมด:")} {bansTotal}
                                {isPolling && (
                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                        </span>
                                        {tr(language, "Auto-refreshing", "กำลังรีเฟรชอัตโนมัติ")}
                                    </span>
                                )}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="icon"
                                className="bg-background/50 border-white/10"
                                onClick={refreshAll}
                                disabled={bansLoading}
                            >
                                <RefreshCw className={cn("h-4 w-4", bansLoading && "animate-spin")} />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs"
                                onClick={() => setIsPolling((p) => !p)}
                            >
                                {isPolling
                                    ? tr(language, "Pause auto-refresh", "หยุดรีเฟรชอัตโนมัติ")
                                    : tr(language, "Resume auto-refresh", "เริ่มรีเฟรชอัตโนมัติ")}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-white/10 overflow-hidden">
                        <div className="max-h-[360px] overflow-auto lg:max-h-[420px]">
                            <Table>
                                <TableHeader className="sticky top-0 z-20 bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
                                    <TableRow className="hover:bg-transparent border-white/10">
                                        <TableHead>{tr(language, "IP Address", "ไอพีแอดเดรส")}</TableHead>
                                        <TableHead>{tr(language, "Reason", "เหตุผล")}</TableHead>
                                        <TableHead>{tr(language, "Failed Attempts", "จำนวนครั้งที่ล้มเหลว")}</TableHead>
                                        <TableHead>{tr(language, "Expires", "หมดอายุ")}</TableHead>
                                        <TableHead>{tr(language, "Banned At", "เวลาที่แบน")}</TableHead>
                                        <TableHead className="w-[80px]">{tr(language, "Actions", "การทำงาน")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {bansLoading && bans.length === 0 ? (
                                        Array.from({ length: 3 }).map((_, i) => (
                                            <TableRow key={i} className="border-white/10">
                                                <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                            </TableRow>
                                        ))
                                    ) : bans.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-24 text-center">
                                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                    <ShieldOff className="h-8 w-8" />
                                                    <p>{tr(language, "No active IP bans", "ไม่มี IP ที่ถูกแบนอยู่")}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <AnimatePresence mode="popLayout">
                                            {bans.map((ban) => (
                                                <m.tr
                                                    key={ban.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -10 }}
                                                    transition={{ duration: 0.15 }}
                                                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                                                >
                                                    <TableCell className="font-mono text-sm">{ban.ip_address}</TableCell>
                                                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                                                        {ban.reason || "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                                                            {ban.failed_attempts}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        <span className="flex items-center gap-1 text-muted-foreground">
                                                            <Clock className="h-3 w-3" />
                                                            {formatBannedUntil(ban.banned_until, language)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">
                                                        {timeAgo(ban.created_at, language)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                                            onClick={() => handleUnban(ban.ip_address)}
                                                        >
                                                            <Unlock className="h-4 w-4 mr-1" />
                                                            {tr(language, "Unban", "ปลดแบน")}
                                                        </Button>
                                                    </TableCell>
                                                </m.tr>
                                            ))}
                                        </AnimatePresence>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {bansTotalPages > 1 && (
                        <div className="flex items-center justify-between gap-2 border-t border-white/10 py-4">
                            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground">
                                {tr(language, "Page", "หน้า")} {bansPage} {tr(language, "of", "จาก")} {bansTotalPages}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-full border-white/20 bg-white/5 px-4 text-xs shadow-sm hover:bg-white/10"
                                    onClick={() => setBansPage((p) => Math.max(1, p - 1))}
                                    disabled={bansPage === 1}
                                >
                                    {tr(language, "Previous", "ก่อนหน้า")}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-full border-white/20 bg-white/5 px-4 text-xs shadow-sm hover:bg-white/10"
                                    onClick={() => setBansPage((p) => p + 1)}
                                    disabled={bansPage >= bansTotalPages}
                                >
                                    {tr(language, "Next", "ถัดไป")}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Login Attempts Section */}
            <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-semibold flex items-center gap-2">
                                <Activity className="w-5 h-5 text-[#7ac2f0]" />
                                {tr(language, "Login Attempts", "ความพยายามเข้าสู่ระบบ")}
                            </CardTitle>
                            <CardDescription>
                                {tr(language, "Recent authentication attempts. Total:", "ความพยายามยืนยันตัวตนล่าสุด ทั้งหมด:")} {attemptsTotal}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder={tr(language, "Filter by email...", "ค้นหาด้วยอีเมล...")}
                                    className="pl-9 w-full sm:w-[200px] bg-background/50 border-white/10"
                                    value={attemptsSearch}
                                    onChange={(e) => setAttemptsSearch(e.target.value)}
                                />
                            </div>
                            <Select
                                value={attemptsFilter}
                                onValueChange={(v) => setAttemptsFilter((v as "all" | "failed" | "success") ?? "all")}
                            >
                                <SelectTrigger className="w-[140px] bg-background/50 border-white/10">
                                    <SelectValue>
                                        {attemptsFilter === "all"
                                            ? tr(language, "All", "ทั้งหมด")
                                            : attemptsFilter === "failed"
                                                ? tr(language, "Failed Only", "เฉพาะล้มเหลว")
                                                : tr(language, "Success Only", "เฉพาะสำเร็จ")}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{tr(language, "All", "ทั้งหมด")}</SelectItem>
                                    <SelectItem value="failed">{tr(language, "Failed Only", "เฉพาะล้มเหลว")}</SelectItem>
                                    <SelectItem value="success">{tr(language, "Success Only", "เฉพาะสำเร็จ")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-white/10 overflow-hidden">
                        <div className="max-h-[420px] overflow-auto lg:max-h-[520px]">
                            <Table>
                                <TableHeader className="sticky top-0 z-20 bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
                                    <TableRow className="hover:bg-transparent border-white/10">
                                        <TableHead className="w-[120px]">{tr(language, "Time", "เวลา")}</TableHead>
                                        <TableHead>{tr(language, "IP Address", "ไอพีแอดเดรส")}</TableHead>
                                        <TableHead>{tr(language, "Email", "อีเมล")}</TableHead>
                                        <TableHead>{tr(language, "Status", "สถานะ")}</TableHead>
                                        <TableHead className="w-[80px]">{tr(language, "Actions", "การทำงาน")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {attemptsLoading && attempts.length === 0 ? (
                                        Array.from({ length: 8 }).map((_, i) => (
                                            <TableRow key={i} className="border-white/10">
                                                <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[180px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                            </TableRow>
                                        ))
                                    ) : attempts.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                                {tr(language, "No login attempts found.", "ไม่พบประวัติการเข้าสู่ระบบ")}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <AnimatePresence mode="popLayout">
                                            {attempts.map((attempt) => (
                                                <m.tr
                                                    key={attempt.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -10 }}
                                                    transition={{ duration: 0.15 }}
                                                    className={cn(
                                                        "border-b border-white/5 hover:bg-white/5 transition-colors",
                                                        !attempt.success && "bg-red-500/5"
                                                    )}
                                                >
                                                    <TableCell className="text-sm">
                                                        <span className="text-muted-foreground" title={new Date(attempt.created_at).toLocaleString(localeOf(language))}>
                                                            {timeAgo(attempt.created_at, language)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-sm">{attempt.ip_address}</TableCell>
                                                    <TableCell className="text-sm">{attempt.email}</TableCell>
                                                    <TableCell>
                                                        {attempt.success ? (
                                                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 flex items-center gap-1 w-fit">
                                                                <CheckCircle2 className="w-3 h-3" />
                                                                {tr(language, "Success", "สำเร็จ")}
                                                            </Badge>
                                                        ) : attempt.details?.includes("Rate Limit") ? (
                                                            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 flex items-center gap-1 w-fit">
                                                                <AlertTriangle className="w-3 h-3" />
                                                                {tr(language, "Blocked (Rate Limit)", "ถูกบล็อก (เกินอัตรา)")}
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 flex items-center gap-1 w-fit">
                                                                <XCircle className="w-3 h-3" />
                                                                {tr(language, "Failed", "ล้มเหลว")}
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
                                                            onClick={() => handleBan(attempt.ip_address)}
                                                            title={tr(language, "Ban IP for 24h", "แบน IP 24 ชั่วโมง")}
                                                        >
                                                            <ShieldAlert className="h-4 w-4 mr-1" />
                                                            {tr(language, "Ban", "แบน")}
                                                        </Button>
                                                    </TableCell>
                                                </m.tr>
                                            ))}
                                        </AnimatePresence>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between gap-2 border-t border-white/10 py-4">
                        <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground">
                            {tr(language, "Page", "หน้า")} {attemptsPage} {tr(language, "of", "จาก")} {attemptsTotalPages || 1}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full border-white/20 bg-white/5 px-4 text-xs shadow-sm hover:bg-white/10"
                                onClick={() => setAttemptsPage((p) => Math.max(1, p - 1))}
                                disabled={attemptsPage === 1 || attemptsLoading}
                            >
                                {tr(language, "Previous", "ก่อนหน้า")}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full border-white/20 bg-white/5 px-4 text-xs shadow-sm hover:bg-white/10"
                                onClick={() => setAttemptsPage((p) => p + 1)}
                                disabled={attemptsPage >= attemptsTotalPages || attemptsLoading}
                            >
                                {tr(language, "Next", "ถัดไป")}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

        </main>
        </LazyMotion>
    );
}
