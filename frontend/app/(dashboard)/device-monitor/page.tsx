"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import { fetchDeviceStats, fetchDeviceErrors, DeviceStats, DeviceErrorLog } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function DeviceMonitorPage() {
    const token = useAuthStore((state) => state.token);
    const [stats, setStats] = useState<DeviceStats | null>(null);
    const [errors, setErrors] = useState<DeviceErrorLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorObj, setErrorObj] = useState<Error | null>(null);
    const [isAutoRefresh, setIsAutoRefresh] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const loadData = async () => {
        if (!token) return;
        setLoading(true);
        setErrorObj(null);
        try {
            const statsData = await fetchDeviceStats(token);
            setStats(statsData);
            const errorsData = await fetchDeviceErrors(token);
            setErrors(errorsData);
        } catch (error: any) {
            console.error("Failed to load device data", error);
            setErrorObj(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [token]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isAutoRefresh && token) {
            interval = setInterval(() => {
                loadData();
            }, 5000);
        }
        return () => clearInterval(interval);
    }, [isAutoRefresh, token]);

    useEffect(() => {
        if (stats) {
            setLastUpdated(new Date());
        }
    }, [stats]);

    if (loading && !stats) return <div className="p-8">Loading device data...</div>;
    if (errorObj) return (
        <div className="p-8">
            <div className="rounded-md bg-destructive/15 p-4">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
                    </div>
                    <div className="ml-3">
                        <h3 className="text-sm font-medium text-destructive">Error loading device monitor</h3>
                        <div className="mt-2 text-sm text-destructive/90">
                            <p>{errorObj.message || "Unknown error occurred"}</p>
                            <Button variant="outline" size="sm" onClick={loadData} className="mt-4 border-destructive/20 hover:bg-destructive/20">
                                Retry
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
    if (!stats) return <div className="p-8">No data available.</div>;

    return (
        <div className="flex flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Device Monitor</h1>
                    <p className="text-muted-foreground">Real-time status of physical device API ingestion.</p>
                </div>
                <div className="flex items-center gap-4">
                    {lastUpdated && (
                        <span className="text-xs text-muted-foreground">
                            Last updated: {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                    <div className="flex items-center space-x-2">
                        <Switch id="auto-refresh" checked={isAutoRefresh} onCheckedChange={setIsAutoRefresh} />
                        <Label htmlFor="auto-refresh">Auto-refresh</Label>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Success Requests (24h)</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.success_count}</div>
                        <p className="text-xs text-muted-foreground">Successful data ingestions</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Error Count (24h)</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.error_count}</div>
                        <p className="text-xs text-muted-foreground">Failed requests or validations</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{(stats.error_rate * 100).toFixed(2)}%</div>
                        <p className="text-xs text-muted-foreground">Percentage of total requests</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Errors by Device ID</CardTitle>
                        <CardDescription>Top devices encountering issues in the last 24 hours.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.errors_by_device}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                        dataKey="device_id"
                                        stroke="#888888"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        stroke="#888888"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${value}`}
                                    />
                                    <Tooltip
                                        contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0" }}
                                        cursor={{ fill: "transparent" }}
                                    />
                                    <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} name="Errors" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Recent Error Logs</CardTitle>
                        <CardDescription>Latest 50 error events.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Device</TableHead>
                                        <TableHead>Error</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {errors.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {new Date(log.occurred_at).toLocaleTimeString()}
                                            </TableCell>
                                            <TableCell className="font-medium text-xs">{log.device_id}</TableCell>
                                            <TableCell className="text-xs text-red-500 max-w-[150px] truncate" title={log.error_message}>
                                                {log.error_message}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {errors.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={3} className="text-center text-muted-foreground">No errors found.</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
