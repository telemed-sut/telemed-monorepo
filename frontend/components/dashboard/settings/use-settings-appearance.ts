"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/ui/toast";
import {
  DEFAULT_APPEARANCE,
  areAppearanceSettingsEqual,
  getAppearancePreviewPalette,
  getStoredAppearance,
  persistAppearance,
  type AppearanceSettings,
} from "@/lib/appearance";

import type { SettingsLanguage } from "./settings-types";
import { tr } from "./settings-utils";

export function useSettingsAppearance(language: SettingsLanguage) {
  const [appearanceDraft, setAppearanceDraft] =
    useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [savedAppearance, setSavedAppearance] =
    useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [appearanceExpanded, setAppearanceExpanded] = useState(true);

  useEffect(() => {
    const appearance = getStoredAppearance();
    queueMicrotask(() => {
      setAppearanceDraft(appearance);
      setSavedAppearance(appearance);
      setAppearanceReady(true);
    });
  }, []);

  const appearancePreview = useMemo(
    () => getAppearancePreviewPalette(appearanceDraft.theme),
    [appearanceDraft.theme],
  );

  const hasAppearanceChanges = useMemo(
    () =>
      appearanceReady &&
      !areAppearanceSettingsEqual(appearanceDraft, savedAppearance),
    [appearanceDraft, appearanceReady, savedAppearance],
  );

  const updateAppearanceDraft = useCallback(
    <K extends keyof AppearanceSettings>(
      key: K,
      value: AppearanceSettings[K],
    ) => {
      setAppearanceDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleApplyAppearance = useCallback(() => {
    persistAppearance(appearanceDraft);
    setSavedAppearance(appearanceDraft);
    toast.success(
      tr(language, "Appearance updated", "อัปเดตรูปลักษณ์การแสดงผลแล้ว"),
    );
  }, [appearanceDraft, language]);

  const handleResetAppearance = useCallback(() => {
    persistAppearance(DEFAULT_APPEARANCE);
    setAppearanceDraft(DEFAULT_APPEARANCE);
    setSavedAppearance(DEFAULT_APPEARANCE);
    toast.success(
      tr(
        language,
        "Appearance reset to default",
        "รีเซ็ตรูปลักษณ์กลับค่าเริ่มต้นแล้ว",
      ),
    );
  }, [language]);

  return {
    appearanceDraft,
    savedAppearance,
    appearanceReady,
    appearanceExpanded,
    setAppearanceExpanded,
    appearancePreview,
    hasAppearanceChanges,
    updateAppearanceDraft,
    handleApplyAppearance,
    handleResetAppearance,
  };
}
