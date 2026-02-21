"use client";

import { useEffect } from "react";
import { applyUITone, getStoredUITone } from "@/lib/ui-tone";

export function UIToneInitializer() {
  useEffect(() => {
    applyUITone(getStoredUITone());
  }, []);

  return null;
}
