"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { SettingsLanguage } from "./settings-types";
import { tr } from "./settings-utils";
import type { useSettingsProfile } from "./use-settings-profile";

interface AccountSettingsPanelProps {
  language: SettingsLanguage;
  isAdmin: boolean;
  logout: () => void;
  profile: ReturnType<typeof useSettingsProfile>;
  getRoleLabel: (role: string, language: SettingsLanguage) => string;
}

export function AccountSettingsPanel({
  language,
  isAdmin,
  logout,
  profile,
  getRoleLabel,
}: AccountSettingsPanelProps) {
  return (
    <Card
      size="sm"
      className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
    >
      <CardHeader>
        <CardTitle>
          {tr(language, "Profile, Access & Session", "โปรไฟล์ การเข้าใช้งาน และเซสชัน")}
        </CardTitle>
        <CardDescription>
          {tr(
            language,
            "Edit your profile and review sign-in details and the current session in one place.",
            "แก้ไขโปรไฟล์ พร้อมดูวิธีเข้าสู่ระบบและเซสชันปัจจุบันได้ในที่เดียว",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.profileLoading ? (
          <p className="text-sm text-muted-foreground">
            {tr(language, "Loading profile...", "กำลังโหลดโปรไฟล์...")}
          </p>
        ) : (
          <form className="space-y-4" onSubmit={profile.handleSaveProfile}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-first-name">
                  {tr(language, "First name", "ชื่อ")}
                </Label>
                <Input
                  id="settings-first-name"
                  value={profile.firstName}
                  onChange={(event) => profile.setFirstName(event.target.value)}
                  placeholder={tr(language, "First name", "ชื่อ")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-last-name">
                  {tr(language, "Last name", "นามสกุล")}
                </Label>
                <Input
                  id="settings-last-name"
                  value={profile.lastName}
                  onChange={(event) => profile.setLastName(event.target.value)}
                  placeholder={tr(language, "Last name", "นามสกุล")}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-email">
                  {tr(language, "Email", "อีเมล")}
                </Label>
                <Input
                  id="settings-email"
                  value={profile.currentUser?.email || ""}
                  disabled
                  readOnly
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-role">
                  {tr(language, "Role", "บทบาท")}
                </Label>
                <Input
                  id="settings-role"
                  value={
                    profile.currentUser
                      ? getRoleLabel(profile.currentUser.role, language)
                      : ""
                  }
                  disabled
                  readOnly
                />
              </div>
            </div>

            {profile.hasPrivilegedAccess ? (
              <div className="space-y-2">
                <Label htmlFor="settings-privileged-access">
                  {tr(language, "Access class", "ชั้นการเข้าถึง")}
                </Label>
                <Input
                  id="settings-privileged-access"
                  value={
                    profile.privilegedAccessCodename ||
                    tr(
                      language,
                      "Protected until recent verification",
                      "ปกป้องไว้จนกว่าจะยืนยันล่าสุด",
                    )
                  }
                  disabled
                  readOnly
                />
                {profile.privilegedAccessProtected ? (
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      language,
                      "Detailed privileged access stays hidden until this session was verified recently.",
                      "รายละเอียดสิทธิพิเศษจะยังไม่แสดงจนกว่าเซสชันนี้จะยืนยันล่าสุด",
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={!profile.hasProfileChanges || profile.profileSaving}
              >
                {profile.profileSaving
                  ? tr(language, "Saving...", "กำลังบันทึก...")
                  : tr(language, "Save changes", "บันทึกการเปลี่ยนแปลง")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={profile.handleResetProfile}
                disabled={profile.profileSaving || !profile.hasProfileChanges}
              >
                {tr(language, "Reset", "รีเซ็ต")}
              </Button>
            </div>
          </form>
        )}

        <div
          className={cn(
            "grid gap-2 sm:grid-cols-2",
            isAdmin && "xl:grid-cols-4",
            !isAdmin && "xl:grid-cols-3",
          )}
        >
          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {tr(language, "Login method", "วิธีเข้าสู่ระบบ")}
            </p>
            <p className="mt-1 text-sm font-medium">{profile.loginMethodSummary}</p>
            {profile.ssoProvider ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {profile.ssoProvider}
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {tr(language, "Verification", "การยืนยัน")}
            </p>
            <p className="mt-1 text-sm font-medium">{profile.sessionVerificationSummary}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tr(language, "Last verified", "ยืนยันล่าสุด")}{" "}
              {profile.mfaAuthenticatedAtLabel}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {tr(language, "Session", "เซสชัน")}
            </p>
            <p className="mt-1 text-sm font-medium">{profile.ttlLabel}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tr(language, "Token time remaining", "เวลาโทเคนคงเหลือ")}
            </p>
          </div>
          {isAdmin ? (
            <div className="rounded-2xl border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                {tr(language, "Access source", "แหล่งสิทธิ")}
              </p>
              <p className="mt-1 text-sm font-medium">
                {tr(language, "DB-backed assignments", "สิทธิที่ผูกกับฐานข้อมูล")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tr(language, "Env remains fallback only", "env เป็น fallback เท่านั้น")}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={logout}>
            {tr(language, "Log out", "ออกจากระบบ")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
