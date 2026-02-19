import { create } from "zustand";

import {
  APP_LANGUAGE_STORAGE_KEY,
  applyDocumentLanguage,
  detectDefaultLanguage,
  isAppLanguage,
  type AppLanguage,
} from "@/store/language-config";

interface LanguageState {
  language: AppLanguage;
  hydrated: boolean;
  hydrate: () => void;
  setLanguage: (language: AppLanguage) => void;
}

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
  if (isAppLanguage(saved)) return saved;

  const detected = detectDefaultLanguage(window.navigator.language);
  window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, detected);
  return detected;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: "en",
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const language = getInitialLanguage();
    applyDocumentLanguage(language);
    set({ language, hydrated: true });
  },
  setLanguage: (language) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
    }
    applyDocumentLanguage(language);
    set({ language, hydrated: true });
  },
}));
