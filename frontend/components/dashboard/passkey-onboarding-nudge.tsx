"use client";

import { useState } from "react";
import { Fingerprint, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import {
  registerNewPasskey,
  dismissPasskeyOnboarding,
  isPasskeyCeremonyCancelled,
} from "@/lib/api-passkeys";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const tr = (language: string, en: string, th: string) =>
  language === "th" ? th : en;

export function PasskeyOnboardingNudge() {
  const { currentUser, setCurrentUser } = useAuthStore();
  const language = useLanguageStore((state) => state.language);
  const [isVisible, setIsVisible] = useState(
    currentUser?.role === "admin" &&
    (currentUser?.passkey_count ?? 0) === 0 &&
    !currentUser?.passkey_onboarding_dismissed
  );
  const [loading, setLoading] = useState(false);

  if (!isVisible || !currentUser) return null;

  const refreshCurrentUser = async () => {
    try {
      const { fetchCurrentUser } = await import("@/lib/api");
      const nextUser = await fetchCurrentUser();
      setCurrentUser(nextUser ?? null);
    } catch {
      // Best-effort refresh only; the nudge can still close locally.
    }
  };

  const handleRegister = async () => {
    setLoading(true);
    try {
      const name = tr(language, "My Device", "อุปกรณ์ของฉัน") + " (" + new Date().toLocaleDateString() + ")";
      await registerNewPasskey(name);
      toast.success(tr(language, "Passkey registered successfully!", "ลงทะเบียน Passkey สำเร็จแล้ว!"));
      await refreshCurrentUser();
      setIsVisible(false);
    } catch (error: unknown) {
      if (isPasskeyCeremonyCancelled(error)) {
        setLoading(false);
        return;
      }
      toast.error(tr(language, "Failed to register Passkey.", "ไม่สามารถลงทะเบียน Passkey ได้"));
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await dismissPasskeyOnboarding();
      setIsVisible(false);
      await refreshCurrentUser();
    } catch (error) {
      setIsVisible(false);
    }
  };

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-primary/5 shadow-sm">
      <CardContent className="p-4 sm:p-6">
        <button
          onClick={handleDismiss}
          className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground/50 hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
        
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Fingerprint className="size-6" />
          </div>
          
          <div className="space-y-1 pr-6">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              {tr(language, "Upgrade your security with Passkeys", "ยกระดับความปลอดภัยด้วย Passkeys")}
              <span className="hidden sm:inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {tr(language, "New", "ใหม่")}
              </span>
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {tr(
                language,
                "Admins can now sign in instantly using biometrics (TouchID/FaceID). It's faster than passwords and 100% phishing-proof. Would you like to set it up now?",
                "แอดมินสามารถเข้าสู่ระบบด้วยการสแกนนิ้วหรือใบหน้าได้แล้ว สะดวกกว่ารหัสผ่านและป้องกันการโดนหลอกขโมยรหัสได้ 100% ต้องการเริ่มตั้งค่าตอนนี้เลยไหม?"
              )}
            </p>
            
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <Button 
                size="sm" 
                onClick={handleRegister} 
                disabled={loading}
                className="gap-2 shadow-sm"
              >
                <Fingerprint className="size-4" />
                {loading ? tr(language, "Setting up...", "กำลังตั้งค่า...") : tr(language, "Setup Passkey Now", "เริ่มตั้งค่าตอนนี้")}
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handleDismiss}
                className="text-muted-foreground"
              >
                {tr(language, "Maybe later", "ไว้ทีหลัง")}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
