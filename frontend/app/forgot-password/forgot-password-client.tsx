"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { getAuthErrorMessage, requestPasswordReset } from "@/lib/api";
import { type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const showDevelopmentToken = process.env.NEXT_PUBLIC_SHOW_DEV_RESET_TOKEN === "true";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

export default function ForgotPasswordClientPage() {
  const language = useLanguageStore((state) => state.language);
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
      setSuccessMessage(
        tr(
          language,
          "If this email is in the system, we will send a reset link.",
          "หากอีเมลนี้อยู่ในระบบ เราจะส่งลิงก์รีเซ็ตให้"
        )
      );
      if (response.reset_token) {
        setResetToken(response.reset_token);
      }
    } catch (err) {
      setError(getAuthErrorMessage(language, err, "forgot-password"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={tr(language, "Forgot password", "ลืมรหัสผ่าน")}
      subtitle={tr(language, "Enter your email to receive a reset link.", "กรอกอีเมลเพื่อรับลิงก์รีเซ็ตรหัสผ่าน")}
      metaText={tr(
        language,
        "New user accounts are created by administrators.",
        "บัญชีผู้ใช้ใหม่จะถูกสร้างโดยผู้ดูแลระบบ"
      )}
      contentClassName="space-y-5"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{tr(language, "Email address", "อีเมล")}</Label>
          <Input
            id="email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={tr(language, "name@example.com", "name@example.com")}
          />
        </div>

        {error && (
          <AuthMessage>
            {error}
          </AuthMessage>
        )}

        {successMessage && (
          <AuthMessage tone="success">
            {successMessage}
          </AuthMessage>
        )}

        {showDevelopmentToken && resetToken && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3.5 text-[0.95rem]">
            <p className="mb-1 font-medium">{tr(language, "Development token", "โทเคนสำหรับพัฒนา")}</p>
            <p className="break-all">{resetToken}</p>
            <Link className="mt-2 inline-block text-primary hover:underline" href={`/reset-password#token=${encodeURIComponent(resetToken)}`}>
              {tr(language, "Continue to reset password", "ไปหน้าตั้งรหัสผ่านใหม่")}
            </Link>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading
            ? tr(language, "Submitting...", "กำลังส่งคำขอ...")
            : tr(language, "Send reset link", "ส่งลิงก์รีเซ็ตรหัสผ่าน")}
        </Button>
      </form>

      <div className="text-center text-[0.92rem]">
        <Link href="/login" className="text-primary hover:underline">
          {tr(language, "Back to sign in", "กลับไปหน้าเข้าสู่ระบบ")}
        </Link>
      </div>
    </AuthShell>
  );
}
