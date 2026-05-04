"use client";

import React, { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { th, enGB } from "date-fns/locale";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VitalTrendDataPoint } from "@/lib/api-types";
import type { AppLanguage } from "@/store/language-config";
import { HeartPulse } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface VitalsTrendChartProps {
  data: VitalTrendDataPoint[];
  language: AppLanguage;
  isLoading: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-border/80 bg-background px-4 py-3 shadow-md">
        <p className="mb-2 text-sm font-semibold text-foreground">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry) => (
            <div key={entry.dataKey} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <div
                  className="size-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}
              </span>
              <span className="text-sm font-medium tabular-nums text-foreground">
                {entry.value} {entry.dataKey === "weight_kg" ? "kg" : "BPM"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export function VitalsTrendChart({ data, language, isLoading }: VitalsTrendChartProps) {
  const isThai = language === "th";
  const dateLocale = isThai ? th : enGB;

  const formattedData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      formattedDate: format(parseISO(d.date), "d MMM", { locale: dateLocale }),
    }));
  }, [data, dateLocale]);

  const hasWeightData = useMemo(() => data.some((d) => d.weight_kg != null), [data]);
  const hasHeartRateData = useMemo(() => data.some((d) => d.heart_rate != null), [data]);

  if (isLoading) {
    return (
      <Card className="rounded-[28px] border-border/70 shadow-sm">
        <CardHeader>
          <Skeleton className="h-6 w-48 rounded-lg" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  if (!hasWeightData && !hasHeartRateData) {
    return (
      <Card className="rounded-[28px] border-border/70 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="rounded-xl bg-muted/40 p-4 text-muted-foreground mb-4 ring-1 ring-border/80">
            <HeartPulse className="h-8 w-8" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {isThai ? "ยังไม่มีข้อมูลกราฟแนวโน้ม" : "No trend data available"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {isThai
              ? "ระบบจะแสดงผลกราฟเมื่อมีข้อมูลน้ำหนักหรือชีพจรเข้าสู่ระบบ"
              : "Trends will appear here once vitals are recorded."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[28px] border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {isThai ? "แนวโน้มสัญญาณชีพ" : "Vital Trends"}
          </p>
          <CardTitle className="text-lg">
            {isThai ? "ข้อมูลน้ำหนักและอัตราการเต้นหัวใจ 30 วัน" : "Weight & Heart Rate (30 Days)"}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="formattedDate"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                dy={10}
              />
              <YAxis
                yAxisId="left"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(value) => `${value}`}
                domain={["auto", "auto"]}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                domain={["auto", "auto"]}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "hsl(var(--border))", strokeWidth: 2 }} />
              {hasWeightData && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="weight_kg"
                  name={isThai ? "น้ำหนัก" : "Weight"}
                  stroke="#10b981" // emerald-500
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                  connectNulls
                />
              )}
              {hasHeartRateData && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="heart_rate"
                  name={isThai ? "อัตราการเต้นหัวใจ" : "Heart Rate"}
                  stroke="#ef4444" // red-500
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#ef4444", strokeWidth: 0 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
