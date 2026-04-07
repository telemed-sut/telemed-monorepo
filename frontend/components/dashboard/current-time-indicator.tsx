"use client";

import { useEffect, useState } from "react";

import { getCurrentTimePosition } from "@/store/calendar-store";

export function CurrentTimeIndicator() {
  const [top, setTop] = useState(() => getCurrentTimePosition());

  useEffect(() => {
    const interval = setInterval(() => {
      setTop(getCurrentTimePosition());
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{ top }}
    >
      <div className="flex items-center">
        <div className="-ml-[5px] size-2.5 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" />
        <div className="h-[2px] flex-1 bg-rose-500" />
      </div>
    </div>
  );
}
