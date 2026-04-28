export type AppearanceTheme =
  | "clinical"
  | "sky"
  | "warm"
  | "calm"
  | "mint"
  | "lavender";
export type AppearanceDensity = "comfortable" | "compact";

export interface AppearanceSettings {
  theme: AppearanceTheme;
  density: AppearanceDensity;
}

export interface AppearancePreviewPalette {
  page: string;
  sidebar: string;
  panel: string;
  panelMuted: string;
  border: string;
  accent: string;
  accentSoft: string;
  accentForeground: string;
  text: string;
  mutedText: string;
}

const APPEARANCE_STORAGE_KEY = "telemed.appearance";
const LEGACY_UI_TONE_STORAGE_KEY = "ui-tone";

export const APPEARANCE_THEMES: AppearanceTheme[] = [
  "clinical",
  "sky",
  "warm",
  "calm",
  "mint",
  "lavender",
];
export const APPEARANCE_DENSITIES: AppearanceDensity[] = ["comfortable", "compact"];

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "clinical",
  density: "comfortable",
};

const LEGACY_TONE_TO_THEME: Partial<Record<string, AppearanceTheme>> = {
  ffffff: "clinical",
  fffdf1: "sky",
  ece7d1: "warm",
  faf3e1: "warm",
  f7f8f0: "calm",
  fff4ea: "lavender",
};

const PREVIEW_PALETTES: Record<AppearanceTheme, AppearancePreviewPalette> = {
  clinical: {
    page: "#ffffff",
    sidebar: "#eef6fd",
    panel: "#ffffff",
    panelMuted: "#f4f7fb",
    border: "#dde6f0",
    accent: "#4988c4",
    accentSoft: "#d9edf9",
    accentForeground: "#ffffff",
    text: "#0f2854",
    mutedText: "#5e7697",
  },
  sky: {
    page: "#fbfdff",
    sidebar: "#eef8fc",
    panel: "#ffffff",
    panelMuted: "#f2f8fb",
    border: "#ddeaf1",
    accent: "#4f95cb",
    accentSoft: "#d8eef9",
    accentForeground: "#ffffff",
    text: "#15384f",
    mutedText: "#64839a",
  },
  warm: {
    page: "#fffaf4",
    sidebar: "#fff0e2",
    panel: "#fffdf9",
    panelMuted: "#faf3e8",
    border: "#eadfce",
    accent: "#a66f4a",
    accentSoft: "#f5dfce",
    accentForeground: "#ffffff",
    text: "#4a2f20",
    mutedText: "#8b6d5b",
  },
  calm: {
    page: "#fbfcfa",
    sidebar: "#eef4ea",
    panel: "#ffffff",
    panelMuted: "#f3f6f1",
    border: "#e2e8df",
    accent: "#6d9a79",
    accentSoft: "#deedde",
    accentForeground: "#ffffff",
    text: "#294030",
    mutedText: "#66796d",
  },
  mint: {
    page: "#fbfffd",
    sidebar: "#ecf8f3",
    panel: "#ffffff",
    panelMuted: "#f1faf6",
    border: "#dcece4",
    accent: "#5fa792",
    accentSoft: "#d9efe6",
    accentForeground: "#ffffff",
    text: "#21423b",
    mutedText: "#63817a",
  },
  lavender: {
    page: "#fcfbff",
    sidebar: "#f3f0ff",
    panel: "#ffffff",
    panelMuted: "#f5f1ff",
    border: "#e3ddf3",
    accent: "#8577c7",
    accentSoft: "#e9e3ff",
    accentForeground: "#ffffff",
    text: "#3c345f",
    mutedText: "#7a7099",
  },
};

function isAppearanceTheme(value: string | null): value is AppearanceTheme {
  return (
    value === "clinical" ||
    value === "sky" ||
    value === "warm" ||
    value === "calm" ||
    value === "mint" ||
    value === "lavender"
  );
}

function isAppearanceDensity(value: string | null): value is AppearanceDensity {
  return value === "comfortable" || value === "compact";
}

function readLegacyTheme(): AppearanceTheme {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE.theme;
  }

  try {
    const legacyTone = window.localStorage.getItem(LEGACY_UI_TONE_STORAGE_KEY);
    return LEGACY_TONE_TO_THEME[legacyTone ?? ""] ?? DEFAULT_APPEARANCE.theme;
  } catch {
    return DEFAULT_APPEARANCE.theme;
  }
}

export function getStoredAppearance(): AppearanceSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE;
  }

  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) {
      return {
        theme: readLegacyTheme(),
        density: DEFAULT_APPEARANCE.density,
      };
    }

    const parsed = JSON.parse(raw) as Partial<
      AppearanceSettings & { mode?: string }
    >;
    const parsedTheme = isAppearanceTheme(parsed.theme ?? null)
      ? parsed.theme
      : undefined;
    const parsedDensity = isAppearanceDensity(parsed.density ?? null)
      ? parsed.density
      : undefined;

    return {
      theme: parsedTheme ?? readLegacyTheme(),
      density: parsedDensity ?? DEFAULT_APPEARANCE.density,
    };
  } catch {
    return {
      theme: readLegacyTheme(),
      density: DEFAULT_APPEARANCE.density,
    };
  }
}

export function saveAppearance(settings: AppearanceSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // no-op
  }
}

export function applyAppearanceAttributes(
  settings: AppearanceSettings,
  root: HTMLElement = document.documentElement
): void {
  root.setAttribute("data-theme", settings.theme);
  root.setAttribute("data-density", settings.density);
  root.removeAttribute("data-mode");
  root.removeAttribute("data-ui-tone");
}

export function persistAppearance(settings: AppearanceSettings): void {
  applyAppearanceAttributes(settings);
  saveAppearance(settings);
}

export function areAppearanceSettingsEqual(
  left: AppearanceSettings,
  right: AppearanceSettings
): boolean {
  return left.theme === right.theme && left.density === right.density;
}

export function getAppearancePreviewPalette(
  theme: AppearanceTheme
): AppearancePreviewPalette {
  return PREVIEW_PALETTES[theme];
}
