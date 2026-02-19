"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
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
  type AdminSecurityUserLookup,
  type Admin2FAStatus,
  type TrustedDevice,
} from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";

function extractSetupKey(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("secret");
  } catch {
    return null;
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SettingsContent() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const getTokenTTL = useAuthStore((state) => state.getTokenTTL);

  const [tokenTTL, setTokenTTL] = useState(() => getTokenTTL());
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
  const [temporaryPasswordInput, setTemporaryPasswordInput] = useState("");
  const [generatedTempPassword, setGeneratedTempPassword] = useState("");

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

  const load2FAStatus = async () => {
    if (!token) return;
    setTwoFALoading(true);
    try {
      const status = await fetch2FAStatus(token);
      setTwoFA(status);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setTwoFALoading(false);
    }
  };

  const loadTrustedDevices = async () => {
    if (!token) return;
    setTrustedLoading(true);
    try {
      const response = await fetchTrustedDevices(token);
      setTrustedDevices(response.items);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setTrustedLoading(false);
    }
  };

  useEffect(() => {
    if (!hydrated || !token) return;
    void load2FAStatus();
    void loadTrustedDevices();
  }, [hydrated, token]);

  useEffect(() => {
    setResolvedUser(null);
    setGeneratedTempPassword("");
  }, [targetEmail]);

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
    if (!tokenTTL) return "Expired";
    const minutes = Math.floor(tokenTTL / 60);
    const seconds = tokenTTL % 60;
    return `${minutes}m ${seconds}s`;
  }, [tokenTTL]);

  const handleVerify2FA = async () => {
    if (!token) return;
    if (!verifyCode.trim()) {
      toast.error("กรุณากรอกรหัส 2FA");
      return;
    }

    setTwoFABusy(true);
    try {
      await verify2FA(verifyCode, token);
      toast.success("ยืนยัน 2FA สำเร็จ");
      setVerifyCode("");
      await load2FAStatus();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleReset2FA = async () => {
    if (!token) return;
    if (twoFA?.enabled && !resetCode.trim()) {
      toast.error("กรุณากรอกรหัส 2FA ปัจจุบัน");
      return;
    }

    setTwoFABusy(true);
    try {
      const status = await reset2FA(token, {
        current_otp_code: twoFA?.enabled ? resetCode : undefined,
        reason: "Reset from settings page",
      });
      setTwoFA(status);
      setResetCode("");
      setVerifyCode("");
      setBackupCodes([]);
      await loadTrustedDevices();
      toast.success("รีเซ็ต 2FA แล้ว กรุณาสแกน QR ใหม่และยืนยัน");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!token) return;
    if (!disableCode.trim()) {
      toast.error("กรุณากรอกรหัส 2FA ปัจจุบันเพื่อปิดระบบ");
      return;
    }

    setTwoFABusy(true);
    try {
      await disable2FA(disableCode, token);
      setDisableCode("");
      setBackupCodes([]);
      await load2FAStatus();
      await loadTrustedDevices();
      toast.success("ปิด 2FA เรียบร้อย");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
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
      toast.success("สร้าง Backup Codes ใหม่แล้ว กรุณาบันทึกไว้ทันที");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleCopyBackupCodes = async () => {
    if (backupCodes.length === 0) {
      toast.error("ยังไม่มี Backup Codes");
      return;
    }
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      toast.success("คัดลอก Backup Codes แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  };

  const handleDownloadBackupCodes = () => {
    if (backupCodes.length === 0) {
      toast.error("ยังไม่มี Backup Codes");
      return;
    }
    const blob = new Blob([backupCodes.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("ดาวน์โหลด Backup Codes แล้ว");
  };

  const handleRevokeTrustedDevice = async (deviceId: string) => {
    if (!token) return;
    setTwoFABusy(true);
    try {
      await revokeTrustedDevice(deviceId, token);
      await loadTrustedDevices();
      toast.success("ยกเลิกอุปกรณ์ที่เชื่อถือแล้ว");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
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
      toast.success("ยกเลิกอุปกรณ์ทั้งหมดแล้ว");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setTwoFABusy(false);
    }
  };

  const resolveEmergencyTarget = async () => {
    if (!token) return;
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error("กรุณากรอกอีเมลผู้ใช้งาน");
      return;
    }

    setEmergencyBusy(true);
    try {
      const user = await resolveSecurityUserByEmail(normalizedEmail, token);
      setResolvedUser(user);
      toast.success("พบผู้ใช้แล้ว");
    } catch (error: unknown) {
      setResolvedUser(null);
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyUnlock = async () => {
    if (!token) return;
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error("กรุณากรอกอีเมลผู้ใช้งาน");
      return;
    }
    if (emergencyReason.trim().length < 8) {
      toast.error("กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร");
      return;
    }

    setEmergencyBusy(true);
    try {
      await adminEmergencyUnlock(
        { email: normalizedEmail, reason: emergencyReason.trim() },
        token
      );
      toast.success("ปลดล็อกบัญชีเรียบร้อย");
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyReset2FA = async () => {
    if (!token || !resolvedUser) return;
    if (emergencyReason.trim().length < 8) {
      toast.error("กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร");
      return;
    }

    setEmergencyBusy(true);
    try {
      await superAdminResetUser2FA(resolvedUser.user_id, emergencyReason.trim(), token);
      toast.success("รีเซ็ต 2FA ให้ผู้ใช้แล้ว");
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyResetPassword = async () => {
    if (!token || !resolvedUser) return;
    if (emergencyReason.trim().length < 8) {
      toast.error("กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร");
      return;
    }

    setEmergencyBusy(true);
    try {
      const response = await superAdminResetUserPassword(
        resolvedUser.user_id,
        emergencyReason.trim(),
        token,
        temporaryPasswordInput.trim() || undefined
      );
      setGeneratedTempPassword(response.temporary_password);
      toast.success("รีเซ็ตรหัสผ่านเรียบร้อย");
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleCopyGeneratedPassword = async () => {
    if (!generatedTempPassword) return;
    try {
      await navigator.clipboard.writeText(generatedTempPassword);
      toast.success("คัดลอกรหัสชั่วคราวแล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  };

  return (
    <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Select your preferred dashboard theme.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant={theme === "light" ? "default" : "outline"} onClick={() => setTheme("light")}>
            Light
          </Button>
          <Button variant={theme === "dark" ? "default" : "outline"} onClick={() => setTheme("dark")}>
            Dark
          </Button>
          <Button variant={theme === "system" ? "default" : "outline"} onClick={() => setTheme("system")}>
            System
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Manage your profile and session.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push("/profile")}>
            Open profile
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
            Log out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            จัดการความปลอดภัยบัญชีด้วย Authenticator, Backup Codes และ Trusted Devices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {twoFALoading ? (
            <p className="text-sm text-muted-foreground">Loading 2FA status...</p>
          ) : twoFA ? (
            <>
              <div className="space-y-1">
                <p className="text-sm">
                  Status: <span className="font-medium">{twoFA.enabled ? "Enabled" : "Not enabled"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {twoFA.required
                    ? `Required by policy${isAdmin ? " (Admin)" : ""}`
                    : "Optional for your role"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Trusted device expires in {twoFA.trusted_device_days ?? (isAdmin ? 7 : 30)} days
                </p>
              </div>

              {(twoFA.setup_required || twoFA.provisioning_uri) && twoFA.provisioning_uri && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน
                  </p>
                  <div className="flex justify-center rounded-md bg-white p-2">
                    {qrCodeDataUrl ? (
                      <img
                        src={qrCodeDataUrl}
                        alt="2FA QR code"
                        className="h-[220px] w-[220px]"
                      />
                    ) : (
                      <p className="py-8 text-xs text-muted-foreground">Generating QR code...</p>
                    )}
                  </div>
                  <p className="break-all text-[11px] text-muted-foreground">
                    Setup key: {extractSetupKey(twoFA.provisioning_uri) ?? "-"}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="two_fa_verify">2FA Verification Code</Label>
                <Input
                  id="two_fa_verify"
                  inputMode="numeric"
                  maxLength={12}
                  placeholder="123456"
                  value={verifyCode}
                  onChange={(event) => setVerifyCode(event.target.value)}
                />
                <Button type="button" onClick={handleVerify2FA} disabled={twoFABusy}>
                  {twoFABusy ? "Verifying..." : "Verify 2FA"}
                </Button>
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">Reset Authenticator</p>
                {twoFA.enabled && (
                  <>
                    <Label htmlFor="two_fa_reset_code">Current 2FA code</Label>
                    <Input
                      id="two_fa_reset_code"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="123456"
                      value={resetCode}
                      onChange={(event) => setResetCode(event.target.value)}
                    />
                  </>
                )}
                <Button type="button" variant="outline" onClick={handleReset2FA} disabled={twoFABusy}>
                  {twoFABusy ? "Resetting..." : "Reset 2FA and generate new QR"}
                </Button>
              </div>

              {!isAdmin && twoFA.enabled && (
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="text-sm font-medium">Disable 2FA</p>
                  <Label htmlFor="two_fa_disable_code">Current 2FA code</Label>
                  <Input
                    id="two_fa_disable_code"
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="123456"
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                  />
                  <Button type="button" variant="destructive" onClick={handleDisable2FA} disabled={twoFABusy}>
                    Disable 2FA
                  </Button>
                </div>
              )}

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">Backup Codes</p>
                <p className="text-xs text-muted-foreground">
                  ใช้แทนรหัส 2FA ได้ครั้งละ 1 โค้ดเมื่อเข้า Authenticator ไม่ได้
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleRegenerateBackupCodes} disabled={twoFABusy || !twoFA.enabled}>
                    Generate / Regenerate
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleCopyBackupCodes} disabled={backupCodes.length === 0}>
                    Copy
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleDownloadBackupCodes} disabled={backupCodes.length === 0}>
                    Download
                  </Button>
                </div>
                {backupCodes.length > 0 && (
                  <pre className="rounded-md border border-border bg-muted p-3 text-xs leading-6">
                    {backupCodes.join("\n")}
                  </pre>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">Trusted Devices</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void loadTrustedDevices()} disabled={twoFABusy || trustedLoading}>
                    Refresh
                  </Button>
                  <Button type="button" variant="destructive" onClick={handleRevokeAllTrustedDevices} disabled={twoFABusy || trustedDevices.length === 0}>
                    Revoke All
                  </Button>
                </div>
                {trustedLoading ? (
                  <p className="text-sm text-muted-foreground">Loading trusted devices...</p>
                ) : trustedDevices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trusted devices.</p>
                ) : (
                  <div className="space-y-2">
                    {trustedDevices.map((device) => (
                      <div key={device.id} className="rounded-md border border-border p-3 text-sm">
                        <p className="font-medium">
                          {device.current_device ? "Current device" : "Trusted device"}
                        </p>
                        <p className="text-xs text-muted-foreground">IP: {device.ip_address || "unknown"}</p>
                        <p className="text-xs text-muted-foreground">Created: {formatDateTime(device.created_at)}</p>
                        <p className="text-xs text-muted-foreground">Last used: {formatDateTime(device.last_used_at)}</p>
                        <p className="text-xs text-muted-foreground">Expires: {formatDateTime(device.expires_at)}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          className="mt-2"
                          onClick={() => void handleRevokeTrustedDevice(device.id)}
                          disabled={twoFABusy}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Unable to load 2FA status.</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Admin Emergency Toolkit</CardTitle>
            <CardDescription>
              เครื่องมือฉุกเฉินสำหรับปลดล็อกบัญชี / รีเซ็ต 2FA / รีเซ็ตรหัสผ่าน พร้อมบันทึก audit log
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target_email">Target user email</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="target_email"
                  placeholder="user@hospital.org"
                  value={targetEmail}
                  onChange={(event) => setTargetEmail(event.target.value)}
                />
                <Button type="button" variant="outline" onClick={resolveEmergencyTarget} disabled={emergencyBusy}>
                  Resolve user
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="emergency_reason">Reason (required)</Label>
              <Input
                id="emergency_reason"
                placeholder="เหตุผลสำหรับการทำรายการฉุกเฉิน"
                value={emergencyReason}
                onChange={(event) => setEmergencyReason(event.target.value)}
              />
            </div>

            {resolvedUser ? (
              <div className="rounded-md border border-border/60 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">User:</span> {resolvedUser.email}</p>
                <p><span className="text-muted-foreground">Role:</span> {resolvedUser.role}</p>
                <p><span className="text-muted-foreground">Locked:</span> {resolvedUser.is_locked ? "Yes" : "No"}</p>
                <p><span className="text-muted-foreground">2FA Enabled:</span> {resolvedUser.two_factor_enabled ? "Yes" : "No"}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Resolve user ก่อน เพื่อยืนยันบัญชีเป้าหมาย</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={emergencyBusy} onClick={handleEmergencyUnlock}>
                Unlock account
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={emergencyBusy || !resolvedUser}
                onClick={handleEmergencyReset2FA}
              >
                Reset 2FA
              </Button>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor="temporary_password">Temporary password (optional)</Label>
              <Input
                id="temporary_password"
                placeholder="ปล่อยว่างเพื่อให้ระบบ generate"
                value={temporaryPasswordInput}
                onChange={(event) => setTemporaryPasswordInput(event.target.value)}
              />
              <Button
                type="button"
                variant="destructive"
                disabled={emergencyBusy || !resolvedUser}
                onClick={handleEmergencyResetPassword}
              >
                Reset password
              </Button>
              {generatedTempPassword && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs text-muted-foreground">
                    Temporary password (แสดงครั้งเดียว):
                  </p>
                  <Input value={generatedTempPassword} readOnly />
                  <Button type="button" variant="outline" onClick={handleCopyGeneratedPassword}>
                    Copy temporary password
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Current access token status.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Token TTL: <span className="font-medium">{ttlLabel}</span>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
