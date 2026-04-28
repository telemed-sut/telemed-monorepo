"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Eye, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import {
  fetchCurrentUser,
  getAuthErrorMessage,
  getLoginRedirectPath,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  const userId = useAuthStore((state) => state.userId);
  const currentUser = useAuthStore((state) => state.currentUser);
  const authSource = useAuthStore((state) => state.authSource);
  const ssoProvider = useAuthStore((state) => state.ssoProvider);
  const setSession = useAuthStore((state) => state.setSession);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [resolvedAuthSource, setResolvedAuthSource] = useState<string | null>(null);
  const [resolvedSsoProvider, setResolvedSsoProvider] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loadingIdentity, setLoadingIdentity] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

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
  const otpActionLabel = tr(
    language,
    "Verify code and continue",
    "ยืนยันรหัสแล้วทำต่อ",
  );
  const effectiveAuthSource = resolvedAuthSource ?? authSource;
  const effectiveSsoProvider = resolvedSsoProvider ?? ssoProvider;
  const isSsoSession = effectiveAuthSource === "sso";

  const ssoMessage = useMemo(
    () =>
      tr(
        language,
        `This session is managed by ${effectiveSsoProvider || "your organization"}. Refresh your secure sign-in, then return and try again.`,
        `เซสชันนี้จัดการโดย ${effectiveSsoProvider || "องค์กรของคุณ"} กรุณายืนยันการลงชื่อเข้าใช้อย่างปลอดภัยใหม่ แล้วกลับมาลองอีกครั้ง`,
      ),
    [effectiveSsoProvider, language],
  );

  useEffect(() => {
    if (!open) {
      setEmail("");
      setResolvedAuthSource(null);
      setResolvedSsoProvider(null);
      setPassword("");
      setOtpCode("");
      setRequiresOtp(false);
      setRememberDevice(false);
      setSubmitting(false);
      setError(null);
      return;
    }

    if (!token) {
      return;
    }

    if (currentUser && (!userId || currentUser.id === userId)) {
      setEmail(currentUser.email ?? "");
      setResolvedAuthSource(currentUser.auth_source ?? authSource ?? "local");
      setResolvedSsoProvider(currentUser.sso_provider ?? null);
    }

    let cancelled = false;

    const loadIdentity = async () => {
      setLoadingIdentity(true);
      try {
        const nextCurrentUser = await fetchCurrentUser(token);
        if (!cancelled) {
          if (userId && nextCurrentUser.id !== userId) {
            return;
          }
          setCurrentUser(nextCurrentUser);
          setEmail(nextCurrentUser.email ?? "");
          setResolvedAuthSource(nextCurrentUser.auth_source ?? authSource ?? "local");
          setResolvedSsoProvider(nextCurrentUser.sso_provider ?? null);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace(getLoginRedirectPath("session_missing"));
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
  }, [authSource, clearToken, currentUser, language, open, router, token, userId, setCurrentUser]);

  useEffect(() => {
    if (!requiresOtp) {
      return;
    }

    otpInputRef.current?.focus();
  }, [requiresOtp]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      router.replace(getLoginRedirectPath("session_missing"));
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

      const response = await stepUpAuth(password, otpCode, rememberDevice, token);
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
      setRememberDevice(false);
      onOpenChange(false);
      toast.success(tr(language, "Secure verification refreshed", "รีเฟรชการยืนยันตัวตนแล้ว"));
      await onSuccess?.();
    } catch (err) {
      const apiError = err as ApiError;
      const detail = apiError.detail as Admin2FAErrorDetail | undefined;

      if (detail?.code === "two_factor_required" || detail?.code === "admin_2fa_required") {
        setRequiresOtp(true);
        setError(
          tr(
            language,
            "Enter the 6-digit code from your authenticator app, or use a backup code.",
            "กรอกรหัส 6 หลักจากแอปยืนยันตัวตน หรือใช้รหัสสำรอง",
          ),
        );
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
                {tr(language, "Current account password", "รหัสผ่านของบัญชีนี้")}
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
                placeholder={tr(
                  language,
                  "Enter the password for this account",
                  "กรอกรหัสผ่านของบัญชีนี้",
                )}
                disabled={submitting || loadingIdentity}
              />
              <p className="text-sm text-muted-foreground">
                {email
                  ? tr(
                      language,
                      `Use the same password you use to sign in as ${email}. This is not the OTP or verification code.`,
                      `ใช้รหัสเดียวกับที่คุณใช้ล็อกอินเป็น ${email} ไม่ใช่รหัส OTP หรือรหัสยืนยัน`,
                    )
                  : tr(
                      language,
                      "Use the same password you use to sign in to this dashboard. This is not the OTP or verification code.",
                      "ใช้รหัสเดียวกับที่คุณใช้ล็อกอินเข้าแดชบอร์ดนี้ ไม่ใช่รหัส OTP หรือรหัสยืนยัน",
                    )}
              </p>
            </div>

            {requiresOtp ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <p>
                      {tr(
                        language,
                        "Password confirmed. Step 2 of 2: enter the current code from your authenticator app or a backup code to finish.",
                        "รหัสผ่านถูกต้องแล้ว ขั้นตอนที่ 2 จาก 2: กรอกรหัสล่าสุดจากแอปยืนยันตัวตน หรือใช้รหัสสำรองเพื่อทำรายการต่อ",
                      )}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="secure-session-otp">
                    {tr(language, "Authenticator or backup code", "รหัสจากแอปยืนยันตัวตนหรือรหัสสำรอง")}
                  </Label>
                  <Input
                    id="secure-session-otp"
                    ref={otpInputRef}
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
                  <p className="text-sm text-muted-foreground">
                    {tr(
                      language,
                      "Use the current 6-digit code from your authenticator app, or one of your backup codes from Security settings.",
                      "ใช้รหัส 6 หลักล่าสุดจากแอปยืนยันตัวตน หรือใช้รหัสสำรองจากหน้า Security settings",
                    )}
                  </p>
                </div>

                <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="secure-session-remember-device"
                      checked={rememberDevice}
                      onCheckedChange={(value) => setRememberDevice(Boolean(value))}
                      disabled={submitting}
                    />
                    <Label
                      htmlFor="secure-session-remember-device"
                      className="cursor-pointer text-sm font-medium"
                    >
                      {tr(
                        language,
                        "Trust this device for secure actions",
                        "เชื่อถืออุปกรณ์นี้สำหรับงานที่ต้องยืนยันตัวตน",
                      )}
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {tr(
                      language,
                      "Future protected actions on this browser will ask for fewer codes, based on your trusted-device policy.",
                      "งานที่ถูกปกป้องครั้งถัดไปบนเบราว์เซอร์นี้จะถามรหัสน้อยลงตามนโยบายอุปกรณ์ที่เชื่อถือได้",
                    )}
                  </p>
                </div>
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
                {requiresOtp ? otpActionLabel : primaryActionLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
