"use client";

import { useEffect } from "react";

import { applyAppearanceAttributes, getStoredAppearance } from "@/lib/appearance";

export function AppearanceInitializer() {
  useEffect(() => {
    applyAppearanceAttributes(getStoredAppearance());
  }, []);

  return null;
}
