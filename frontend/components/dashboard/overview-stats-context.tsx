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
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OverviewStatsResponse | null>(null);

  useEffect(() => {
    if (!token) {
      setStats(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void fetchOverviewStats(token)
      .then((response) => {
        if (active) {
          setStats(response);
        }
      })
      .catch(() => {
        if (active) {
          setStats(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  const value = useMemo(
    () => ({
      loading,
      stats,
    }),
    [loading, stats]
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
