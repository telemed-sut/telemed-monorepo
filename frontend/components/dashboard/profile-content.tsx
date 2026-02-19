"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL_MAP, fetchCurrentUser, updateUser, type UserMe } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function parseApiError(error: unknown, language: AppLanguage): string {
  if (error instanceof Error && error.message) return error.message;
  return tr(language, "Unable to update profile", "ไม่สามารถอัปเดตโปรไฟล์ได้");
}

export function ProfileContent() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const language = useLanguageStore((state) => state.language);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const me = await fetchCurrentUser(token);
        if (cancelled) return;
        setCurrentUser(me);
        setFirstName(me.first_name || "");
        setLastName(me.last_name || "");
      } catch {
        if (cancelled) return;
        clearToken();
        router.replace("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, clearToken, router]);

  const hasChanges = useMemo(() => {
    if (!currentUser) return false;
    return firstName !== (currentUser.first_name || "") || lastName !== (currentUser.last_name || "");
  }, [currentUser, firstName, lastName]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !currentUser || !hasChanges) return;

    setSaving(true);

    try {
      const updated = await updateUser(
        currentUser.id,
        {
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
        },
        token,
      );

      const nextUser: UserMe = {
        id: updated.id,
        email: updated.email,
        first_name: updated.first_name,
        last_name: updated.last_name,
        role: updated.role,
        verification_status: updated.verification_status,
      };

      setCurrentUser(nextUser);
      setFirstName(nextUser.first_name || "");
      setLastName(nextUser.last_name || "");
      toast.success(tr(language, "Profile updated", "อัปเดตโปรไฟล์แล้ว"));
    } catch (error: unknown) {
      toast.error(parseApiError(error, language));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{tr(language, "Profile", "โปรไฟล์")}</CardTitle>
          <CardDescription>
            {tr(
              language,
              "Update your account details used across the dashboard.",
              "อัปเดตรายละเอียดบัญชีที่ใช้ในแดชบอร์ดทั้งหมด"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {tr(language, "Loading profile...", "กำลังโหลดโปรไฟล์...")}
            </p>
          ) : (
            <form className="space-y-4" onSubmit={handleSave}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first_name">{tr(language, "First name", "ชื่อ")}</Label>
                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={tr(language, "First name", "ชื่อ")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">{tr(language, "Last name", "นามสกุล")}</Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={tr(language, "Last name", "นามสกุล")}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">{tr(language, "Email", "อีเมล")}</Label>
                  <Input id="email" value={currentUser?.email || ""} disabled readOnly />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">{tr(language, "Role", "บทบาท")}</Label>
                  <Input
                    id="role"
                    value={currentUser
                      ? (language === "th"
                        ? ({
                          admin: "ผู้ดูแลระบบ",
                          doctor: "แพทย์",
                          staff: "เจ้าหน้าที่",
                          nurse: "พยาบาล",
                          pharmacist: "เภสัชกร",
                          medical_technologist: "นักเทคนิคการแพทย์",
                          psychologist: "นักจิตวิทยา",
                        }[currentUser.role] || currentUser.role)
                        : (ROLE_LABEL_MAP[currentUser.role] || currentUser.role))
                      : ""}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={!hasChanges || saving}>
                  {saving
                    ? tr(language, "Saving...", "กำลังบันทึก...")
                    : tr(language, "Save changes", "บันทึกการเปลี่ยนแปลง")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFirstName(currentUser?.first_name || "");
                    setLastName(currentUser?.last_name || "");
                  }}
                  disabled={saving || !hasChanges}
                >
                  {tr(language, "Reset", "รีเซ็ต")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
