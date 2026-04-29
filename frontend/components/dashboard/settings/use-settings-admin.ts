"use client";

import { useCallback, useMemo, useState } from "react";

import { toast } from "@/components/ui/toast";
import {
  createUserInvite,
  getErrorMessage,
} from "@/lib/api";

import type { SensitiveReauthRequest, SettingsLanguage } from "./settings-types";
import { SETTINGS_VALIDATION_TOAST_IDS, tr } from "./settings-utils";

interface UseSettingsAdminOptions {
  token: string | null;
  language: SettingsLanguage;
  canManagePrivilegedAdmins: boolean;
  sensitiveReauthOpen: boolean;
  dismissValidationToast: (id: string) => void;
  showValidationToastOnce: (id: string, title: string) => void;
  handleSensitiveActionError: (
    error: unknown,
    request: SensitiveReauthRequest,
  ) => boolean;
}

export function useSettingsAdmin({
  token,
  language,
  canManagePrivilegedAdmins,
  sensitiveReauthOpen,
  dismissValidationToast,
  showValidationToastOnce,
  handleSensitiveActionError,
}: UseSettingsAdminOptions) {
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminInviteReason, setAdminInviteReason] = useState("");
  const [createdAdminInviteEmail, setCreatedAdminInviteEmail] = useState("");
  const [createdAdminInviteUrl, setCreatedAdminInviteUrl] = useState("");
  const [createdAdminInviteExpiresAt, setCreatedAdminInviteExpiresAt] =
    useState<string | null>(null);
  const [adminToolsExpanded, setAdminToolsExpanded] = useState(false);
  const [adminSectionOpen, setAdminSectionOpen] = useState<"onboarding" | null>(
    null,
  );

  const normalizedAdminInviteEmail = newAdminEmail.trim().toLowerCase();
  const hasAdminInviteEmail = normalizedAdminInviteEmail.length > 0;
  const hasAdminInviteReason = adminInviteReason.trim().length >= 8;

  const adminToolsSummary = useMemo(() => {
    if (canManagePrivilegedAdmins) {
      return tr(language, "Onboarding", "เชิญแอดมิน");
    }
    return "";
  }, [canManagePrivilegedAdmins, language]);

  const showGenericError = useCallback(
    (error: unknown) => {
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    },
    [language],
  );

  const handleAdminInviteEmailChange = useCallback(
    (value: string) => {
      setNewAdminEmail(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.adminInviteEmail);
      setCreatedAdminInviteEmail("");
      setCreatedAdminInviteUrl("");
      setCreatedAdminInviteExpiresAt(null);
    },
    [dismissValidationToast],
  );

  const handleAdminInviteReasonChange = useCallback(
    (value: string) => {
      setAdminInviteReason(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.adminInviteReason);
    },
    [dismissValidationToast],
  );

  const handleCopyCreatedAdminInvite = useCallback(async () => {
    if (!createdAdminInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdAdminInviteUrl);
      toast.success(
        tr(language, "Invite link copied", "คัดลอกลิงก์คำเชิญแล้ว"),
      );
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  }, [createdAdminInviteUrl, language]);

  const handleCreateAdminOnboarding = useCallback(async () => {
    if (
      !token ||
      !canManagePrivilegedAdmins ||
      onboardingBusy ||
      sensitiveReauthOpen
    ) {
      return;
    }

    const email = normalizedAdminInviteEmail;
    const reason = adminInviteReason.trim();
    if (!hasAdminInviteEmail) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.adminInviteEmail,
        tr(language, "Please enter admin email", "กรุณากรอกอีเมลแอดมิน"),
      );
      return;
    }
    if (!hasAdminInviteReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.adminInviteReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setOnboardingBusy(true);
    try {
      const invite = await createUserInvite(
        { email, role: "admin", reason },
        token,
      );
      setCreatedAdminInviteEmail(email);
      setCreatedAdminInviteUrl(invite.invite_url);
      setCreatedAdminInviteExpiresAt(invite.expires_at);
      setAdminInviteReason("");
      toast.success(
        tr(language, "Admin invite generated", "สร้างลิงก์คำเชิญแอดมินแล้ว"),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(
            language,
            "Generate admin invite",
            "สร้างลิงก์คำเชิญแอดมิน",
          ),
          run: handleCreateAdminOnboarding,
        })
      ) {
        return;
      }

      setCreatedAdminInviteEmail("");
      setCreatedAdminInviteUrl("");
      setCreatedAdminInviteExpiresAt(null);
      showGenericError(error);
    } finally {
      setOnboardingBusy(false);
    }
  }, [
    adminInviteReason,
    canManagePrivilegedAdmins,
    handleSensitiveActionError,
    hasAdminInviteEmail,
    hasAdminInviteReason,
    language,
    normalizedAdminInviteEmail,
    onboardingBusy,
    sensitiveReauthOpen,
    showGenericError,
    showValidationToastOnce,
    token,
  ]);

  return {
    onboardingBusy,
    newAdminEmail,
    adminInviteReason,
    createdAdminInviteEmail,
    createdAdminInviteUrl,
    createdAdminInviteExpiresAt,
    adminToolsExpanded,
    setAdminToolsExpanded,
    adminSectionOpen,
    setAdminSectionOpen,
    adminToolsSummary,
    handleAdminInviteEmailChange,
    handleAdminInviteReasonChange,
    handleCopyCreatedAdminInvite,
    handleCreateAdminOnboarding,
  };
}
