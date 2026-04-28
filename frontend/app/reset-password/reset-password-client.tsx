"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuthMessage } from "@/components/auth/auth-message";
import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthErrorMessage, resetPassword } from "@/lib/api";
import { type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function ResetPasswordForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const language = useLanguageStore((state) => state.language);

  const [tokenValue, setTokenValue] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashToken = new URLSearchParams(hash).get("token");

    if (hashToken?.trim()) {
      setTokenValue(hashToken.trim());
      return;
    }

    if (initialToken.trim()) {
      setTokenValue(initialToken.trim());
      window.history.replaceState(null, "", "/reset-password");
    }
  }, [initialToken]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      router.replace("/login");
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [router, successMessage]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    const token = tokenValue.trim();

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
      setSuccessMessage(
        tr(
          language,
          "Password updated. Redirecting to sign in...",
          "อัปเดตรหัสผ่านแล้ว กำลังพากลับไปหน้าเข้าสู่ระบบ..."
        )
      );
    } catch (err) {
      setError(getAuthErrorMessage(language, err, "reset-password"));
    } finally {
      setLoading(false);
    }
  };

  const hasToken = tokenValue.trim().length > 0;

  return (
    <AuthShell
      title={tr(language, "Reset password", "ตั้งรหัสผ่านใหม่")}
      subtitle={tr(language, "Create a new password to continue.", "ตั้งรหัสผ่านใหม่เพื่อดำเนินการต่อ")}
      metaText={
        hasToken
          ? tr(language, "Your reset link is ready.", "ลิงก์รีเซ็ตของคุณพร้อมใช้งานแล้ว")
          : tr(language, "Paste your reset token to continue.", "วางโทเคนรีเซ็ตเพื่อดำเนินการต่อ")
      }
      contentClassName="space-y-5"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!hasToken ? (
          <div className="space-y-2">
            <Label htmlFor="token">{tr(language, "Reset token", "รีเซ็ตโทเคน")}</Label>
            <Input
              id="token"
              required
              autoFocus
              value={tokenValue}
              onChange={(event) => setTokenValue(event.target.value)}
              placeholder={tr(language, "Paste reset token", "วางรีเซ็ตโทเคน")}
            />
          </div>
        ) : (
          <AuthMessage tone="info" className="text-left text-[0.92rem]">
            {tr(language, "Reset link detected. You can set a new password below.", "ตรวจพบลิงก์รีเซ็ตแล้ว คุณสามารถตั้งรหัสผ่านใหม่ด้านล่างได้")}
          </AuthMessage>
        )}

        <div className="space-y-2">
          <Label htmlFor="new_password">{tr(language, "New password", "รหัสผ่านใหม่")}</Label>
          <Input
            id="new_password"
            type="password"
            required
            autoFocus={hasToken}
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
          <AuthMessage>
            {error}
          </AuthMessage>
        )}

        {successMessage && (
          <AuthMessage tone="success">
            {successMessage}
          </AuthMessage>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading
            ? tr(language, "Updating password...", "กำลังอัปเดตรหัสผ่าน...")
            : tr(language, "Update password", "อัปเดตรหัสผ่าน")}
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

export default function ResetPasswordClientPage({
  initialToken,
}: {
  initialToken: string;
}) {
  return <ResetPasswordForm initialToken={initialToken} />;
}
