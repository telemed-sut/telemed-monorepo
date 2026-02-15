"use client";

import { useDenseModeStore } from "@/store/dense-mode-store";
import { Badge } from "@/components/ui/badge";
import {
    Pill,
    TestTube,
    FileText,
    AlertTriangle,
    Stethoscope,
    Syringe,
    ImageIcon,
    Activity,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { useState } from "react";

interface TimelineEvent {
    id: string;
    event_type: string;
    event_time: string;
    title: string;
    summary: string | null;
    details: string | null;
    is_abnormal: boolean;
    author_name: string | null;
}

const typeConfig: Record<string, { icon: typeof Pill; color: string; label: string }> = {
    medication: { icon: Pill, color: "text-blue-500", label: "Medication" },
    lab_result: { icon: TestTube, color: "text-amber-500", label: "Lab Result" },
    lab_order: { icon: TestTube, color: "text-amber-400", label: "Lab Order" },
    note: { icon: FileText, color: "text-emerald-500", label: "Note" },
    progress_note: { icon: FileText, color: "text-emerald-500", label: "Progress Note" },
    alert: { icon: AlertTriangle, color: "text-red-500", label: "Alert" },
    encounter: { icon: Stethoscope, color: "text-purple-500", label: "Encounter" },
    imaging: { icon: ImageIcon, color: "text-indigo-500", label: "Imaging" },
    procedure: { icon: Syringe, color: "text-rose-500", label: "Procedure" },
    vitals: { icon: Activity, color: "text-teal-500", label: "Vitals" },
};

function getConfig(eventType: string) {
    return typeConfig[eventType] ?? { icon: FileText, color: "text-muted-foreground", label: eventType };
}

interface TimelineCardProps {
    event: TimelineEvent;
}

export function TimelineCard({ event }: TimelineCardProps) {
    const [expanded, setExpanded] = useState(false);
    const config = getConfig(event.event_type);
    const Icon = config.icon;

    const time = new Date(event.event_time).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });

    let parsedDetails: Record<string, string> | null = null;
    if (event.details) {
        try {
            parsedDetails = JSON.parse(event.details);
        } catch {
            // not JSON, treat as plain text
        }
    }

    return (
        <div
            className={`relative flex gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/40 ${event.is_abnormal ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" : ""}`}
        >
            <div className="flex flex-col items-center shrink-0">
                <div className={`p-1.5 rounded-full bg-muted ${config.color}`}>
                    <Icon className="size-3.5" />
                </div>
                <div className="w-px flex-1 bg-border mt-1" />
            </div>

            <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{event.title}</span>
                        {event.is_abnormal && (
                            <Badge variant="destructive" className="text-[10px]">
                                Abnormal
                            </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                            {config.label}
                        </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                        {time}
                    </span>
                </div>

                {event.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{event.summary}</p>
                )}

                {event.author_name && (
                    <p className="text-[11px] text-muted-foreground">By: {event.author_name}</p>
                )}

                {(event.details || parsedDetails) && (
                    <button
                        type="button"
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        {expanded ? "Hide details" : "Show details"}
                    </button>
                )}

                {expanded && parsedDetails && (
                    <div className="mt-2 p-2 rounded bg-muted/50 text-xs space-y-1 border">
                        {Object.entries(parsedDetails).map(([key, value]) => (
                            <div key={key}>
                                <span className="font-medium capitalize">{key.replace(/_/g, " ")}:</span>{" "}
                                <span className="text-muted-foreground whitespace-pre-wrap">{value}</span>
                            </div>
                        ))}
                    </div>
                )}

                {expanded && !parsedDetails && event.details && (
                    <div className="mt-2 p-2 rounded bg-muted/50 text-xs border whitespace-pre-wrap text-muted-foreground">
                        {event.details}
                    </div>
                )}
            </div>
        </div>
    );
}
