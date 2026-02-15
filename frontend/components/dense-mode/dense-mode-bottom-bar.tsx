"use client";

import { useDenseModeStore } from "@/store/dense-mode-store";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

export function DenseModeBottomBar() {
    const summary = useDenseModeStore((s) => s.summary);

    return (
        <div className="flex items-center justify-between px-4 py-1.5 border-t bg-muted/50 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    Last updated: {new Date().toLocaleTimeString()}
                </span>
                <Badge variant="outline" className="text-[10px]">
                    Source: EMR
                </Badge>
            </div>
            <div className="flex items-center gap-2">
                {summary?.patient && (
                    <span>
                        {summary.patient.ward ? `Ward: ${summary.patient.ward}` : "No ward assigned"}
                        {summary.patient.bed_number ? ` / Bed: ${summary.patient.bed_number}` : ""}
                    </span>
                )}
            </div>
        </div>
    );
}
