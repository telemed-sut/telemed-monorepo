"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getErrorMessage, login as loginRequest } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { Logo } from "@/components/ui/logo";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
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
  const token = useAuthStore((state) => state.token);
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const setToken = useAuthStore((state) => state.setToken);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [otpCode, setOtpCode] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [provisioningUri, setProvisioningUri] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [trustedDays, setTrustedDays] = useState<number | null>(null);

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await loginRequest(email, password, otpCode, rememberDevice);
      setToken(res.access_token);
      router.replace("/patients");
    } catch (err) {
      const apiError = err as ApiError;
      const detail = apiError.detail as Admin2FAErrorDetail | undefined;
      if (detail && (detail.code === "two_factor_required" || detail.code === "admin_2fa_required")) {
        setRequiresTwoFactor(true);
        setProvisioningUri(detail.provisioning_uri ?? null);
        setTrustedDays(typeof detail.trusted_device_days === "number" ? detail.trusted_device_days : null);
        setError(detail.message ?? tr(language, "Login requires a 2FA code.", "การเข้าสู่ระบบต้องใช้รหัส 2FA"));
      } else {
        const message = getErrorMessage(
          err,
          tr(language, "Unable to sign in", "เข้าสู่ระบบไม่สำเร็จ")
        );
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => setIsPasswordVisible((prev) => !prev);

  if (!hydrated) {
    return null;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md mx-4 pb-8 shadow-xl border-border">
        <CardHeader className="space-y-1 text-center mb-2 mt-4">
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
          <div className="flex justify-center mb-4">
            <Logo className="size-10" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold">
              {tr(language, "Welcome Back", "ยินดีต้อนรับกลับ")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {tr(language, "Sign in to continue to your secure workspace.", "เข้าสู่ระบบเพื่อใช้งานพื้นที่ทำงานที่ปลอดภัย")}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {tr(language, "Authorized users only.", "สำหรับผู้ใช้งานที่ได้รับอนุญาตเท่านั้น")}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">{tr(language, "Email address", "อีเมล")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={tr(language, "Enter your email", "กรอกอีเมล")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
            </div>
            <div className="space-y-0">
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="password">{tr(language, "Password", "รหัสผ่าน")}</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  {tr(language, "Need help signing in?", "มีปัญหาในการเข้าสู่ระบบ?")}
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  className="pe-9"
                  placeholder={tr(language, "Enter your password", "กรอกรหัสผ่าน")}
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
            </div>
            {requiresTwoFactor && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-2">
                  <Label htmlFor="otpCode">
                    {tr(language, "2FA Code / Backup Code", "รหัส 2FA / รหัสสำรอง")}
                  </Label>
                  <Input
                    id="otpCode"
                    inputMode="numeric"
                    maxLength={12}
                    placeholder={tr(language, "123456 or BACKUPCODE", "123456 หรือ BACKUPCODE")}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required={requiresTwoFactor}
                  />
                </div>

                {provisioningUri ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        language,
                        "Scan this QR with your authenticator app, then enter a 6-digit code or backup code.",
                        "สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลัก หรือใช้ Backup Code"
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
                        <p className="text-xs text-muted-foreground py-8">
                          {tr(language, "Generating QR code...", "กำลังสร้าง QR code...")}
                        </p>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground break-all">
                      {tr(language, "Setup key", "รหัสตั้งค่า")}: {extractSetupKey(provisioningUri) ?? "-"}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      language,
                      "If your original authenticator device is unavailable, use a backup code or ask a super admin to reset 2FA for this account.",
                      "ถ้าไม่มีเครื่องที่ผูก Authenticator เดิม ให้ใช้ Backup Code หรือให้ super admin รีเซ็ต 2FA ให้บัญชีนี้"
                    )}
                  </p>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember_device"
                    checked={rememberDevice}
                    onCheckedChange={(value) => setRememberDevice(Boolean(value))}
                  />
                  <Label htmlFor="remember_device" className="text-sm font-normal">
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
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button variant="glass-primary" className="w-full" type="submit" disabled={loading}>
              {loading
                ? tr(language, "Signing in...", "กำลังเข้าสู่ระบบ...")
                : tr(language, "Sign In", "เข้าสู่ระบบ")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
