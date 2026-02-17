"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { fetchAuditLogs, exportAuditLogs, type AuditLogItem, type AuditLogListResponse } from "@/lib/api";
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
import { toast } from "sonner";
import {
    ScrollText,
    Search,
    RefreshCw,
    ShieldAlert,
    Activity,
    Users,
    Clock,
    Eye,
    ChevronRight,
    Download,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Constants ──

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const ACTION_OPTIONS = [
    { value: "all", label: "All Actions" },
    { value: "user_create", label: "User Create" },
    { value: "user_update", label: "User Update" },
    { value: "user_delete", label: "User Delete" },
    { value: "user_verify", label: "User Verify" },
    { value: "user_invite", label: "User Invite" },
    { value: "view_patient_summary", label: "View Patient Summary" },
    { value: "view_patient_timeline", label: "View Patient Timeline" },
    { value: "view_active_orders", label: "View Active Orders" },
    { value: "view_lab_trends", label: "View Lab Trends" },
    { value: "create_medication_order", label: "Create Medication Order" },
    { value: "create_lab_order", label: "Create Lab Order" },
    { value: "create_imaging_order", label: "Create Imaging Order" },
    { value: "create_note", label: "Create Note" },
    { value: "break_glass", label: "Break Glass" },
    { value: "acknowledge_alert", label: "Acknowledge Alert" },
];

const RESOURCE_TYPE_OPTIONS = [
    { value: "all", label: "All Resources" },
    { value: "user", label: "User" },
    { value: "user_invite", label: "User Invite" },
    { value: "patient", label: "Patient" },
    { value: "note", label: "Note" },
    { value: "alert", label: "Alert" },
    { value: "medication", label: "Medication" },
    { value: "lab", label: "Lab" },
    { value: "imaging", label: "Imaging" },
];

const BREAK_GLASS_OPTIONS = [
    { value: "all", label: "All Events" },
    { value: "true", label: "Break Glass Only" },
];

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

function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString();
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
    total,
    logs,
}: {

    total: number;
    logs: AuditLogItem[];
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
            title: "Total Logs",
            value: total,
            subtitle: "All audit entries",
            icon: ScrollText,
            iconColor: "text-[#7ac2f0]",
            bgColor: "bg-[#7ac2f0]/10",
        },
        {
            title: "Break Glass",
            value: breakGlassCount,
            subtitle: breakGlassCount > 0 ? "Requires review" : "No incidents",
            icon: ShieldAlert,
            iconColor: breakGlassCount > 0 ? "text-red-500" : "text-muted-foreground",
            bgColor: breakGlassCount > 0 ? "bg-red-500/10" : "bg-muted/50",
        },
        {
            title: "Unique Users",
            value: uniqueUsers,
            subtitle: "In current view",
            icon: Users,
            iconColor: "text-emerald-500",
            bgColor: "bg-emerald-500/10",
        },
        {
            title: "Today's Activity",
            value: todayCount,
            subtitle: "Events today",
            icon: Activity,
            iconColor: "text-amber-500",
            bgColor: "bg-amber-500/10",
        },
    ];

    return (
        <div className="bg-card rounded-xl border">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x">
                {stats.map((stat, i) => (
                    <div key={i} className="flex items-start gap-3 p-4 sm:p-5">
                        <div className={`p-2.5 rounded-lg ${stat.bgColor}`}>
                            <stat.icon className={`size-5 ${stat.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground font-medium">
                                {stat.title}
                            </p>
                            <p className="text-[28px] font-semibold leading-tight tracking-tight mt-0.5">
                                {stat.value}
                            </p>
                            <p className="text-xs text-muted-foreground font-medium mt-1">
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

    // Data
    const [logs, setLogs] = useState<AuditLogItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);

    // Filters
    const [search, setSearch] = useState("");
    const [actionFilter, setActionFilter] = useState("all");
    const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
    const [breakGlassFilter, setBreakGlassFilter] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    // UI
    const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
    const [isPolling, setIsPolling] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    // Auth guard
    useEffect(() => {
        if (hydrated && !token) {
            router.replace("/login");
        }
    }, [hydrated, token, router]);

    const loadLogs = useCallback(async (silent = false) => {
        if (!token) return;

        try {
            if (!silent) setLoading(true);

            const params: Record<string, any> = { page, limit };
            if (search) params.search = search;
            if (actionFilter !== "all") params.action = actionFilter;
            if (resourceTypeFilter !== "all") params.resource_type = resourceTypeFilter;
            if (breakGlassFilter === "true") params.is_break_glass = true;
            if (dateFrom) params.date_from = dateFrom;
            if (dateTo) params.date_to = dateTo;

            const response = await fetchAuditLogs(token, params);
            setLogs(response.items);
            setTotal(response.total);
        } catch (err: any) {
            if (err.status === 401) {
                clearToken();
                router.replace("/login");
                return;
            }
            if (!silent) toast.error("Failed to load audit logs");
        } finally {
            if (!silent) setLoading(false);
        }
    }, [token, page, limit, search, actionFilter, resourceTypeFilter, breakGlassFilter, dateFrom, dateTo, clearToken, router]);

    // Debounce search & filter changes
    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1);
            loadLogs();
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, actionFilter, resourceTypeFilter, breakGlassFilter, dateFrom, dateTo]);

    // Pagination change
    useEffect(() => {
        loadLogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit]);

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
                action: actionFilter !== "all" ? actionFilter : undefined,
                resource_type: resourceTypeFilter !== "all" ? resourceTypeFilter : undefined,
                is_break_glass: breakGlassFilter === "true" ? true : undefined,
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

            toast.success("Audit logs exported successfully");
        } catch (err) {
            toast.error("Failed to export logs");
        } finally {
            setIsExporting(false);
        }
    };

    if (!hydrated || !token) {
        return null;
    }

    const totalPages = Math.ceil(total / limit);

    return (
        <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
            <AuditStatsCards total={total} logs={logs} />

            <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                <CardHeader>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-semibold flex items-center gap-2">
                                <ScrollText className="w-5 h-5 text-primary" />
                                Audit Logs
                            </CardTitle>
                            <CardDescription className="flex items-center gap-2">
                                System activity and security events. Total: {total}
                                {isPolling && (
                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                        </span>
                                        Auto-refreshing
                                    </span>
                                )}
                            </CardDescription>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search logs..."
                                    className="pl-9 w-full sm:w-[200px] bg-background/50 border-white/10"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>

                            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? "")}>
                                <SelectTrigger className="w-[180px] bg-background/50 border-white/10">
                                    <SelectValue>
                                        {ACTION_OPTIONS.find((a) => a.value === actionFilter)?.label || "All Actions"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {ACTION_OPTIONS.map((a) => (
                                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={resourceTypeFilter} onValueChange={(v) => setResourceTypeFilter(v ?? "")}>
                                <SelectTrigger className="w-[160px] bg-background/50 border-white/10">
                                    <SelectValue>
                                        {RESOURCE_TYPE_OPTIONS.find((r) => r.value === resourceTypeFilter)?.label || "All Resources"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {RESOURCE_TYPE_OPTIONS.map((r) => (
                                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={breakGlassFilter} onValueChange={(v) => setBreakGlassFilter(v ?? "")}>
                                <SelectTrigger className="w-[160px] bg-background/50 border-white/10">
                                    <SelectValue>
                                        {BREAK_GLASS_OPTIONS.find((b) => b.value === breakGlassFilter)?.label || "All Events"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {BREAK_GLASS_OPTIONS.map((b) => (
                                        <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Date Range Filters */}
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">From:</span>
                            <Input
                                type="date"
                                className="w-[160px] bg-background/50 border-white/10"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">To:</span>
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
                            className="text-xs"
                            onClick={() => setIsPolling((p) => !p)}
                        >
                            {isPolling ? "Pause" : "Resume"} auto-refresh
                        </Button>

                        <Button
                            variant="default"
                            size="sm"
                            className="text-xs gap-2 ml-auto lg:ml-0"
                            onClick={handleExport}
                            disabled={isExporting || total === 0}
                        >
                            {isExporting ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            Export CSV
                        </Button>
                    </div>
                </CardHeader>

                <CardContent>
                    <div className="rounded-md border border-white/10 overflow-hidden">
                        <div className="max-h-[500px] overflow-auto lg:max-h-[620px]">
                            <Table>
                                <TableHeader className="sticky top-0 z-20 bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
                                    <TableRow className="hover:bg-transparent border-white/10">
                                        <TableHead className="w-[120px]">Time</TableHead>
                                        <TableHead>User</TableHead>
                                        <TableHead>Action</TableHead>
                                        <TableHead>Resource</TableHead>
                                        <TableHead>IP Address</TableHead>
                                        <TableHead>Break Glass</TableHead>
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
                                                <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[20px]" /></TableCell>
                                            </TableRow>
                                        ))
                                    ) : logs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                                No audit logs found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <AnimatePresence mode="popLayout">
                                            {logs.map((log) => (
                                                <motion.tr
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
                                                        <div title={new Date(log.created_at).toLocaleString()}>
                                                            <span className="text-muted-foreground">{timeAgo(log.created_at)}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="min-w-0">
                                                            <span className="block text-sm font-medium truncate">
                                                                {log.user_name || "-"}
                                                            </span>
                                                            <span className="block text-xs text-muted-foreground truncate">
                                                                {log.user_email || "-"}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className={cn("text-xs", getActionColor(log.action))}>
                                                            {formatActionLabel(log.action)}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="min-w-0">
                                                            <span className="block text-sm">{log.resource_type || "-"}</span>
                                                            <span className="block text-xs text-muted-foreground font-mono">
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
                                                                Yes
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </TableCell>
                                                </motion.tr>
                                            ))}
                                        </AnimatePresence>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Pagination */}
                    <div className="flex flex-col gap-3 border-t border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground">
                                Page {page} of {totalPages || 1}
                            </span>
                            <Select
                                value={limit.toString()}
                                onValueChange={(val) => {
                                    setLimit(Number(val));
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger variant="glass" className="h-8 w-[96px] rounded-full text-xs shadow-sm">
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
                            <span className="text-xs text-muted-foreground">/ page</span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full border-white/20 bg-white/5 px-4 text-xs shadow-sm hover:bg-white/10"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1 || loading}
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full border-white/20 bg-white/5 px-4 text-xs shadow-sm hover:bg-white/10"
                                onClick={() => setPage((p) => p + 1)}
                                disabled={page >= totalPages || loading}
                            >
                                Next
                            </Button>
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
                                            <Badge variant="outline" className={cn("text-xs", getActionColor(selectedLog.action))}>
                                                {formatActionLabel(selectedLog.action)}
                                            </Badge>
                                            {selectedLog.is_break_glass && (
                                                <Badge variant="outline" className="border-red-500/20 text-red-500 bg-red-500/10 text-xs">
                                                    Break Glass
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {new Date(selectedLog.created_at).toLocaleString()} ({timeAgo(selectedLog.created_at)})
                                        </p>
                                    </div>
                                </SheetTitle>
                                <SheetDescription className="sr-only">
                                    Audit log detail view
                                </SheetDescription>
                            </SheetHeader>

                            <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(88vh-100px)]">
                                {/* User Section */}
                                <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                        <Users className="w-3.5 h-3.5" />
                                        User
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm uppercase shrink-0">
                                            {selectedLog.user_name ? selectedLog.user_name[0] : selectedLog.user_email ? selectedLog.user_email[0] : "?"}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{selectedLog.user_name || "Unknown"}</p>
                                            <p className="text-xs text-muted-foreground truncate">{selectedLog.user_email || "-"}</p>
                                        </div>
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">User ID</p>
                                            <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{selectedLog.user_id || "-"}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">IP Address</p>
                                            <p className="text-xs font-mono text-muted-foreground mt-0.5">{selectedLog.ip_address || "-"}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Resource Section */}
                                <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                        <Activity className="w-3.5 h-3.5" />
                                        Resource
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Type</p>
                                            <p className="text-sm mt-0.5">{selectedLog.resource_type || "-"}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Resource ID</p>
                                            <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{selectedLog.resource_id || "-"}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Break Glass Section */}
                                {selectedLog.is_break_glass && (
                                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-2">
                                        <p className="text-xs font-medium text-red-500 uppercase tracking-wide flex items-center gap-1.5">
                                            <ShieldAlert className="w-3.5 h-3.5" />
                                            Break Glass Access
                                        </p>
                                        {selectedLog.break_glass_reason ? (
                                            <p className="text-sm text-foreground">{selectedLog.break_glass_reason}</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground italic">No reason provided</p>
                                        )}
                                    </div>
                                )}

                                {/* Details Section */}
                                {selectedLog.details && (
                                    <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                            <ScrollText className="w-3.5 h-3.5" />
                                            Details
                                        </p>
                                        <pre className="text-sm bg-background rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground border border-border/40">
                                            {tryFormatJson(selectedLog.details)}
                                        </pre>
                                    </div>
                                )}

                                {/* Change History Section */}
                                {(selectedLog.old_values || selectedLog.new_values) && (
                                    <div className="rounded-lg border border-border/60 p-4 bg-muted/10">
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                            <Activity className="w-3.5 h-3.5" />
                                            Change History
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
                                                    return <p className="text-sm text-muted-foreground italic">No specific changes detected.</p>;
                                                }

                                                return (
                                                    <div className="rounded-md border border-border/40 overflow-hidden">
                                                        <Table>
                                                            <TableHeader className="bg-muted/30">
                                                                <TableRow className="border-border/40 hover:bg-transparent">
                                                                    <TableHead className="h-8 text-xs font-medium">Field</TableHead>
                                                                    <TableHead className="h-8 text-xs font-medium text-red-500/80">Old Value</TableHead>
                                                                    <TableHead className="h-8 text-xs font-medium text-emerald-500/80">New Value</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {changedKeys.map((key) => (
                                                                    <TableRow key={key} className="border-border/40 hover:bg-transparent">
                                                                        <TableCell className="py-2 text-xs font-medium font-mono text-muted-foreground">
                                                                            {key}
                                                                        </TableCell>
                                                                        <TableCell className="py-2 text-xs font-mono text-red-600/90 break-all bg-red-500/5">
                                                                            {typeof oldVals[key] === 'object' ? JSON.stringify(oldVals[key]) : String(oldVals[key] ?? "-")}
                                                                        </TableCell>
                                                                        <TableCell className="py-2 text-xs font-mono text-emerald-600/90 break-all bg-emerald-500/5">
                                                                            {typeof newVals[key] === 'object' ? JSON.stringify(newVals[key]) : String(newVals[key] ?? "-")}
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
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Log ID</p>
                                    <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{selectedLog.id}</p>
                                </div>
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet >
        </main >
    );
}
