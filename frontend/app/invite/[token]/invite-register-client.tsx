"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptInvite, getInviteInfo, getRoleLabel, CLINICAL_ROLES } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const USER_REGISTRATION_SIGNAL_KEY = "telemed:user-registered";
const USER_REGISTRATION_CHANNEL = "telemed-user-events";

function notifyUserRegistered(): void {
  if (typeof window === "undefined") return;

  const signal = {
    type: "user.registered",
    occurredAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(USER_REGISTRATION_SIGNAL_KEY, JSON.stringify(signal));
  } catch {
    // Best-effort cross-tab refresh signal.
  }

  if (typeof window.BroadcastChannel !== "undefined") {
    try {
      const channel = new window.BroadcastChannel(USER_REGISTRATION_CHANNEL);
      channel.postMessage(signal);
      channel.close();
    } catch {
      // Ignore broadcast failures and rely on focus/storage fallback.
    }
  }
}

function timingSafeEqualStrings(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left.normalize("NFKC"));
  const rightBytes = encoder.encode(right.normalize("NFKC"));
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export default function InviteRegisterClientPage() {
  const router = useRouter();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [inviteToken, setInviteToken] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyPathTokenDetected, setLegacyPathTokenDetected] = useState(false);
  const isClinicalInvite = CLINICAL_ROLES.has(role);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashToken = new URLSearchParams(hash).get("token");

    if (hashToken?.trim()) {
      setInviteToken(hashToken.trim());
      if (window.location.pathname !== "/invite") {
        window.history.replaceState(
          null,
          "",
          `/invite#token=${encodeURIComponent(hashToken.trim())}`
        );
      }
      return;
    }

    if (window.location.pathname.startsWith("/invite/")) {
      setLegacyPathTokenDetected(true);
      window.history.replaceState(null, "", "/invite");
    }
  }, []);

  useEffect(() => {
    if (!inviteToken.trim()) {
      setLoading(false);
      setError(
        legacyPathTokenDetected
          ? tr(
            language,
            "This invite link format is no longer supported. Ask an administrator to resend the invite.",
            "รูปแบบลิงก์คำเชิญนี้เลิกใช้งานแล้ว กรุณาให้ผู้ดูแลระบบส่งคำเชิญใหม่"
          )
          : tr(language, "Invite link is invalid or expired", "ลิงก์คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว")
      );
      return;
    }

    const loadInvite = async () => {
      try {
        setLoading(true);
        const info = await getInviteInfo(inviteToken);
        setEmail(info.email);
        setRole(info.role);
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : tr(language, "Invite link is invalid or expired", "ลิงก์คำเชิญไม่ถูกต้องหรือหมดอายุแล้ว");
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    void loadInvite();
  }, [inviteToken, language, legacyPathTokenDetected]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(tr(language, "Password must be at least 8 characters", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"));
      return;
    }
    if (!timingSafeEqualStrings(password, confirmPassword)) {
      setError(tr(language, "Passwords do not match", "รหัสผ่านไม่ตรงกัน"));
      return;
    }
    if (isClinicalInvite && !licenseNo.trim()) {
      setError(tr(language, "License number is required for clinical roles.", "ตำแหน่งสายคลินิกต้องระบุเลขใบอนุญาต"));
      return;
    }

    try {
      setSubmitting(true);
      await acceptInvite(inviteToken, {
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        password,
        license_no: licenseNo || undefined,
      });
      notifyUserRegistered();
      router.replace("/login");
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : tr(language, "Failed to create account", "ไม่สามารถสร้างบัญชีได้");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">
          {tr(language, "Loading invite...", "กำลังโหลดคำเชิญ...")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="mx-4 w-full max-w-xl border-border shadow-xl">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-end">
            <div className="inline-flex rounded-md border border-input bg-background p-0.5">
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`h-8 rounded px-2.5 text-[0.9rem] transition-colors ${option.value === language
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                    }`}
                  onClick={() => setLanguage(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">
            {tr(language, "Complete your account setup", "ตั้งค่าบัญชีของคุณให้เสร็จ")}
          </h2>
          <p className="text-[0.98rem] text-muted-foreground">
            {tr(language, "This invitation was created by an administrator.", "คำเชิญนี้ถูกสร้างโดยผู้ดูแลระบบ")}
          </p>
        </CardHeader>
        <CardContent>
          {error && !email ? (
            <div className="space-y-4">
              <p className="text-[0.95rem] text-destructive">{error}</p>
              <Link href="/login" className="text-[0.95rem] text-primary hover:underline">
                {tr(language, "Back to sign in", "กลับไปหน้าเข้าสู่ระบบ")}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>{tr(language, "Email", "อีเมล")}</Label>
                <Input value={email} disabled />
              </div>

              <div className="space-y-2">
                <Label>{tr(language, "Assigned role", "บทบาทที่ได้รับมอบหมาย")}</Label>
                <Input
                  value={getRoleLabel(role, language)}
                  disabled
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name">{tr(language, "First name", "ชื่อ")}</Label>
                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={tr(language, "First name", "ชื่อ")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">{tr(language, "Last name", "นามสกุล")}</Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={tr(language, "Last name", "นามสกุล")}
                  />
                </div>
              </div>

              {isClinicalInvite && (
                <div className="space-y-2">
                  <Label htmlFor="license_no">
                    {tr(language, "License Number", "เลขใบอนุญาต")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="license_no"
                    value={licenseNo}
                    required
                    onChange={(e) => setLicenseNo(e.target.value)}
                    placeholder={tr(language, "e.g., MD-12345", "เช่น MD-12345")}
                  />
                  <p className="text-[0.88rem] text-muted-foreground">
                    {tr(language, "Required for clinical roles.", "จำเป็นสำหรับตำแหน่งสายคลินิก")}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">{tr(language, "Password", "รหัสผ่าน")}</Label>
                <Input
                  id="password"
                  type="password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tr(language, "At least 8 characters", "อย่างน้อย 8 ตัวอักษร")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm_password">{tr(language, "Confirm password", "ยืนยันรหัสผ่าน")}</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  minLength={8}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={tr(language, "Re-enter password", "กรอกรหัสผ่านอีกครั้ง")}
                />
              </div>

              {error && (
                <p className="text-[0.95rem] text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? tr(language, "Creating account...", "กำลังสร้างบัญชี...")
                  : tr(language, "Create account", "สร้างบัญชี")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
