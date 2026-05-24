"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export default function RippleWaveLoader({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center justify-center gap-1.5", className)}
      aria-hidden="true"
    >
      {Array.from({ length: 7 }).map((_, index) => (
        <motion.div
          key={index}
          className="h-7 w-1.5 rounded-full bg-primary/70"
          animate={{
            scaleY: [0.45, 1.45, 0.45],
            scaleX: [1, 0.82, 1],
            translateY: ["0%", "-14%", "0%"],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "easeInOut",
            delay: index * 0.08,
          }}
        />
      ))}
    </div>
  );
}
