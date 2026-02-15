import { create } from "zustand";
import type {
    PatientDenseSummary,
    TimelineEvent,
} from "@/lib/api";

interface DenseModeState {
    // Patient data
    summary: PatientDenseSummary | null;
    loading: boolean;
    error: string | null;
    accessDenied: boolean;

    // Timeline
    timelineEvents: TimelineEvent[];
    timelineCursor: string | null;
    timelineHasMore: boolean;
    timelineLoading: boolean;

    // Panel visibility
    leftPanelCollapsed: boolean;
    rightPanelCollapsed: boolean;

    // Quick action dialogs
    showNewNoteDialog: boolean;
    showNewOrderDialog: boolean;

    // Actions
    setSummary: (summary: PatientDenseSummary) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setAccessDenied: (denied: boolean) => void;

    appendTimelineEvents: (events: TimelineEvent[], cursor: string | null, hasMore: boolean) => void;
    resetTimeline: () => void;
    setTimelineLoading: (loading: boolean) => void;

    toggleLeftPanel: () => void;
    toggleRightPanel: () => void;

    setShowNewNoteDialog: (show: boolean) => void;
    setShowNewOrderDialog: (show: boolean) => void;

    markAlertAcknowledged: (alertId: string) => void;

    reset: () => void;
}

export const useDenseModeStore = create<DenseModeState>((set) => ({
    summary: null,
    loading: false,
    error: null,
    accessDenied: false,

    timelineEvents: [],
    timelineCursor: null,
    timelineHasMore: true,
    timelineLoading: false,

    leftPanelCollapsed: false,
    rightPanelCollapsed: false,

    showNewNoteDialog: false,
    showNewOrderDialog: false,

    setSummary: (summary) => set({ summary, error: null, accessDenied: false }),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error, loading: false }),
    setAccessDenied: (accessDenied) => set({ accessDenied, loading: false }),

    appendTimelineEvents: (newEvents, cursor, hasMore) =>
        set((s) => {
            const existingIds = new Set(s.timelineEvents.map((e) => e.id));
            const uniqueNewEvents = newEvents.filter((e) => !existingIds.has(e.id));
            return {
                timelineEvents: [...s.timelineEvents, ...uniqueNewEvents],
                timelineCursor: cursor,
                timelineHasMore: hasMore,
            };
        }),
    resetTimeline: () => set({ timelineEvents: [], timelineCursor: null, timelineHasMore: true }),
    setTimelineLoading: (loading) => set({ timelineLoading: loading }),

    toggleLeftPanel: () => set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
    toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),

    setShowNewNoteDialog: (show) => set({ showNewNoteDialog: show }),
    setShowNewOrderDialog: (show) => set({ showNewOrderDialog: show }),

    markAlertAcknowledged: (alertId) =>
        set((s) => {
            if (!s.summary) return s;
            return {
                summary: {
                    ...s.summary,
                    active_alerts: s.summary.active_alerts.filter((a) => a.id !== alertId),
                },
            };
        }),

    reset: () =>
        set({
            summary: null,
            loading: false,
            error: null,
            accessDenied: false,
            timelineEvents: [],
            timelineCursor: null,
            timelineHasMore: true,
            timelineLoading: false,
            showNewNoteDialog: false,
            showNewOrderDialog: false,
        }),
}));
