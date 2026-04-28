"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings2, ShieldCheck, UserRound, Wrench, X } from "lucide-react";

import { SensitiveActionReauthDialog } from "@/components/dashboard/sensitive-action-reauth-dialog";
import { useSessionLogout } from "@/hooks/use-session-logout";
import { getRoleLabel, type UserMe } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";

import { DASHBOARD_HOME_HREF } from "./dashboard-route-utils";
import { AccountSettingsPanel } from "./settings/account-settings-panel";
import { AdminSettingsPanel } from "./settings/admin-settings-panel";
import { GeneralSettingsPanel } from "./settings/general-settings-panel";
import { SecuritySettingsPanel } from "./settings/security-settings-panel";
import { SettingsPanelNavButton } from "./settings/settings-panel-nav-button";
import type { SettingsPanelId } from "./settings/settings-types";
import { getAppearanceSummary, isSettingsPanelId, tr } from "./settings/settings-utils";
import { useSettingsAdmin } from "./settings/use-settings-admin";
import { useSettingsAppearance } from "./settings/use-settings-appearance";
import { useSettingsProfile } from "./settings/use-settings-profile";
import { useSettingsSecurity } from "./settings/use-settings-security";
import { useSettingsSensitiveReauth } from "./settings/use-settings-sensitive-reauth";
import { useSettingsValidationToasts } from "./settings/use-settings-validation-toasts";

interface SettingsContentProps {
  presentation?: "page" | "modal";
  onRequestClose?: () => void;
}

export function SettingsContent({
  presentation = "page",
  onRequestClose,
}: SettingsContentProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const language = useLanguageStore((state) => state.language);
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const role = useAuthStore((state) => state.role);
  const authCurrentUser = useAuthStore((state) => state.currentUser as UserMe | null);
  const setAuthCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const clearToken = useAuthStore((state) => state.clearToken);
  const ssoProvider = useAuthStore((state) => state.ssoProvider);
  const mfaVerified = useAuthStore((state) => state.mfaVerified);
  const mfaAuthenticatedAt = useAuthStore((state) => state.mfaAuthenticatedAt);
  const hydrated = useAuthStore((state) => state.hydrated);
  const getTokenTTL = useAuthStore((state) => state.getTokenTTL);
  const logout = useSessionLogout();

  const isAdmin = role === "admin";
  const isModalPresentation = presentation === "modal";

  const [activePanel, setActivePanel] = useState<SettingsPanelId>("general");

  const { dismissValidationToast, showValidationToastOnce } =
    useSettingsValidationToasts();
  const {
    sensitiveReauthRequest,
    closeSensitiveReauth,
    handleSensitiveActionError,
    handleSensitiveReauthSuccess,
  } = useSettingsSensitiveReauth();

  const profile = useSettingsProfile({
    token,
    userId,
    hydrated,
    authCurrentUser,
    setAuthCurrentUser,
    clearToken,
    getTokenTTL,
    router,
    language,
    ssoProvider,
    mfaVerified,
    mfaAuthenticatedAt,
  });

  const appearance = useSettingsAppearance(language);

  const security = useSettingsSecurity({
    token,
    hydrated,
    language,
    isAdmin,
    mfaAuthenticatedAt,
    sensitiveReauthOpen: Boolean(sensitiveReauthRequest),
    dismissValidationToast,
    showValidationToastOnce,
    handleSensitiveActionError,
  });

  const admin = useSettingsAdmin({
    token,
    language,
    isAdmin,
    canManagePrivilegedAdmins: profile.canManagePrivilegedAdmins,
    canManageSecurityRecovery: profile.canManageSecurityRecovery,
    sensitiveReauthOpen: Boolean(sensitiveReauthRequest),
    dismissValidationToast,
    showValidationToastOnce,
    handleSensitiveActionError,
  });

  const generalSummary = useMemo(
    () => getAppearanceSummary(language, appearance.savedAppearance),
    [appearance.savedAppearance, language],
  );
  const setAppearanceExpanded = appearance.setAppearanceExpanded;
  const setAdminToolsExpanded = admin.setAdminToolsExpanded;

  const settingsPanels = useMemo(
    () => [
      {
        id: "general" as const,
        title: tr(language, "General", "ทั่วไป"),
        summary: generalSummary,
        description: tr(
          language,
          "Set the visual tone and daily workspace feel.",
          "กำหนดหน้าตาและบรรยากาศการใช้งานประจำวัน",
        ),
        icon: <Settings2 className="size-4" />,
      },
      {
        id: "account" as const,
        title: tr(language, "Account", "บัญชี"),
        summary: `${profile.loginMethodSummary} • ${profile.ttlLabel}`,
        description: tr(
          language,
          "Review sign-in details and the active session.",
          "ดูวิธีเข้าสู่ระบบและสถานะเซสชันปัจจุบัน",
        ),
        icon: <UserRound className="size-4" />,
      },
      {
        id: "security" as const,
        title: tr(language, "Security", "ความปลอดภัย"),
        summary: security.securityHeaderSummary,
        description: tr(
          language,
          "Manage passkeys and secure sign-in options.",
          "จัดการ Passkeys และตัวเลือกเข้าสู่ระบบที่ปลอดภัย",
        ),
        icon: <ShieldCheck className="size-4" />,
      },
      ...(profile.canManagePrivilegedAdmins ||
      (isAdmin && profile.canManageSecurityRecovery)
        ? [
            {
              id: "admin" as const,
              title: tr(language, "Admin Tools", "เครื่องมือผู้ดูแลระบบ"),
              summary:
                admin.adminToolsSummary ||
                tr(language, "Advanced access", "เครื่องมือขั้นสูง"),
              description: tr(
                language,
                "Open onboarding and emergency actions in one place.",
                "รวมงานเชิญแอดมินและงานฉุกเฉินไว้ในจุดเดียว",
              ),
              icon: <Wrench className="size-4" />,
            },
          ]
        : []),
    ],
    [
      admin.adminToolsSummary,
      generalSummary,
      isAdmin,
      language,
      profile.canManagePrivilegedAdmins,
      profile.canManageSecurityRecovery,
      profile.loginMethodSummary,
      profile.ttlLabel,
      security.securityHeaderSummary,
    ],
  );

  useEffect(() => {
    if (isModalPresentation) return;

    const requestedPanel = searchParams.get("panel");
    if (!isSettingsPanelId(requestedPanel)) return;

    queueMicrotask(() => {
      setActivePanel(requestedPanel);
      if (requestedPanel === "general") {
        setAppearanceExpanded(true);
      }
      if (requestedPanel === "admin") {
        setAdminToolsExpanded(true);
      }
    });
  }, [
    isModalPresentation,
    searchParams,
    setAdminToolsExpanded,
    setAppearanceExpanded,
  ]);

  useEffect(() => {
    if (settingsPanels.some((panel) => panel.id === activePanel)) return;
    queueMicrotask(() => {
      setActivePanel(settingsPanels[0]?.id ?? "general");
    });
  }, [activePanel, settingsPanels]);

  const handleCloseSettings = useCallback(() => {
    if (onRequestClose) {
      onRequestClose();
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(DASHBOARD_HOME_HREF);
  }, [onRequestClose, router]);

  const activePanelMeta =
    settingsPanels.find((panel) => panel.id === activePanel) ?? settingsPanels[0];

  return (
    <main
      className={cn(
        "relative flex w-full flex-1",
        isModalPresentation
          ? "overflow-hidden bg-transparent p-0"
          : "min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(140,180,212,0.18),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(246,248,251,0.96))] p-3 sm:p-4 lg:p-6",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-full w-full min-h-0 justify-center",
          isModalPresentation ? "items-center" : "items-start",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 w-full flex-col overflow-hidden border border-border/70 bg-background/95 shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur",
            isModalPresentation
              ? "max-h-[min(90vh,820px)] min-h-0 rounded-[1.7rem] md:flex md:flex-row"
              : "h-full max-w-[1120px] rounded-[2rem] md:grid md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]",
          )}
        >
          <aside
            className={cn(
              "border-b border-border/70 bg-muted/25 px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5",
              isModalPresentation
                ? "md:flex md:w-[260px] lg:w-[280px] md:flex-none md:flex-col md:overflow-y-auto md:border-r md:border-b-0"
                : "md:overflow-y-auto md:border-r md:border-b-0",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCloseSettings}
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground transition-[background-color,color,border-color] hover:bg-muted hover:text-foreground"
                aria-label={tr(language, "Close settings", "ปิดการตั้งค่า")}
              >
                <X className="size-4" />
              </button>
              <div className="text-right md:hidden">
                <p className="text-sm font-medium text-foreground">
                  {tr(language, "Settings", "ตั้งค่า")}
                </p>
              </div>
            </div>

            <div className={cn("hidden md:block", isModalPresentation ? "mt-2" : "mt-4")}>
              <p className="text-base font-semibold text-foreground">
                {tr(language, "Settings", "ตั้งค่า")}
              </p>
              {!isModalPresentation ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {tr(
                    language,
                    "Keep the essentials in a focused panel.",
                    "รวมการตั้งค่าหลักไว้ในแผงเดียวที่โฟกัสง่าย",
                  )}
                </p>
              ) : null}
            </div>

            <div
              className={cn(
                "flex overflow-x-auto pb-1",
                isModalPresentation
                  ? "mt-2 gap-1 md:flex-col md:overflow-visible"
                  : "mt-4 gap-2 md:flex-col md:overflow-visible",
              )}
            >
              {settingsPanels.map((panel) => (
                <div
                  key={panel.id}
                  className={cn(
                    isModalPresentation ? "min-w-[140px] md:min-w-0" : "md:min-w-0 min-w-[220px]",
                  )}
                >
                  <SettingsPanelNavButton
                    title={panel.title}
                    summary={panel.summary}
                    active={activePanel === panel.id}
                    icon={panel.icon}
                    isModalPresentation={isModalPresentation}
                    onClick={() => {
                      setActivePanel(panel.id);
                      if (panel.id === "general") {
                        appearance.setAppearanceExpanded(true);
                      }
                      if (panel.id === "admin") {
                        admin.setAdminToolsExpanded(true);
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </aside>

          <section
            className={cn(
              "flex min-w-0 flex-col bg-background",
              isModalPresentation
                ? "min-h-0 md:min-w-[320px] md:flex-[1_1_320px] md:overflow-y-auto"
                : "min-h-0",
            )}
          >
            <div className="border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-words text-[1.15rem] font-semibold text-foreground">
                    {activePanelMeta.title}
                  </p>
                  <p
                    className={cn(
                      "mt-1 break-words text-sm leading-6 text-muted-foreground",
                      isModalPresentation ? "max-w-[48ch]" : "max-w-[56ch]",
                    )}
                  >
                    {activePanelMeta.description}
                  </p>
                </div>
                <div
                  className={cn(
                    "hidden rounded-full border border-border/70 bg-muted/20 px-3 py-1 text-xs text-muted-foreground",
                    isModalPresentation ? "xl:hidden" : "sm:block",
                  )}
                >
                  {activePanelMeta.summary}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 sm:px-6 sm:py-5">
              {activePanel === "general" ? (
                <GeneralSettingsPanel
                  language={language}
                  isModalPresentation={isModalPresentation}
                  appearance={appearance}
                  onOpenSecurity={() => setActivePanel("security")}
                />
              ) : null}

              {activePanel === "account" ? (
                <AccountSettingsPanel
                  language={language}
                  isAdmin={isAdmin}
                  logout={logout}
                  profile={profile}
                  getRoleLabel={getRoleLabel}
                />
              ) : null}

              {activePanel === "security" ? (
                <SecuritySettingsPanel
                  language={language}
                  isAdmin={isAdmin}
                  security={security}
                />
              ) : null}

              {activePanel === "admin" &&
              (profile.canManagePrivilegedAdmins ||
                (isAdmin && profile.canManageSecurityRecovery)) ? (
                <AdminSettingsPanel
                  language={language}
                  isAdmin={isAdmin}
                  canManagePrivilegedAdmins={profile.canManagePrivilegedAdmins}
                  canManageSecurityRecovery={profile.canManageSecurityRecovery}
                  admin={admin}
                  getRoleLabel={getRoleLabel}
                />
              ) : null}
            </div>
          </section>
        </div>
      </div>
      <SensitiveActionReauthDialog
        open={Boolean(sensitiveReauthRequest)}
        onOpenChange={closeSensitiveReauth}
        actionLabel={sensitiveReauthRequest?.actionLabel}
        onSuccess={handleSensitiveReauthSuccess}
      />
    </main>
  );
}
