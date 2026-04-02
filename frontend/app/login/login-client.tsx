"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  fetchAdminSsoStatus,
  getAuthErrorMessage,
  getAdminSsoLoginPath,
  login as loginRequest,
  type AdminSsoStatus,
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { AuthMessage } from "@/components/auth/auth-message";
import { SecretDisclosure } from "@/components/auth/secret-disclosure";
import { AuthShell } from "@/components/auth/auth-shell";
import { type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

interface Admin2FAErrorDetail {
  code?: string;
  message?: string;
  required?: boolean;
  setup_required?: boolean;
  issuer?: string;
  trusted_device_days?: number;
  provisioning_uri?: string;
}

type LoginStep = "credentials" | "twoFactor";

function extractSetupKey(uri: string | null): string | null {
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("secret");
  } catch {
    return null;
  }
}

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

export default function LoginClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((state) => state.token);
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const setSession = useAuthStore((state) => state.setSession);
  const language = useLanguageStore((state) => state.language);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [loginStep, setLoginStep] = useState<LoginStep>("credentials");
  const [otpCode, setOtpCode] = useState("");
  const [provisioningUri, setProvisioningUri] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [trustedDays, setTrustedDays] = useState<number | null>(null);
  const [adminSsoStatus, setAdminSsoStatus] = useState<AdminSsoStatus | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && token) {
      router.replace("/patients");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    let cancelled = false;
    async function buildQr() {
      if (!provisioningUri) {
        setQrCodeDataUrl(null);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(provisioningUri, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrCodeDataUrl(null);
        }
      }
    }
    void buildQr();
    return () => {
      cancelled = true;
    };
  }, [provisioningUri]);

  useEffect(() => {
    let cancelled = false;

    const loadAdminSsoStatus = async () => {
      try {
        const status = await fetchAdminSsoStatus();
        if (!cancelled) {
          setAdminSsoStatus(status);
        }
      } catch {
        if (!cancelled) {
          setAdminSsoStatus(null);
        }
      }
    };

    void loadAdminSsoStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const errorCode = searchParams.get("error");
    const reason = searchParams.get("reason");
    if (errorCode !== "admin_sso_failed") {
      return;
    }

    const reasonMessages: Record<string, { en: string; th: string }> = {
      provider_error: {
        en: "Organization SSO was cancelled or denied by the identity provider.",
        th: "การเข้าสู่ระบบผ่าน Organization SSO ถูกยกเลิกหรือถูกปฏิเสธจากผู้ให้บริการยืนยันตัวตน",
      },
      invalid_state: {
        en: "Organization SSO session expired. Please try again.",
        th: "เซสชัน Organization SSO หมดอายุแล้ว กรุณาลองใหม่อีกครั้ง",
      },
      missing_state_cookie: {
        en: "Organization SSO session cookie is missing. Please start sign-in again from this browser.",
        th: "ไม่พบคุกกี้เซสชันของ Organization SSO กรุณาเริ่มเข้าสู่ระบบใหม่จากเบราว์เซอร์นี้",
      },
      expired_sso_session: {
        en: "Organization SSO session expired before the callback completed. Please try again.",
        th: "เซสชัน Organization SSO หมดอายุก่อนดำเนินการ callback เสร็จ กรุณาลองใหม่อีกครั้ง",
      },
      provider_exchange: {
        en: "Unable to complete Organization SSO. Please try again.",
        th: "ไม่สามารถดำเนินการเข้าสู่ระบบผ่าน Organization SSO ได้ กรุณาลองใหม่อีกครั้ง",
      },
      email_not_verified: {
        en: "Your organization account email must be verified before sign-in.",
        th: "อีเมลของบัญชีองค์กรต้องผ่านการยืนยันก่อนเข้าสู่ระบบ",
      },
      email_domain_not_allowed: {
        en: "This email domain is not approved for admin SSO.",
        th: "โดเมนอีเมลนี้ไม่ได้รับอนุญาตสำหรับ admin SSO",
      },
      required_group_missing: {
        en: "Your organization account is missing the required admin group.",
        th: "บัญชีองค์กรของคุณยังไม่อยู่ในกลุ่มผู้ดูแลที่กำหนด",
      },
      admin_account_not_found: {
        en: "No approved admin account was found for this organization identity.",
        th: "ไม่พบบัญชีผู้ดูแลที่ได้รับอนุมัติสำหรับตัวตนองค์กรนี้",
      },
      admin_role_required: {
        en: "This organization account is not allowed to access the admin workspace.",
        th: "บัญชีองค์กรนี้ไม่ได้รับสิทธิ์เข้าสู่พื้นที่ผู้ดูแลระบบ",
      },
      account_deactivated: {
        en: "This account has been deactivated.",
        th: "บัญชีนี้ถูกปิดการใช้งานแล้ว",
      },
      mfa_required: {
        en: "Admin SSO requires a passkey or MFA-verified organization session.",
        th: "Admin SSO ต้องใช้ passkey หรือเซสชันองค์กรที่ยืนยัน MFA แล้ว",
      },
    };

    const message = reason ? reasonMessages[reason] : null;
    setError(
      message
        ? tr(language, message.en, message.th)
        : tr(language, "Unable to complete Organization SSO. Please try again.", "ไม่สามารถดำเนินการเข้าสู่ระบบผ่าน Organization SSO ได้ กรุณาลองใหม่อีกครั้ง")
    );
  }, [language, searchParams]);

  const resetTwoFactorChallenge = () => {
    setLoginStep("credentials");
    setOtpCode("");
    setProvisioningUri(null);
    setTrustedDays(null);
    setQrCodeDataUrl(null);
    setError(null);
  };

  const isTwoFactorStep = loginStep === "twoFactor";
  const title = isTwoFactorStep
    ? tr(language, "Confirm sign-in", "ยืนยันการเข้าสู่ระบบ")
    : tr(language, "Welcome Back", "ยินดีต้อนรับกลับ");
  const subtitle = isTwoFactorStep
    ? tr(
        language,
        "Enter your code to continue.",
        "กรอกรหัสเพื่อดำเนินการต่อ"
      )
    : tr(language, "Sign in to continue securely.", "ลงชื่อเข้าใช้เพื่อดำเนินการต่ออย่างปลอดภัย");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await loginRequest(email, password, otpCode, rememberDevice);
      if (!res.user) {
        throw new Error(
          tr(language, "Unable to establish session. Please try again.", "ไม่สามารถเริ่มต้นเซสชันได้ โปรดลองอีกครั้ง")
        );
      }
      setSession(res);
      router.replace("/patients");
    } catch (err) {
      const apiError = err as ApiError;
      const detail = apiError.detail as Admin2FAErrorDetail | undefined;
      if (detail && (detail.code === "two_factor_required" || detail.code === "admin_2fa_required")) {
        setLoginStep("twoFactor");
        setProvisioningUri(detail.provisioning_uri ?? null);
        setTrustedDays(typeof detail.trusted_device_days === "number" ? detail.trusted_device_days : null);
        setError(tr(language, "Enter your code to continue.", "กรอกรหัสเพื่อดำเนินการต่อ"));
      } else if (apiError instanceof Error) {
        setError(getAuthErrorMessage(language, apiError, "login"));
      } else {
        setError(tr(language, "Unable to sign in. Please try again.", "ไม่สามารถเข้าสู่ระบบได้ โปรดลองอีกครั้ง"));
      }
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => setIsPasswordVisible((prev) => !prev);
  const adminSsoEnabled = Boolean(adminSsoStatus?.enabled);
  const adminSsoLoginHref = adminSsoStatus?.login_path
    ? `${adminSsoStatus.login_path}?next=${encodeURIComponent("/patients")}`
    : getAdminSsoLoginPath("/patients");

  if (!hydrated) {
    return null;
  }

  return (
    <AuthShell title={title} subtitle={subtitle}>
      {adminSsoEnabled ? (
        <div className="space-y-3 rounded-xl border border-sky-200/70 bg-sky-50/80 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-sky-950">
              {tr(language, "Admin access uses Organization SSO", "การเข้าถึงของผู้ดูแลใช้ Organization SSO")}
            </p>
            <p className="text-sm text-sky-900/80">
              {adminSsoStatus?.enforced_for_admin
                ? tr(
                    language,
                    "Admin accounts must sign in with your organization identity. Clinical accounts can continue with email and password below.",
                    "บัญชีผู้ดูแลต้องเข้าสู่ระบบด้วยตัวตนขององค์กร ส่วนบัญชีสายคลินิกยังใช้อีเมลและรหัสผ่านด้านล่างได้"
                  )
                : tr(
                    language,
                    "Use Organization SSO for admin accounts. Other accounts can continue with email and password below.",
                    "ใช้ Organization SSO สำหรับบัญชีผู้ดูแล ส่วนบัญชีอื่นยังใช้อีเมลและรหัสผ่านด้านล่างได้"
                  )}
            </p>
          </div>
          <Button
            type="button"
            className="w-full bg-sky-900 text-white hover:bg-sky-800"
            onClick={() => {
              window.location.assign(adminSsoLoginHref);
            }}
          >
            {tr(language, "Continue with Organization SSO", "ดำเนินการต่อด้วย Organization SSO")}
          </Button>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6">
        {adminSsoEnabled ? (
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>{tr(language, "Password sign in", "ลงชื่อเข้าใช้ด้วยรหัสผ่าน")}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        {!isTwoFactorStep ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="email">{tr(language, "Email address", "อีเมล")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder={tr(language, "Enter your email", "กรอกอีเมล")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                required
              />
            </div>
            <div className="space-y-0">
              <div className="mb-2 flex items-center justify-between">
                <Label htmlFor="password">{tr(language, "Password", "รหัสผ่าน")}</Label>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  className="pe-9"
                  autoComplete="current-password"
                  placeholder={tr(language, "Enter your password", "กรอกรหัสผ่าน")}
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  required
                />
                <button
                  className="text-muted-foreground/80 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-none focus:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={togglePasswordVisibility}
                  aria-label={
                    isPasswordVisible
                      ? tr(language, "Hide password", "ซ่อนรหัสผ่าน")
                      : tr(language, "Show password", "แสดงรหัสผ่าน")
                  }
                  aria-pressed={isPasswordVisible}
                  aria-controls="password"
                >
                  {isPasswordVisible ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="mt-2 flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-[0.92rem] text-slate-500 transition-colors hover:text-primary hover:underline"
                >
                  {tr(language, "Forgot password?", "ลืมรหัสผ่าน?")}
                </Link>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {tr(language, "Continue sign-in", "ดำเนินการเข้าสู่ระบบต่อ")}
              </p>
              <p className="text-sm text-muted-foreground">
                {tr(language, "Enter your code below.", "กรอกรหัสด้านล่าง")}
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-[0.9rem] text-slate-500 hover:text-slate-700"
                onClick={resetTwoFactorChallenge}
              >
                {tr(language, "Use another account", "เปลี่ยนบัญชี")}
              </Button>
            </div>
          </div>
        )}

        {isTwoFactorStep && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-2">
              <Label htmlFor="otpCode">
                {tr(language, "Verification code", "รหัสยืนยัน")}
              </Label>
              <Input
                id="otpCode"
                inputMode="numeric"
                maxLength={12}
                placeholder={tr(language, "Enter code", "กรอกรหัส")}
                autoFocus={isTwoFactorStep}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value);
                  setError(null);
                }}
                required={isTwoFactorStep}
              />
            </div>

            {provisioningUri ? (
              <div className="space-y-2">
                <p className="text-[0.88rem] text-muted-foreground">
                  {tr(
                    language,
                    "Scan the QR, then enter your code.",
                    "สแกน QR แล้วกรอกรหัส"
                  )}
                </p>
                <div className="flex justify-center rounded-md bg-white p-2">
                  {qrCodeDataUrl ? (
                    <Image
                      src={qrCodeDataUrl}
                      alt={tr(language, "Admin 2FA QR code", "คิวอาร์โค้ด 2FA สำหรับผู้ดูแล")}
                      width={220}
                      height={220}
                      unoptimized
                      className="h-[220px] w-[220px]"
                    />
                  ) : (
                    <p className="py-8 text-[0.88rem] text-muted-foreground">
                      {tr(language, "Generating QR code...", "กำลังสร้าง QR code...")}
                    </p>
                  )}
                </div>
                <SecretDisclosure
                  key={extractSetupKey(provisioningUri) ?? "setup-key-hidden"}
                  label={tr(language, "Setup key", "รหัสตั้งค่า")}
                  value={extractSetupKey(provisioningUri)}
                  showLabel={tr(language, "Show setup key", "แสดงรหัสตั้งค่า")}
                  hideLabel={tr(language, "Hide setup key", "ซ่อนรหัสตั้งค่า")}
                />
              </div>
            ) : null}

            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember_device"
                checked={rememberDevice}
                onCheckedChange={(value) => setRememberDevice(Boolean(value))}
              />
              <Label htmlFor="remember_device" className="text-[0.95rem] font-normal">
                {tr(language, "Trust this device", "เชื่อถืออุปกรณ์นี้")}
                {trustedDays
                  ? language === "th"
                    ? ` (${trustedDays} วัน)`
                    : ` (${trustedDays} days)`
                  : ""}
              </Label>
            </div>
          </div>
        )}

        {error && (
          <AuthMessage>
            {error}
          </AuthMessage>
        )}

        <Button variant="glass-primary" className="w-full" type="submit" disabled={loading}>
          {loading
            ? tr(language, "Signing in...", "กำลังเข้าสู่ระบบ...")
            : isTwoFactorStep
              ? tr(language, "Verify and Sign In", "ยืนยันและเข้าสู่ระบบ")
              : tr(language, "Continue", "ดำเนินการต่อ")}
        </Button>
      </form>
    </AuthShell>
  );
}
