"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

import { toast } from "@/components/ui/toast";
import {
  disable2FA,
  fetch2FAStatus,
  fetchTrustedDevices,
  getErrorMessage,
  regenerateBackupCodes,
  reset2FA,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  verify2FA,
  type Admin2FAStatus,
  type TrustedDevice,
} from "@/lib/api";
import {
  deletePasskey,
  isPasskeyCeremonyCancelled,
  listPasskeys,
  registerNewPasskey,
  type PasskeyOut,
} from "@/lib/api-passkeys";

import type { SensitiveReauthRequest, SettingsLanguage } from "./settings-types";
import {
  SETTINGS_VALIDATION_TOAST_IDS,
  isInvalidTwoFactorCodeError,
  tr,
} from "./settings-utils";

interface UseSettingsSecurityOptions {
  token: string | null;
  hydrated: boolean;
  language: SettingsLanguage;
  isAdmin: boolean;
  mfaAuthenticatedAt: string | null;
  sensitiveReauthOpen: boolean;
  dismissValidationToast: (id: string) => void;
  showValidationToastOnce: (id: string, title: string) => void;
  handleSensitiveActionError: (
    error: unknown,
    request: SensitiveReauthRequest,
  ) => boolean;
}

export function useSettingsSecurity({
  token,
  hydrated,
  language,
  isAdmin,
  mfaAuthenticatedAt,
  sensitiveReauthOpen,
  dismissValidationToast,
  showValidationToastOnce,
  handleSensitiveActionError,
}: UseSettingsSecurityOptions) {
  const [twoFA, setTwoFA] = useState<Admin2FAStatus | null>(null);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [twoFABusy, setTwoFABusy] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [trustedLoading, setTrustedLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyOut[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [securitySectionOpen, setSecuritySectionOpen] = useState<
    "authenticator" | "passkeys" | "backup-codes" | "trusted-devices" | null
  >("authenticator");

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

  const load2FAStatus = useCallback(async () => {
    if (!token) return;
    setTwoFALoading(true);
    try {
      const status = await fetch2FAStatus(token);
      setTwoFA(status);
    } catch (error: unknown) {
      showGenericError(error);
    } finally {
      setTwoFALoading(false);
    }
  }, [showGenericError, token]);

  const loadTrustedDevices = useCallback(async () => {
    if (!token) return;
    setTrustedLoading(true);
    try {
      const response = await fetchTrustedDevices(token);
      setTrustedDevices(response.items);
    } catch (error: unknown) {
      showGenericError(error);
    } finally {
      setTrustedLoading(false);
    }
  }, [showGenericError, token]);

  const loadPasskeys = useCallback(async () => {
    if (!token) return;
    setPasskeyLoading(true);
    try {
      const response = await listPasskeys();
      setPasskeys(response.items);
    } catch (error: unknown) {
      showGenericError(error);
    } finally {
      setPasskeyLoading(false);
    }
  }, [showGenericError, token]);

  useEffect(() => {
    if (!hydrated || !token) return;
    void load2FAStatus();
    void loadTrustedDevices();
    void loadPasskeys();
  }, [hydrated, load2FAStatus, loadPasskeys, loadTrustedDevices, token]);

  useEffect(() => {
    let cancelled = false;

    async function buildQr() {
      if (!twoFA?.provisioning_uri) {
        setQrCodeDataUrl(null);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(twoFA.provisioning_uri, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrCodeDataUrl(null);
        }
      }
    }

    void buildQr();

    return () => {
      cancelled = true;
    };
  }, [twoFA?.provisioning_uri]);

  const hasVerifyCode = verifyCode.trim().length > 0;
  const hasResetCode = resetCode.trim().length > 0;
  const hasDisableCode = disableCode.trim().length > 0;

  const securityHeaderSummary = useMemo(() => {
    if (!twoFA) {
      return tr(language, "Unable to load status", "โหลดสถานะไม่สำเร็จ");
    }

    const requirement = twoFA.required
      ? tr(language, "Required", "บังคับ")
      : tr(language, "Optional", "ไม่บังคับ");
    const trustedDays = twoFA.trusted_device_days ?? (isAdmin ? 1 : 7);

    return `${
      twoFA.enabled
        ? tr(language, "Enabled", "เปิดใช้งาน")
        : tr(language, "Not enabled", "ยังไม่เปิดใช้งาน")
    } • ${requirement} • ${trustedDays}${tr(language, "d", "วัน")}`;
  }, [isAdmin, language, twoFA]);

  const authenticatorSummary = useMemo(() => {
    if (!twoFA) {
      return tr(language, "Unavailable", "ไม่พร้อมใช้งาน");
    }

    if (twoFA.setup_required || twoFA.provisioning_uri) {
      return tr(language, "Needs verification", "รอยืนยัน");
    }

    return twoFA.enabled
      ? tr(language, "Ready", "พร้อมใช้งาน")
      : tr(language, "Not enabled", "ยังไม่เปิดใช้งาน");
  }, [language, twoFA]);

  const backupCodesSummary = backupCodes.length
    ? tr(
        language,
        `${backupCodes.length} codes ready`,
        `มี ${backupCodes.length} โค้ด`,
      )
    : tr(language, "No backup codes", "ยังไม่มีโค้ด");

  const trustedDevicesSummary = trustedLoading
    ? tr(language, "Loading...", "กำลังโหลด...")
    : trustedDevices.length
      ? tr(
          language,
          `${trustedDevices.length} devices`,
          `${trustedDevices.length} อุปกรณ์`,
        )
      : tr(language, "No devices", "ไม่มีอุปกรณ์");

  const currentTrustedDevice = useMemo(
    () => trustedDevices.find((device) => device.current_device) ?? null,
    [trustedDevices],
  );

  const handleVerifyCodeChange = useCallback(
    (value: string) => {
      setVerifyCode(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.verify2FA);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.verify2FAInvalid);
    },
    [dismissValidationToast],
  );

  const handleResetCodeChange = useCallback(
    (value: string) => {
      setResetCode(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.reset2FA);
    },
    [dismissValidationToast],
  );

  const handleDisableCodeChange = useCallback(
    (value: string) => {
      setDisableCode(value);
      dismissValidationToast(SETTINGS_VALIDATION_TOAST_IDS.disable2FA);
    },
    [dismissValidationToast],
  );

  const handleVerify2FA = useCallback(async () => {
    if (!token || twoFABusy) return;
    if (!hasVerifyCode) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.verify2FA,
        tr(language, "Please enter 2FA code", "กรุณากรอกรหัส 2FA"),
      );
      return;
    }

    setTwoFABusy(true);
    try {
      await verify2FA(verifyCode, token);
      toast.success(
        tr(language, "2FA verified successfully", "ยืนยัน 2FA สำเร็จ"),
      );
      setVerifyCode("");
      await load2FAStatus();
    } catch (error: unknown) {
      if (isInvalidTwoFactorCodeError(error)) {
        showValidationToastOnce(
          SETTINGS_VALIDATION_TOAST_IDS.verify2FAInvalid,
          getErrorMessage(
            error,
            tr(
              language,
              "Authenticator code or backup code is incorrect.",
              "รหัส 2FA หรือ Backup Code ไม่ถูกต้อง",
            ),
          ),
        );
        return;
      }

      showGenericError(error);
    } finally {
      setTwoFABusy(false);
    }
  }, [
    hasVerifyCode,
    language,
    load2FAStatus,
    showGenericError,
    showValidationToastOnce,
    token,
    twoFABusy,
    verifyCode,
  ]);

  const handleReset2FA = useCallback(async () => {
    if (!token || twoFABusy || sensitiveReauthOpen) return;
    if (twoFA?.enabled && !hasResetCode) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.reset2FA,
        tr(
          language,
          "Please enter current 2FA code",
          "กรุณากรอกรหัส 2FA ปัจจุบัน",
        ),
      );
      return;
    }

    setTwoFABusy(true);
    try {
      const status = await reset2FA(token, {
        current_otp_code: twoFA?.enabled ? resetCode : undefined,
        reason: tr(
          language,
          "Reset from settings page",
          "รีเซ็ตจากหน้าการตั้งค่า",
        ),
      });
      setTwoFA(status);
      setResetCode("");
      setVerifyCode("");
      setBackupCodes([]);
      await loadTrustedDevices();
      toast.success(
        tr(
          language,
          "2FA has been reset. Please scan new QR and verify.",
          "รีเซ็ต 2FA แล้ว กรุณาสแกน QR ใหม่และยืนยัน",
        ),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Reset 2FA", "รีเซ็ต 2FA"),
          run: handleReset2FA,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setTwoFABusy(false);
    }
  }, [
    handleSensitiveActionError,
    hasResetCode,
    language,
    loadTrustedDevices,
    resetCode,
    sensitiveReauthOpen,
    showGenericError,
    showValidationToastOnce,
    token,
    twoFA?.enabled,
    twoFABusy,
  ]);

  const handleDisable2FA = useCallback(async () => {
    if (!token || twoFABusy || sensitiveReauthOpen) return;
    if (!hasDisableCode) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.disable2FA,
        tr(
          language,
          "Please enter current 2FA code to disable",
          "กรุณากรอกรหัส 2FA ปัจจุบันเพื่อปิดระบบ",
        ),
      );
      return;
    }

    setTwoFABusy(true);
    try {
      await disable2FA(disableCode, token);
      setDisableCode("");
      setBackupCodes([]);
      await load2FAStatus();
      await loadTrustedDevices();
      toast.success(tr(language, "2FA disabled", "ปิด 2FA เรียบร้อย"));
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Disable 2FA", "ปิดใช้งาน 2FA"),
          run: handleDisable2FA,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setTwoFABusy(false);
    }
  }, [
    disableCode,
    handleSensitiveActionError,
    hasDisableCode,
    language,
    load2FAStatus,
    loadTrustedDevices,
    sensitiveReauthOpen,
    showGenericError,
    showValidationToastOnce,
    token,
    twoFABusy,
  ]);

  const handleRegisterPasskey = useCallback(async () => {
    if (!token || passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      const name = `${tr(language, "My Device", "อุปกรณ์ของฉัน")} (${new Date().toLocaleDateString()})`;
      await registerNewPasskey(name);
      toast.success(
        tr(language, "Passkey registered successfully", "ลงทะเบียน Passkey สำเร็จแล้ว"),
      );
      await loadPasskeys();
    } catch (error: unknown) {
      if (isPasskeyCeremonyCancelled(error)) {
        return;
      }
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Failed to register Passkey",
            "ไม่สามารถลงทะเบียน Passkey ได้",
          ),
        ),
      );
    } finally {
      setPasskeyBusy(false);
    }
  }, [language, loadPasskeys, passkeyBusy, token]);

  const handleDeletePasskey = useCallback(
    async (passkeyId: string) => {
      if (!token || passkeyBusy) return;
      setPasskeyBusy(true);
      try {
        await deletePasskey(passkeyId);
        toast.success(tr(language, "Passkey deleted", "ลบ Passkey เรียบร้อยแล้ว"));
        await loadPasskeys();
      } catch (error: unknown) {
        toast.error(
          getErrorMessage(
            error,
            tr(
              language,
              "Failed to delete Passkey",
              "ไม่สามารถลบ Passkey ได้",
            ),
          ),
        );
      } finally {
        setPasskeyBusy(false);
      }
    },
    [language, loadPasskeys, passkeyBusy, token],
  );

  const handleRegenerateBackupCodes = useCallback(async () => {
    if (!token || twoFABusy || sensitiveReauthOpen) return;
    setTwoFABusy(true);
    try {
      const response = await regenerateBackupCodes(token);
      setBackupCodes(response.codes);
      toast.success(
        tr(
          language,
          "Backup codes regenerated. Save them now.",
          "สร้าง Backup Codes ใหม่แล้ว กรุณาบันทึกไว้ทันที",
        ),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Generate / Regenerate", "สร้าง / สร้างใหม่"),
          run: handleRegenerateBackupCodes,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setTwoFABusy(false);
    }
  }, [
    handleSensitiveActionError,
    language,
    sensitiveReauthOpen,
    showGenericError,
    token,
    twoFABusy,
  ]);

  const handleCopyBackupCodes = useCallback(async () => {
    if (backupCodes.length === 0) {
      toast.error(tr(language, "No backup codes yet", "ยังไม่มี Backup Codes"));
      return;
    }
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      toast.success(
        tr(language, "Backup codes copied", "คัดลอก Backup Codes แล้ว"),
      );
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  }, [backupCodes, language]);

  const handleDownloadBackupCodes = useCallback(() => {
    if (backupCodes.length === 0) {
      toast.error(tr(language, "No backup codes yet", "ยังไม่มี Backup Codes"));
      return;
    }
    const blob = new Blob([backupCodes.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = tr(language, "backup-codes.txt", "รหัสสำรอง-2fa.txt");
    link.click();
    URL.revokeObjectURL(url);
    toast.success(
      tr(language, "Backup codes downloaded", "ดาวน์โหลด Backup Codes แล้ว"),
    );
  }, [backupCodes, language]);

  const handleRevokeTrustedDevice = useCallback(
    async (deviceId: string) => {
      if (!token || twoFABusy || sensitiveReauthOpen) return;
      setTwoFABusy(true);
      try {
        await revokeTrustedDevice(deviceId, token);
        await loadTrustedDevices();
        toast.success(
          tr(language, "Trusted device revoked", "ยกเลิกอุปกรณ์ที่เชื่อถือแล้ว"),
        );
      } catch (error: unknown) {
        if (
          handleSensitiveActionError(error, {
            actionLabel: tr(language, "Revoke", "เพิกถอน"),
            run: async () => handleRevokeTrustedDevice(deviceId),
          })
        ) {
          return;
        }

        showGenericError(error);
      } finally {
        setTwoFABusy(false);
      }
    },
    [
      handleSensitiveActionError,
      language,
      loadTrustedDevices,
      sensitiveReauthOpen,
      showGenericError,
      token,
      twoFABusy,
    ],
  );

  const handleRevokeAllTrustedDevices = useCallback(async () => {
    if (!token || twoFABusy || sensitiveReauthOpen) return;
    setTwoFABusy(true);
    try {
      await revokeAllTrustedDevices(token);
      await loadTrustedDevices();
      toast.success(
        tr(language, "All trusted devices revoked", "ยกเลิกอุปกรณ์ทั้งหมดแล้ว"),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Revoke All", "เพิกถอนทั้งหมด"),
          run: handleRevokeAllTrustedDevices,
        })
      ) {
        return;
      }

      showGenericError(error);
    } finally {
      setTwoFABusy(false);
    }
  }, [
    handleSensitiveActionError,
    language,
    loadTrustedDevices,
    sensitiveReauthOpen,
    showGenericError,
    token,
    twoFABusy,
  ]);

  return {
    twoFA,
    twoFALoading,
    twoFABusy,
    verifyCode,
    resetCode,
    disableCode,
    qrCodeDataUrl,
    backupCodes,
    trustedDevices,
    trustedLoading,
    passkeys,
    passkeyLoading,
    passkeyBusy,
    securitySectionOpen,
    setSecuritySectionOpen,
    securityHeaderSummary,
    authenticatorSummary,
    backupCodesSummary,
    trustedDevicesSummary,
    currentTrustedDevice,
    mfaAuthenticatedAt,
    handleVerifyCodeChange,
    handleResetCodeChange,
    handleDisableCodeChange,
    handleVerify2FA,
    handleReset2FA,
    handleDisable2FA,
    handleRegisterPasskey,
    handleDeletePasskey,
    handleRegenerateBackupCodes,
    handleCopyBackupCodes,
    handleDownloadBackupCodes,
    handleRevokeTrustedDevice,
    handleRevokeAllTrustedDevices,
    refreshTrustedDevices: loadTrustedDevices,
  };
}
