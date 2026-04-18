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
  type LoginChallengeDetail,
  type LockedRecoveryOption,
} from "@/lib/api";
import {
  browserSupportsConditionalPasskeyLogin,
  cancelPasskeyCeremony,
  isPasskeyCeremonyCancelled,
  loginWithPasskey,
  startConditionalPasskeyLogin,
} from "@/lib/api-passkeys";
import {
  clearLoginCredentialResetMarker,
  shouldResetLoginCredentialsAfterLogout,
} from "@/lib/login-form-privacy";
import { useAuthStore } from "@/store/auth-store";
import { AuthMessage } from "@/components/auth/auth-message";
import { SecretDisclosure } from "@/components/auth/secret-disclosure";
import { AuthShell } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";
import { type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

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

function formatRetryAfterDuration(language: AppLanguage, totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (language === "th") {
    if (minutes > 0 && seconds > 0) {
      return `${minutes} นาที ${seconds} วินาที`;
    }
    if (minutes > 0) {
      return `${minutes} นาที`;
    }
    return `${seconds} วินาที`;
  }

  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function buildLockoutMessage(language: AppLanguage, retryAfterSeconds: number): string {
  const duration = formatRetryAfterDuration(language, retryAfterSeconds);
  return tr(
    language,
    `Too many sign-in attempts. Please try again in ${duration}.`,
    `พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่อีกครั้งใน ${duration}`,
  );
}

function getRecoveryOptionLabel(language: AppLanguage, option: LockedRecoveryOption): string {
  switch (option) {
    case "forgot_password":
      return tr(language, "Reset your password", "รีเซ็ตรหัสผ่าน");
    case "contact_admin":
      return tr(language, "Contact an admin for help unlocking this account.", "ติดต่อแอดมินเพื่อช่วยปลดล็อกบัญชีนี้");
    case "contact_security_admin":
      return tr(language, "Contact a security admin for an emergency unlock.", "ติดต่อผู้ดูแลด้านความปลอดภัยเพื่อปลดล็อกฉุกเฉิน");
    case "wait":
    default:
      return tr(language, "Wait for the timer to finish.", "รอให้เวลานับถอยหลังหมดก่อน");
  }
}

function findConditionalPasskeyInput(): HTMLInputElement | null {
  const element = document.querySelector<HTMLInputElement>(
    'input[autocomplete="webauthn"], input[autocomplete$=" webauthn"]',
  );
  return element instanceof HTMLInputElement ? element : null;
}

function isMissingConditionalPasskeyInputError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";

  return message.includes(
    'No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected',
  );
}

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
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutDetail, setLockoutDetail] = useState<LoginChallengeDetail | null>(null);
  const [lockoutRetryAfterSeconds, setLockoutRetryAfterSeconds] = useState<number | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [loginStep, setLoginStep] = useState<LoginStep>("credentials");
  const [otpCode, setOtpCode] = useState("");
  const [provisioningUri, setProvisioningUri] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [trustedDays, setTrustedDays] = useState<number | null>(null);
  const [adminSsoStatus, setAdminSsoStatus] = useState<AdminSsoStatus | null>(null);
  const [shouldSuppressCredentialAutofill, setShouldSuppressCredentialAutofill] = useState(false);
  const [supportsConditionalPasskeyUi, setSupportsConditionalPasskeyUi] = useState<boolean | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setShouldSuppressCredentialAutofill(shouldResetLoginCredentialsAfterLogout());
  }, []);

  useEffect(() => {
    if (!shouldSuppressCredentialAutofill) {
      return;
    }

    const clearCredentialFields = () => {
      setEmail("");
      setPassword("");
      setOtpCode("");
      setError(null);
      setLoginStep("credentials");
      setProvisioningUri(null);
      setTrustedDays(null);
      setIsPasswordVisible(false);
      setLockoutDetail(null);
      setLockoutRetryAfterSeconds(null);

      const emailInput = document.getElementById("email");
      if (emailInput instanceof HTMLInputElement) {
        emailInput.value = "";
      }

      const passwordInput = document.getElementById("password");
      if (passwordInput instanceof HTMLInputElement) {
        passwordInput.value = "";
      }
    };

    clearCredentialFields();
    const animationFrameId = window.requestAnimationFrame(clearCredentialFields);
    const timeoutId = window.setTimeout(clearCredentialFields, 150);
    window.addEventListener("pageshow", clearCredentialFields);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("pageshow", clearCredentialFields);
    };
  }, [shouldSuppressCredentialAutofill]);

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
    let cancelled = false;

    const detectConditionalPasskeyUi = async () => {
      try {
        const supported = await browserSupportsConditionalPasskeyLogin();
        if (!cancelled) {
          setSupportsConditionalPasskeyUi(supported);
        }
      } catch {
        if (!cancelled) {
          setSupportsConditionalPasskeyUi(false);
        }
      }
    };

    void detectConditionalPasskeyUi();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const errorCode = searchParams.get("error");
    const reason = searchParams.get("reason");
    if (errorCode === "session_expired") {
      const reasonMessages: Record<string, { en: string; th: string }> = {
        token_expired: {
          en: "Your session expired while you were away. Please sign in again.",
          th: "เซสชันหมดอายุระหว่างที่คุณไม่ได้ใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง",
        },
        refresh_failed: {
          en: "We couldn't refresh your session securely. Please sign in again.",
          th: "ระบบไม่สามารถรีเฟรชเซสชันอย่างปลอดภัยได้ กรุณาเข้าสู่ระบบอีกครั้ง",
        },
        session_missing: {
          en: "Your previous session is no longer available. Please sign in again.",
          th: "ไม่พบเซสชันก่อนหน้านี้แล้ว กรุณาเข้าสู่ระบบอีกครั้ง",
        },
      };

      const message = reason ? reasonMessages[reason] : null;
      setError(
        message
          ? tr(language, message.en, message.th)
          : tr(
              language,
              "Your session is no longer available. Please sign in again.",
              "ไม่พบเซสชันก่อนหน้านี้แล้ว กรุณาเข้าสู่ระบบอีกครั้ง",
            ),
      );
      return;
    }

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
      deprecated_logout_method: {
        en: "Organization SSO logout now requires an active in-app session. Please sign in again if you still need to end that session.",
        th: "การออกจากระบบผ่าน Organization SSO ต้องเริ่มจากเซสชันในแอปที่ยังใช้งานอยู่ หากยังต้องการปิดเซสชันนั้น กรุณาเข้าสู่ระบบอีกครั้ง",
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

  useEffect(() => {
    if (lockoutRetryAfterSeconds === null || lockoutRetryAfterSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setLockoutRetryAfterSeconds((current) => {
        if (current === null || current <= 1) {
          return null;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lockoutRetryAfterSeconds]);

  const resetTwoFactorChallenge = () => {
    setLoginStep("credentials");
    setLockoutDetail(null);
    setLockoutRetryAfterSeconds(null);
    setOtpCode("");
    setProvisioningUri(null);
    setTrustedDays(null);
    setQrCodeDataUrl(null);
    setError(null);
  };

  const isTwoFactorStep = loginStep === "twoFactor";
  const isPlainLocked = lockoutDetail?.code === "account_locked";
  const countdownMessage =
    lockoutRetryAfterSeconds !== null
      ? buildLockoutMessage(language, lockoutRetryAfterSeconds)
      : null;
  const recoveryOptions = lockoutDetail?.recovery_options ?? [];
  const showForgotPassword = recoveryOptions.includes("forgot_password");
  const showContactAdmin = recoveryOptions.includes("contact_admin");
  const showContactSecurityAdmin = recoveryOptions.includes("contact_security_admin");
  const hasTypedCredentials = email.trim().length > 0 || password.trim().length > 0;
  const hasCompleteCredentials = email.trim().length > 0 && password.trim().length > 0;
  const isSubmitReady = isTwoFactorStep ? otpCode.trim().length > 0 : hasCompleteCredentials;
  const shouldEmphasizePasskey = !isTwoFactorStep && !hasTypedCredentials;
  const isConditionalPasskeyUiPending = supportsConditionalPasskeyUi === null;
  const shouldUseConditionalPasskeyUi = supportsConditionalPasskeyUi === true && !isTwoFactorStep;
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
      setLockoutDetail(null);
      setLockoutRetryAfterSeconds(null);
      setSession(res);
      clearLoginCredentialResetMarker();
      setShouldSuppressCredentialAutofill(false);
      router.replace("/patients");
    } catch (err) {
      const apiError = err as ApiError;
      const detail = apiError.detail as LoginChallengeDetail | undefined;
      const detailCode = detail?.code?.toLowerCase();
      if (detail && (detailCode === "two_factor_required" || detailCode === "admin_2fa_required")) {
        setLockoutDetail(null);
        setLockoutRetryAfterSeconds(null);
        setLoginStep("twoFactor");
        setProvisioningUri(detail.provisioning_uri ?? null);
        setTrustedDays(typeof detail.trusted_device_days === "number" ? detail.trusted_device_days : null);
        setError(tr(language, "Enter your code to continue.", "กรอกรหัสเพื่อดำเนินการต่อ"));
      } else if (detail && detailCode === "account_locked") {
        setLoginStep("credentials");
        setLockoutDetail(detail);
        setProvisioningUri(null);
        setTrustedDays(null);
        const retryAfterSeconds =
          typeof detail.retry_after_seconds === "number" && detail.retry_after_seconds > 0
            ? detail.retry_after_seconds
            : null;
        setError(null);
        setLockoutRetryAfterSeconds(retryAfterSeconds);
        if (retryAfterSeconds === null) {
          setError(getAuthErrorMessage(language, apiError, "login"));
        }
      } else if (apiError instanceof Error) {
        setLockoutDetail(null);
        setLockoutRetryAfterSeconds(null);
        setError(getAuthErrorMessage(language, apiError, "login"));
      } else {
        setLockoutDetail(null);
        setLockoutRetryAfterSeconds(null);
        setError(tr(language, "Unable to sign in. Please try again.", "ไม่สามารถเข้าสู่ระบบได้ โปรดลองอีกครั้ง"));
      }
    } finally {
      setLoading(false);
    }
  };

  const onPasskeyLogin = async () => {
    cancelPasskeyCeremony();
    setError(null);
    setPasskeyLoading(true);
    try {
      // If email is provided, we can use it to narrow down passkeys,
      // but WebAuthn also supports discoverable credentials (empty email).
      const res = await loginWithPasskey(email || undefined);
      if (!res.user) {
        throw new Error(
          tr(language, "Unable to establish session. Please try again.", "ไม่สามารถเริ่มต้นเซสชันได้ โปรดลองอีกครั้ง")
        );
      }
      setSession(res);
      clearLoginCredentialResetMarker();
      setShouldSuppressCredentialAutofill(false);
      router.replace("/patients");
    } catch (err: any) {
      // Don't show error if user cancelled the native dialog
      if (isPasskeyCeremonyCancelled(err)) {
        setError(null);
        return;
      }

      // Check for specific error code from backend
      if (err.code === "passkey_not_registered") {
        setError(tr(
          language, 
          "That Passkey can't be used here anymore. Try again or use your password.", 
          "Passkey นี้ใช้กับระบบนี้ไม่ได้แล้ว ลองอีกครั้งหรือใช้รหัสผ่านแทน"
        ));
        return;
      }

      console.error("Passkey login error:", err);

      setError(tr(language, "Passkey login failed. Please try again or use password.", "การเข้าสู่ระบบด้วย Passkey ล้มเหลว กรุณาลองใหม่หรือใช้รหัสผ่าน"));
    } finally {
      setPasskeyLoading(false);
    }
  };

  useEffect(() => {
    if (!hydrated || !shouldUseConditionalPasskeyUi) {
      return;
    }

    let cancelled = false;
    let animationFrameId: number | null = null;

    const beginConditionalPasskeyLogin = async () => {
      await new Promise<void>((resolve) => {
        animationFrameId = window.requestAnimationFrame(() => {
          animationFrameId = null;
          resolve();
        });
      });

      if (cancelled || !findConditionalPasskeyInput()) {
        return;
      }

      try {
        const res = await startConditionalPasskeyLogin();
        if (cancelled) {
          return;
        }
        if (!res.user) {
          throw new Error(
            tr(language, "Unable to establish session. Please try again.", "ไม่สามารถเริ่มต้นเซสชันได้ โปรดลองอีกครั้ง")
          );
        }
        setSession(res);
        clearLoginCredentialResetMarker();
        setShouldSuppressCredentialAutofill(false);
        router.replace("/patients");
      } catch (err: any) {
        if (
          cancelled ||
          isPasskeyCeremonyCancelled(err) ||
          isMissingConditionalPasskeyInputError(err)
        ) {
          return;
        }

        if (err.code === "passkey_not_registered") {
          setError(
            tr(
              language,
              "That Passkey can't be used here anymore. Try again or use your password.",
              "Passkey นี้ใช้กับระบบนี้ไม่ได้แล้ว ลองอีกครั้งหรือใช้รหัสผ่านแทน"
            )
          );
          return;
        }

        console.error("Conditional Passkey login error:", err);
        setError(
          tr(
            language,
            "Passkey login failed. Please try again or use password.",
            "การเข้าสู่ระบบด้วย Passkey ล้มเหลว กรุณาลองใหม่หรือใช้รหัสผ่าน"
          )
        );
      }
    };

    void beginConditionalPasskeyLogin();

    return () => {
      cancelled = true;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      cancelPasskeyCeremony();
    };
  }, [hydrated, language, router, setSession, shouldUseConditionalPasskeyUi]);

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

      {!shouldUseConditionalPasskeyUi && !isConditionalPasskeyUiPending ? (
        <>
          <div className="transition-all">
            <Button
              type="button"
              variant={shouldEmphasizePasskey ? "default" : "outline"}
              className={cn(
                "w-full justify-center gap-2 py-5 transition-all",
                shouldEmphasizePasskey
                  ? "border-sky-900 bg-sky-900 text-white hover:bg-sky-800 shadow-[0_16px_30px_rgba(12,74,110,0.22)]"
                  : "border-2 hover:bg-slate-50"
              )}
              onClick={onPasskeyLogin}
              disabled={passkeyLoading || loading}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="currentColor"/>
                <path d="M12 17C13.6569 17 15 15.6569 15 14C15 12.3431 13.6569 11 12 11C10.3431 11 9 12.3431 9 14C9 15.6569 10.3431 17 12 17Z" fill="currentColor"/>
                <path d="M12 6C10.34 6 9 7.34 9 9V10H15V9C15 7.34 13.66 6 12 6Z" fill="currentColor"/>
              </svg>
              <span className="font-semibold">
                {passkeyLoading
                  ? tr(language, "Checking Passkey...", "กำลังตรวจสอบ Passkey...")
                  : tr(language, "Sign in with Passkey", "ลงชื่อเข้าใช้ด้วย Passkey")}
              </span>
            </Button>
          </div>

          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
            <span className="h-px flex-1 bg-border/60" />
            <span>{tr(language, "Or use password", "หรือใช้รหัสผ่าน")}</span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
        </>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="space-y-6"
        autoComplete="on"
      >
        {!isTwoFactorStep ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="email">{tr(language, "Email address", "อีเมล")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete={
                  shouldUseConditionalPasskeyUi
                    ? "username webauthn"
                    : shouldSuppressCredentialAutofill
                      ? "off"
                      : "username"
                }
                placeholder={tr(language, "Enter your email", "กรอกอีเมล")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setLockoutDetail(null);
                  setLoginStep("credentials");
                  setOtpCode("");
                  setProvisioningUri(null);
                  setTrustedDays(null);
                  setError(null);
                  setLockoutRetryAfterSeconds(null);
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
                  autoComplete={shouldSuppressCredentialAutofill ? "new-password" : "current-password"}
                  placeholder={tr(language, "Enter your password", "กรอกรหัสผ่าน")}
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLockoutDetail(null);
                    setLoginStep("credentials");
                    setOtpCode("");
                    setProvisioningUri(null);
                    setTrustedDays(null);
                    setError(null);
                    setLockoutRetryAfterSeconds(null);
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

        {isPlainLocked && !isTwoFactorStep ? (
          <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/80 p-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-950">
                {tr(language, "Account temporarily locked", "บัญชีถูกล็อกชั่วคราว")}
              </p>
              <p className="text-sm text-amber-900/80">
                {countdownMessage ?? lockoutDetail?.message ?? tr(language, "Please try again later.", "กรุณาลองใหม่อีกครั้งภายหลัง")}
              </p>
            </div>

            <div className="space-y-2 text-sm text-amber-950">
              {showForgotPassword ? (
                <Link href="/forgot-password" className="inline-flex text-primary hover:underline">
                  {getRecoveryOptionLabel(language, "forgot_password")}
                </Link>
              ) : null}
              {showContactAdmin ? (
                <p>{getRecoveryOptionLabel(language, "contact_admin")}</p>
              ) : null}
              {showContactSecurityAdmin ? (
                <p>{getRecoveryOptionLabel(language, "contact_security_admin")}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {isTwoFactorStep && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-2">
              {isTwoFactorStep ? (
                <>
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
                </>
              ) : null}
            </div>

            {isTwoFactorStep && provisioningUri ? (
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

            {isTwoFactorStep ? (
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
            ) : null}
          </div>
        )}

        {error && !isPlainLocked && (
          <AuthMessage>
            {error}
          </AuthMessage>
        )}

        <Button
          variant="outline"
          className={cn(
            "w-full",
            isSubmitReady
              ? "border-slate-950 bg-slate-950 text-white hover:bg-slate-900"
              : "border-slate-200 bg-slate-300 text-white hover:bg-slate-300"
          )}
          type="submit"
          disabled={loading || !isSubmitReady}
        >
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
