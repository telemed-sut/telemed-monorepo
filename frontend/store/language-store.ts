import { create } from "zustand";

import {
  APP_LANGUAGE_COOKIE_KEY,
  APP_LANGUAGE_STORAGE_KEY,
  applyDocumentLanguage,
  resolveAppLanguage,
  type AppLanguage,
} from "@/store/language-config";

interface LanguageState {
  language: AppLanguage;
  hydrated: boolean;
  hydrate: () => void;
  setLanguage: (language: AppLanguage) => void;
}

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "th";
  const saved = window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
  const cookieLanguage = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${APP_LANGUAGE_COOKIE_KEY}=`))
    ?.split("=")[1];
  const detected = resolveAppLanguage(
    saved || cookieLanguage,
    window.navigator.language
  );
  persistLanguagePreference(detected);
  return detected;
}

function persistLanguagePreference(language: AppLanguage) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
    document.cookie = `${APP_LANGUAGE_COOKIE_KEY}=${language}; path=/; max-age=31536000; samesite=lax`;
  }
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: "th",
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const language = getInitialLanguage();
    applyDocumentLanguage(language);
    set({ language, hydrated: true });
  },
  setLanguage: (language) => {
    persistLanguagePreference(language);
    applyDocumentLanguage(language);
    set({ language, hydrated: true });
  },
}));
