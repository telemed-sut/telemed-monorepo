"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { SettingsLanguage } from "./settings-types";
import { formatDateTime, tr } from "./settings-utils";
import { SettingsDisclosure } from "./settings-disclosure";
import type { useSettingsAdmin } from "./use-settings-admin";

interface AdminSettingsPanelProps {
  language: SettingsLanguage;
  isAdmin: boolean;
  canManagePrivilegedAdmins: boolean;
  canManageSecurityRecovery: boolean;
  admin: ReturnType<typeof useSettingsAdmin>;
  getRoleLabel: (role: string, language: SettingsLanguage) => string;
}

export function AdminSettingsPanel({
  language,
  isAdmin,
  canManagePrivilegedAdmins,
  canManageSecurityRecovery,
  admin,
  getRoleLabel,
}: AdminSettingsPanelProps) {
  return (
    <Card
      size="sm"
      className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
    >
      <Collapsible
        open={admin.adminToolsExpanded}
        onOpenChange={admin.setAdminToolsExpanded}
      >
        <CardHeader>
          <CollapsibleTrigger className="group -m-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-start justify-between gap-3 rounded-2xl p-2 text-left transition-[background-color,color] hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block">
              <span className="block text-[0.98rem] leading-normal font-medium">
                {tr(language, "Admin Tools", "เครื่องมือผู้ดูแลระบบ")}
              </span>
              <span className="block text-[0.95rem] text-muted-foreground">
                {tr(
                  language,
                  "Keep onboarding and emergency actions grouped under one advanced area.",
                  "รวมงานเชิญแอดมินและการกู้คืนฉุกเฉินไว้ในส่วนขั้นสูงเดียว",
                )}
              </span>
            </span>
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground transition-[border-color,background-color,color,box-shadow] group-hover:bg-muted/70 group-hover:text-foreground">
              <span className="hidden sm:block">{admin.adminToolsSummary}</span>
              <span>
                {admin.adminToolsExpanded
                  ? tr(language, "Hide", "ซ่อน")
                  : tr(language, "Show", "แสดง")}
              </span>
              {admin.adminToolsExpanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </span>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent className="overflow-hidden">
          <CardContent className="space-y-2 pt-0">
            {canManagePrivilegedAdmins ? (
              <SettingsDisclosure
                title={tr(language, "Admin Onboarding", "เริ่มต้นใช้งานแอดมิน")}
                description={tr(
                  language,
                  "Create a one-time invite so the new admin can set a password and finish setup.",
                  "สร้างลิงก์แบบใช้ครั้งเดียวเพื่อให้แอดมินใหม่ตั้งรหัสผ่านและเริ่มต้นใช้งาน",
                )}
                summary={
                  admin.createdAdminInviteUrl
                    ? tr(language, "Invite ready", "สร้างลิงก์แล้ว")
                    : tr(language, "No invite generated", "ยังไม่สร้างลิงก์")
                }
                open={admin.adminSectionOpen === "onboarding"}
                onOpenChange={(open) =>
                  admin.setAdminSectionOpen(open ? "onboarding" : null)
                }
              >
                <div className="space-y-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="new_admin_email">
                        {tr(language, "Admin email", "อีเมลแอดมิน")}
                      </Label>
                      <Input
                        id="new_admin_email"
                        placeholder="admin@hospital.org"
                        value={admin.newAdminEmail}
                        onChange={(event) =>
                          admin.handleAdminInviteEmailChange(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="admin_invite_reason">
                        {tr(language, "Reason (required)", "เหตุผล (จำเป็น)")}
                      </Label>
                      <Input
                        id="admin_invite_reason"
                        placeholder={tr(
                          language,
                          "Incident, approval, or onboarding ticket reference",
                          "เลขอ้างอิง incident, approval หรือ onboarding ticket",
                        )}
                        value={admin.adminInviteReason}
                        onChange={(event) =>
                          admin.handleAdminInviteReasonChange(event.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                    {tr(
                      language,
                      "This issues an admin invite link. Share it securely. The invited admin will set a password and still complete 2FA.",
                      "ระบบจะออกลิงก์คำเชิญสำหรับแอดมิน ควรส่งลิงก์อย่างปลอดภัย โดยผู้ได้รับเชิญจะตั้งรหัสผ่านและยังต้องทำ 2FA ให้ครบ",
                    )}
                  </div>

                  <Button
                    type="button"
                    onClick={admin.handleCreateAdminOnboarding}
                    disabled={admin.onboardingBusy}
                  >
                    {tr(language, "Generate admin invite", "สร้างลิงก์คำเชิญแอดมิน")}
                  </Button>

                  {admin.createdAdminInviteEmail ? (
                    <div className="rounded-xl border border-border/60 p-3 text-sm space-y-1">
                      <p>
                        <span className="text-muted-foreground">
                          {tr(language, "Invite target", "อีเมลปลายทาง")}:
                        </span>{" "}
                        {admin.createdAdminInviteEmail}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {tr(language, "Role", "บทบาท")}:
                        </span>{" "}
                        {getRoleLabel("admin", language)}
                      </p>
                    </div>
                  ) : null}

                  {admin.createdAdminInviteUrl ? (
                    <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-sm text-muted-foreground">
                        {tr(language, "One-time admin invite link:", "ลิงก์คำเชิญแอดมินแบบครั้งเดียว:")}
                      </p>
                      <Input value={admin.createdAdminInviteUrl} readOnly />
                      <p className="text-sm text-muted-foreground">
                        {tr(language, "Expires", "หมดอายุ")}{" "}
                        {formatDateTime(admin.createdAdminInviteExpiresAt, language)}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={admin.handleCopyCreatedAdminInvite}
                      >
                        {tr(language, "Copy invite link", "คัดลอกลิงก์คำเชิญ")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </SettingsDisclosure>
            ) : null}

            {isAdmin && canManageSecurityRecovery ? (
              <SettingsDisclosure
                title={tr(language, "Emergency Actions", "การกู้คืนฉุกเฉิน")}
                description={tr(
                  language,
                  "Unlock accounts and reset security with audit-friendly controls.",
                  "ปลดล็อกบัญชีและรีเซ็ตความปลอดภัยด้วยเครื่องมือที่เหมาะกับงานฉุกเฉิน",
                )}
                summary={
                  admin.resolvedUser
                    ? admin.resolvedUser.email
                    : tr(language, "Resolve a target user", "ค้นหาผู้ใช้เป้าหมาย")
                }
                open={admin.adminSectionOpen === "emergency"}
                onOpenChange={(open) =>
                  admin.setAdminSectionOpen(open ? "emergency" : null)
                }
                tone="danger"
              >
                <div className="space-y-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="space-y-2">
                      <Label htmlFor="target_email">
                        {tr(language, "Target user email", "อีเมลผู้ใช้เป้าหมาย")}
                      </Label>
                      <Input
                        id="target_email"
                        placeholder={tr(language, "user@hospital.org", "user@hospital.org")}
                        value={admin.targetEmail}
                        onChange={(event) =>
                          admin.handleTargetEmailChange(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emergency_reason">
                        {tr(language, "Reason (required)", "เหตุผล (จำเป็น)")}
                      </Label>
                      <Input
                        id="emergency_reason"
                        placeholder={tr(
                          language,
                          "Reason for emergency action",
                          "เหตุผลสำหรับการทำรายการฉุกเฉิน",
                        )}
                        value={admin.emergencyReason}
                        onChange={(event) =>
                          admin.handleEmergencyReasonChange(event.target.value)
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={admin.resolveEmergencyTarget}
                        disabled={admin.emergencyBusy}
                      >
                        {tr(language, "Resolve user", "ค้นหาผู้ใช้")}
                      </Button>
                    </div>
                  </div>

                  {admin.resolvedUser ? (
                    <div className="rounded-xl border border-destructive/20 bg-background p-3 text-sm space-y-1">
                      <p>
                        <span className="text-muted-foreground">
                          {tr(language, "User", "ผู้ใช้")}:
                        </span>{" "}
                        {admin.resolvedUser.email}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {tr(language, "Role", "บทบาท")}:
                        </span>{" "}
                        {getRoleLabel(admin.resolvedUser.role, language)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {tr(language, "Locked", "ล็อกอยู่")}:
                        </span>{" "}
                        {admin.resolvedUser.is_locked
                          ? tr(language, "Yes", "ใช่")
                          : tr(language, "No", "ไม่")}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {tr(language, "2FA Enabled", "เปิดใช้งาน 2FA")}:
                        </span>{" "}
                        {admin.resolvedUser.two_factor_enabled
                          ? tr(language, "Yes", "ใช่")
                          : tr(language, "No", "ไม่")}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {tr(
                        language,
                        "Resolve user first to confirm target account",
                        "ค้นหาผู้ใช้ก่อน เพื่อยืนยันบัญชีเป้าหมาย",
                      )}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={admin.emergencyBusy}
                      onClick={admin.handleEmergencyUnlock}
                    >
                      {tr(language, "Unlock account", "ปลดล็อกบัญชี")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={admin.emergencyBusy || !admin.resolvedUser}
                      onClick={admin.handleEmergencyReset2FA}
                    >
                      {tr(language, "Reset 2FA", "รีเซ็ต 2FA")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={admin.emergencyBusy || !admin.resolvedUser}
                      onClick={admin.handleEmergencyResetPassword}
                    >
                      {tr(language, "Reset password", "รีเซ็ตรหัสผ่าน")}
                    </Button>
                  </div>

                  {admin.generatedResetToken ? (
                    <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-sm text-muted-foreground">
                        {tr(
                          language,
                          "One-time reset token (shown once):",
                          "โทเคนรีเซ็ตรหัสผ่านแบบครั้งเดียว (แสดงครั้งเดียว):",
                        )}
                      </p>
                      <Input value={admin.generatedResetToken} readOnly />
                      <p className="text-sm text-muted-foreground">
                        {tr(language, "Expires in", "หมดอายุใน")}{" "}
                        {admin.generatedResetTokenTTL ?? "-"}{" "}
                        {tr(language, "seconds", "วินาที")}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={admin.handleCopyGeneratedResetToken}
                      >
                        {tr(language, "Copy reset token", "คัดลอกโทเคนรีเซ็ต")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </SettingsDisclosure>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
