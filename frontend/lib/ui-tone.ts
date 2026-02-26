export type UITone =
  | "ffffff"
  | "ece7d1"
  | "f7f8f0"
  | "fff4ea"
  | "fffdf1"
  | "faf3e1";

const UI_TONE_STORAGE_KEY = "ui-tone";

function isUITone(value: string | null): value is UITone {
  return (
    value === "ffffff" ||
    value === "ece7d1" ||
    value === "f7f8f0" ||
    value === "fff4ea" ||
    value === "fffdf1" ||
    value === "faf3e1"
  );
}

export function getStoredUITone(): UITone {
  if (typeof window === "undefined") return "ffffff";
  try {
    const stored = window.localStorage.getItem(UI_TONE_STORAGE_KEY);
    if (isUITone(stored)) return stored;
    if (stored === "soft" || stored === "classic") return "ffffff";
    return "ffffff";
  } catch {
    return "ffffff";
  }
}

export function applyUITone(tone: UITone): void {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-ui-tone", tone);

  try {
    window.localStorage.setItem(UI_TONE_STORAGE_KEY, tone);
  } catch {
    // no-op
  }
}
