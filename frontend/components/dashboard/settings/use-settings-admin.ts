"use client";

import { useCallback, useMemo, useState } from "react";

import { toast } from "@/components/ui/toast";
import {
  adminEmergencyUnlock,
  createUserInvite,
  getErrorMessage,
  resolveSecurityUserByEmail,
  superAdminResetUser2FA,
  superAdminResetUserPassword,
  type AdminSecurityUserLookup,
} from "@/lib/api";

import type { SensitiveReauthRequest, SettingsLanguage } from "./settings-types";
import { SETTINGS_VALIDATION_TOAST_IDS, tr } from "./settings-utils";

interface UseSettingsAdminOptions {
  token: string | null;
  language: SettingsLanguage;
  isAdmin: boolean;
  canManagePrivilegedAdmins: boolean;
  canManageSecurityRecovery: boolean;
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
  isAdmin,
  canManagePrivilegedAdmins,
  canManageSecurityRecovery,
  sensitiveReauthOpen,
  dismissValidationToast,
  showValidationToastOnce,
  handleSensitiveActionError,
}: UseSettingsAdminOptions) {
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [resolvedUser, setResolvedUser] =
    useState<AdminSecurityUserLookup | null>(null);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [generatedResetToken, setGeneratedResetToken] = useState("");
  const [generatedResetTokenTTL, setGeneratedResetTokenTTL] = useState<
    number | null
  >(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminInviteReason, setAdminInviteReason] = useState("");
  const [createdAdminInviteEmail, setCreatedAdminInviteEmail] = useState("");
  const [createdAdminInviteUrl, setCreatedAdminInviteUrl] = useState("");
  const [createdAdminInviteExpiresAt, setCreatedAdminInviteExpiresAt] =
    useState<string | null>(null);
  const [adminToolsExpanded, setAdminToolsExpanded] = useState(false);
  const [adminSectionOpen, setAdminSectionOpen] = useState<
    "onboarding" | "emergency" | null
  >(null);

  const normalizedTargetEmail = targetEmail.trim().toLowerCase();
  const hasTargetEmail = normalizedTargetEmail.length > 0;
  const hasEmergencyReason = emergencyReason.trim().length >= 8;
  const normalizedAdminInviteEmail = newAdminEmail.trim().toLowerCase();
  const hasAdminInviteEmail = normalizedAdminInviteEmail.length > 0;
  const hasAdminInviteReason = adminInviteReason.trim().length >= 8;

  const adminToolsSummary = useMemo(() => {
    const parts: string[] = [];
    if (canManagePrivilegedAdmins) {
      parts.push(tr(language, "Onboarding", "เชิญแอดมิน"));
    }
    if (isAdmin && canManageSecurityRecovery) {
      parts.push(tr(language, "Emergency recovery", "กู้คืนฉุกเฉิน"));
    }
    return parts.join(" • ");
  }, [
    canManagePrivilegedAdmins,
    canManageSecurityRecovery,
    isAdmin,
    language,
  ]);

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

  const handleTargetEmailChange = useCallback(
    (value: string) => {
      setTargetEmail(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.resolveUser);
      setResolvedUser(null);
      setGeneratedResetToken("");
      setGeneratedResetTokenTTL(null);
    },
    [dismissValidationToast],
  );

  const handleEmergencyReasonChange = useCallback(
    (value: string) => {
      setEmergencyReason(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.emergencyReason);
    },
    [dismissValidationToast],
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

  const resolveEmergencyTarget = useCallback(async () => {
    if (!token || emergencyBusy) return;
    if (!hasTargetEmail) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.resolveUser,
        tr(language, "Please enter user email", "กรุณากรอกอีเมลผู้ใช้งาน"),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      const user = await resolveSecurityUserByEmail(normalizedTargetEmail, token);
      setResolvedUser(user);
      toast.success(tr(language, "User found", "พบผู้ใช้แล้ว"));
    } catch (error: unknown) {
      setResolvedUser(null);
      showGenericError(error);
    } finally {
      setEmergencyBusy(false);
    }
  }, [
    emergencyBusy,
    hasTargetEmail,
    language,
    normalizedTargetEmail,
    showGenericError,
    showValidationToastOnce,
    token,
  ]);

  const handleEmergencyUnlock = useCallback(async () => {
    if (!token || emergencyBusy || sensitiveReauthOpen) return;
    if (!hasTargetEmail) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.resolveUser,
        tr(language, "Please enter user email", "กรุณากรอกอีเมลผู้ใช้งาน"),
      );
      return;
    }
    if (!hasEmergencyReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      await adminEmergencyUnlock(
        { email: normalizedTargetEmail, reason: emergencyReason.trim() },
        token,
      );
      toast.success(tr(language, "Account unlocked", "ปลดล็อกบัญชีเรียบร้อย"));
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Unlock account", "ปลดล็อกบัญชี"),
          run: handleEmergencyUnlock,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setEmergencyBusy(false);
    }
  }, [
    emergencyBusy,
    emergencyReason,
    handleSensitiveActionError,
    hasEmergencyReason,
    hasTargetEmail,
    language,
    normalizedTargetEmail,
    resolveEmergencyTarget,
    sensitiveReauthOpen,
    showGenericError,
    showValidationToastOnce,
    token,
  ]);

  const handleEmergencyReset2FA = useCallback(async () => {
    if (!token || !resolvedUser || emergencyBusy || sensitiveReauthOpen) {
      return;
    }
    if (!hasEmergencyReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      await superAdminResetUser2FA(
        resolvedUser.user_id,
        emergencyReason.trim(),
        token,
      );
      toast.success(
        tr(language, "User 2FA reset successfully", "รีเซ็ต 2FA ให้ผู้ใช้แล้ว"),
      );
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Reset 2FA", "รีเซ็ต 2FA"),
          run: handleEmergencyReset2FA,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setEmergencyBusy(false);
    }
  }, [
    emergencyBusy,
    emergencyReason,
    handleSensitiveActionError,
    hasEmergencyReason,
    language,
    resolveEmergencyTarget,
    resolvedUser,
    sensitiveReauthOpen,
    showGenericError,
    showValidationToastOnce,
    token,
  ]);

  const handleEmergencyResetPassword = useCallback(async () => {
    if (!token || !resolvedUser || emergencyBusy || sensitiveReauthOpen) {
      return;
    }
    if (!hasEmergencyReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      const response = await superAdminResetUserPassword(
        resolvedUser.user_id,
        emergencyReason.trim(),
        token,
      );
      setGeneratedResetToken(response.reset_token);
      setGeneratedResetTokenTTL(response.reset_token_expires_in);
      toast.success(
        tr(
          language,
          "Password reset token generated",
          "สร้างโทเคนรีเซ็ตรหัสผ่านแล้ว",
        ),
      );
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Reset password", "รีเซ็ตรหัสผ่าน"),
          run: handleEmergencyResetPassword,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setEmergencyBusy(false);
    }
  }, [
    emergencyBusy,
    emergencyReason,
    handleSensitiveActionError,
    hasEmergencyReason,
    language,
    resolveEmergencyTarget,
    resolvedUser,
    sensitiveReauthOpen,
    showGenericError,
    showValidationToastOnce,
    token,
  ]);

  const handleCopyGeneratedResetToken = useCallback(async () => {
    if (!generatedResetToken) return;
    try {
      await navigator.clipboard.writeText(generatedResetToken);
      toast.success(
        tr(language, "Reset token copied", "คัดลอกโทเคนรีเซ็ตรหัสผ่านแล้ว"),
      );
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  }, [generatedResetToken, language]);

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
    emergencyBusy,
    targetEmail,
    emergencyReason,
    resolvedUser,
    generatedResetToken,
    generatedResetTokenTTL,
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
    handleTargetEmailChange,
    handleEmergencyReasonChange,
    handleAdminInviteEmailChange,
    handleAdminInviteReasonChange,
    resolveEmergencyTarget,
    handleEmergencyUnlock,
    handleEmergencyReset2FA,
    handleEmergencyResetPassword,
    handleCopyGeneratedResetToken,
    handleCopyCreatedAdminInvite,
    handleCreateAdminOnboarding,
  };
}
