"use client";

import { KeyRound, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { SettingsLanguage } from "./settings-types";
import { formatDateTime, tr } from "./settings-utils";
import { SettingsDisclosure } from "./settings-disclosure";
import type { useSettingsSecurity } from "./use-settings-security";

interface SecuritySettingsPanelProps {
  language: SettingsLanguage;
  isAdmin: boolean;
  security: ReturnType<typeof useSettingsSecurity>;
}

export function SecuritySettingsPanel({
  language,
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
            "Manage passkeys for faster, phishing-resistant sign-in.",
            "จัดการ Passkeys สำหรับการเข้าสู่ระบบที่เร็วและปลอดภัยขึ้น",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border bg-muted/20 px-3 py-1 text-xs font-medium text-foreground">
            {security.securityHeaderSummary}
          </span>
        </div>

        <SettingsDisclosure
          open={security.securitySectionOpen === "passkeys"}
          onOpenChange={(open) =>
            security.setSecuritySectionOpen(open ? "passkeys" : null)
          }
          title={tr(language, "Passkeys", "Passkeys")}
          description={tr(
            language,
            "Use biometrics or device unlock for a secure sign-in option.",
            "ใช้การปลดล็อกอุปกรณ์หรือชีวมิติเป็นทางเลือกเข้าสู่ระบบที่ปลอดภัย",
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
            {security.passkeys.length > 0 ? (
              <div className="space-y-2">
                {security.passkeys.map((pk) => (
                  <div
                    key={pk.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-muted/10 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {pk.name || tr(language, "Unnamed device", "อุปกรณ์ไม่มีชื่อ")}
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
              <p className="text-sm text-muted-foreground">
                {tr(language, "No passkeys registered yet.", "ยังไม่มีการลงทะเบียน Passkey")}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={security.handleRegisterPasskey}
                disabled={security.passkeyBusy}
              >
                <KeyRound className="mr-2 size-4" />
                {tr(language, "Register passkey", "ลงทะเบียน Passkey")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void security.refreshPasskeys()}
                disabled={security.passkeyBusy || security.passkeyLoading}
              >
                <RefreshCw className="mr-2 size-4" />
                {tr(language, "Refresh", "รีเฟรช")}
              </Button>
            </div>
          </div>
        </SettingsDisclosure>
      </CardContent>
    </Card>
  );
}
