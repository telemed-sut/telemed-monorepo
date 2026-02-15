import { create } from "zustand";

export type LayoutDensity = "default" | "compact" | "comfortable";

interface DashboardState {
  searchQuery: string;
  departmentFilter: string;
  statusFilter: string;
  setSearchQuery: (query: string) => void;
  setDepartmentFilter: (filter: string) => void;
  setStatusFilter: (filter: string) => void;
  clearFilters: () => void;

  // Overview layout options
  showAlertBanner: boolean;
  showStatsCards: boolean;
  showChart: boolean;
  showTable: boolean;
  layoutDensity: LayoutDensity;
  setShowAlertBanner: (show: boolean) => void;
  setShowStatsCards: (show: boolean) => void;
  setShowChart: (show: boolean) => void;
  setShowTable: (show: boolean) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  resetLayout: () => void;

  // Patients page layout
  showPatientStats: boolean;
  showPatientTable: boolean;
  setShowPatientStats: (show: boolean) => void;
  setShowPatientTable: (show: boolean) => void;
  resetPatientsLayout: () => void;

  // Users page layout
  showUserStats: boolean;
  showUserCharts: boolean;
  showUserTable: boolean;
  setShowUserStats: (show: boolean) => void;
  setShowUserCharts: (show: boolean) => void;
  setShowUserTable: (show: boolean) => void;
  resetUsersLayout: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  searchQuery: "",
  departmentFilter: "all",
  statusFilter: "all",
  setSearchQuery: (query) => set({ searchQuery: query }),
  setDepartmentFilter: (filter) => set({ departmentFilter: filter }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  clearFilters: () =>
    set({
      searchQuery: "",
      departmentFilter: "all",
      statusFilter: "all",
    }),

  // Overview layout options
  showAlertBanner: true,
  showStatsCards: true,
  showChart: true,
  showTable: true,
  layoutDensity: "default",
  setShowAlertBanner: (show) => set({ showAlertBanner: show }),
  setShowStatsCards: (show) => set({ showStatsCards: show }),
  setShowChart: (show) => set({ showChart: show }),
  setShowTable: (show) => set({ showTable: show }),
  setLayoutDensity: (density) => set({ layoutDensity: density }),
  resetLayout: () =>
    set({
      showAlertBanner: true,
      showStatsCards: true,
      showChart: true,
      showTable: true,
      layoutDensity: "default",
    }),

  // Patients page layout
  showPatientStats: true,
  showPatientTable: true,
  setShowPatientStats: (show) => set({ showPatientStats: show }),
  setShowPatientTable: (show) => set({ showPatientTable: show }),
  resetPatientsLayout: () =>
    set({
      showPatientStats: true,
      showPatientTable: true,
    }),

  // Users page layout
  showUserStats: true,
  showUserCharts: true,
  showUserTable: true,
  setShowUserStats: (show) => set({ showUserStats: show }),
  setShowUserCharts: (show) => set({ showUserCharts: show }),
  setShowUserTable: (show) => set({ showUserTable: show }),
  resetUsersLayout: () =>
    set({
      showUserStats: true,
      showUserCharts: true,
      showUserTable: true,
    }),
}));
