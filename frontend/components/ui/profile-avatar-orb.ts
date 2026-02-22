import type { CSSProperties } from "react";

const SYSTEM_ORB_PALETTES = [
  { highlight: "#edf8ff", mid: "#d5ecfb", edge: "#a9d2ee", glow: "#f7fbff" },
  { highlight: "#ecf5ff", mid: "#d4e6fa", edge: "#a9c8e9", glow: "#f4f9ff" },
  { highlight: "#ebf8f6", mid: "#d1efe8", edge: "#a6dacd", glow: "#f4fbf8" },
  { highlight: "#eef3ff", mid: "#dae4fb", edge: "#b6c8ee", glow: "#f7f9ff" },
  { highlight: "#f0f6fb", mid: "#dce9f6", edge: "#b8cee4", glow: "#f8fbff" },
  { highlight: "#eef9f3", mid: "#d7f0e2", edge: "#b3dcc6", glow: "#f6fcf9" },
  { highlight: "#f7f2ec", mid: "#ecdfd3", edge: "#d7bfad", glow: "#fbf7f3" },
  { highlight: "#f3f6fb", mid: "#e2e9f4", edge: "#c2cedf", glow: "#fafcff" },
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
  const seed = parts
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join("|");
  return seed || "profile-orb-default";
}

export function getProfileOrbStyle(seed: string): CSSProperties {
  const hash = hashSeed(seed);
  const palette = SYSTEM_ORB_PALETTES[hash % SYSTEM_ORB_PALETTES.length];
  const angle = 128 + ((hash >> 6) % 24);
  const bloomX = 66 + ((hash >> 11) % 12);
  const bloomY = 72 + ((hash >> 16) % 10);

  const gradient = `radial-gradient(circle at 28% 24%, ${palette.highlight} 0%, ${palette.mid} 54%, ${palette.edge} 100%), radial-gradient(circle at ${bloomX}% ${bloomY}%, ${palette.glow} 0%, transparent 52%), linear-gradient(${angle}deg, color-mix(in srgb, var(--med-primary-light) 22%, transparent) 0%, transparent 64%)`;

  return {
    backgroundImage: gradient,
    boxShadow:
      "inset 0 1px 2px rgba(255,255,255,0.55), inset 0 -1px 2px rgba(15,23,42,0.05), 0 0 0 1px color-mix(in srgb, var(--med-primary-dark) 14%, white)",
  };
}
