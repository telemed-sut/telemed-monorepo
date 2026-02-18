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
import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, login as loginRequest } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { Logo } from "@/components/ui/logo";

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


export default function LoginPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const setToken = useAuthStore((state) => state.setToken);

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
        setError(detail.message ?? "Login requires a 2FA code.");
      } else {
        const message = err instanceof Error ? err.message : "Login failed";
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
          <div className="flex justify-center mb-4">
            <Logo className="size-10" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold">Welcome Back</h2>
            <p className="text-muted-foreground text-sm">
              Sign in to continue to your secure workspace.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Authorized users only.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
            </div>
            <div className="space-y-0">
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  Need help signing in?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  className="pe-9"
                  placeholder="Enter your password"
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
                    isPasswordVisible ? "Hide password" : "Show password"
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
                  <Label htmlFor="otpCode">2FA Code / Backup Code</Label>
                  <Input
                    id="otpCode"
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="123456 หรือ BACKUPCODE"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required={requiresTwoFactor}
                  />
                </div>

                {provisioningUri ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลัก หรือใช้ Backup Code
                    </p>
                    <div className="flex justify-center rounded-md bg-white p-2">
                      {qrCodeDataUrl ? (
                        <img
                          src={qrCodeDataUrl}
                          alt="Admin 2FA QR code"
                          className="h-[220px] w-[220px]"
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground py-8">Generating QR code...</p>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground break-all">
                      Setup key: {extractSetupKey(provisioningUri) ?? "-"}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    ถ้าไม่มีเครื่องที่ผูก Authenticator เดิม ให้ใช้ Backup Code หรือให้ super admin รีเซ็ต 2FA ให้บัญชีนี้
                  </p>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember_device"
                    checked={rememberDevice}
                    onCheckedChange={(value) => setRememberDevice(Boolean(value))}
                  />
                  <Label htmlFor="remember_device" className="text-sm font-normal">
                    เชื่อถืออุปกรณ์นี้{trustedDays ? ` (${trustedDays} วัน)` : ""}
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
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
