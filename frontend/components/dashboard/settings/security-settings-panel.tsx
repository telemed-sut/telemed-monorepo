"use client";

import Image from "next/image";
import { X } from "lucide-react";

import { SecretDisclosure } from "@/components/auth/secret-disclosure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { SettingsLanguage } from "./settings-types";
import {
  extractSetupKey,
  formatDateTime,
  formatTimeUntil,
  tr,
} from "./settings-utils";
import { SettingsDisclosure } from "./settings-disclosure";
import type { useSettingsSecurity } from "./use-settings-security";

interface SecuritySettingsPanelProps {
  language: SettingsLanguage;
  isAdmin: boolean;
  security: ReturnType<typeof useSettingsSecurity>;
}

export function SecuritySettingsPanel({
  language,
  isAdmin,
  security,
}: SecuritySettingsPanelProps) {
  return (
    <Card
      size="sm"
      className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
    >
      <CardHeader>
        <CardTitle>{tr(language, "Security", "ความปลอดภัย")}</CardTitle>
        <CardDescription>
          {tr(
            language,
            "Use concise sections to manage authenticator setup, backup codes, and trusted devices.",
            "จัดการ Authenticator, รหัสสำรอง และอุปกรณ์ที่เชื่อถือแบบแยกเป็นส่วนที่เปิดดูได้ง่าย",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {security.twoFALoading ? (
          <p className="text-sm text-muted-foreground">
            {tr(language, "Loading 2FA status...", "กำลังโหลดสถานะ 2FA...")}
          </p>
        ) : security.twoFA ? (
          <>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-border bg-muted/20 px-3 py-1 text-xs font-medium text-foreground">
                {security.securityHeaderSummary}
              </span>
              <span className="rounded-full border border-border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                {tr(language, "Last verified", "ยืนยันล่าสุด")}{" "}
                {formatDateTime(security.mfaAuthenticatedAt, language)}
              </span>
            </div>

            <div className="space-y-2">
              <SettingsDisclosure
                title={tr(language, "Authenticator", "Authenticator")}
                description={tr(
                  language,
                  "Verify, reset, or disable the primary authenticator.",
                  "ยืนยัน รีเซ็ต หรือปิดตัว Authenticator หลัก",
                )}
                summary={security.authenticatorSummary}
                open={security.securitySectionOpen === "authenticator"}
                onOpenChange={(open) =>
                  security.setSecuritySectionOpen(open ? "authenticator" : null)
                }
              >
                <div
                  className={
                    (security.twoFA.setup_required || security.twoFA.provisioning_uri) &&
                    security.twoFA.provisioning_uri
                      ? "grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]"
                      : "grid gap-4"
                  }
                >
                  {(security.twoFA.setup_required ||
                    security.twoFA.provisioning_uri) &&
                  security.twoFA.provisioning_uri ? (
                    <div className="space-y-2 rounded-xl border border-border bg-muted/15 p-3">
                      <p className="text-xs text-muted-foreground">
                        {tr(
                          language,
                          "Scan the QR code or copy the setup key.",
                          "สแกน QR code หรือคัดลอกรหัสตั้งค่า",
                        )}
                      </p>
                      <div className="flex justify-center rounded-xl bg-white p-2">
                        {security.qrCodeDataUrl ? (
                          <Image
                            src={security.qrCodeDataUrl}
                            alt={tr(language, "2FA QR code", "คิวอาร์โค้ด 2FA")}
                            width={220}
                            height={220}
                            unoptimized
                            className="h-[220px] w-[220px]"
                          />
                        ) : (
                          <p className="py-8 text-sm text-muted-foreground">
                            {tr(
                              language,
                              "Generating QR code...",
                              "กำลังสร้าง QR code...",
                            )}
                          </p>
                        )}
                      </div>
                      <SecretDisclosure
                        key={
                          extractSetupKey(security.twoFA.provisioning_uri) ??
                          "settings-setup-key-hidden"
                        }
                        label={tr(language, "Setup key", "รหัสตั้งค่า")}
                        value={extractSetupKey(security.twoFA.provisioning_uri)}
                        showLabel={tr(language, "Show setup key", "แสดงรหัสตั้งค่า")}
                        hideLabel={tr(language, "Hide setup key", "ซ่อนรหัสตั้งค่า")}
                      />
                    </div>
                  ) : null}

                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-muted/15 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {tr(language, "Status", "สถานะ")}
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {security.twoFA.enabled
                            ? tr(language, "Enabled", "เปิดใช้งาน")
                            : tr(language, "Not enabled", "ยังไม่เปิดใช้งาน")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-muted/15 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {tr(language, "Policy", "นโยบาย")}
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {security.twoFA.required
                            ? tr(
                                language,
                                `Required${isAdmin ? " (Admin)" : ""}`,
                                `บังคับ${isAdmin ? " (ผู้ดูแลระบบ)" : ""}`,
                              )
                            : tr(language, "Optional", "ไม่บังคับ")}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="two_fa_verify">
                        {tr(language, "2FA Verification Code", "รหัสยืนยัน 2FA")}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          id="two_fa_verify"
                          inputMode="numeric"
                          maxLength={12}
                          placeholder={tr(language, "123456", "123456")}
                          value={security.verifyCode}
                          onChange={(event) =>
                            security.handleVerifyCodeChange(event.target.value)
                          }
                          className="min-w-[220px] flex-1"
                        />
                        <Button
                          type="button"
                          onClick={security.handleVerify2FA}
                          disabled={security.twoFABusy}
                        >
                          {security.twoFABusy
                            ? tr(language, "Verifying...", "กำลังยืนยัน...")
                            : tr(language, "Verify 2FA", "ยืนยัน 2FA")}
                        </Button>
                      </div>
                    </div>

                    <div
                      className={
                        !isAdmin && security.twoFA.enabled
                          ? "grid gap-3 lg:grid-cols-2"
                          : "grid grid-cols-1 gap-3"
                      }
                    >
                      <div className="space-y-2 rounded-xl border border-border bg-muted/15 p-3">
                        <p className="text-sm font-medium">
                          {tr(language, "Reset Authenticator", "รีเซ็ต Authenticator")}
                        </p>
                        {security.twoFA.enabled ? (
                          <>
                            <Label htmlFor="two_fa_reset_code">
                              {tr(language, "Current 2FA code", "รหัส 2FA ปัจจุบัน")}
                            </Label>
                            <Input
                              id="two_fa_reset_code"
                              inputMode="numeric"
                              maxLength={12}
                              placeholder={tr(language, "123456", "123456")}
                              value={security.resetCode}
                              onChange={(event) =>
                                security.handleResetCodeChange(event.target.value)
                              }
                            />
                          </>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={security.handleReset2FA}
                          disabled={security.twoFABusy}
                        >
                          {security.twoFABusy
                            ? tr(language, "Resetting...", "กำลังรีเซ็ต...")
                            : tr(language, "Reset 2FA", "รีเซ็ต 2FA")}
                        </Button>
                      </div>

                      {!isAdmin && security.twoFA.enabled ? (
                        <div className="space-y-2 rounded-xl border border-destructive/20 bg-destructive/3 p-3">
                          <p className="text-sm font-medium">
                            {tr(language, "Disable 2FA", "ปิดใช้งาน 2FA")}
                          </p>
                          <Label htmlFor="two_fa_disable_code">
                            {tr(language, "Current 2FA code", "รหัส 2FA ปัจจุบัน")}
                          </Label>
                          <Input
                            id="two_fa_disable_code"
                            inputMode="numeric"
                            maxLength={12}
                            placeholder={tr(language, "123456", "123456")}
                            value={security.disableCode}
                            onChange={(event) =>
                              security.handleDisableCodeChange(event.target.value)
                            }
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={security.handleDisable2FA}
                            disabled={security.twoFABusy}
                          >
                            {tr(language, "Disable 2FA", "ปิดใช้งาน 2FA")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </SettingsDisclosure>

              <SettingsDisclosure
                open={security.securitySectionOpen === "passkeys"}
                onOpenChange={(open) =>
                  security.setSecuritySectionOpen(open ? "passkeys" : null)
                }
                title={tr(language, "Passkeys", "Passkeys")}
                description={tr(
                  language,
                  "Use biometrics like TouchID or FaceID for instant, phishing-proof sign-in.",
                  "ใช้การสแกนนิ้วหรือใบหน้าเพื่อเข้าสู่ระบบที่รวดเร็วและปลอดภัยสูงสุด",
                )}
                summary={
                  security.passkeyLoading
                    ? tr(language, "Loading...", "กำลังโหลด...")
                    : tr(
                        language,
                        `${security.passkeys.length} keys`,
                        `${security.passkeys.length} กุญแจ`,
                      )
                }
              >
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {tr(
                      language,
                      "Passkeys provide a faster and more secure way to sign in without typing passwords or OTPs.",
                      "Passkeys ช่วยให้เข้าสู่ระบบได้เร็วและปลอดภัยกว่าเดิม โดยไม่ต้องพิมพ์รหัสผ่านหรือรหัส OTP",
                    )}
                  </p>
                  {security.passkeys.length > 0 ? (
                    <div className="space-y-2">
                      {security.passkeys.map((pk) => (
                        <div
                          key={pk.id}
                          className="flex items-center justify-between rounded-xl border border-border bg-muted/10 p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {pk.name || "Unnamed Device"}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {tr(language, "Added", "เพิ่มเมื่อ")}{" "}
                              {formatDateTime(pk.created_at, language)}
                              {pk.last_used_at ? (
                                <>
                                  {" • "}
                                  {tr(language, "Used", "ใช้ล่าสุด")}{" "}
                                  {formatDateTime(pk.last_used_at, language)}
                                </>
                              ) : null}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => void security.handleDeletePasskey(pk.id)}
                            disabled={security.passkeyBusy}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      {tr(language, "No passkeys registered yet.", "ยังไม่มีการลงทะเบียน Passkey")}
                    </p>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={security.handleRegisterPasskey}
                    disabled={security.passkeyBusy}
                  >
                    <svg className="mr-2 size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="currentColor"/>
                      <path d="M12 17C13.6569 17 15 15.6569 15 14C15 12.3431 13.6569 11 12 11C10.3431 11 9 12.3431 9 14C9 15.6569 10.3431 17 12 17Z" fill="currentColor"/>
                      <path d="M12 6C10.34 6 9 7.34 9 9V10H15V9C15 7.34 13.66 6 12 6Z" fill="currentColor"/>
                    </svg>
                    {tr(language, "Register new Passkey", "ลงทะเบียน Passkey ใหม่")}
                  </Button>
                </div>
              </SettingsDisclosure>

              <SettingsDisclosure
                title={tr(language, "Backup Codes", "รหัสสำรอง")}
                description={tr(
                  language,
                  "Generate, copy, or download one-time recovery codes.",
                  "สร้าง คัดลอก หรือดาวน์โหลดรหัสกู้คืนแบบใช้ครั้งเดียว",
                )}
                summary={security.backupCodesSummary}
                open={security.securitySectionOpen === "backup-codes"}
                onOpenChange={(open) =>
                  security.setSecuritySectionOpen(open ? "backup-codes" : null)
                }
              >
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {tr(
                      language,
                      "Use one code at a time when you cannot access authenticator app",
                      "ใช้แทนรหัส 2FA ได้ครั้งละ 1 โค้ดเมื่อเข้า Authenticator ไม่ได้",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={security.handleRegenerateBackupCodes}
                      disabled={security.twoFABusy || !security.twoFA.enabled}
                    >
                      {tr(language, "Generate / Regenerate", "สร้าง / สร้างใหม่")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={security.handleCopyBackupCodes}
                      disabled={security.backupCodes.length === 0}
                    >
                      {tr(language, "Copy", "คัดลอก")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={security.handleDownloadBackupCodes}
                      disabled={security.backupCodes.length === 0}
                    >
                      {tr(language, "Download", "ดาวน์โหลด")}
                    </Button>
                  </div>
                  {security.backupCodes.length > 0 ? (
                    <pre className="rounded-xl border border-border bg-muted p-3 text-sm leading-6">
                      {security.backupCodes.join("\n")}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {tr(language, "No backup codes yet.", "ยังไม่มีรหัสสำรอง")}
                    </p>
                  )}
                </div>
              </SettingsDisclosure>

              <SettingsDisclosure
                title={tr(language, "Trusted Devices", "อุปกรณ์ที่เชื่อถือ")}
                description={tr(
                  language,
                  "Review active trusted devices and revoke access when needed.",
                  "ดูอุปกรณ์ที่เชื่อถืออยู่และเพิกถอนสิทธิเมื่อจำเป็น",
                )}
                summary={security.trustedDevicesSummary}
                open={security.securitySectionOpen === "trusted-devices"}
                onOpenChange={(open) =>
                  security.setSecuritySectionOpen(open ? "trusted-devices" : null)
                }
              >
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-muted/15 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          security.currentTrustedDevice
                            ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                            : "border-amber-200/80 bg-amber-50 text-amber-700"
                        }
                      >
                        {security.currentTrustedDevice
                          ? tr(language, "Current browser trusted", "เบราว์เซอร์นี้ถูกเชื่อถือ")
                          : tr(language, "Current browser not trusted", "เบราว์เซอร์นี้ยังไม่ถูกเชื่อถือ")}
                      </Badge>
                      {security.currentTrustedDevice ? (
                        <span className="text-xs text-muted-foreground">
                          {formatTimeUntil(
                            security.currentTrustedDevice.expires_at,
                            language,
                          )}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {security.currentTrustedDevice
                        ? tr(
                            language,
                            "This browser can skip some repeated verification prompts until the trusted-device window ends.",
                            "เบราว์เซอร์นี้จะข้ามการถามยืนยันซ้ำบางครั้งได้จนกว่าช่วงอุปกรณ์ที่เชื่อถือจะสิ้นสุด",
                          )
                        : tr(
                            language,
                            "When verification is requested again, you can choose to trust this browser for future prompts.",
                            "เมื่อระบบขอให้ยืนยันตัวตนอีกครั้ง คุณสามารถเลือกเชื่อถือเบราว์เซอร์นี้เพื่อลดการถามซ้ำในครั้งถัดไป",
                          )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void security.refreshTrustedDevices()}
                      disabled={security.twoFABusy || security.trustedLoading}
                    >
                      {tr(language, "Refresh", "รีเฟรช")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={security.handleRevokeAllTrustedDevices}
                      disabled={security.twoFABusy || security.trustedDevices.length === 0}
                    >
                      {tr(language, "Revoke All", "เพิกถอนทั้งหมด")}
                    </Button>
                  </div>
                  {security.trustedLoading ? (
                    <p className="text-sm text-muted-foreground">
                      {tr(language, "Loading trusted devices...", "กำลังโหลดอุปกรณ์ที่เชื่อถือ...")}
                    </p>
                  ) : security.trustedDevices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {tr(language, "No trusted devices.", "ไม่มีอุปกรณ์ที่เชื่อถือ")}
                    </p>
                  ) : (
                    <div className="grid gap-2 lg:grid-cols-2">
                      {security.trustedDevices.map((device) => (
                        <div
                          key={device.id}
                          className="rounded-xl border border-border bg-muted/15 p-3 text-sm"
                        >
                          <p className="font-medium">
                            {device.current_device
                              ? tr(language, "Current device", "อุปกรณ์ปัจจุบัน")
                              : tr(language, "Trusted device", "อุปกรณ์ที่เชื่อถือ")}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tr(language, "IP", "ไอพี")}:{" "}
                            {device.ip_address || tr(language, "unknown", "ไม่ทราบ")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tr(language, "Created", "สร้างเมื่อ")}:{" "}
                            {formatDateTime(device.created_at, language)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tr(language, "Last used", "ใช้งานล่าสุด")}:{" "}
                            {formatDateTime(device.last_used_at, language)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tr(language, "Expires", "หมดอายุ")}:{" "}
                            {formatDateTime(device.expires_at, language)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {device.current_device ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-200/80 bg-emerald-50 text-emerald-700"
                              >
                                {tr(language, "Current browser", "เบราว์เซอร์นี้")}
                              </Badge>
                            ) : null}
                            <Badge variant="outline">
                              {formatTimeUntil(device.expires_at, language)}
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="mt-2"
                            onClick={() =>
                              void security.handleRevokeTrustedDevice(device.id)
                            }
                            disabled={security.twoFABusy}
                          >
                            {tr(language, "Revoke", "เพิกถอน")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </SettingsDisclosure>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tr(language, "Unable to load 2FA status.", "ไม่สามารถโหลดสถานะ 2FA ได้")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
