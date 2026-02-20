"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/lib/api";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

export default function ForgotPasswordClientPage() {
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setResetToken(null);

    try {
      const response = await requestPasswordReset(email);
      setSuccessMessage(response.message);
      if (response.reset_token) {
        setResetToken(response.reset_token);
      }
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : tr(language, "Unable to request password reset", "ไม่สามารถส่งคำขอรีเซ็ตรหัสผ่านได้");
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
          <h2 className="text-2xl font-semibold">{tr(language, "Forgot password", "ลืมรหัสผ่าน")}</h2>
          <p className="text-sm text-muted-foreground">
            {tr(language, "Enter your work email to request a reset link.", "กรอกอีเมลที่ใช้ทำงานเพื่อขอลิงก์รีเซ็ตรหัสผ่าน")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr(
              language,
              "This is a closed system. New accounts are provisioned by administrators only.",
              "ระบบนี้เป็นระบบปิด การสร้างบัญชีใหม่ทำได้โดยผู้ดูแลระบบเท่านั้น"
            )}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{tr(language, "Email address", "อีเมล")}</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tr(language, "name@hospital.org", "name@hospital.org")}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="text-sm text-green-600" role="status">
                {successMessage}
              </p>
            )}

            {resetToken && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium mb-1">{tr(language, "Development token", "โทเคนสำหรับพัฒนา")}</p>
                <p className="break-all">{resetToken}</p>
                <Link className="text-primary hover:underline mt-2 inline-block" href={`/reset-password?token=${encodeURIComponent(resetToken)}`}>
                  {tr(language, "Continue to reset password", "ไปหน้าตั้งรหัสผ่านใหม่")}
                </Link>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? tr(language, "Submitting...", "กำลังส่งคำขอ...")
                : tr(language, "Request reset", "ขอรีเซ็ตรหัสผ่าน")}
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
