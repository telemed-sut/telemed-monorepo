"use client";

import { useCallback, useRef } from "react";

import { toast } from "@/components/ui/toast";

export function useSettingsValidationToasts() {
  const activeValidationToastIdsRef = useRef(new Set<string>());

  const dismissValidationToast = useCallback((id: string) => {
    activeValidationToastIdsRef.current.delete(id);
    toast.dismiss(id);
  }, []);

  const showValidationToastOnce = useCallback((id: string, title: string) => {
    if (activeValidationToastIdsRef.current.has(id)) {
      return;
    }

    activeValidationToastIdsRef.current.add(id);
    toast.error(title, {
      id,
      onDismiss: () => {
        activeValidationToastIdsRef.current.delete(id);
      },
      onAutoClose: () => {
        activeValidationToastIdsRef.current.delete(id);
      },
    });
  }, []);

  return {
    dismissValidationToast,
    showValidationToastOnce,
  };
}
