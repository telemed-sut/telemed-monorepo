"use client";

import { useDenseModeStore } from "@/store/dense-mode-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, UserCheck, Activity, Stethoscope } from "lucide-react";

export function DenseModeLeftPanel() {
    const summary = useDenseModeStore((s) => s.summary);
    if (!summary) return null;

    const { active_alerts, assigned_doctors, current_conditions, active_treatments } = summary;

    return (
        <div className="w-64 border-r overflow-y-auto p-3 space-y-3 bg-muted/30 shrink-0">
            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                        <AlertCircle className="size-3.5 text-red-500" />
                        Active Alerts
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                    {active_alerts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No active alerts</p>
                    ) : (
                        <div className="space-y-1.5">
                            {active_alerts.map((alert) => (
                                <div key={alert.id} className="flex items-start gap-1.5">
                                    <Badge
                                        variant={alert.severity === "critical" ? "destructive" : "secondary"}
                                        className="text-[10px] shrink-0"
                                    >
                                        {alert.severity}
                                    </Badge>
                                    <span className="text-xs leading-tight">{alert.title}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                        <Activity className="size-3.5" />
                        Current Conditions
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                    {current_conditions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No active conditions</p>
                    ) : (
                        <div className="space-y-1">
                            {current_conditions.map((c) => (
                                <div key={c.id} className="text-xs flex items-center gap-1.5">
                                    <span className="font-medium">{c.condition}</span>
                                    {c.severity && (
                                        <Badge variant="outline" className="text-[10px]">{c.severity}</Badge>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                        <UserCheck className="size-3.5" />
                        Assigned Doctors
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                    {assigned_doctors.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No assigned doctors</p>
                    ) : (
                        <div className="space-y-1">
                            {assigned_doctors.map((d) => (
                                <div key={d.id} className="text-xs">
                                    <span className="font-medium">Dr. {d.name}</span>
                                    {d.role && <span className="text-muted-foreground ml-1">({d.role})</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                        <Stethoscope className="size-3.5" />
                        Active Treatments
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                    {active_treatments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No active treatments</p>
                    ) : (
                        <div className="space-y-1">
                            {active_treatments.map((t) => (
                                <div key={t.id} className="text-xs">
                                    <span>{t.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
