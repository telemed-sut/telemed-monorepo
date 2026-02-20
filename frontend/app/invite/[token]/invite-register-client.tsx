"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { acceptInvite, getInviteInfo, ROLE_LABEL_MAP, CLINICAL_ROLES } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

export default function InviteRegisterClientPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

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
  const isClinicalInvite = CLINICAL_ROLES.has(role);

  useEffect(() => {
    const loadInvite = async () => {
      try {
        setLoading(true);
        const info = await getInviteInfo(token);
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
    loadInvite();
  }, [token, language]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(tr(language, "Password must be at least 8 characters", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"));
      return;
    }
    if (password !== confirmPassword) {
      setError(tr(language, "Passwords do not match", "รหัสผ่านไม่ตรงกัน"));
      return;
    }
    if (isClinicalInvite && !licenseNo.trim()) {
      setError(tr(language, "License number is required for clinical roles.", "ตำแหน่งสายคลินิกต้องระบุเลขใบอนุญาต"));
      return;
    }

    try {
      setSubmitting(true);
      await acceptInvite(token, {
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        password,
        license_no: licenseNo || undefined,
      });
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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 border-border shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-end">
            <div className="inline-flex rounded-md border border-input bg-background p-0.5">
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`h-7 rounded px-2 text-xs transition-colors ${option.value === language
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
          <h2 className="text-2xl font-semibold">
            {tr(language, "Complete your account setup", "ตั้งค่าบัญชีของคุณให้เสร็จ")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tr(language, "This invitation was created by an administrator.", "คำเชิญนี้ถูกสร้างโดยผู้ดูแลระบบ")}
          </p>
        </CardHeader>
        <CardContent>
          {error && !email ? (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Link href="/login" className="text-primary hover:underline text-sm">
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
                  value={language === "th"
                    ? ({
                      admin: "ผู้ดูแลระบบ",
                      doctor: "แพทย์",
                      staff: "เจ้าหน้าที่",
                      nurse: "พยาบาล",
                      pharmacist: "เภสัชกร",
                      medical_technologist: "นักเทคนิคการแพทย์",
                      psychologist: "นักจิตวิทยา",
                    }[role] || role)
                    : (ROLE_LABEL_MAP[role] || role)}
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
                  <p className="text-xs text-muted-foreground">
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
                <p className="text-sm text-destructive" role="alert">
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
