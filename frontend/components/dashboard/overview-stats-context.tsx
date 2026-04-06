"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchOverviewStats, type OverviewStatsResponse } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";

interface OverviewStatsContextValue {
  loading: boolean;
  stats: OverviewStatsResponse | null;
}

const OverviewStatsContext = createContext<OverviewStatsContextValue | null>(null);

export function OverviewStatsProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const [stats, setStats] = useState<OverviewStatsResponse | null>(null);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    void fetchOverviewStats(token)
      .then((response) => {
        if (active) {
          setStats(response);
          setLoadedToken(token);
        }
      })
      .catch(() => {
        if (active) {
          setStats(null);
          setLoadedToken(token);
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  const loading = Boolean(token) && loadedToken !== token;
  const resolvedStats = token ? stats : null;

  const value = useMemo(
    () => ({
      loading,
      stats: resolvedStats,
    }),
    [loading, resolvedStats]
  );

  return (
    <OverviewStatsContext.Provider value={value}>
      {children}
    </OverviewStatsContext.Provider>
  );
}

export function useOverviewStats() {
  return useContext(OverviewStatsContext) ?? { loading: true, stats: null };
}
