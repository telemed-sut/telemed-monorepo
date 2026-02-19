"use client";

import { useEffect } from "react";

import { useLanguageStore } from "@/store/language-store";

export function LanguageInitializer() {
  const hydrate = useLanguageStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return null;
}
