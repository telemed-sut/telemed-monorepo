"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import {
    UserGroupIcon,
    Add01Icon,
    CalendarAddIcon,
    AiPhone01Icon,
    ArrowUp01Icon,
    ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { fetchPatients, type Patient } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { motion } from "framer-motion";

export function OverviewContent() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const clearToken = useAuthStore((state) => state.clearToken);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        total: 0,
        active: 0,
        recent: 0,
        growth: 0,
    });
    const [recentPatients, setRecentPatients] = useState<Patient[]>([]);

    useEffect(() => {
        if (!token) return;

        const loadStats = async () => {
            setLoading(true);
            try {
                // Fetch total patients
                const allPatients = await fetchPatients({ page: 1, limit: 10000 }, token);

                // Fetch recent patients (last 7 days)
                const recentData = await fetchPatients({ page: 1, limit: 5, sort: "created_at", order: "desc" }, token);

                const totalPatients = allPatients.total;
                const activePatients = allPatients.items.filter(p => !!p.phone || !!p.email).length;

                const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                const recentCount = allPatients.items.filter(p => {
                    if (!p.created_at) return false;
                    return new Date(p.created_at) >= weekAgo;
                }).length;

                // Calculate growth (mock calculation - you can adjust based on your needs)
                const growth = totalPatients > 0 ? Math.round((recentCount / totalPatients) * 100) : 0;

                setStats({
                    total: totalPatients,
                    active: activePatients,
                    recent: recentCount,
                    growth,
                });

                setRecentPatients(recentData.items);
            } catch (err) {
                const status = (err as { status?: number }).status;
                if (status === 401) {
                    clearToken();
                    router.replace("/login");
                }
            } finally {
                setLoading(false);
            }
        };

        loadStats();
    }, [token, clearToken, router]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
            },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 },
    };

    return (
        <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
                <p className="text-muted-foreground">
                    Welcome back! Here's what's happening with your patient management system.
                </p>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Card key={i}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-8 w-8 rounded-lg" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-8 w-16 mb-2" />
                                <Skeleton className="h-3 w-32" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <motion.div
                    className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                >
                    <motion.div variants={itemVariants}>
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
                                <p className="text-xs text-muted-foreground mt-1">
                                    <span className="text-primary font-medium">All time</span>
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div variants={itemVariants}>
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
                                <p className="text-xs text-muted-foreground mt-1">
                                    <span className="text-emerald-500 font-medium">{stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}%</span> with contact info
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div variants={itemVariants}>
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
                                <p className="text-xs text-muted-foreground mt-1">
                                    <span className="text-amber-500 font-medium">+{stats.recent}</span> last 7 days
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div variants={itemVariants}>
                        <Card className="relative overflow-hidden border-none shadow-md bg-gradient-to-br from-background via-background to-blue-500/5 hover:shadow-lg transition-all duration-300 group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <HugeiconsIcon icon={ArrowUp01Icon} className="w-24 h-24 text-blue-500 transform rotate-12 translate-x-4 -translate-y-4" />
                            </div>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Growth Rate</CardTitle>
                                <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                                    <HugeiconsIcon icon={ArrowUp01Icon} className="h-4 w-4 text-blue-500" />
                                </div>
                            </CardHeader>
                            <CardContent className="relative z-10">
                                <div className="text-3xl font-bold tracking-tight text-foreground">{stats.growth}%</div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    <span className="text-blue-500 font-medium">Weekly</span> growth
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>
                </motion.div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <div className="flex items-center justify-center p-2 rounded-lg bg-primary/10">
                                <HugeiconsIcon icon={CalendarAddIcon} className="size-5 text-primary" />
                            </div>
                            Recent Patients
                        </CardTitle>
                        <CardDescription>Latest patient registrations</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="space-y-3">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <Skeleton className="h-10 w-10 rounded-full" />
                                        <div className="flex-1 space-y-2">
                                            <Skeleton className="h-4 w-32" />
                                            <Skeleton className="h-3 w-24" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : recentPatients.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <p>No patients yet</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {recentPatients.map((patient) => (
                                    <div
                                        key={patient.id}
                                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary font-semibold">
                                            {patient.first_name?.charAt(0)}{patient.last_name?.charAt(0)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">
                                                {patient.first_name} {patient.last_name}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {patient.email || patient.phone || "No contact"}
                                            </p>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {patient.created_at ? new Date(patient.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <div className="flex items-center justify-center p-2 rounded-lg bg-primary/10">
                                <HugeiconsIcon icon={UserGroupIcon} className="size-5 text-primary" />
                            </div>
                            Quick Actions
                        </CardTitle>
                        <CardDescription>Common tasks and shortcuts</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button
                            className="w-full justify-between group shadow-sm hover:shadow-md transition-all"
                            onClick={() => router.push("/patients")}
                        >
                            <div className="flex items-center gap-2">
                                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                                Add New Patient
                            </div>
                            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 group-hover:translate-x-1 transition-transform" />
                        </Button>

                        <Button
                            variant="outline"
                            className="w-full justify-between group shadow-sm hover:shadow-md transition-all"
                            onClick={() => router.push("/patients")}
                        >
                            <div className="flex items-center gap-2">
                                <HugeiconsIcon icon={UserGroupIcon} className="size-4" />
                                View All Patients
                            </div>
                            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 group-hover:translate-x-1 transition-transform" />
                        </Button>

                        <div className="pt-4 border-t">
                            <div className="text-sm text-muted-foreground space-y-2">
                                <p className="flex items-center justify-between">
                                    <span>System Status:</span>
                                    <span className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-emerald-500 font-medium">Online</span>
                                    </span>
                                </p>
                                <p className="flex items-center justify-between">
                                    <span>Last Updated:</span>
                                    <span className="font-medium">{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}
