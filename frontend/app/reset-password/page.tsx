"use client";

import { FormEvent, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/api";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromQuery = searchParams.get("token") || "";
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [token, setToken] = useState(tokenFromQuery);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError(tr(language, "Reset token is required", "ต้องระบุรีเซ็ตโทเคน"));
      return;
    }
    if (newPassword.length < 8) {
      setError(tr(language, "Password must be at least 8 characters", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(tr(language, "Passwords do not match", "รหัสผ่านไม่ตรงกัน"));
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      router.replace("/login");
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : tr(language, "Unable to reset password", "ไม่สามารถรีเซ็ตรหัสผ่านได้");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

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
          <h2 className="text-2xl font-semibold">{tr(language, "Reset password", "ตั้งรหัสผ่านใหม่")}</h2>
          <p className="text-sm text-muted-foreground">
            {tr(language, "Enter your reset token and set a new password.", "กรอกรีเซ็ตโทเคนและตั้งรหัสผ่านใหม่")}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">{tr(language, "Reset token", "รีเซ็ตโทเคน")}</Label>
              <Input
                id="token"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tr(language, "Paste reset token", "วางรีเซ็ตโทเคน")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_password">{tr(language, "New password", "รหัสผ่านใหม่")}</Label>
              <Input
                id="new_password"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={tr(language, "At least 8 characters", "อย่างน้อย 8 ตัวอักษร")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm_password">{tr(language, "Confirm password", "ยืนยันรหัสผ่าน")}</Label>
              <Input
                id="confirm_password"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={tr(language, "Re-enter new password", "กรอกรหัสผ่านใหม่อีกครั้ง")}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? tr(language, "Resetting...", "กำลังรีเซ็ต...")
                : tr(language, "Reset password", "รีเซ็ตรหัสผ่าน")}
            </Button>
          </form>

          <div className="mt-4 text-sm text-center">
            <Link href="/login" className="text-primary hover:underline">
              {tr(language, "Back to sign in", "กลับไปหน้าเข้าสู่ระบบ")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
