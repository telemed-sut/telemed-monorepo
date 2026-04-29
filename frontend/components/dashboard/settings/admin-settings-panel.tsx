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
  canManagePrivilegedAdmins: boolean;
  admin: ReturnType<typeof useSettingsAdmin>;
  getRoleLabel: (role: string, language: SettingsLanguage) => string;
}

export function AdminSettingsPanel({
  language,
  canManagePrivilegedAdmins,
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
                  "Generate one-time admin invites from one advanced area.",
                  "สร้างลิงก์คำเชิญแอดมินแบบใช้ครั้งเดียวจากส่วนขั้นสูงนี้",
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
                      "This issues an admin invite link. Share it securely. The invited admin will set a password before signing in.",
                      "ระบบจะออกลิงก์คำเชิญสำหรับแอดมิน ควรส่งลิงก์อย่างปลอดภัย โดยผู้ได้รับเชิญจะตั้งรหัสผ่านก่อนเข้าใช้งาน",
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
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
