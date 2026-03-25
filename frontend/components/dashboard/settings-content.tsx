"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminEmergencyUnlock,
  createUserInvite,
  disable2FA,
  fetch2FAStatus,
  fetchTrustedDevices,
  getErrorMessage,
  logout,
  regenerateBackupCodes,
  resolveSecurityUserByEmail,
  reset2FA,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  superAdminResetUser2FA,
  superAdminResetUserPassword,
  verify2FA,
  getRoleLabel,
  type AdminSecurityUserLookup,
  type Admin2FAStatus,
  type TrustedDevice,
} from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";
import {
  applyUITone,
  getStoredUITone,
  type UITone,
} from "@/lib/ui-tone";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const UI_TONE_OPTIONS: UITone[] = [
  "ffffff",
  "ece7d1",
  "f7f8f0",
  "fff4ea",
  "fffdf1",
  "faf3e1",
];

function extractSetupKey(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("secret");
  } catch {
    return null;
  }
}

function formatDateTime(
  value: string | null | undefined,
  language: AppLanguage
): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SettingsContent() {
  const router = useRouter();
  const language = useLanguageStore((state) => state.language);
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const getTokenTTL = useAuthStore((state) => state.getTokenTTL);

  const [tokenTTL, setTokenTTL] = useState(() => getTokenTTL());
  const [uiTone, setUiTone] = useState<UITone>("ffffff");
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
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [resolvedUser, setResolvedUser] = useState<AdminSecurityUserLookup | null>(null);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [generatedResetToken, setGeneratedResetToken] = useState("");
  const [generatedResetTokenTTL, setGeneratedResetTokenTTL] = useState<number | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [createdAdminInviteEmail, setCreatedAdminInviteEmail] = useState("");
  const [createdAdminInviteUrl, setCreatedAdminInviteUrl] = useState("");
  const [createdAdminInviteExpiresAt, setCreatedAdminInviteExpiresAt] = useState<string | null>(null);

  const isAdmin = role === "admin";

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTokenTTL(getTokenTTL());
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [getTokenTTL]);

  useEffect(() => {
    setUiTone(getStoredUITone());
  }, []);

  const load2FAStatus = useCallback(async () => {
    if (!token) return;
    setTwoFALoading(true);
    try {
      const status = await fetch2FAStatus(token);
      setTwoFA(status);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFALoading(false);
    }
  }, [token, language]);

  const loadTrustedDevices = useCallback(async () => {
    if (!token) return;
    setTrustedLoading(true);
    try {
      const response = await fetchTrustedDevices(token);
      setTrustedDevices(response.items);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTrustedLoading(false);
    }
  }, [token, language]);

  useEffect(() => {
    if (!hydrated || !token) return;
    void load2FAStatus();
    void loadTrustedDevices();
  }, [hydrated, token, load2FAStatus, loadTrustedDevices]);

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

  const ttlLabel = useMemo(() => {
    if (!tokenTTL) return tr(language, "Expired", "หมดอายุแล้ว");
    const minutes = Math.floor(tokenTTL / 60);
    const seconds = tokenTTL % 60;
    return `${minutes}m ${seconds}s`;
  }, [tokenTTL, language]);

  const handleVerify2FA = async () => {
    if (!token) return;
    if (!verifyCode.trim()) {
      toast.error(tr(language, "Please enter 2FA code", "กรุณากรอกรหัส 2FA"));
      return;
    }

    setTwoFABusy(true);
    try {
      await verify2FA(verifyCode, token);
      toast.success(tr(language, "2FA verified successfully", "ยืนยัน 2FA สำเร็จ"));
      setVerifyCode("");
      await load2FAStatus();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleReset2FA = async () => {
    if (!token) return;
    if (twoFA?.enabled && !resetCode.trim()) {
      toast.error(tr(language, "Please enter current 2FA code", "กรุณากรอกรหัส 2FA ปัจจุบัน"));
      return;
    }

    setTwoFABusy(true);
    try {
      const status = await reset2FA(token, {
        current_otp_code: twoFA?.enabled ? resetCode : undefined,
        reason: tr(language, "Reset from settings page", "รีเซ็ตจากหน้าการตั้งค่า"),
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
          "รีเซ็ต 2FA แล้ว กรุณาสแกน QR ใหม่และยืนยัน"
        )
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!token) return;
    if (!disableCode.trim()) {
      toast.error(tr(language, "Please enter current 2FA code to disable", "กรุณากรอกรหัส 2FA ปัจจุบันเพื่อปิดระบบ"));
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
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!token) return;
    setTwoFABusy(true);
    try {
      const response = await regenerateBackupCodes(token);
      setBackupCodes(response.codes);
      toast.success(
        tr(
          language,
          "Backup codes regenerated. Save them now.",
          "สร้าง Backup Codes ใหม่แล้ว กรุณาบันทึกไว้ทันที"
        )
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleCopyBackupCodes = async () => {
    if (backupCodes.length === 0) {
      toast.error(tr(language, "No backup codes yet", "ยังไม่มี Backup Codes"));
      return;
    }
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      toast.success(tr(language, "Backup codes copied", "คัดลอก Backup Codes แล้ว"));
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  };

  const handleDownloadBackupCodes = () => {
    if (backupCodes.length === 0) {
      toast.error(tr(language, "No backup codes yet", "ยังไม่มี Backup Codes"));
      return;
    }
    const blob = new Blob([backupCodes.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = tr(language, "backup-codes.txt", "รหัสสำรอง-2fa.txt");
    link.click();
    URL.revokeObjectURL(url);
    toast.success(tr(language, "Backup codes downloaded", "ดาวน์โหลด Backup Codes แล้ว"));
  };

  const handleRevokeTrustedDevice = async (deviceId: string) => {
    if (!token) return;
    setTwoFABusy(true);
    try {
      await revokeTrustedDevice(deviceId, token);
      await loadTrustedDevices();
      toast.success(tr(language, "Trusted device revoked", "ยกเลิกอุปกรณ์ที่เชื่อถือแล้ว"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleRevokeAllTrustedDevices = async () => {
    if (!token) return;
    setTwoFABusy(true);
    try {
      await revokeAllTrustedDevices(token);
      await loadTrustedDevices();
      toast.success(tr(language, "All trusted devices revoked", "ยกเลิกอุปกรณ์ทั้งหมดแล้ว"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setTwoFABusy(false);
    }
  };

  const resolveEmergencyTarget = async () => {
    if (!token) return;
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error(tr(language, "Please enter user email", "กรุณากรอกอีเมลผู้ใช้งาน"));
      return;
    }

    setEmergencyBusy(true);
    try {
      const user = await resolveSecurityUserByEmail(normalizedEmail, token);
      setResolvedUser(user);
      toast.success(tr(language, "User found", "พบผู้ใช้แล้ว"));
    } catch (error: unknown) {
      setResolvedUser(null);
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyUnlock = async () => {
    if (!token) return;
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error(tr(language, "Please enter user email", "กรุณากรอกอีเมลผู้ใช้งาน"));
      return;
    }
    if (emergencyReason.trim().length < 8) {
      toast.error(tr(language, "Please enter reason with at least 8 characters", "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร"));
      return;
    }

    setEmergencyBusy(true);
    try {
      await adminEmergencyUnlock(
        { email: normalizedEmail, reason: emergencyReason.trim() },
        token
      );
      toast.success(tr(language, "Account unlocked", "ปลดล็อกบัญชีเรียบร้อย"));
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyReset2FA = async () => {
    if (!token || !resolvedUser) return;
    if (emergencyReason.trim().length < 8) {
      toast.error(tr(language, "Please enter reason with at least 8 characters", "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร"));
      return;
    }

    setEmergencyBusy(true);
    try {
      await superAdminResetUser2FA(resolvedUser.user_id, emergencyReason.trim(), token);
      toast.success(tr(language, "User 2FA reset successfully", "รีเซ็ต 2FA ให้ผู้ใช้แล้ว"));
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyResetPassword = async () => {
    if (!token || !resolvedUser) return;
    if (emergencyReason.trim().length < 8) {
      toast.error(tr(language, "Please enter reason with at least 8 characters", "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร"));
      return;
    }

    setEmergencyBusy(true);
    try {
      const response = await superAdminResetUserPassword(
        resolvedUser.user_id,
        emergencyReason.trim(),
        token
      );
      setGeneratedResetToken(response.reset_token);
      setGeneratedResetTokenTTL(response.reset_token_expires_in);
      toast.success(tr(language, "Password reset token generated", "สร้างโทเคนรีเซ็ตรหัสผ่านแล้ว"));
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleCopyGeneratedResetToken = async () => {
    if (!generatedResetToken) return;
    try {
      await navigator.clipboard.writeText(generatedResetToken);
      toast.success(tr(language, "Reset token copied", "คัดลอกโทเคนรีเซ็ตรหัสผ่านแล้ว"));
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  };

  const handleCopyCreatedAdminInvite = async () => {
    if (!createdAdminInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdAdminInviteUrl);
      toast.success(tr(language, "Invite link copied", "คัดลอกลิงก์คำเชิญแล้ว"));
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  };

  const handleCreateAdminOnboarding = async () => {
    if (!token || !isSuperAdmin) return;

    const email = newAdminEmail.trim().toLowerCase();
    if (!email) {
      toast.error(tr(language, "Please enter admin email", "กรุณากรอกอีเมลแอดมิน"));
      return;
    }

    setOnboardingBusy(true);
    try {
      const invite = await createUserInvite(
        { email, role: "admin" },
        token,
      );
      setCreatedAdminInviteEmail(email);
      setCreatedAdminInviteUrl(invite.invite_url);
      setCreatedAdminInviteExpiresAt(invite.expires_at);
      toast.success(tr(language, "Admin invite generated", "สร้างลิงก์คำเชิญแอดมินแล้ว"));
    } catch (error: unknown) {
      setCreatedAdminInviteEmail("");
      setCreatedAdminInviteUrl("");
      setCreatedAdminInviteExpiresAt(null);
      toast.error(getErrorMessage(error, tr(language, "Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")));
    } finally {
      setOnboardingBusy(false);
    }
  };

  return (
    <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{tr(language, "Appearance", "การแสดงผล")}</CardTitle>
          <CardDescription>
            {tr(
              language,
              "Pick a background tone. White is the default main color.",
              "เลือกโทนพื้นหลังตามต้องการ โดยสีหลักเริ่มต้นเป็นสีขาว"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {UI_TONE_OPTIONS.map((tone) => (
            <Button
              key={tone}
              variant="outline"
              onClick={() => {
                applyUITone(tone);
                setUiTone(tone);
              }}
              className={`gap-2 bg-card text-foreground hover:bg-accent hover:text-accent-foreground ${
                uiTone === tone
                  ? "border-primary ring-2 ring-ring/30"
                  : "border-border"
              }`}
            >
              <span
                className="inline-flex size-3 rounded-full border border-slate-300"
                style={{ backgroundColor: `#${tone}` }}
              />
              {`#${tone.toUpperCase()}`}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr(language, "Account", "บัญชี")}</CardTitle>
          <CardDescription>{tr(language, "Manage your profile and session.", "จัดการโปรไฟล์และเซสชันของคุณ")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push("/profile")}>
            {tr(language, "Open profile", "เปิดโปรไฟล์")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void logout(token || undefined).catch(() => undefined).finally(() => {
                clearToken();
                router.replace("/login");
              });
            }}
          >
            {tr(language, "Log out", "ออกจากระบบ")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr(language, "Two-Factor Authentication", "การยืนยันตัวตนสองชั้น")}</CardTitle>
          <CardDescription>
            {tr(
              language,
              "Manage account security with Authenticator, Backup Codes and Trusted Devices",
              "จัดการความปลอดภัยบัญชีด้วย Authenticator, Backup Codes และ Trusted Devices"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {twoFALoading ? (
            <p className="text-sm text-muted-foreground">{tr(language, "Loading 2FA status...", "กำลังโหลดสถานะ 2FA...")}</p>
          ) : twoFA ? (
            <>
              <div className="space-y-1">
                <p className="text-sm">
                  {tr(language, "Status", "สถานะ")}:{" "}
                  <span className="font-medium">
                    {twoFA.enabled
                      ? tr(language, "Enabled", "เปิดใช้งาน")
                      : tr(language, "Not enabled", "ยังไม่เปิดใช้งาน")}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {twoFA.required
                    ? tr(
                      language,
                      `Required by policy${isAdmin ? " (Admin)" : ""}`,
                      `บังคับตามนโยบาย${isAdmin ? " (ผู้ดูแลระบบ)" : ""}`
                    )
                    : tr(language, "Optional for your role", "ไม่บังคับสำหรับบทบาทของคุณ")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tr(language, "Trusted device expires in", "อุปกรณ์ที่เชื่อถือจะหมดอายุใน")} {twoFA.trusted_device_days ?? (isAdmin ? 7 : 30)} {tr(language, "days", "วัน")}
                </p>
              </div>

              {(twoFA.setup_required || twoFA.provisioning_uri) && twoFA.provisioning_uri && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-sm text-muted-foreground">
                    {tr(language, "Scan QR with your authenticator app and enter 6-digit code to verify", "สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน")}
                  </p>
                  <div className="flex justify-center rounded-md bg-white p-2">
                    {qrCodeDataUrl ? (
                      <Image
                        src={qrCodeDataUrl}
                        alt={tr(language, "2FA QR code", "คิวอาร์โค้ด 2FA")}
                        width={220}
                        height={220}
                        unoptimized
                        className="h-[220px] w-[220px]"
                      />
                    ) : (
                      <p className="py-8 text-sm text-muted-foreground">{tr(language, "Generating QR code...", "กำลังสร้าง QR code...")}</p>
                    )}
                  </div>
                  <p className="break-all text-sm text-muted-foreground">
                    {tr(language, "Setup key", "รหัสตั้งค่า")}: {extractSetupKey(twoFA.provisioning_uri) ?? "-"}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="two_fa_verify">{tr(language, "2FA Verification Code", "รหัสยืนยัน 2FA")}</Label>
                <Input
                  id="two_fa_verify"
                  inputMode="numeric"
                  maxLength={12}
                  placeholder={tr(language, "123456", "123456")}
                  value={verifyCode}
                  onChange={(event) => setVerifyCode(event.target.value)}
                />
                <Button type="button" onClick={handleVerify2FA} disabled={twoFABusy}>
                  {twoFABusy
                    ? tr(language, "Verifying...", "กำลังยืนยัน...")
                    : tr(language, "Verify 2FA", "ยืนยัน 2FA")}
                </Button>
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">{tr(language, "Reset Authenticator", "รีเซ็ต Authenticator")}</p>
                {twoFA.enabled && (
                  <>
                    <Label htmlFor="two_fa_reset_code">{tr(language, "Current 2FA code", "รหัส 2FA ปัจจุบัน")}</Label>
                    <Input
                      id="two_fa_reset_code"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder={tr(language, "123456", "123456")}
                      value={resetCode}
                      onChange={(event) => setResetCode(event.target.value)}
                    />
                  </>
                )}
                <Button type="button" variant="outline" onClick={handleReset2FA} disabled={twoFABusy}>
                  {twoFABusy
                    ? tr(language, "Resetting...", "กำลังรีเซ็ต...")
                    : tr(language, "Reset 2FA and generate new QR", "รีเซ็ต 2FA และสร้าง QR ใหม่")}
                </Button>
              </div>

              {!isAdmin && twoFA.enabled && (
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="text-sm font-medium">{tr(language, "Disable 2FA", "ปิดใช้งาน 2FA")}</p>
                  <Label htmlFor="two_fa_disable_code">{tr(language, "Current 2FA code", "รหัส 2FA ปัจจุบัน")}</Label>
                  <Input
                    id="two_fa_disable_code"
                    inputMode="numeric"
                    maxLength={12}
                    placeholder={tr(language, "123456", "123456")}
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                  />
                  <Button type="button" variant="destructive" onClick={handleDisable2FA} disabled={twoFABusy}>
                    {tr(language, "Disable 2FA", "ปิดใช้งาน 2FA")}
                  </Button>
                </div>
              )}

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">{tr(language, "Backup Codes", "รหัสสำรอง")}</p>
                <p className="text-sm text-muted-foreground">
                  {tr(language, "Use one code at a time when you cannot access authenticator app", "ใช้แทนรหัส 2FA ได้ครั้งละ 1 โค้ดเมื่อเข้า Authenticator ไม่ได้")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleRegenerateBackupCodes} disabled={twoFABusy || !twoFA.enabled}>
                    {tr(language, "Generate / Regenerate", "สร้าง / สร้างใหม่")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleCopyBackupCodes} disabled={backupCodes.length === 0}>
                    {tr(language, "Copy", "คัดลอก")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleDownloadBackupCodes} disabled={backupCodes.length === 0}>
                    {tr(language, "Download", "ดาวน์โหลด")}
                  </Button>
                </div>
                {backupCodes.length > 0 && (
                  <pre className="rounded-md border border-border bg-muted p-3 text-sm leading-6">
                    {backupCodes.join("\n")}
                  </pre>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">{tr(language, "Trusted Devices", "อุปกรณ์ที่เชื่อถือ")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void loadTrustedDevices()} disabled={twoFABusy || trustedLoading}>
                    {tr(language, "Refresh", "รีเฟรช")}
                  </Button>
                  <Button type="button" variant="destructive" onClick={handleRevokeAllTrustedDevices} disabled={twoFABusy || trustedDevices.length === 0}>
                    {tr(language, "Revoke All", "เพิกถอนทั้งหมด")}
                  </Button>
                </div>
                {trustedLoading ? (
                  <p className="text-sm text-muted-foreground">{tr(language, "Loading trusted devices...", "กำลังโหลดอุปกรณ์ที่เชื่อถือ...")}</p>
                ) : trustedDevices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tr(language, "No trusted devices.", "ไม่มีอุปกรณ์ที่เชื่อถือ")}</p>
                ) : (
                  <div className="space-y-2">
                    {trustedDevices.map((device) => (
                      <div key={device.id} className="rounded-md border border-border p-3 text-sm">
                        <p className="font-medium">
                          {device.current_device
                            ? tr(language, "Current device", "อุปกรณ์ปัจจุบัน")
                            : tr(language, "Trusted device", "อุปกรณ์ที่เชื่อถือ")}
                        </p>
                        <p className="text-sm text-muted-foreground">{tr(language, "IP", "ไอพี")}: {device.ip_address || tr(language, "unknown", "ไม่ทราบ")}</p>
                        <p className="text-sm text-muted-foreground">{tr(language, "Created", "สร้างเมื่อ")}: {formatDateTime(device.created_at, language)}</p>
                        <p className="text-sm text-muted-foreground">{tr(language, "Last used", "ใช้งานล่าสุด")}: {formatDateTime(device.last_used_at, language)}</p>
                        <p className="text-sm text-muted-foreground">{tr(language, "Expires", "หมดอายุ")}: {formatDateTime(device.expires_at, language)}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          className="mt-2"
                          onClick={() => void handleRevokeTrustedDevice(device.id)}
                          disabled={twoFABusy}
                        >
                          {tr(language, "Revoke", "เพิกถอน")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{tr(language, "Unable to load 2FA status.", "ไม่สามารถโหลดสถานะ 2FA ได้")}</p>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{tr(language, "Admin Onboarding", "เริ่มต้นใช้งานแอดมิน")}</CardTitle>
            <CardDescription>
              {tr(
                language,
                "Generate an admin invite link so the account owner can set password and complete onboarding securely.",
                "สร้างลิงก์คำเชิญสำหรับแอดมิน เพื่อให้เจ้าของบัญชีตั้งรหัสผ่านและเริ่มต้นใช้งานได้อย่างปลอดภัย"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-1">
              <div className="space-y-2">
                <Label htmlFor="new_admin_email">{tr(language, "Admin email", "อีเมลแอดมิน")}</Label>
                <Input
                  id="new_admin_email"
                  placeholder="admin@hospital.org"
                  value={newAdminEmail}
                  onChange={(event) => {
                    setNewAdminEmail(event.target.value);
                    setCreatedAdminInviteEmail("");
                    setCreatedAdminInviteUrl("");
                    setCreatedAdminInviteExpiresAt(null);
                  }}
                />
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
              {tr(
                language,
                "This issues an admin invite link. Share it securely. The invited admin will set password during invite acceptance and will still be required to complete 2FA.",
                "ระบบจะออกลิงก์คำเชิญสำหรับแอดมิน ควรส่งลิงก์อย่างปลอดภัย โดยผู้ได้รับเชิญจะตั้งรหัสผ่านในขั้นตอนรับคำเชิญ และยังต้องทำ 2FA ให้ครบ"
              )}
            </div>

            <Button type="button" onClick={handleCreateAdminOnboarding} disabled={onboardingBusy}>
              {tr(language, "Generate admin invite", "สร้างลิงก์คำเชิญแอดมิน")}
            </Button>

            {createdAdminInviteEmail && (
              <div className="rounded-md border border-border/60 p-3 text-sm space-y-2">
                <p><span className="text-muted-foreground">{tr(language, "Invite target", "อีเมลปลายทาง")}:</span> {createdAdminInviteEmail}</p>
                <p><span className="text-muted-foreground">{tr(language, "Role", "บทบาท")}:</span> {getRoleLabel("admin", language)}</p>
              </div>
            )}

            {createdAdminInviteUrl && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-sm text-muted-foreground">
                  {tr(language, "One-time admin invite link:", "ลิงก์คำเชิญแอดมินแบบครั้งเดียว:")}
                </p>
                <Input value={createdAdminInviteUrl} readOnly />
                <p className="text-sm text-muted-foreground">
                  {tr(language, "Expires", "หมดอายุ")} {formatDateTime(createdAdminInviteExpiresAt, language)}
                </p>
                <Button type="button" variant="outline" onClick={handleCopyCreatedAdminInvite}>
                  {tr(language, "Copy invite link", "คัดลอกลิงก์คำเชิญ")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{tr(language, "Admin Emergency Toolkit", "ชุดเครื่องมือฉุกเฉินผู้ดูแลระบบ")}</CardTitle>
            <CardDescription>
              {tr(language, "Emergency tools for account unlock / reset 2FA / reset password with audit log", "เครื่องมือฉุกเฉินสำหรับปลดล็อกบัญชี / รีเซ็ต 2FA / รีเซ็ตรหัสผ่าน พร้อมบันทึก audit log")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target_email">{tr(language, "Target user email", "อีเมลผู้ใช้เป้าหมาย")}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="target_email"
                  placeholder={tr(language, "user@hospital.org", "user@hospital.org")}
                  value={targetEmail}
                  onChange={(event) => {
                    setTargetEmail(event.target.value);
                    setResolvedUser(null);
                    setGeneratedResetToken("");
                    setGeneratedResetTokenTTL(null);
                  }}
                />
                <Button type="button" variant="outline" onClick={resolveEmergencyTarget} disabled={emergencyBusy}>
                  {tr(language, "Resolve user", "ค้นหาผู้ใช้")}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="emergency_reason">{tr(language, "Reason (required)", "เหตุผล (จำเป็น)")}</Label>
              <Input
                id="emergency_reason"
                placeholder={tr(language, "Reason for emergency action", "เหตุผลสำหรับการทำรายการฉุกเฉิน")}
                value={emergencyReason}
                onChange={(event) => setEmergencyReason(event.target.value)}
              />
            </div>

            {resolvedUser ? (
              <div className="rounded-md border border-border/60 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">{tr(language, "User", "ผู้ใช้")}:</span> {resolvedUser.email}</p>
                <p><span className="text-muted-foreground">{tr(language, "Role", "บทบาท")}:</span> {getRoleLabel(resolvedUser.role, language)}</p>
                <p><span className="text-muted-foreground">{tr(language, "Locked", "ล็อกอยู่")}:</span> {resolvedUser.is_locked ? tr(language, "Yes", "ใช่") : tr(language, "No", "ไม่")}</p>
                <p><span className="text-muted-foreground">{tr(language, "2FA Enabled", "เปิดใช้งาน 2FA")}:</span> {resolvedUser.two_factor_enabled ? tr(language, "Yes", "ใช่") : tr(language, "No", "ไม่")}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{tr(language, "Resolve user first to confirm target account", "ค้นหาผู้ใช้ก่อน เพื่อยืนยันบัญชีเป้าหมาย")}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={emergencyBusy} onClick={handleEmergencyUnlock}>
                {tr(language, "Unlock account", "ปลดล็อกบัญชี")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={emergencyBusy || !resolvedUser}
                onClick={handleEmergencyReset2FA}
              >
                {tr(language, "Reset 2FA", "รีเซ็ต 2FA")}
              </Button>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="destructive"
                disabled={emergencyBusy || !resolvedUser}
                onClick={handleEmergencyResetPassword}
              >
                {tr(language, "Reset password", "รีเซ็ตรหัสผ่าน")}
              </Button>
              {generatedResetToken && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-sm text-muted-foreground">
                    {tr(language, "One-time reset token (shown once):", "โทเคนรีเซ็ตรหัสผ่านแบบครั้งเดียว (แสดงครั้งเดียว):")}
                  </p>
                  <Input value={generatedResetToken} readOnly />
                  <p className="text-sm text-muted-foreground">
                    {tr(language, "Expires in", "หมดอายุใน")} {generatedResetTokenTTL ?? "-"} {tr(language, "seconds", "วินาที")}
                  </p>
                  <Button type="button" variant="outline" onClick={handleCopyGeneratedResetToken}>
                    {tr(language, "Copy reset token", "คัดลอกโทเคนรีเซ็ต")}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr(language, "Session", "เซสชัน")}</CardTitle>
          <CardDescription>{tr(language, "Current access token status.", "สถานะ access token ปัจจุบัน")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            {tr(language, "Token TTL", "อายุโทเคนคงเหลือ")}: <span className="font-medium">{ttlLabel}</span>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
