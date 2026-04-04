"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import {
  fetchCurrentUser,
  getAuthErrorMessage,
  getErrorMessage,
  stepUpAuth,
  type ApiError,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import type { AppLanguage } from "@/store/language-config";

interface Admin2FAErrorDetail {
  code?: string;
  message?: string;
}

interface SensitiveActionReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
  title?: string;
  description?: string;
  actionLabel?: string;
}

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

export function SensitiveActionReauthDialog({
  open,
  onOpenChange,
  onSuccess,
  title,
  description,
  actionLabel,
}: SensitiveActionReauthDialogProps) {
  const token = useAuthStore((state) => state.token);
  const authSource = useAuthStore((state) => state.authSource);
  const ssoProvider = useAuthStore((state) => state.ssoProvider);
  const setSession = useAuthStore((state) => state.setSession);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loadingIdentity, setLoadingIdentity] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogTitle = title ?? tr(language, "Confirm your identity", "ยืนยันตัวตนอีกครั้ง");
  const dialogDescription =
    description ??
    tr(
      language,
      "A recent secure verification is required before continuing with this protected action.",
      "จำเป็นต้องยืนยันตัวตนล่าสุดอีกครั้งก่อนทำรายการที่ถูกปกป้องนี้",
    );
  const primaryActionLabel =
    actionLabel ?? tr(language, "Continue securely", "ดำเนินการต่ออย่างปลอดภัย");
  const isSsoSession = authSource === "sso";

  const ssoMessage = useMemo(
    () =>
      tr(
        language,
        `This session is managed by ${ssoProvider || "your organization"}. Refresh your secure sign-in, then return and try again.`,
        `เซสชันนี้จัดการโดย ${ssoProvider || "องค์กรของคุณ"} กรุณายืนยันการลงชื่อเข้าใช้อย่างปลอดภัยใหม่ แล้วกลับมาลองอีกครั้ง`,
      ),
    [language, ssoProvider],
  );

  useEffect(() => {
    if (!open) {
      setPassword("");
      setOtpCode("");
      setRequiresOtp(false);
      setSubmitting(false);
      setError(null);
      return;
    }

    if (isSsoSession || !token) {
      return;
    }

    let cancelled = false;

    const loadIdentity = async () => {
      setLoadingIdentity(true);
      try {
        const currentUser = await fetchCurrentUser(token);
        if (!cancelled) {
          setEmail(currentUser.email ?? "");
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(
          getErrorMessage(
            err,
            tr(language, "Unable to prepare secure verification.", "ไม่สามารถเตรียมการยืนยันตัวตนได้"),
          ),
        );
      } finally {
        if (!cancelled) {
          setLoadingIdentity(false);
        }
      }
    };

    void loadIdentity();
    return () => {
      cancelled = true;
    };
  }, [clearToken, isSsoSession, language, open, router, token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      router.replace("/login");
      return;
    }

    if (!isSsoSession && !password.trim()) {
      setError(tr(language, "Please enter your password.", "กรุณากรอกรหัสผ่าน"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isSsoSession) {
        window.location.assign("/login");
        return;
      }

      const response = await stepUpAuth(password, otpCode, false, token);
      if (!response.user) {
        throw new Error(
          tr(
            language,
            "Unable to refresh the secure session. Please try again.",
            "ไม่สามารถรีเฟรช secure session ได้ กรุณาลองอีกครั้ง",
          ),
        );
      }

      setSession(response);
      setPassword("");
      setOtpCode("");
      setRequiresOtp(false);
      onOpenChange(false);
      toast.success(tr(language, "Secure verification refreshed", "รีเฟรชการยืนยันตัวตนแล้ว"));
      await onSuccess?.();
    } catch (err) {
      const apiError = err as ApiError;
      const detail = apiError.detail as Admin2FAErrorDetail | undefined;

      if (detail?.code === "two_factor_required" || detail?.code === "admin_2fa_required") {
        setRequiresOtp(true);
        setError(tr(language, "Enter your verification code to continue.", "กรอกรหัสยืนยันเพื่อดำเนินการต่อ"));
        return;
      }

      setError(getAuthErrorMessage(language, err, "step-up"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader className="pr-8">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-2.5 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </div>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {isSsoSession ? (
          <div className="space-y-4 rounded-2xl border border-amber-200/70 bg-amber-50/80 p-4 text-sm text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{ssoMessage}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tr(language, "Close", "ปิด")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  window.location.assign("/login");
                }}
              >
                <LockKeyhole className="size-4" />
                {tr(language, "Open secure sign-in", "เปิดหน้าเข้าสู่ระบบที่ปลอดภัย")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="secure-session-email">
                {tr(language, "Account", "บัญชี")}
              </Label>
              <Input
                id="secure-session-email"
                value={email}
                disabled
                readOnly
                placeholder={
                  loadingIdentity
                    ? tr(language, "Loading account...", "กำลังโหลดบัญชี...")
                    : tr(language, "Account email", "อีเมลบัญชี")
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="secure-session-password">
                {tr(language, "Password", "รหัสผ่าน")}
              </Label>
              <Input
                id="secure-session-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                placeholder={tr(language, "Enter your password", "กรอกรหัสผ่าน")}
                disabled={submitting || loadingIdentity}
              />
            </div>

            {requiresOtp ? (
              <div className="space-y-2">
                <Label htmlFor="secure-session-otp">
                  {tr(language, "Verification code", "รหัสยืนยัน")}
                </Label>
                <Input
                  id="secure-session-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(event) => {
                    setOtpCode(event.target.value);
                    setError(null);
                  }}
                  placeholder={tr(language, "6-digit code or backup code", "รหัส 6 หลักหรือรหัสสำรอง")}
                  disabled={submitting}
                />
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <Eye className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  {tr(
                    language,
                    "This refreshes only the secure session for protected actions. You will stay in the current workflow.",
                    "การยืนยันนี้มีผลเฉพาะ secure session สำหรับงานที่ถูกปกป้อง และคุณจะยังอยู่ใน workflow เดิม",
                  )}
                </p>
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
                {error}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                {tr(language, "Cancel", "ยกเลิก")}
              </Button>
              <Button type="submit" disabled={submitting || loadingIdentity || !email}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
                {primaryActionLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
