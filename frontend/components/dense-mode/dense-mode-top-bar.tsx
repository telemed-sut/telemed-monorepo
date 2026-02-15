"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDenseModeStore } from "@/store/dense-mode-store";

interface Props {
    patientId: string;
}

export function DenseModeTopBar({ patientId }: Props) {
    const router = useRouter();
    const summary = useDenseModeStore((s) => s.summary);
    const leftPanelCollapsed = useDenseModeStore((s) => s.leftPanelCollapsed);
    const rightPanelCollapsed = useDenseModeStore((s) => s.rightPanelCollapsed);
    const toggleLeftPanel = useDenseModeStore((s) => s.toggleLeftPanel);
    const toggleRightPanel = useDenseModeStore((s) => s.toggleRightPanel);

    const alertCount = summary?.active_alerts.length ?? 0;

    return (
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="sm" onClick={() => router.push(`/patients/${patientId}`)}>
                <ArrowLeft className="size-4 mr-1" />
                Back
            </Button>

            <div className="flex items-center gap-2 flex-1">
                {summary && (
                    <h1 className="text-lg font-semibold">
                        {summary.patient.first_name} {summary.patient.last_name}
                        {summary.patient.people_id && (
                            <span className="text-sm text-muted-foreground ml-2">HN: {summary.patient.people_id}</span>
                        )}
                    </h1>
                )}
            </div>

            {alertCount > 0 && (
                <div className="flex items-center gap-1.5">
                    <AlertTriangle className="size-4 text-red-500" />
                    <Badge variant="destructive" className="text-xs">
                        {alertCount} Alert{alertCount > 1 ? "s" : ""}
                    </Badge>
                </div>
            )}

            <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={toggleLeftPanel} title="Toggle left panel" aria-label={leftPanelCollapsed ? "Expand left panel" : "Collapse left panel"}>
                    {leftPanelCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={toggleRightPanel} title="Toggle right panel" aria-label={rightPanelCollapsed ? "Expand right panel" : "Collapse right panel"}>
                    {rightPanelCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
                </Button>
            </div>
        </div>
    );
}
