"use client";

import { useEffect, useRef, useCallback } from "react";
import { useDenseModeStore } from "@/store/dense-mode-store";
import { useAuthStore } from "@/store/auth-store";
import { fetchPatientTimeline } from "@/lib/api";
import { TimelineCard } from "./timeline-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

interface Props {
    patientId: string;
}

export function ClinicalTimeline({ patientId }: Props) {
    const token = useAuthStore((s) => s.token);
    const events = useDenseModeStore((s) => s.timelineEvents);
    const cursor = useDenseModeStore((s) => s.timelineCursor);
    const hasMore = useDenseModeStore((s) => s.timelineHasMore);
    const loading = useDenseModeStore((s) => s.timelineLoading);
    const appendEvents = useDenseModeStore((s) => s.appendTimelineEvents);
    const setTimelineLoading = useDenseModeStore((s) => s.setTimelineLoading);
    const resetTimeline = useDenseModeStore((s) => s.resetTimeline);

    const observerRef = useRef<IntersectionObserver | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const loadingRef = useRef(false);

    const loadMore = useCallback(async () => {
        if (!token || loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setTimelineLoading(true);
        try {
            const res = await fetchPatientTimeline(patientId, token, cursor ?? undefined, 20);
            appendEvents(res.items, res.next_cursor, res.has_more);
        } catch {
            // silently fail, user can scroll to retry
        } finally {
            setTimelineLoading(false);
            loadingRef.current = false;
        }
    }, [token, patientId, cursor, hasMore, appendEvents, setTimelineLoading]);

    // Initial load
    useEffect(() => {
        resetTimeline();
        loadingRef.current = false;
    }, [patientId]);

    useEffect(() => {
        if (events.length === 0 && hasMore && token) {
            loadMore();
        }
    }, [events.length, hasMore, token, loadMore]);

    // IntersectionObserver for infinite scroll
    useEffect(() => {
        if (observerRef.current) observerRef.current.disconnect();

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && hasMore && !loadingRef.current) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        if (sentinelRef.current) {
            observerRef.current.observe(sentinelRef.current);
        }

        return () => observerRef.current?.disconnect();
    }, [hasMore, loadMore]);

    return (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {events.length === 0 && loading && (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex gap-3 p-3">
                            <Skeleton className="size-8 rounded-full shrink-0" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {events.map((event) => (
                <TimelineCard key={event.id} event={event} />
            ))}

            {/* Sentinel for infinite scroll */}
            {hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-4">
                    {loading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
                </div>
            )}

            {!hasMore && events.length > 0 && (
                <p className="text-center text-xs text-muted-foreground py-4">
                    No more events
                </p>
            )}

            {!hasMore && events.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm text-muted-foreground">No clinical events yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                        Timeline events will appear here as they are recorded.
                    </p>
                </div>
            )}
        </div>
    );
}
