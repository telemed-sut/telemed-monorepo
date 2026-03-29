"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

const TRANSITION_DURATION_SECONDS = 0.06;
const TRANSITION_EASE: [number, number, number, number] = [
  0.22,
  1,
  0.36,
  1,
];

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        key={pathname}
        initial={
          prefersReducedMotion
            ? { opacity: 1 }
            : { opacity: 0.992 }
        }
        animate={{ opacity: 1 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : {
                duration: TRANSITION_DURATION_SECONDS,
                ease: TRANSITION_EASE,
              }
        }
        className="flex-1 overflow-hidden flex flex-col w-full"
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
