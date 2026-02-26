import type { CSSProperties } from "react";

const PROFILE_ORB_GRADIENTS = [
  "radial-gradient(circle at 30% 25%, #fee2e2 0%, #fca5a5 45%, #f43f5e 100%)",
  "radial-gradient(circle at 30% 25%, #ffedd5 0%, #fdba74 45%, #f97316 100%)",
  "radial-gradient(circle at 30% 25%, #fef9c3 0%, #fde047 45%, #eab308 100%)",
  "radial-gradient(circle at 30% 25%, #dcfce7 0%, #86efac 45%, #22c55e 100%)",
  "radial-gradient(circle at 30% 25%, #ccfbf1 0%, #5eead4 45%, #14b8a6 100%)",
  "radial-gradient(circle at 30% 25%, #dbeafe 0%, #93c5fd 45%, #3b82f6 100%)",
  "radial-gradient(circle at 30% 25%, #e0e7ff 0%, #a5b4fc 45%, #6366f1 100%)",
  "radial-gradient(circle at 30% 25%, #f3e8ff 0%, #d8b4fe 45%, #a855f7 100%)",
  "radial-gradient(circle at 30% 25%, #fae8ff 0%, #f0abfc 45%, #d946ef 100%)",
  "radial-gradient(circle at 30% 25%, #ffe4e6 0%, #fda4af 45%, #fb7185 100%)",
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function buildProfileSeed(
  ...parts: Array<string | null | undefined>
): string {
  const seed = parts.filter((part) => typeof part === "string" && part.trim().length > 0).join("|");
  return seed || "profile-orb-default";
}

export function getProfileOrbStyle(seed: string): CSSProperties {
  const gradient = PROFILE_ORB_GRADIENTS[hashSeed(seed) % PROFILE_ORB_GRADIENTS.length];
  return {
    backgroundImage: gradient,
    boxShadow:
      "inset 0 1px 2px rgba(255,255,255,0.45), 0 0 0 1px color-mix(in srgb, #94a3b8 30%, transparent)",
  };
}
