"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useDenseModeStore } from "@/store/dense-mode-store";
import { fetchPatientSummary, fetchPatientTimeline, breakGlassAccess } from "@/lib/api";
import { DenseModeTopBar } from "./dense-mode-top-bar";
import { DenseModeLeftPanel } from "./dense-mode-left-panel";
import { DenseModeCenterPanel } from "./dense-mode-center-panel";
import { DenseModeRightPanel } from "./dense-mode-right-panel";
import { DenseModeBottomBar } from "./dense-mode-bottom-bar";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
    patientId: string;
}

export function DenseModeDashboard({ patientId }: Props) {
    const token = useAuthStore((s) => s.token);
    const summary = useDenseModeStore((s) => s.summary);
    const loading = useDenseModeStore((s) => s.loading);
    const error = useDenseModeStore((s) => s.error);
    const accessDenied = useDenseModeStore((s) => s.accessDenied);
    const leftPanelCollapsed = useDenseModeStore((s) => s.leftPanelCollapsed);
    const rightPanelCollapsed = useDenseModeStore((s) => s.rightPanelCollapsed);
    const setSummary = useDenseModeStore((s) => s.setSummary);
    const setLoading = useDenseModeStore((s) => s.setLoading);
    const setError = useDenseModeStore((s) => s.setError);
    const setAccessDenied = useDenseModeStore((s) => s.setAccessDenied);
    const appendTimelineEvents = useDenseModeStore((s) => s.appendTimelineEvents);
    const reset = useDenseModeStore((s) => s.reset);

    const [breakGlassReason, setBreakGlassReason] = useState("");
    const [breakGlassLoading, setBreakGlassLoading] = useState(false);
    const [breakGlassError, setBreakGlassError] = useState<string | null>(null);

    const loadPatientData = useCallback(async () => {
        if (!token) return;
        setLoading(true);

        try {
            const [summaryData, timelineData] = await Promise.all([
                fetchPatientSummary(patientId, token),
                fetchPatientTimeline(patientId, token),
            ]);
            setSummary(summaryData);
            appendTimelineEvents(timelineData.items, timelineData.next_cursor, timelineData.has_more);
            setLoading(false);
        } catch (err: any) {
            if (err?.status === 403) {
                setAccessDenied(true);
            } else {
                setError(err.message || "Failed to load patient data");
            }
        }
    }, [patientId, token]);

    useEffect(() => {
        loadPatientData();

        return () => {
            reset();
        };
    }, [patientId, token]);

    const handleBreakGlass = async () => {
        if (!token || breakGlassReason.trim().length < 5) return;
        setBreakGlassLoading(true);
        setBreakGlassError(null);

        try {
            const summaryData = await breakGlassAccess(patientId, breakGlassReason.trim(), token);
            setSummary(summaryData);
            setBreakGlassReason("");
            // Load timeline after break-glass grants access
            const timelineData = await fetchPatientTimeline(patientId, token);
            appendTimelineEvents(timelineData.items, timelineData.next_cursor, timelineData.has_more);
        } catch (err: any) {
            setBreakGlassError(err.message || "Break-glass request failed");
        } finally {
            setBreakGlassLoading(false);
        }
    };

    if (loading && !summary) {
        return (
            <div className="flex flex-col h-full p-4 gap-4">
                <Skeleton className="h-12 w-full" />
                <div className="flex flex-1 gap-4">
                    <Skeleton className="h-full w-64" />
                    <Skeleton className="h-full flex-1" />
                    <Skeleton className="h-full w-72" />
                </div>
                <Skeleton className="h-10 w-full" />
            </div>
        );
    }

    if (accessDenied) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="w-full max-w-md p-6 border rounded-lg shadow-sm bg-card">
                    <div className="flex items-center gap-2 mb-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        <h2 className="text-lg font-semibold">Access Restricted</h2>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                        You are not assigned to this patient. If you need emergency access, provide a reason below. This action will be audited.
                    </p>
                    <textarea
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-3"
                        rows={3}
                        placeholder="Reason for emergency access (min 5 characters)..."
                        value={breakGlassReason}
                        onChange={(e) => setBreakGlassReason(e.target.value)}
                        disabled={breakGlassLoading}
                    />
                    {breakGlassError && (
                        <p className="text-sm text-red-600 mb-3">{breakGlassError}</p>
                    )}
                    <div className="flex gap-2">
                        <button
                            className="flex-1 inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleBreakGlass}
                            disabled={breakGlassLoading || breakGlassReason.trim().length < 5}
                        >
                            {breakGlassLoading ? "Requesting..." : "Break-Glass Access"}
                        </button>
                        <button
                            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                            onClick={() => window.history.back()}
                        >
                            Go Back
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                        Access granted for 8 hours. All activity will be recorded in the audit log.
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <p className="text-lg font-semibold text-red-600">Error</p>
                    <p className="text-sm text-muted-foreground mt-1">{error}</p>
                </div>
            </div>
        );
    }

    if (!summary) return null;

    return (
        <div className="flex flex-col h-full bg-background">
            <DenseModeTopBar patientId={patientId} />
            <div className="flex flex-1 overflow-hidden">
                {!leftPanelCollapsed && <DenseModeLeftPanel />}
                <DenseModeCenterPanel patientId={patientId} />
                {!rightPanelCollapsed && <DenseModeRightPanel patientId={patientId} />}
            </div>
            <DenseModeBottomBar />
        </div>
    );
}
