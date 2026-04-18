"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";

import { SensitiveActionReauthDialog } from "@/components/dashboard/sensitive-action-reauth-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SecretDisclosure } from "@/components/auth/secret-disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronUp,
  Palette,
  Settings2,
  ShieldCheck,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import {
  adminEmergencyUnlock,
  createUserInvite,
  disable2FA,
  fetchAccessProfile,
  fetch2FAStatus,
  fetchCurrentUser,
  fetchTrustedDevices,
  getErrorMessage,
  regenerateBackupCodes,
  resolveSecurityUserByEmail,
  reset2FA,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  superAdminResetUser2FA,
  superAdminResetUserPassword,
  updateUser,
  verify2FA,
  getRoleLabel,
  type AccessProfile,
  type AdminSecurityUserLookup,
  type Admin2FAStatus,
  type TrustedDevice,
  type UserMe,
} from "@/lib/api";
import {
  listPasskeys,
  deletePasskey,
  registerNewPasskey,
  isPasskeyCeremonyCancelled,
  type PasskeyOut,
} from "@/lib/api-passkeys";
import { useSessionLogout } from "@/hooks/use-session-logout";
import { toast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";
import { cn } from "@/lib/utils";
import {
  APPEARANCE_DENSITIES,
  APPEARANCE_THEMES,
  DEFAULT_APPEARANCE,
  type AppearanceDensity,
  type AppearanceSettings,
  type AppearanceTheme,
  areAppearanceSettingsEqual,
  getAppearancePreviewPalette,
  getStoredAppearance,
  persistAppearance,
} from "@/lib/appearance";
import {
  formatCompactDuration,
} from "@/lib/secure-session";
import { isRecentSensitiveSessionError } from "@/lib/sensitive-session";
import { DASHBOARD_HOME_HREF } from "@/components/dashboard/dashboard-route-utils";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const SETTINGS_VALIDATION_TOAST_IDS = {
  verify2FA: "settings-verify-2fa-required",
  verify2FAInvalid: "settings-verify-2fa-invalid",
  reset2FA: "settings-reset-2fa-required",
  disable2FA: "settings-disable-2fa-required",
  resolveUser: "settings-resolve-user-required",
  emergencyReason: "settings-emergency-reason-required",
  adminInviteEmail: "settings-admin-invite-email-required",
  adminInviteReason: "settings-admin-invite-reason-required",
} as const;

function isInvalidTwoFactorCodeError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as {
    detail?: unknown;
    message?: unknown;
  };
  if (
    record.detail &&
    typeof record.detail === "object" &&
    "code" in record.detail &&
    (record.detail as { code?: unknown }).code === "invalid_two_factor_code"
  ) {
    return true;
  }

  return (
    typeof record.message === "string" &&
    /invalid two-factor authentication code/i.test(record.message)
  );
}

function extractSetupKey(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("secret");
  } catch {
    return null;
  }
}

function formatDateTime(
  value: string | null | undefined,
  language: AppLanguage,
): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeUntil(
  value: string | null | undefined,
  language: AppLanguage,
): string {
  if (!value) return "-";
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) return "-";
  const remainingSeconds = Math.max(
    Math.floor((expiresAt - Date.now()) / 1000),
    0,
  );
  if (remainingSeconds <= 0) {
    return tr(language, "Expired", "หมดอายุแล้ว");
  }
  return language === "th"
    ? `อีก ${formatCompactDuration(remainingSeconds, language)}`
    : `${formatCompactDuration(remainingSeconds, language)} left`;
}

interface SettingsDisclosureProps {
  title: string;
  description: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  tone?: "default" | "danger";
}

type SettingsPanelId = "general" | "account" | "security" | "admin";

function isSettingsPanelId(value: string | null): value is SettingsPanelId {
  return (
    value === "general" ||
    value === "account" ||
    value === "security" ||
    value === "admin"
  );
}

interface SettingsContentProps {
  presentation?: "page" | "modal";
  onRequestClose?: () => void;
}

interface SensitiveReauthRequest {
  actionLabel: string;
  run: () => Promise<void>;
}

interface SettingsPanelNavButtonProps {
  title: string;
  summary: string;
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
  isModalPresentation?: boolean;
}

function SettingsPanelNavButton({
  title,
  summary,
  active,
  icon,
  onClick,
  isModalPresentation,
}: SettingsPanelNavButtonProps) {
  if (isModalPresentation) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-colors",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
        aria-pressed={active}
      >
        <span
          className={cn(
            "flex shrink-0 transition-colors [&>svg]:size-4",
            active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {icon}
        </span>
        <span className="truncate text-sm">{title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-14 min-w-0 w-full cursor-pointer items-start gap-3.5 overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-[border-color,background-color,color,box-shadow]",
        active
          ? "border-primary/30 bg-background text-foreground shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/70 hover:text-foreground",
      )}
      aria-pressed={active}
    >
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border transition-[background-color,border-color,color]",
          active
            ? "border-primary/20 bg-primary/10 text-primary"
            : "border-border/70 bg-background text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-[0.95rem] font-semibold">{title}</span>
        <span className="mt-1 block line-clamp-2 text-sm leading-5 text-muted-foreground break-words">
          {summary}
        </span>
      </span>
    </button>
  );
}

function SettingsDisclosure({
  title,
  description,
  summary,
  open,
  onOpenChange,
  children,
  tone = "default",
}: SettingsDisclosureProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "rounded-2xl border bg-background px-3 py-2.5",
          tone === "danger"
            ? "border-destructive/20 bg-destructive/3"
            : "border-border",
        )}
      >
        <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-start justify-between gap-3 overflow-hidden rounded-xl text-left transition-[color,background-color] hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block min-w-0 flex-1 overflow-hidden">
            <span className="block break-words text-sm font-medium text-foreground">
              {title}
            </span>
            <span className="block break-words text-xs text-muted-foreground">
              {description}
            </span>
          </span>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-2.5 text-xs text-muted-foreground group-hover:text-foreground">
            {summary ? (
              <span className="hidden max-w-[14rem] truncate text-right sm:block">{summary}</span>
            ) : null}
            {open ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <div
            className={cn(
              "mt-2 border-t pt-3",
              tone === "danger" ? "border-destructive/15" : "border-border/70",
            )}
          >
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
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
  const authCurrentUser = useAuthStore((state) => state.currentUser);
  const setAuthCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const clearToken = useAuthStore((state) => state.clearToken);
  const ssoProvider = useAuthStore((state) => state.ssoProvider);
  const mfaVerified = useAuthStore((state) => state.mfaVerified);
  const mfaAuthenticatedAt = useAuthStore((state) => state.mfaAuthenticatedAt);
  const hydrated = useAuthStore((state) => state.hydrated);
  const getTokenTTL = useAuthStore((state) => state.getTokenTTL);
  const logout = useSessionLogout();

  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);
  const [accessProfile, setAccessProfile] = useState<AccessProfile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [tokenTTL, setTokenTTL] = useState(() => getTokenTTL());
  const [twoFA, setTwoFA] = useState<Admin2FAStatus | null>(null);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [twoFABusy, setTwoFABusy] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [trustedLoading, setTrustedLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyOut[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [resolvedUser, setResolvedUser] =
    useState<AdminSecurityUserLookup | null>(null);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [generatedResetToken, setGeneratedResetToken] = useState("");
  const [generatedResetTokenTTL, setGeneratedResetTokenTTL] = useState<
    number | null
  >(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminInviteReason, setAdminInviteReason] = useState("");
  const [createdAdminInviteEmail, setCreatedAdminInviteEmail] = useState("");
  const [createdAdminInviteUrl, setCreatedAdminInviteUrl] = useState("");
  const [createdAdminInviteExpiresAt, setCreatedAdminInviteExpiresAt] =
    useState<string | null>(null);
  const [appearanceDraft, setAppearanceDraft] =
    useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [savedAppearance, setSavedAppearance] =
    useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [appearanceExpanded, setAppearanceExpanded] = useState(true);
  const [activePanel, setActivePanel] = useState<SettingsPanelId>("general");
  const [securitySectionOpen, setSecuritySectionOpen] = useState<
    "authenticator" | "backup-codes" | "trusted-devices" | null
  >("authenticator");
  const [adminToolsExpanded, setAdminToolsExpanded] = useState(false);
  const [adminSectionOpen, setAdminSectionOpen] = useState<
    "onboarding" | "emergency" | null
  >(null);
  const activeValidationToastIdsRef = useRef(new Set<string>());
  const pendingSensitiveReauthRef = useRef<SensitiveReauthRequest | null>(null);
  const [sensitiveReauthRequest, setSensitiveReauthRequest] =
    useState<SensitiveReauthRequest | null>(null);

  const isAdmin = role === "admin";
  const isModalPresentation = presentation === "modal";

  const loadAccessProfile = useCallback(async () => {
    if (!token) return null;
    try {
      const nextProfile = await fetchAccessProfile(token);
      setAccessProfile(nextProfile);
      return nextProfile;
    } catch {
      setAccessProfile(null);
      return null;
    }
  }, [token]);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token || !userId) {
      setCurrentUser(null);
      setFirstName("");
      setLastName("");
      return;
    }

    if (!authCurrentUser || authCurrentUser.id !== userId) {
      setCurrentUser(null);
      setFirstName("");
      setLastName("");
      return;
    }

    setCurrentUser(authCurrentUser);
    setFirstName(authCurrentUser.first_name || "");
    setLastName(authCurrentUser.last_name || "");
  }, [authCurrentUser, hydrated, token, userId]);

  useEffect(() => {
    const authToken = token ?? undefined;
    if (!hydrated || !authToken || !userId) return;

    let cancelled = false;

    async function loadCurrentUser() {
      setProfileLoading(true);
      try {
        const [me] = await Promise.all([
          fetchCurrentUser(authToken),
          loadAccessProfile(),
        ]);
        if (cancelled || me.id !== userId) return;
        setAuthCurrentUser(me);
        setCurrentUser(me);
        setFirstName(me.first_name || "");
        setLastName(me.last_name || "");
      } catch {
        if (cancelled) return;
        clearToken();
        router.replace("/login");
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    }

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, userId, clearToken, loadAccessProfile, router, setAuthCurrentUser]);

  useEffect(() => {
    if (isModalPresentation) return;

    const requestedPanel = searchParams.get("panel");
    if (!isSettingsPanelId(requestedPanel)) return;

    setActivePanel(requestedPanel);
    if (requestedPanel === "general") {
      setAppearanceExpanded(true);
    }
    if (requestedPanel === "admin") {
      setAdminToolsExpanded(true);
    }
  }, [isModalPresentation, searchParams]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTokenTTL(getTokenTTL());
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [getTokenTTL]);

  useEffect(() => {
    const appearance = getStoredAppearance();
    setAppearanceDraft(appearance);
    setSavedAppearance(appearance);
    setAppearanceReady(true);
  }, []);

  const load2FAStatus = useCallback(async () => {
    if (!token) return;
    setTwoFALoading(true);
    try {
      const status = await fetch2FAStatus(token);
      setTwoFA(status);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFALoading(false);
    }
  }, [token, language]);

  const loadTrustedDevices = useCallback(async () => {
    if (!token) return;
    setTrustedLoading(true);
    try {
      const response = await fetchTrustedDevices(token);
      setTrustedDevices(response.items);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTrustedLoading(false);
    }
  }, [token, language]);

  const loadPasskeys = useCallback(async () => {
    if (!token) return;
    setPasskeyLoading(true);
    try {
      const response = await listPasskeys();
      setPasskeys(response.items);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setPasskeyLoading(false);
    }
  }, [token, language]);

  useEffect(() => {
    if (!hydrated || !token) return;
    void load2FAStatus();
    void loadTrustedDevices();
    void loadPasskeys();
  }, [hydrated, token, load2FAStatus, loadTrustedDevices, loadPasskeys]);

  useEffect(() => {
    let cancelled = false;
    async function buildQr() {
      if (!twoFA?.provisioning_uri) {
        setQrCodeDataUrl(null);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(twoFA.provisioning_uri, {
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
  }, [twoFA?.provisioning_uri]);

  const ttlLabel = useMemo(() => {
    if (!tokenTTL) return tr(language, "Expired", "หมดอายุแล้ว");
    const minutes = Math.floor(tokenTTL / 60);
    const seconds = tokenTTL % 60;
    return `${minutes}m ${seconds}s`;
  }, [tokenTTL, language]);
  const appearancePreview = useMemo(
    () => getAppearancePreviewPalette(appearanceDraft.theme),
    [appearanceDraft.theme],
  );

  const hasAppearanceChanges = useMemo(
    () =>
      appearanceReady &&
      !areAppearanceSettingsEqual(appearanceDraft, savedAppearance),
    [appearanceDraft, appearanceReady, savedAppearance],
  );

  const hasProfileChanges = useMemo(() => {
    if (!currentUser) return false;

    return (
      firstName !== (currentUser.first_name || "") ||
      lastName !== (currentUser.last_name || "")
    );
  }, [currentUser, firstName, lastName]);

  const hasVerifyCode = verifyCode.trim().length > 0;
  const hasResetCode = resetCode.trim().length > 0;
  const hasDisableCode = disableCode.trim().length > 0;
  const normalizedTargetEmail = targetEmail.trim().toLowerCase();
  const hasTargetEmail = normalizedTargetEmail.length > 0;
  const hasEmergencyReason = emergencyReason.trim().length >= 8;
  const normalizedAdminInviteEmail = newAdminEmail.trim().toLowerCase();
  const hasAdminInviteEmail = normalizedAdminInviteEmail.length > 0;
  const hasAdminInviteReason = adminInviteReason.trim().length >= 8;

  const dismissValidationToast = useCallback((id: string) => {
    activeValidationToastIdsRef.current.delete(id);
    toast.dismiss(id);
  }, []);

  const showValidationToastOnce = useCallback(
    (id: string, title: string) => {
      if (activeValidationToastIdsRef.current.has(id)) {
        return;
      }

      activeValidationToastIdsRef.current.add(id);
      toast.error(title, {
        id,
        onDismiss: () => {
          activeValidationToastIdsRef.current.delete(id);
        },
        onAutoClose: () => {
          activeValidationToastIdsRef.current.delete(id);
        },
      });
    },
    [],
  );

  const requestSensitiveReauth = useCallback(
    (request: SensitiveReauthRequest) => {
      pendingSensitiveReauthRef.current = request;
      setSensitiveReauthRequest((current) => current ?? request);
    },
    [],
  );

  const closeSensitiveReauth = useCallback((open: boolean) => {
    if (open) return;
    pendingSensitiveReauthRef.current = null;
    setSensitiveReauthRequest(null);
  }, []);

  const handleSensitiveActionError = useCallback(
    (error: unknown, request: SensitiveReauthRequest): boolean => {
      if (!isRecentSensitiveSessionError(error)) {
        return false;
      }

      requestSensitiveReauth(request);
      return true;
    },
    [requestSensitiveReauth],
  );

  const hasPrivilegedAccess = accessProfile?.has_privileged_access ?? false;
  const privilegedAccessCodename = accessProfile?.access_class ?? null;
  const privilegedAccessProtected =
    hasPrivilegedAccess && !accessProfile?.access_class_revealed;
  const canManagePrivilegedAdmins =
    accessProfile?.can_manage_privileged_admins ?? false;
  const canManageSecurityRecovery =
    accessProfile?.can_manage_security_recovery ?? false;

  const loginMethodSummary = ssoProvider
    ? tr(language, "Organization SSO", "Organization SSO")
    : tr(language, "Local password", "รหัสผ่านภายใน");

  const mfaStatusSummary = mfaVerified
    ? tr(language, "Verified", "ยืนยันแล้ว")
    : tr(language, "Not verified", "ยังไม่ได้ยืนยัน");

  const securityHeaderSummary = useMemo(() => {
    if (!twoFA) {
      return tr(language, "Unable to load status", "โหลดสถานะไม่สำเร็จ");
    }

    const requirement = twoFA.required
      ? tr(language, "Required", "บังคับ")
      : tr(language, "Optional", "ไม่บังคับ");
    const trustedDays = twoFA.trusted_device_days ?? (isAdmin ? 1 : 7);

    return `${
      twoFA.enabled
        ? tr(language, "Enabled", "เปิดใช้งาน")
        : tr(language, "Not enabled", "ยังไม่เปิดใช้งาน")
    } • ${requirement} • ${trustedDays}${tr(language, "d", "วัน")}`;
  }, [twoFA, language, isAdmin]);

  const authenticatorSummary = useMemo(() => {
    if (!twoFA) {
      return tr(language, "Unavailable", "ไม่พร้อมใช้งาน");
    }

    if (twoFA.setup_required || twoFA.provisioning_uri) {
      return tr(language, "Needs verification", "รอยืนยัน");
    }

    return twoFA.enabled
      ? tr(language, "Ready", "พร้อมใช้งาน")
      : tr(language, "Not enabled", "ยังไม่เปิดใช้งาน");
  }, [twoFA, language]);

  const backupCodesSummary = backupCodes.length
    ? tr(
        language,
        `${backupCodes.length} codes ready`,
        `มี ${backupCodes.length} โค้ด`,
      )
    : tr(language, "No backup codes", "ยังไม่มีโค้ด");

  const trustedDevicesSummary = trustedLoading
    ? tr(language, "Loading...", "กำลังโหลด...")
    : trustedDevices.length
      ? tr(
          language,
          `${trustedDevices.length} devices`,
          `${trustedDevices.length} อุปกรณ์`,
        )
      : tr(language, "No devices", "ไม่มีอุปกรณ์");
  const currentTrustedDevice = useMemo(
    () => trustedDevices.find((device) => device.current_device) ?? null,
    [trustedDevices],
  );

  const adminToolsSummary = useMemo(() => {
    const parts: string[] = [];
    if (canManagePrivilegedAdmins) {
      parts.push(tr(language, "Onboarding", "เชิญแอดมิน"));
    }
    if (isAdmin && canManageSecurityRecovery) {
      parts.push(tr(language, "Emergency recovery", "กู้คืนฉุกเฉิน"));
    }
    return parts.join(" • ");
  }, [canManagePrivilegedAdmins, canManageSecurityRecovery, isAdmin, language]);

  const updateAppearanceDraft = useCallback(
    <K extends keyof AppearanceSettings>(
      key: K,
      value: AppearanceSettings[K],
    ) => {
      setAppearanceDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleApplyAppearance = useCallback(() => {
    persistAppearance(appearanceDraft);
    setSavedAppearance(appearanceDraft);
    toast.success(
      tr(language, "Appearance updated", "อัปเดตรูปลักษณ์การแสดงผลแล้ว"),
    );
  }, [appearanceDraft, language]);

  const handleResetAppearance = useCallback(() => {
    persistAppearance(DEFAULT_APPEARANCE);
    setAppearanceDraft(DEFAULT_APPEARANCE);
    setSavedAppearance(DEFAULT_APPEARANCE);
    toast.success(
      tr(
        language,
        "Appearance reset to default",
        "รีเซ็ตรูปลักษณ์กลับค่าเริ่มต้นแล้ว",
      ),
    );
  }, [language]);

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

  const handleResetProfile = useCallback(() => {
    setFirstName(currentUser?.first_name || "");
    setLastName(currentUser?.last_name || "");
  }, [currentUser]);

  const handleSaveProfile = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token || !currentUser || !hasProfileChanges) return;

      setProfileSaving(true);
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
          two_factor_enabled: currentUser.two_factor_enabled,
          mfa_verified: currentUser.mfa_verified,
          mfa_authenticated_at: currentUser.mfa_authenticated_at,
          mfa_recent_for_privileged_actions:
            currentUser.mfa_recent_for_privileged_actions,
          auth_source: currentUser.auth_source,
          sso_provider: currentUser.sso_provider,
        };

        setAuthCurrentUser(nextUser);
        setCurrentUser(nextUser);
        setFirstName(nextUser.first_name || "");
        setLastName(nextUser.last_name || "");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("telemed-profile-updated"));
        }
        toast.success(tr(language, "Profile updated", "อัปเดตโปรไฟล์แล้ว"));
      } catch (error: unknown) {
        toast.error(
          getErrorMessage(
            error,
            tr(
              language,
              "Unable to update profile",
              "ไม่สามารถอัปเดตโปรไฟล์ได้",
            ),
          ),
        );
      } finally {
        setProfileSaving(false);
      }
    },
    [
      currentUser,
      firstName,
      hasProfileChanges,
      language,
      lastName,
      setAuthCurrentUser,
      token,
    ],
  );

  const handleVerify2FA = async () => {
    if (!token || twoFABusy) return;
    if (!hasVerifyCode) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.verify2FA,
        tr(language, "Please enter 2FA code", "กรุณากรอกรหัส 2FA"),
      );
      return;
    }

    setTwoFABusy(true);
    try {
      await verify2FA(verifyCode, token);
      toast.success(
        tr(language, "2FA verified successfully", "ยืนยัน 2FA สำเร็จ"),
      );
      setVerifyCode("");
      await load2FAStatus();
    } catch (error: unknown) {
      if (isInvalidTwoFactorCodeError(error)) {
        showValidationToastOnce(
          SETTINGS_VALIDATION_TOAST_IDS.verify2FAInvalid,
          getErrorMessage(
            error,
            tr(
              language,
              "Authenticator code or backup code is incorrect.",
              "รหัส 2FA หรือ Backup Code ไม่ถูกต้อง",
            ),
          ),
        );
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleReset2FA = async () => {
    if (!token || twoFABusy || Boolean(sensitiveReauthRequest)) return;
    if (twoFA?.enabled && !hasResetCode) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.reset2FA,
        tr(
          language,
          "Please enter current 2FA code",
          "กรุณากรอกรหัส 2FA ปัจจุบัน",
        ),
      );
      return;
    }

    setTwoFABusy(true);
    try {
      const status = await reset2FA(token, {
        current_otp_code: twoFA?.enabled ? resetCode : undefined,
        reason: tr(
          language,
          "Reset from settings page",
          "รีเซ็ตจากหน้าการตั้งค่า",
        ),
      });
      setTwoFA(status);
      setResetCode("");
      setVerifyCode("");
      setBackupCodes([]);
      await loadTrustedDevices();
      toast.success(
        tr(
          language,
          "2FA has been reset. Please scan new QR and verify.",
          "รีเซ็ต 2FA แล้ว กรุณาสแกน QR ใหม่และยืนยัน",
        ),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Reset 2FA", "รีเซ็ต 2FA"),
          run: handleReset2FA,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!token || twoFABusy || Boolean(sensitiveReauthRequest)) return;
    if (!hasDisableCode) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.disable2FA,
        tr(
          language,
          "Please enter current 2FA code to disable",
          "กรุณากรอกรหัส 2FA ปัจจุบันเพื่อปิดระบบ",
        ),
      );
      return;
    }

    setTwoFABusy(true);
    try {
      await disable2FA(disableCode, token);
      setDisableCode("");
      setBackupCodes([]);
      await load2FAStatus();
      await loadTrustedDevices();
      toast.success(tr(language, "2FA disabled", "ปิด 2FA เรียบร้อย"));
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Disable 2FA", "ปิดใช้งาน 2FA"),
          run: handleDisable2FA,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleRegisterPasskey = async () => {
    if (!token || passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      const name = tr(language, "My Device", "อุปกรณ์ของฉัน") + " (" + new Date().toLocaleDateString() + ")";
      await registerNewPasskey(name);
      toast.success(tr(language, "Passkey registered successfully", "ลงทะเบียน Passkey สำเร็จแล้ว"));
      await loadPasskeys();
    } catch (error: unknown) {
      if (isPasskeyCeremonyCancelled(error)) {
        return;
      }
      console.error("Passkey registration error:", error);
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Failed to register Passkey",
            "ไม่สามารถลงทะเบียน Passkey ได้",
          ),
        ),
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleDeletePasskey = async (passkeyId: string) => {
    if (!token || passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      await deletePasskey(passkeyId);
      toast.success(tr(language, "Passkey deleted", "ลบ Passkey เรียบร้อยแล้ว"));
      await loadPasskeys();
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Failed to delete Passkey",
            "ไม่สามารถลบ Passkey ได้",
          ),
        ),
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!token || twoFABusy || Boolean(sensitiveReauthRequest)) return;
    setTwoFABusy(true);
    try {
      const response = await regenerateBackupCodes(token);
      setBackupCodes(response.codes);
      toast.success(
        tr(
          language,
          "Backup codes regenerated. Save them now.",
          "สร้าง Backup Codes ใหม่แล้ว กรุณาบันทึกไว้ทันที",
        ),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Generate / Regenerate", "สร้าง / สร้างใหม่"),
          run: handleRegenerateBackupCodes,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleCopyBackupCodes = async () => {
    if (backupCodes.length === 0) {
      toast.error(tr(language, "No backup codes yet", "ยังไม่มี Backup Codes"));
      return;
    }
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      toast.success(
        tr(language, "Backup codes copied", "คัดลอก Backup Codes แล้ว"),
      );
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  };

  const handleDownloadBackupCodes = () => {
    if (backupCodes.length === 0) {
      toast.error(tr(language, "No backup codes yet", "ยังไม่มี Backup Codes"));
      return;
    }
    const blob = new Blob([backupCodes.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = tr(language, "backup-codes.txt", "รหัสสำรอง-2fa.txt");
    link.click();
    URL.revokeObjectURL(url);
    toast.success(
      tr(language, "Backup codes downloaded", "ดาวน์โหลด Backup Codes แล้ว"),
    );
  };

  const handleRevokeTrustedDevice = async (deviceId: string) => {
    if (!token || twoFABusy || Boolean(sensitiveReauthRequest)) return;
    setTwoFABusy(true);
    try {
      await revokeTrustedDevice(deviceId, token);
      await loadTrustedDevices();
      toast.success(
        tr(language, "Trusted device revoked", "ยกเลิกอุปกรณ์ที่เชื่อถือแล้ว"),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Revoke", "เพิกถอน"),
          run: async () => handleRevokeTrustedDevice(deviceId),
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFABusy(false);
    }
  };

  const handleRevokeAllTrustedDevices = async () => {
    if (!token || twoFABusy || Boolean(sensitiveReauthRequest)) return;
    setTwoFABusy(true);
    try {
      await revokeAllTrustedDevices(token);
      await loadTrustedDevices();
      toast.success(
        tr(language, "All trusted devices revoked", "ยกเลิกอุปกรณ์ทั้งหมดแล้ว"),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Revoke All", "เพิกถอนทั้งหมด"),
          run: handleRevokeAllTrustedDevices,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setTwoFABusy(false);
    }
  };

  const resolveEmergencyTarget = async () => {
    if (!token || emergencyBusy) return;
    if (!hasTargetEmail) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.resolveUser,
        tr(language, "Please enter user email", "กรุณากรอกอีเมลผู้ใช้งาน"),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      const user = await resolveSecurityUserByEmail(normalizedTargetEmail, token);
      setResolvedUser(user);
      toast.success(tr(language, "User found", "พบผู้ใช้แล้ว"));
    } catch (error: unknown) {
      setResolvedUser(null);
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyUnlock = async () => {
    if (!token || emergencyBusy || Boolean(sensitiveReauthRequest)) return;
    if (!hasTargetEmail) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.resolveUser,
        tr(language, "Please enter user email", "กรุณากรอกอีเมลผู้ใช้งาน"),
      );
      return;
    }
    if (!hasEmergencyReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      await adminEmergencyUnlock(
        { email: normalizedTargetEmail, reason: emergencyReason.trim() },
        token,
      );
      toast.success(tr(language, "Account unlocked", "ปลดล็อกบัญชีเรียบร้อย"));
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Unlock account", "ปลดล็อกบัญชี"),
          run: handleEmergencyUnlock,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyReset2FA = async () => {
    if (
      !token ||
      !resolvedUser ||
      emergencyBusy ||
      Boolean(sensitiveReauthRequest)
    ) {
      return;
    }
    if (!hasEmergencyReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      await superAdminResetUser2FA(
        resolvedUser.user_id,
        emergencyReason.trim(),
        token,
      );
      toast.success(
        tr(language, "User 2FA reset successfully", "รีเซ็ต 2FA ให้ผู้ใช้แล้ว"),
      );
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Reset 2FA", "รีเซ็ต 2FA"),
          run: handleEmergencyReset2FA,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleEmergencyResetPassword = async () => {
    if (
      !token ||
      !resolvedUser ||
      emergencyBusy ||
      Boolean(sensitiveReauthRequest)
    ) {
      return;
    }
    if (!hasEmergencyReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setEmergencyBusy(true);
    try {
      const response = await superAdminResetUserPassword(
        resolvedUser.user_id,
        emergencyReason.trim(),
        token,
      );
      setGeneratedResetToken(response.reset_token);
      setGeneratedResetTokenTTL(response.reset_token_expires_in);
      toast.success(
        tr(
          language,
          "Password reset token generated",
          "สร้างโทเคนรีเซ็ตรหัสผ่านแล้ว",
        ),
      );
      await resolveEmergencyTarget();
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(language, "Reset password", "รีเซ็ตรหัสผ่าน"),
          run: handleEmergencyResetPassword,
        })
      ) {
        return;
      }

      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleCopyGeneratedResetToken = async () => {
    if (!generatedResetToken) return;
    try {
      await navigator.clipboard.writeText(generatedResetToken);
      toast.success(
        tr(language, "Reset token copied", "คัดลอกโทเคนรีเซ็ตรหัสผ่านแล้ว"),
      );
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  };

  const handleCopyCreatedAdminInvite = async () => {
    if (!createdAdminInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdAdminInviteUrl);
      toast.success(
        tr(language, "Invite link copied", "คัดลอกลิงก์คำเชิญแล้ว"),
      );
    } catch {
      toast.error(tr(language, "Copy failed", "คัดลอกไม่สำเร็จ"));
    }
  };

  const handleCreateAdminOnboarding = async () => {
    if (
      !token ||
      !canManagePrivilegedAdmins ||
      onboardingBusy ||
      Boolean(sensitiveReauthRequest)
    ) {
      return;
    }

    const email = normalizedAdminInviteEmail;
    const reason = adminInviteReason.trim();
    if (!hasAdminInviteEmail) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.adminInviteEmail,
        tr(language, "Please enter admin email", "กรุณากรอกอีเมลแอดมิน"),
      );
      return;
    }
    if (!hasAdminInviteReason) {
      showValidationToastOnce(
        SETTINGS_VALIDATION_TOAST_IDS.adminInviteReason,
        tr(
          language,
          "Please enter reason with at least 8 characters",
          "กรุณากรอกเหตุผลอย่างน้อย 8 ตัวอักษร",
        ),
      );
      return;
    }

    setOnboardingBusy(true);
    try {
      const invite = await createUserInvite(
        { email, role: "admin", reason },
        token,
      );
      setCreatedAdminInviteEmail(email);
      setCreatedAdminInviteUrl(invite.invite_url);
      setCreatedAdminInviteExpiresAt(invite.expires_at);
      setAdminInviteReason("");
      toast.success(
        tr(language, "Admin invite generated", "สร้างลิงก์คำเชิญแอดมินแล้ว"),
      );
    } catch (error: unknown) {
      if (
        handleSensitiveActionError(error, {
          actionLabel: tr(
            language,
            "Generate admin invite",
            "สร้างลิงก์คำเชิญแอดมิน",
          ),
          run: handleCreateAdminOnboarding,
        })
      ) {
        return;
      }

      setCreatedAdminInviteEmail("");
      setCreatedAdminInviteUrl("");
      setCreatedAdminInviteExpiresAt(null);
      toast.error(
        getErrorMessage(
          error,
          tr(
            language,
            "Something went wrong. Please try again.",
            "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
          ),
        ),
      );
    } finally {
      setOnboardingBusy(false);
    }
  };

  const appearanceThemeCopy: Record<
    AppearanceTheme,
    { title: string; description: string }
  > = {
    clinical: {
      title: tr(language, "Clinical", "Clinical"),
      description: tr(
        language,
        "Clean blue-led daily dashboard",
        "แดชบอร์ดฟ้าใสสำหรับใช้งานทุกวัน",
      ),
    },
    sky: {
      title: tr(language, "Sky", "Sky"),
      description: tr(
        language,
        "Light aqua blue with a fresher mood",
        "ฟ้าอมเขียวเบาๆ ดูสดและสบายขึ้น",
      ),
    },
    warm: {
      title: tr(language, "Warm", "Warm"),
      description: tr(
        language,
        "Soft warm-paper surfaces",
        "โทนอุ่นแบบกระดาษอ่อน ช่วยให้หน้าจอนุ่มลง",
      ),
    },
    calm: {
      title: tr(language, "Calm", "Calm"),
      description: tr(
        language,
        "Muted green for a quieter workspace",
        "โทนเขียวสงบ ลดความแข็งของหน้าจอทำงาน",
      ),
    },
    mint: {
      title: tr(language, "Mint", "Mint"),
      description: tr(
        language,
        "Fresh mint with a softer clinical feel",
        "เขียวมิ้นต์สดเบาๆ ดูสะอาดแต่ไม่แข็งเกินไป",
      ),
    },
    lavender: {
      title: tr(language, "Lavender", "Lavender"),
      description: tr(
        language,
        "Soft violet with a calmer premium tone",
        "ม่วงลาเวนเดอร์อ่อน ให้ความรู้สึกนุ่มและพรีเมียม",
      ),
    },
  };

  const appearanceDensityCopy: Record<
    AppearanceDensity,
    { title: string; description: string }
  > = {
    comfortable: {
      title: tr(language, "Comfortable", "ปกติ"),
      description: tr(
        language,
        "More breathing room",
        "เว้นระยะมากขึ้น อ่านสบายตา",
      ),
    },
    compact: {
      title: tr(language, "Compact", "กระชับ"),
      description: tr(
        language,
        "Denser admin layout",
        "แน่นขึ้นเล็กน้อย เหมาะกับงานข้อมูลเยอะ",
      ),
    },
  };

  const generalSummary = `${appearanceThemeCopy[savedAppearance.theme].title} • ${appearanceDensityCopy[savedAppearance.density].title}`;

  const settingsPanels = [
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
      summary: `${loginMethodSummary} • ${ttlLabel}`,
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
      summary: securityHeaderSummary,
      description: tr(
        language,
        "Manage MFA, backup codes, and trusted devices.",
        "จัดการ MFA, รหัสสำรอง และอุปกรณ์ที่เชื่อถือ",
      ),
      icon: <ShieldCheck className="size-4" />,
    },
    ...(canManagePrivilegedAdmins || (isAdmin && canManageSecurityRecovery)
      ? [
          {
            id: "admin" as const,
            title: tr(language, "Admin Tools", "เครื่องมือผู้ดูแลระบบ"),
            summary:
              adminToolsSummary ||
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
  ];

  const activePanelMeta =
    settingsPanels.find((panel) => panel.id === activePanel) ??
    settingsPanels[0];

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
                : "md:overflow-y-auto md:border-r md:border-b-0"
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
              {!isModalPresentation && (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {tr(
                    language,
                    "Keep the essentials in a focused panel.",
                    "รวมการตั้งค่าหลักไว้ในแผงเดียวที่โฟกัสง่าย",
                  )}
                </p>
              )}
            </div>

            <div
              className={cn(
                "flex overflow-x-auto pb-1",
                isModalPresentation
                  ? "mt-2 gap-1 md:flex-col md:overflow-visible"
                  : "mt-4 gap-2 md:flex-col md:overflow-visible"
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
                        setAppearanceExpanded(true);
                      }
                      if (panel.id === "admin") {
                        setAdminToolsExpanded(true);
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

            <div
              className={cn(
                "flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5",
                "min-h-0",
              )}
            >
              {activePanel === "general" ? (
                <div className="space-y-4">
                  {isModalPresentation ? (
                    <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-border/70 bg-muted/18 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div className="flex items-start gap-3">
                          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <ShieldCheck className="size-4.5" />
                          </span>
                          <div className="min-w-0 overflow-hidden">
                            <p className="break-words text-sm font-semibold text-foreground">
                              {tr(
                                language,
                                "Protect your account",
                                "ปกป้องบัญชีของคุณ",
                              )}
                            </p>
                            <p className="mt-1 max-w-[46ch] break-words text-sm leading-6 text-muted-foreground">
                              {tr(
                                language,
                                "Review MFA and recovery options before choosing a daily theme.",
                                "ตรวจสอบ MFA และตัวเลือกกู้คืนก่อนเลือกธีมสำหรับใช้งานทุกวัน",
                              )}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="lg:shrink-0"
                          onClick={() => setActivePanel("security")}
                        >
                          {tr(language, "Open security", "ไปที่ความปลอดภัย")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-w-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
                      <div className="min-w-0 overflow-x-auto rounded-[1.5rem] border border-border/70 bg-muted/18 p-4">
                        <div className="flex items-start gap-3">
                          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Palette className="size-4.5" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {tr(
                                language,
                                "Workspace look & feel",
                                "บุคลิกของหน้าจอทำงาน",
                              )}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {tr(
                                language,
                                "Pick a theme and density that feel calm for daily tasks.",
                                "เลือกธีมและความหนาแน่นที่สบายตาสำหรับการใช้งานทุกวัน",
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0 overflow-x-auto rounded-[1.5rem] border border-border/70 bg-background p-4">
                        <div className="flex items-start gap-3">
                          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <ShieldCheck className="size-4.5" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {tr(
                                language,
                                "Protect your account",
                                "ปกป้องบัญชีของคุณ",
                              )}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {tr(
                                language,
                                "Open security settings to verify MFA and recovery options.",
                                "เปิดส่วนความปลอดภัยเพื่อตรวจสอบ MFA และตัวเลือกกู้คืน",
                              )}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => setActivePanel("security")}
                            >
                              {tr(
                                language,
                                "Open security",
                                "ไปที่ความปลอดภัย",
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Card
                    size="sm"
                    className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
                  >
                    <Collapsible
                      open={appearanceExpanded}
                      onOpenChange={setAppearanceExpanded}
                    >
                      <CardHeader>
                        <CollapsibleTrigger className="group -m-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer flex-col items-start gap-3 rounded-2xl p-2 text-left transition-[background-color,color] hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-row lg:justify-between">
                          <span className="block min-w-0 overflow-hidden">
                            <span className="block break-words text-[0.98rem] leading-normal font-medium">
                              {tr(language, "Appearance", "รูปลักษณ์การแสดงผล")}
                            </span>
                            <span
                              className={cn(
                                "block break-words text-[0.95rem] text-muted-foreground",
                                isModalPresentation && "max-w-[48ch] leading-6",
                              )}
                            >
                              {tr(
                                language,
                                "Choose a theme and spacing that feel right for daily work.",
                                "เลือกธีมและระยะห่างที่สบายตาสำหรับการใช้งานประจำวัน",
                              )}
                            </span>
                          </span>
                          <span className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground transition-[border-color,background-color,color,box-shadow] group-hover:bg-muted/70 group-hover:text-foreground lg:self-center">
                            <span>
                              {appearanceExpanded
                                ? tr(language, "Hide", "ซ่อน")
                                : tr(language, "Show", "แสดง")}
                            </span>
                            {appearanceExpanded ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </span>
                        </CollapsibleTrigger>
                      </CardHeader>

                      <CollapsibleContent className="overflow-hidden">
                        <CardContent className="space-y-4 pt-0">
                          <div
                            className={cn(
                              "mx-auto grid gap-3",
                              isModalPresentation
                                ? "max-w-none xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start"
                                : "max-w-[1160px] xl:grid-cols-[minmax(0,720px)_340px] xl:items-start xl:justify-between",
                            )}
                          >
                            <div className="space-y-3">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium">
                                    {tr(language, "Theme", "ธีม")}
                                  </p>
                                  <span className="text-[11px] text-muted-foreground">
                                    {tr(
                                      language,
                                      "6 curated themes",
                                      "ธีมคัดมาแล้ว 6 แบบ",
                                    )}
                                  </span>
                                </div>
                                <div
                                  className={cn(
                                    "grid gap-2 sm:grid-cols-2",
                                    isModalPresentation
                                      ? "2xl:grid-cols-3"
                                      : "xl:grid-cols-3",
                                  )}
                                >
                                  {APPEARANCE_THEMES.map((themeOption) => {
                                    const palette =
                                      getAppearancePreviewPalette(themeOption);
                                    const isDraftTheme =
                                      appearanceDraft.theme === themeOption;
                                    const isSavedTheme =
                                      savedAppearance.theme === themeOption;

                                    return (
                                      <button
                                        key={themeOption}
                                        type="button"
                                        onClick={() =>
                                          updateAppearanceDraft(
                                            "theme",
                                            themeOption,
                                          )
                                        }
                                        className={cn(
                                          "rounded-xl border p-2 text-left transition-[border-color,background-color,box-shadow]",
                                          isDraftTheme
                                            ? "border-primary bg-primary/10 shadow-sm"
                                            : isSavedTheme
                                              ? "border-primary/35 bg-primary/5"
                                              : "border-border bg-background hover:bg-muted/50",
                                        )}
                                      >
                                        <div
                                          className="mb-2 overflow-hidden rounded-lg border"
                                          style={{
                                            borderColor: palette.border,
                                            backgroundColor: palette.page,
                                            color: palette.text,
                                          }}
                                        >
                                          <div className="grid grid-cols-[34px_1fr]">
                                            <div
                                              className="px-1.5 py-1.5"
                                              style={{
                                                backgroundColor:
                                                  palette.sidebar,
                                                borderRight: `1px solid ${palette.border}`,
                                              }}
                                            >
                                              <div
                                                className="h-1.5 rounded-full"
                                                style={{
                                                  backgroundColor:
                                                    palette.accent,
                                                  opacity: 0.95,
                                                }}
                                              />
                                              <div
                                                className="mt-1 h-1 rounded-full"
                                                style={{
                                                  backgroundColor:
                                                    palette.accentSoft,
                                                }}
                                              />
                                              <div
                                                className="mt-1 h-1 rounded-full"
                                                style={{
                                                  backgroundColor:
                                                    palette.panelMuted,
                                                }}
                                              />
                                            </div>
                                            <div className="space-y-1.5 p-1.5">
                                              <div className="flex items-center justify-between gap-1.5">
                                                <div
                                                  className="h-1.5 w-9 rounded-full"
                                                  style={{
                                                    backgroundColor:
                                                      palette.text,
                                                    opacity: 0.16,
                                                  }}
                                                />
                                                <div
                                                  className="h-3 w-5 rounded-full"
                                                  style={{
                                                    backgroundColor:
                                                      palette.accent,
                                                  }}
                                                />
                                              </div>
                                              <div
                                                className="rounded-md border p-1.5"
                                                style={{
                                                  borderColor: palette.border,
                                                  backgroundColor:
                                                    palette.panel,
                                                }}
                                              >
                                                <div
                                                  className="h-1.5 w-10 rounded-full"
                                                  style={{
                                                    backgroundColor:
                                                      palette.text,
                                                    opacity: 0.12,
                                                  }}
                                                />
                                                <div className="mt-1.5 flex gap-1">
                                                  <div
                                                    className="h-3.5 flex-1 rounded-sm"
                                                    style={{
                                                      backgroundColor:
                                                        palette.accentSoft,
                                                    }}
                                                  />
                                                  <div
                                                    className="h-3.5 w-5 rounded-sm"
                                                    style={{
                                                      backgroundColor:
                                                        palette.panelMuted,
                                                    }}
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-sm font-semibold">
                                            {
                                              appearanceThemeCopy[themeOption]
                                                .title
                                            }
                                          </p>
                                          <div className="flex items-center gap-1">
                                            {isSavedTheme ? (
                                              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
                                                {tr(
                                                  language,
                                                  "Active",
                                                  "ใช้งานอยู่",
                                                )}
                                              </span>
                                            ) : null}
                                            {isDraftTheme && !isSavedTheme ? (
                                              <span className="rounded-full border border-primary/25 bg-background px-2 py-0.5 text-[10px] font-medium text-primary">
                                                {tr(
                                                  language,
                                                  "Selected",
                                                  "ที่เลือก",
                                                )}
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>
                                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                          {
                                            appearanceThemeCopy[themeOption]
                                              .description
                                          }
                                        </p>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <p className="text-sm font-medium">
                                  {tr(language, "Density", "ความหนาแน่น")}
                                </p>
                                <div className="grid max-w-[520px] gap-2 sm:grid-cols-2">
                                  {APPEARANCE_DENSITIES.map((density) => (
                                    <button
                                      key={density}
                                      type="button"
                                      onClick={() =>
                                        updateAppearanceDraft(
                                          "density",
                                          density,
                                        )
                                      }
                                      className={cn(
                                        "rounded-2xl border px-3.5 py-2 text-left transition-[border-color,background-color,box-shadow]",
                                        appearanceDraft.density === density
                                          ? "border-primary bg-primary/10 shadow-sm"
                                          : "border-border bg-background hover:bg-muted/50",
                                      )}
                                    >
                                      <p className="text-sm font-semibold">
                                        {appearanceDensityCopy[density].title}
                                      </p>
                                      <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                        {
                                          appearanceDensityCopy[density]
                                            .description
                                        }
                                      </p>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2.5 rounded-2xl border border-border bg-muted/20 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    {tr(language, "Preview", "ตัวอย่าง")}
                                  </p>
                                  <p className="text-[11px] leading-4 text-muted-foreground">
                                    {tr(
                                      language,
                                      "Sidebar, cards, actions, and list spacing",
                                      "Sidebar, cards, ปุ่ม และระยะห่างของรายการ",
                                    )}
                                  </p>
                                </div>
                                <span className="text-[11px] text-muted-foreground">
                                  {
                                    appearanceDensityCopy[
                                      appearanceDraft.density
                                    ].title
                                  }
                                </span>
                              </div>

                              <div
                                className="overflow-hidden rounded-[20px] border"
                                style={{
                                  backgroundColor: appearancePreview.page,
                                  borderColor: appearancePreview.border,
                                  color: appearancePreview.text,
                                }}
                              >
                                <div className="grid min-h-[118px] grid-cols-[70px_1fr]">
                                  <div
                                    className="space-y-1.5 px-1.5 py-1.5"
                                    style={{
                                      backgroundColor:
                                        appearancePreview.sidebar,
                                      borderRight: `1px solid ${appearancePreview.border}`,
                                    }}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <div
                                        className="size-5 rounded-xl"
                                        style={{
                                          backgroundColor:
                                            appearancePreview.accent,
                                        }}
                                      />
                                      <div className="space-y-1">
                                        <div
                                          className="h-1.5 w-8 rounded-full"
                                          style={{
                                            backgroundColor:
                                              appearancePreview.text,
                                            opacity: 0.18,
                                          }}
                                        />
                                        <div
                                          className="h-1 w-6 rounded-full"
                                          style={{
                                            backgroundColor:
                                              appearancePreview.text,
                                            opacity: 0.1,
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <div
                                      className="rounded-xl px-2 py-1 text-[10px] font-semibold"
                                      style={{
                                        backgroundColor:
                                          appearancePreview.accentSoft,
                                        color: appearancePreview.text,
                                      }}
                                    >
                                      {tr(language, "Patients", "ผู้ป่วย")}
                                    </div>
                                    <div
                                      className="rounded-xl px-2 py-1 text-[10px]"
                                      style={{
                                        backgroundColor:
                                          appearancePreview.panelMuted,
                                        color: appearancePreview.mutedText,
                                      }}
                                    >
                                      {tr(language, "Meetings", "นัดหมาย")}
                                    </div>
                                  </div>

                                  <div className="space-y-1.5 px-2 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="space-y-1">
                                        <div
                                          className="h-1.5 w-16 rounded-full"
                                          style={{
                                            backgroundColor:
                                              appearancePreview.text,
                                            opacity: 0.14,
                                          }}
                                        />
                                        <div
                                          className="h-1.5 w-24 rounded-full"
                                          style={{
                                            backgroundColor:
                                              appearancePreview.text,
                                            opacity: 0.08,
                                          }}
                                        />
                                      </div>
                                      <div className="flex gap-1.5">
                                        <div
                                          className="rounded-full px-2.5 py-1.5 text-[10px] font-semibold"
                                          style={{
                                            backgroundColor:
                                              appearancePreview.accent,
                                            color:
                                              appearancePreview.accentForeground,
                                          }}
                                        >
                                          {tr(language, "New", "ใหม่")}
                                        </div>
                                        <div
                                          className="rounded-full border px-2.5 py-1.5 text-[10px] font-semibold"
                                          style={{
                                            borderColor:
                                              appearancePreview.border,
                                            backgroundColor:
                                              appearancePreview.panel,
                                            color: appearancePreview.text,
                                          }}
                                        >
                                          {tr(language, "Filter", "กรอง")}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                      {[0, 1].map((index) => (
                                        <div
                                          key={index}
                                          className={cn(
                                            "rounded-2xl border",
                                            appearanceDraft.density ===
                                              "compact"
                                              ? "p-1.5"
                                              : "p-2",
                                          )}
                                          style={{
                                            backgroundColor:
                                              appearancePreview.panel,
                                            borderColor:
                                              appearancePreview.border,
                                          }}
                                        >
                                          <div
                                            className="h-1.5 w-12 rounded-full"
                                            style={{
                                              backgroundColor:
                                                appearancePreview.text,
                                              opacity: 0.14,
                                            }}
                                          />
                                          <div className="mt-2 flex items-end gap-1">
                                            {[20, 30, 24, 36].map(
                                              (height, barIndex) => (
                                                <div
                                                  key={barIndex}
                                                  className="w-1.5 rounded-full"
                                                  style={{
                                                    height: Math.max(
                                                      14,
                                                      height - 6,
                                                    ),
                                                    backgroundColor:
                                                      barIndex % 2 === 0
                                                        ? appearancePreview.accent
                                                        : appearancePreview.accentSoft,
                                                  }}
                                                />
                                              ),
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>

                                    <div
                                      className="rounded-2xl border"
                                      style={{
                                        backgroundColor:
                                          appearancePreview.panel,
                                        borderColor: appearancePreview.border,
                                      }}
                                    >
                                      {[
                                        tr(
                                          language,
                                          "Critical follow-up",
                                          "ติดตามด่วน",
                                        ),
                                        tr(
                                          language,
                                          "Medication review",
                                          "ทบทวนยา",
                                        ),
                                        tr(
                                          language,
                                          "Lab verified",
                                          "ยืนยันผลแลบ",
                                        ),
                                      ].map((label, index) => (
                                        <div
                                          key={label}
                                          className={cn(
                                            "flex items-center justify-between px-2.5",
                                            appearanceDraft.density ===
                                              "compact"
                                              ? "py-1.5"
                                              : "py-2",
                                            index !== 2 && "border-b",
                                          )}
                                          style={{
                                            borderColor:
                                              appearancePreview.border,
                                          }}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span
                                              className="size-2 rounded-full"
                                              style={{
                                                backgroundColor:
                                                  index === 0
                                                    ? "#ef7f6d"
                                                    : index === 1
                                                      ? appearancePreview.accent
                                                      : "#6bb68d",
                                              }}
                                            />
                                            <span className="text-[11px] font-medium">
                                              {label}
                                            </span>
                                          </div>
                                          <span
                                            className="text-[10px]"
                                            style={{
                                              color:
                                                appearancePreview.mutedText,
                                            }}
                                          >
                                            {index === 0
                                              ? "09:30"
                                              : index === 1
                                                ? "13:00"
                                                : "Done"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-[10px] leading-4 text-muted-foreground">
                                  {hasAppearanceChanges
                                    ? tr(
                                        language,
                                        "Changes are ready to apply.",
                                        "พร้อมใช้งานเมื่อกดบันทึก",
                                      )
                                    : tr(
                                        language,
                                        "Saved appearance is already active.",
                                        "กำลังใช้ค่าที่บันทึกไว้แล้ว",
                                      )}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={handleResetAppearance}
                                  >
                                    {tr(language, "Reset", "รีเซ็ต")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleApplyAppearance}
                                    disabled={
                                      !appearanceReady || !hasAppearanceChanges
                                    }
                                  >
                                    {tr(language, "Apply", "ใช้งาน")}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                </div>
              ) : null}

              {activePanel === "account" ? (
                <Card
                  size="sm"
                  className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
                >
                  <CardHeader>
                    <CardTitle>
                      {tr(
                        language,
                        "Profile, Access & Session",
                        "โปรไฟล์ การเข้าใช้งาน และเซสชัน",
                      )}
                    </CardTitle>
                    <CardDescription>
                      {tr(
                        language,
                        "Edit your profile and review sign-in details, MFA status, and the current session in one place.",
                        "แก้ไขโปรไฟล์ พร้อมดูวิธีเข้าสู่ระบบ สถานะ MFA และเซสชันปัจจุบันได้ในที่เดียว",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {profileLoading ? (
                      <p className="text-sm text-muted-foreground">
                        {tr(language, "Loading profile...", "กำลังโหลดโปรไฟล์...")}
                      </p>
                    ) : (
                      <form className="space-y-4" onSubmit={handleSaveProfile}>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="settings-first-name">
                              {tr(language, "First name", "ชื่อ")}
                            </Label>
                            <Input
                              id="settings-first-name"
                              value={firstName}
                              onChange={(event) => setFirstName(event.target.value)}
                              placeholder={tr(language, "First name", "ชื่อ")}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="settings-last-name">
                              {tr(language, "Last name", "นามสกุล")}
                            </Label>
                            <Input
                              id="settings-last-name"
                              value={lastName}
                              onChange={(event) => setLastName(event.target.value)}
                              placeholder={tr(language, "Last name", "นามสกุล")}
                            />
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="settings-email">
                              {tr(language, "Email", "อีเมล")}
                            </Label>
                            <Input
                              id="settings-email"
                              value={currentUser?.email || ""}
                              disabled
                              readOnly
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="settings-role">
                              {tr(language, "Role", "บทบาท")}
                            </Label>
                            <Input
                              id="settings-role"
                              value={
                                currentUser
                                  ? getRoleLabel(currentUser.role, language)
                                  : ""
                              }
                              disabled
                              readOnly
                            />
                          </div>
                        </div>

                        {hasPrivilegedAccess ? (
                          <div className="space-y-2">
                            <Label htmlFor="settings-privileged-access">
                              {tr(
                                language,
                                "Access class",
                                "ชั้นการเข้าถึง",
                              )}
                            </Label>
                            <Input
                              id="settings-privileged-access"
                              value={
                                privilegedAccessCodename ||
                                tr(
                                  language,
                                  "Protected until recent MFA",
                                  "ปกป้องไว้จนกว่าจะยืนยัน MFA ล่าสุด",
                                )
                              }
                              disabled
                              readOnly
                            />
                            {privilegedAccessProtected ? (
                              <p className="text-xs text-muted-foreground">
                                {tr(
                                  language,
                                  "Detailed privileged access stays hidden until this session has recent MFA.",
                                  "รายละเอียดสิทธิพิเศษจะยังไม่แสดงจนกว่าเซสชันนี้จะมี MFA ล่าสุด",
                                )}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="submit"
                            disabled={!hasProfileChanges || profileSaving}
                          >
                            {profileSaving
                              ? tr(language, "Saving...", "กำลังบันทึก...")
                              : tr(language, "Save changes", "บันทึกการเปลี่ยนแปลง")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleResetProfile}
                            disabled={profileSaving || !hasProfileChanges}
                          >
                            {tr(language, "Reset", "รีเซ็ต")}
                          </Button>
                        </div>
                      </form>
                    )}

                    <div
                      className={cn(
                        "grid gap-2 sm:grid-cols-2",
                        isAdmin && "xl:grid-cols-4",
                        !isAdmin && "xl:grid-cols-3",
                      )}
                    >
                      <div className="rounded-2xl border border-border bg-muted/20 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {tr(language, "Login method", "วิธีเข้าสู่ระบบ")}
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {loginMethodSummary}
                        </p>
                        {ssoProvider ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {ssoProvider}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/20 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {tr(language, "MFA", "MFA")}
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {mfaStatusSummary}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {tr(language, "Last verified", "ยืนยันล่าสุด")}{" "}
                          {formatDateTime(mfaAuthenticatedAt, language)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border bg-muted/20 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {tr(language, "Session", "เซสชัน")}
                        </p>
                        <p className="mt-1 text-sm font-medium">{ttlLabel}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {tr(
                            language,
                            "Token time remaining",
                            "เวลาโทเคนคงเหลือ",
                          )}
                        </p>
                      </div>
                      {isAdmin ? (
                        <div className="rounded-2xl border border-border bg-muted/20 p-3">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {tr(language, "Access source", "แหล่งสิทธิ")}
                          </p>
                          <p className="mt-1 text-sm font-medium">
                            {tr(
                              language,
                              "DB-backed assignments",
                              "สิทธิที่ผูกกับฐานข้อมูล",
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {tr(
                              language,
                              "Env remains fallback only",
                              "env เป็น fallback เท่านั้น",
                            )}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="destructive" onClick={logout}>
                        {tr(language, "Log out", "ออกจากระบบ")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {activePanel === "security" ? (
                <Card
                  size="sm"
                  className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
                >
                  <CardHeader>
                    <CardTitle>
                      {tr(language, "Security", "ความปลอดภัย")}
                    </CardTitle>
                    <CardDescription>
                      {tr(
                        language,
                        "Use concise sections to manage authenticator setup, backup codes, and trusted devices.",
                        "จัดการ Authenticator, รหัสสำรอง และอุปกรณ์ที่เชื่อถือแบบแยกเป็นส่วนที่เปิดดูได้ง่าย",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {twoFALoading ? (
                      <p className="text-sm text-muted-foreground">
                        {tr(
                          language,
                          "Loading 2FA status...",
                          "กำลังโหลดสถานะ 2FA...",
                        )}
                      </p>
                    ) : twoFA ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-border bg-muted/20 px-3 py-1 text-xs font-medium text-foreground">
                            {securityHeaderSummary}
                          </span>
                          <span className="rounded-full border border-border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                            {tr(language, "Last verified", "ยืนยันล่าสุด")}{" "}
                            {formatDateTime(mfaAuthenticatedAt, language)}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <SettingsDisclosure
                            title={tr(
                              language,
                              "Authenticator",
                              "Authenticator",
                            )}
                            description={tr(
                              language,
                              "Verify, reset, or disable the primary authenticator.",
                              "ยืนยัน รีเซ็ต หรือปิดตัว Authenticator หลัก",
                            )}
                            summary={authenticatorSummary}
                            open={securitySectionOpen === "authenticator"}
                            onOpenChange={(open) =>
                              setSecuritySectionOpen(
                                open ? "authenticator" : null,
                              )
                            }
                          >
                            <div
                              className={cn(
                                "grid gap-4",
                                (twoFA.setup_required ||
                                  twoFA.provisioning_uri) &&
                                  twoFA.provisioning_uri &&
                                  "xl:grid-cols-[240px_minmax(0,1fr)]",
                              )}
                            >
                              {(twoFA.setup_required ||
                                twoFA.provisioning_uri) &&
                              twoFA.provisioning_uri ? (
                                <div className="space-y-2 rounded-xl border border-border bg-muted/15 p-3">
                                  <p className="text-xs text-muted-foreground">
                                    {tr(
                                      language,
                                      "Scan the QR code or copy the setup key.",
                                      "สแกน QR code หรือคัดลอกรหัสตั้งค่า",
                                    )}
                                  </p>
                                  <div className="flex justify-center rounded-xl bg-white p-2">
                                    {qrCodeDataUrl ? (
                                      <Image
                                        src={qrCodeDataUrl}
                                        alt={tr(
                                          language,
                                          "2FA QR code",
                                          "คิวอาร์โค้ด 2FA",
                                        )}
                                        width={220}
                                        height={220}
                                        unoptimized
                                        className="h-[220px] w-[220px]"
                                      />
                                    ) : (
                                      <p className="py-8 text-sm text-muted-foreground">
                                        {tr(
                                          language,
                                          "Generating QR code...",
                                          "กำลังสร้าง QR code...",
                                        )}
                                      </p>
                                    )}
                                  </div>
                                  <SecretDisclosure
                                    key={
                                      extractSetupKey(twoFA.provisioning_uri) ??
                                      "settings-setup-key-hidden"
                                    }
                                    label={tr(
                                      language,
                                      "Setup key",
                                      "รหัสตั้งค่า",
                                    )}
                                    value={extractSetupKey(
                                      twoFA.provisioning_uri,
                                    )}
                                    showLabel={tr(
                                      language,
                                      "Show setup key",
                                      "แสดงรหัสตั้งค่า",
                                    )}
                                    hideLabel={tr(
                                      language,
                                      "Hide setup key",
                                      "ซ่อนรหัสตั้งค่า",
                                    )}
                                  />
                                </div>
                              ) : null}

                              <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="rounded-xl border border-border bg-muted/15 p-3">
                                    <p className="text-[11px] font-medium text-muted-foreground">
                                      {tr(language, "Status", "สถานะ")}
                                    </p>
                                    <p className="mt-1 text-sm font-medium">
                                      {twoFA.enabled
                                        ? tr(language, "Enabled", "เปิดใช้งาน")
                                        : tr(
                                            language,
                                            "Not enabled",
                                            "ยังไม่เปิดใช้งาน",
                                          )}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-border bg-muted/15 p-3">
                                    <p className="text-[11px] font-medium text-muted-foreground">
                                      {tr(language, "Policy", "นโยบาย")}
                                    </p>
                                    <p className="mt-1 text-sm font-medium">
                                      {twoFA.required
                                        ? tr(
                                            language,
                                            `Required${isAdmin ? " (Admin)" : ""}`,
                                            `บังคับ${isAdmin ? " (ผู้ดูแลระบบ)" : ""}`,
                                          )
                                        : tr(language, "Optional", "ไม่บังคับ")}
                                    </p>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <Label htmlFor="two_fa_verify">
                                    {tr(
                                      language,
                                      "2FA Verification Code",
                                      "รหัสยืนยัน 2FA",
                                    )}
                                  </Label>
                                  <div className="flex flex-wrap gap-2">
                                    <Input
                                      id="two_fa_verify"
                                      inputMode="numeric"
                                      maxLength={12}
                                      placeholder={tr(
                                        language,
                                        "123456",
                                        "123456",
                                      )}
                                      value={verifyCode}
                                      onChange={(event) => {
                                        setVerifyCode(event.target.value);
                                        dismissValidationToast(
                                          SETTINGS_VALIDATION_TOAST_IDS.verify2FA,
                                        );
                                        dismissValidationToast(
                                          SETTINGS_VALIDATION_TOAST_IDS.verify2FAInvalid,
                                        );
                                      }}
                                      className="min-w-[220px] flex-1"
                                    />
                                    <Button
                                      type="button"
                                      onClick={handleVerify2FA}
                                      disabled={twoFABusy}
                                    >
                                      {twoFABusy
                                        ? tr(
                                            language,
                                            "Verifying...",
                                            "กำลังยืนยัน...",
                                          )
                                        : tr(
                                            language,
                                            "Verify 2FA",
                                            "ยืนยัน 2FA",
                                          )}
                                    </Button>
                                  </div>
                                </div>

                                <div
                                  className={cn(
                                    "grid gap-3",
                                    !isAdmin && twoFA.enabled
                                      ? "lg:grid-cols-2"
                                      : "grid-cols-1",
                                  )}
                                >
                                  <div className="space-y-2 rounded-xl border border-border bg-muted/15 p-3">
                                    <p className="text-sm font-medium">
                                      {tr(
                                        language,
                                        "Reset Authenticator",
                                        "รีเซ็ต Authenticator",
                                      )}
                                    </p>
                                    {twoFA.enabled ? (
                                      <>
                                        <Label htmlFor="two_fa_reset_code">
                                          {tr(
                                            language,
                                            "Current 2FA code",
                                            "รหัส 2FA ปัจจุบัน",
                                          )}
                                        </Label>
                                        <Input
                                          id="two_fa_reset_code"
                                          inputMode="numeric"
                                          maxLength={12}
                                          placeholder={tr(
                                            language,
                                            "123456",
                                            "123456",
                                          )}
                                          value={resetCode}
                                          onChange={(event) => {
                                            setResetCode(event.target.value);
                                            dismissValidationToast(
                                              SETTINGS_VALIDATION_TOAST_IDS.reset2FA,
                                            );
                                          }}
                                        />
                                      </>
                                    ) : null}
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={handleReset2FA}
                                      disabled={twoFABusy}
                                    >
                                      {twoFABusy
                                        ? tr(
                                            language,
                                            "Resetting...",
                                            "กำลังรีเซ็ต...",
                                          )
                                        : tr(
                                            language,
                                            "Reset 2FA",
                                            "รีเซ็ต 2FA",
                                          )}
                                    </Button>
                                  </div>

                                  {!isAdmin && twoFA.enabled ? (
                                    <div className="space-y-2 rounded-xl border border-destructive/20 bg-destructive/3 p-3">
                                      <p className="text-sm font-medium">
                                        {tr(
                                          language,
                                          "Disable 2FA",
                                          "ปิดใช้งาน 2FA",
                                        )}
                                      </p>
                                      <Label htmlFor="two_fa_disable_code">
                                        {tr(
                                          language,
                                          "Current 2FA code",
                                          "รหัส 2FA ปัจจุบัน",
                                        )}
                                      </Label>
                                      <Input
                                        id="two_fa_disable_code"
                                        inputMode="numeric"
                                        maxLength={12}
                                        placeholder={tr(
                                          language,
                                          "123456",
                                          "123456",
                                        )}
                                        value={disableCode}
                                        onChange={(event) => {
                                          setDisableCode(event.target.value);
                                          dismissValidationToast(
                                            SETTINGS_VALIDATION_TOAST_IDS.disable2FA,
                                          );
                                        }}
                                      />
                                      <Button
                                        type="button"
                                        variant="destructive"
                                        onClick={handleDisable2FA}
                                        disabled={twoFABusy}
                                      >
                                        {tr(
                                          language,
                                          "Disable 2FA",
                                          "ปิดใช้งาน 2FA",
                                        )}
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </SettingsDisclosure>

                          <SettingsDisclosure
                            open={securitySectionOpen === "passkeys"}
                            onOpenChange={(open) =>
                              setSecuritySectionOpen(open ? "passkeys" : null)
                            }
                            title={tr(language, "Passkeys", "Passkeys")}
                            description={tr(
                              language,
                              "Use biometrics like TouchID or FaceID for instant, phishing-proof sign-in.",
                              "ใช้การสแกนนิ้วหรือใบหน้าเพื่อเข้าสู่ระบบที่รวดเร็วและปลอดภัยสูงสุด",
                            )}
                            summary={
                              passkeyLoading
                                ? tr(language, "Loading...", "กำลังโหลด...")
                                : tr(
                                    language,
                                    `${passkeys.length} keys`,
                                    `${passkeys.length} กุญแจ`,
                                  )
                            }
                          >
                            <div className="space-y-4">
                              <p className="text-sm text-muted-foreground">
                                {tr(
                                  language,
                                  "Passkeys provide a faster and more secure way to sign in without typing passwords or OTPs.",
                                  "Passkeys ช่วยให้เข้าสู่ระบบได้เร็วและปลอดภัยกว่าเดิม โดยไม่ต้องพิมพ์รหัสผ่านหรือรหัส OTP",
                                )}
                              </p>
                              {passkeys.length > 0 ? (
                                <div className="space-y-2">
                                  {passkeys.map((pk) => (
                                    <div
                                      key={pk.id}
                                      className="flex items-center justify-between rounded-xl border border-border bg-muted/10 p-3"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                          {pk.name || "Unnamed Device"}
                                        </p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                                          {tr(language, "Added", "เพิ่มเมื่อ")}{" "}
                                          {formatDateTime(pk.created_at, language)}
                                          {pk.last_used_at ? (
                                            <>
                                              {" • "}
                                              {tr(language, "Used", "ใช้ล่าสุด")}{" "}
                                              {formatDateTime(pk.last_used_at, language)}
                                            </>
                                          ) : null}
                                        </p>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        tone="danger"
                                        className="h-8 w-8 p-0"
                                        onClick={() => handleDeletePasskey(pk.id)}
                                        disabled={passkeyBusy}
                                      >
                                        <X className="size-4" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs italic text-muted-foreground">
                                  {tr(
                                    language,
                                    "No passkeys registered yet.",
                                    "ยังไม่มีการลงทะเบียน Passkey",
                                  )}
                                </p>
                              )}

                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={handleRegisterPasskey}
                                disabled={passkeyBusy}
                              >
                                <svg className="mr-2 size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="currentColor"/>
                                  <path d="M12 17C13.6569 17 15 15.6569 15 14C15 12.3431 13.6569 11 12 11C10.3431 11 9 12.3431 9 14C9 15.6569 10.3431 17 12 17Z" fill="currentColor"/>
                                  <path d="M12 6C10.34 6 9 7.34 9 9V10H15V9C15 7.34 13.66 6 12 6Z" fill="currentColor"/>
                                </svg>
                                {tr(language, "Register new Passkey", "ลงทะเบียน Passkey ใหม่")}
                              </Button>
                            </div>
                          </SettingsDisclosure>

                          <SettingsDisclosure
                            title={tr(language, "Backup Codes", "รหัสสำรอง")}
                            description={tr(
                              language,
                              "Generate, copy, or download one-time recovery codes.",
                              "สร้าง คัดลอก หรือดาวน์โหลดรหัสกู้คืนแบบใช้ครั้งเดียว",
                            )}
                            summary={backupCodesSummary}
                            open={securitySectionOpen === "backup-codes"}
                            onOpenChange={(open) =>
                              setSecuritySectionOpen(
                                open ? "backup-codes" : null,
                              )
                            }
                          >
                            <div className="space-y-3">
                              <p className="text-sm text-muted-foreground">
                                {tr(
                                  language,
                                  "Use one code at a time when you cannot access authenticator app",
                                  "ใช้แทนรหัส 2FA ได้ครั้งละ 1 โค้ดเมื่อเข้า Authenticator ไม่ได้",
                                )}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={handleRegenerateBackupCodes}
                                  disabled={twoFABusy || !twoFA.enabled}
                                >
                                  {tr(
                                    language,
                                    "Generate / Regenerate",
                                    "สร้าง / สร้างใหม่",
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={handleCopyBackupCodes}
                                  disabled={backupCodes.length === 0}
                                >
                                  {tr(language, "Copy", "คัดลอก")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={handleDownloadBackupCodes}
                                  disabled={backupCodes.length === 0}
                                >
                                  {tr(language, "Download", "ดาวน์โหลด")}
                                </Button>
                              </div>
                              {backupCodes.length > 0 ? (
                                <pre className="rounded-xl border border-border bg-muted p-3 text-sm leading-6">
                                  {backupCodes.join("\n")}
                                </pre>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  {tr(
                                    language,
                                    "No backup codes yet.",
                                    "ยังไม่มีรหัสสำรอง",
                                  )}
                                </p>
                              )}
                            </div>
                          </SettingsDisclosure>

                          <SettingsDisclosure
                            title={tr(
                              language,
                              "Trusted Devices",
                              "อุปกรณ์ที่เชื่อถือ",
                            )}
                            description={tr(
                              language,
                              "Review active trusted devices and revoke access when needed.",
                              "ดูอุปกรณ์ที่เชื่อถืออยู่และเพิกถอนสิทธิเมื่อจำเป็น",
                            )}
                            summary={trustedDevicesSummary}
                            open={securitySectionOpen === "trusted-devices"}
                            onOpenChange={(open) =>
                              setSecuritySectionOpen(
                                open ? "trusted-devices" : null,
                              )
                            }
                          >
                            <div className="space-y-3">
                              <div className="rounded-xl border border-border bg-muted/15 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className={
                                      currentTrustedDevice
                                        ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                        : "border-amber-200/80 bg-amber-50 text-amber-700"
                                    }
                                  >
                                    {currentTrustedDevice
                                      ? tr(
                                          language,
                                          "Current browser trusted",
                                          "เบราว์เซอร์นี้ถูกเชื่อถือ",
                                        )
                                      : tr(
                                          language,
                                          "Current browser not trusted",
                                          "เบราว์เซอร์นี้ยังไม่ถูกเชื่อถือ",
                                        )}
                                  </Badge>
                                  {currentTrustedDevice ? (
                                    <span className="text-xs text-muted-foreground">
                                      {formatTimeUntil(
                                        currentTrustedDevice.expires_at,
                                        language,
                                      )}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                  {currentTrustedDevice
                                    ? tr(
                                        language,
                                        "This browser can skip some repeated verification prompts until the trusted-device window ends.",
                                        "เบราว์เซอร์นี้จะข้ามการถามยืนยันซ้ำบางครั้งได้จนกว่าช่วงอุปกรณ์ที่เชื่อถือจะสิ้นสุด",
                                      )
                                    : tr(
                                        language,
                                        "When verification is requested again, you can choose to trust this browser for future prompts.",
                                        "เมื่อระบบขอให้ยืนยันตัวตนอีกครั้ง คุณสามารถเลือกเชื่อถือเบราว์เซอร์นี้เพื่อลดการถามซ้ำในครั้งถัดไป",
                                      )}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void loadTrustedDevices()}
                                  disabled={twoFABusy || trustedLoading}
                                >
                                  {tr(language, "Refresh", "รีเฟรช")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={handleRevokeAllTrustedDevices}
                                  disabled={
                                    twoFABusy || trustedDevices.length === 0
                                  }
                                >
                                  {tr(language, "Revoke All", "เพิกถอนทั้งหมด")}
                                </Button>
                              </div>
                              {trustedLoading ? (
                                <p className="text-sm text-muted-foreground">
                                  {tr(
                                    language,
                                    "Loading trusted devices...",
                                    "กำลังโหลดอุปกรณ์ที่เชื่อถือ...",
                                  )}
                                </p>
                              ) : trustedDevices.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  {tr(
                                    language,
                                    "No trusted devices.",
                                    "ไม่มีอุปกรณ์ที่เชื่อถือ",
                                  )}
                                </p>
                              ) : (
                                <div className="grid gap-2 lg:grid-cols-2">
                                  {trustedDevices.map((device) => (
                                    <div
                                      key={device.id}
                                      className="rounded-xl border border-border bg-muted/15 p-3 text-sm"
                                    >
                                      <p className="font-medium">
                                        {device.current_device
                                          ? tr(
                                              language,
                                              "Current device",
                                              "อุปกรณ์ปัจจุบัน",
                                            )
                                          : tr(
                                              language,
                                              "Trusted device",
                                              "อุปกรณ์ที่เชื่อถือ",
                                            )}
                                      </p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {tr(language, "IP", "ไอพี")}:{" "}
                                        {device.ip_address ||
                                          tr(language, "unknown", "ไม่ทราบ")}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {tr(language, "Created", "สร้างเมื่อ")}:{" "}
                                        {formatDateTime(
                                          device.created_at,
                                          language,
                                        )}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {tr(
                                          language,
                                          "Last used",
                                          "ใช้งานล่าสุด",
                                        )}
                                        :{" "}
                                        {formatDateTime(
                                          device.last_used_at,
                                          language,
                                        )}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {tr(language, "Expires", "หมดอายุ")}:{" "}
                                        {formatDateTime(
                                          device.expires_at,
                                          language,
                                        )}
                                      </p>
                                      <div className="mt-2 flex flex-wrap items-center gap-2">
                                        {device.current_device ? (
                                          <Badge
                                            variant="outline"
                                            className="border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                          >
                                            {tr(
                                              language,
                                              "Current browser",
                                              "เบราว์เซอร์นี้",
                                            )}
                                          </Badge>
                                        ) : null}
                                        <Badge variant="outline">
                                          {formatTimeUntil(
                                            device.expires_at,
                                            language,
                                          )}
                                        </Badge>
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        className="mt-2"
                                        onClick={() =>
                                          void handleRevokeTrustedDevice(
                                            device.id,
                                          )
                                        }
                                        disabled={twoFABusy}
                                      >
                                        {tr(language, "Revoke", "เพิกถอน")}
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </SettingsDisclosure>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {tr(
                          language,
                          "Unable to load 2FA status.",
                          "ไม่สามารถโหลดสถานะ 2FA ได้",
                        )}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {activePanel === "admin" &&
              (canManagePrivilegedAdmins ||
                (isAdmin && canManageSecurityRecovery)) ? (
                <Card
                  size="sm"
                  className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
                >
                  <Collapsible
                    open={adminToolsExpanded}
                    onOpenChange={setAdminToolsExpanded}
                  >
                    <CardHeader>
                      <CollapsibleTrigger className="group -m-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-start justify-between gap-3 rounded-2xl p-2 text-left transition-[background-color,color] hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="block">
                          <span className="block text-[0.98rem] leading-normal font-medium">
                            {tr(
                              language,
                              "Admin Tools",
                              "เครื่องมือผู้ดูแลระบบ",
                            )}
                          </span>
                          <span className="block text-[0.95rem] text-muted-foreground">
                            {tr(
                              language,
                              "Keep onboarding and emergency actions grouped under one advanced area.",
                              "รวมงานเชิญแอดมินและการกู้คืนฉุกเฉินไว้ในส่วนขั้นสูงเดียว",
                            )}
                          </span>
                        </span>
                        <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground transition-[border-color,background-color,color,box-shadow] group-hover:bg-muted/70 group-hover:text-foreground">
                          <span className="hidden sm:block">
                            {adminToolsSummary}
                          </span>
                          <span>
                            {adminToolsExpanded
                              ? tr(language, "Hide", "ซ่อน")
                              : tr(language, "Show", "แสดง")}
                          </span>
                          {adminToolsExpanded ? (
                            <ChevronUp className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )}
                        </span>
                      </CollapsibleTrigger>
                    </CardHeader>

                    <CollapsibleContent className="overflow-hidden">
                      <CardContent className="space-y-2 pt-0">
                        {canManagePrivilegedAdmins ? (
                          <SettingsDisclosure
                            title={tr(
                              language,
                              "Admin Onboarding",
                              "เริ่มต้นใช้งานแอดมิน",
                            )}
                            description={tr(
                              language,
                              "Create a one-time invite so the new admin can set a password and finish setup.",
                              "สร้างลิงก์แบบใช้ครั้งเดียวเพื่อให้แอดมินใหม่ตั้งรหัสผ่านและเริ่มต้นใช้งาน",
                            )}
                            summary={
                              createdAdminInviteUrl
                                ? tr(language, "Invite ready", "สร้างลิงก์แล้ว")
                                : tr(
                                    language,
                                    "No invite generated",
                                    "ยังไม่สร้างลิงก์",
                                  )
                            }
                            open={adminSectionOpen === "onboarding"}
                            onOpenChange={(open) =>
                              setAdminSectionOpen(open ? "onboarding" : null)
                            }
                          >
                            <div className="space-y-4">
                              <div className="grid gap-3 lg:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor="new_admin_email">
                                    {tr(language, "Admin email", "อีเมลแอดมิน")}
                                  </Label>
                                  <Input
                                    id="new_admin_email"
                                    placeholder="admin@hospital.org"
                                    value={newAdminEmail}
                                    onChange={(event) => {
                                      setNewAdminEmail(event.target.value);
                                      dismissValidationToast(
                                        SETTINGS_VALIDATION_TOAST_IDS.adminInviteEmail,
                                      );
                                      setCreatedAdminInviteEmail("");
                                      setCreatedAdminInviteUrl("");
                                      setCreatedAdminInviteExpiresAt(null);
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="admin_invite_reason">
                                    {tr(
                                      language,
                                      "Reason (required)",
                                      "เหตุผล (จำเป็น)",
                                    )}
                                  </Label>
                                  <Input
                                    id="admin_invite_reason"
                                    placeholder={tr(
                                      language,
                                      "Incident, approval, or onboarding ticket reference",
                                      "เลขอ้างอิง incident, approval หรือ onboarding ticket",
                                    )}
                                    value={adminInviteReason}
                                    onChange={(event) => {
                                      setAdminInviteReason(event.target.value);
                                      dismissValidationToast(
                                        SETTINGS_VALIDATION_TOAST_IDS.adminInviteReason,
                                      );
                                    }}
                                  />
                                </div>
                              </div>

                              <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                                {tr(
                                  language,
                                  "This issues an admin invite link. Share it securely. The invited admin will set a password and still complete 2FA.",
                                  "ระบบจะออกลิงก์คำเชิญสำหรับแอดมิน ควรส่งลิงก์อย่างปลอดภัย โดยผู้ได้รับเชิญจะตั้งรหัสผ่านและยังต้องทำ 2FA ให้ครบ",
                                )}
                              </div>

                              <Button
                                type="button"
                                onClick={handleCreateAdminOnboarding}
                                disabled={onboardingBusy}
                              >
                                {tr(
                                  language,
                                  "Generate admin invite",
                                  "สร้างลิงก์คำเชิญแอดมิน",
                                )}
                              </Button>

                              {createdAdminInviteEmail ? (
                                <div className="rounded-xl border border-border/60 p-3 text-sm space-y-1">
                                  <p>
                                    <span className="text-muted-foreground">
                                      {tr(
                                        language,
                                        "Invite target",
                                        "อีเมลปลายทาง",
                                      )}
                                      :
                                    </span>{" "}
                                    {createdAdminInviteEmail}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">
                                      {tr(language, "Role", "บทบาท")}:
                                    </span>{" "}
                                    {getRoleLabel("admin", language)}
                                  </p>
                                </div>
                              ) : null}

                              {createdAdminInviteUrl ? (
                                <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                                  <p className="text-sm text-muted-foreground">
                                    {tr(
                                      language,
                                      "One-time admin invite link:",
                                      "ลิงก์คำเชิญแอดมินแบบครั้งเดียว:",
                                    )}
                                  </p>
                                  <Input
                                    value={createdAdminInviteUrl}
                                    readOnly
                                  />
                                  <p className="text-sm text-muted-foreground">
                                    {tr(language, "Expires", "หมดอายุ")}{" "}
                                    {formatDateTime(
                                      createdAdminInviteExpiresAt,
                                      language,
                                    )}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCopyCreatedAdminInvite}
                                  >
                                    {tr(
                                      language,
                                      "Copy invite link",
                                      "คัดลอกลิงก์คำเชิญ",
                                    )}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </SettingsDisclosure>
                        ) : null}

                        {isAdmin && canManageSecurityRecovery ? (
                          <SettingsDisclosure
                            title={tr(
                              language,
                              "Emergency Actions",
                              "การกู้คืนฉุกเฉิน",
                            )}
                            description={tr(
                              language,
                              "Unlock accounts and reset security with audit-friendly controls.",
                              "ปลดล็อกบัญชีและรีเซ็ตความปลอดภัยด้วยเครื่องมือที่เหมาะกับงานฉุกเฉิน",
                            )}
                            summary={
                              resolvedUser
                                ? resolvedUser.email
                                : tr(
                                    language,
                                    "Resolve a target user",
                                    "ค้นหาผู้ใช้เป้าหมาย",
                                  )
                            }
                            open={adminSectionOpen === "emergency"}
                            onOpenChange={(open) =>
                              setAdminSectionOpen(open ? "emergency" : null)
                            }
                            tone="danger"
                          >
                            <div className="space-y-4">
                              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                <div className="space-y-2">
                                  <Label htmlFor="target_email">
                                    {tr(
                                      language,
                                      "Target user email",
                                      "อีเมลผู้ใช้เป้าหมาย",
                                    )}
                                  </Label>
                                  <Input
                                    id="target_email"
                                    placeholder={tr(
                                      language,
                                      "user@hospital.org",
                                      "user@hospital.org",
                                    )}
                                    value={targetEmail}
                                    onChange={(event) => {
                                      setTargetEmail(event.target.value);
                                      dismissValidationToast(
                                        SETTINGS_VALIDATION_TOAST_IDS.resolveUser,
                                      );
                                      setResolvedUser(null);
                                      setGeneratedResetToken("");
                                      setGeneratedResetTokenTTL(null);
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="emergency_reason">
                                    {tr(
                                      language,
                                      "Reason (required)",
                                      "เหตุผล (จำเป็น)",
                                    )}
                                  </Label>
                                  <Input
                                    id="emergency_reason"
                                    placeholder={tr(
                                      language,
                                      "Reason for emergency action",
                                      "เหตุผลสำหรับการทำรายการฉุกเฉิน",
                                    )}
                                    value={emergencyReason}
                                    onChange={(event) => {
                                      setEmergencyReason(event.target.value);
                                      dismissValidationToast(
                                        SETTINGS_VALIDATION_TOAST_IDS.emergencyReason,
                                      );
                                    }}
                                  />
                                </div>
                                <div className="flex items-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={resolveEmergencyTarget}
                                    disabled={emergencyBusy}
                                  >
                                    {tr(
                                      language,
                                      "Resolve user",
                                      "ค้นหาผู้ใช้",
                                    )}
                                  </Button>
                                </div>
                              </div>

                              {resolvedUser ? (
                                <div className="rounded-xl border border-destructive/20 bg-background p-3 text-sm space-y-1">
                                  <p>
                                    <span className="text-muted-foreground">
                                      {tr(language, "User", "ผู้ใช้")}:
                                    </span>{" "}
                                    {resolvedUser.email}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">
                                      {tr(language, "Role", "บทบาท")}:
                                    </span>{" "}
                                    {getRoleLabel(resolvedUser.role, language)}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">
                                      {tr(language, "Locked", "ล็อกอยู่")}:
                                    </span>{" "}
                                    {resolvedUser.is_locked
                                      ? tr(language, "Yes", "ใช่")
                                      : tr(language, "No", "ไม่")}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">
                                      {tr(
                                        language,
                                        "2FA Enabled",
                                        "เปิดใช้งาน 2FA",
                                      )}
                                      :
                                    </span>{" "}
                                    {resolvedUser.two_factor_enabled
                                      ? tr(language, "Yes", "ใช่")
                                      : tr(language, "No", "ไม่")}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  {tr(
                                    language,
                                    "Resolve user first to confirm target account",
                                    "ค้นหาผู้ใช้ก่อน เพื่อยืนยันบัญชีเป้าหมาย",
                                  )}
                                </p>
                              )}

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={emergencyBusy}
                                  onClick={handleEmergencyUnlock}
                                >
                                  {tr(
                                    language,
                                    "Unlock account",
                                    "ปลดล็อกบัญชี",
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={emergencyBusy || !resolvedUser}
                                  onClick={handleEmergencyReset2FA}
                                >
                                  {tr(language, "Reset 2FA", "รีเซ็ต 2FA")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  disabled={emergencyBusy || !resolvedUser}
                                  onClick={handleEmergencyResetPassword}
                                >
                                  {tr(
                                    language,
                                    "Reset password",
                                    "รีเซ็ตรหัสผ่าน",
                                  )}
                                </Button>
                              </div>

                              {generatedResetToken ? (
                                <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                                  <p className="text-sm text-muted-foreground">
                                    {tr(
                                      language,
                                      "One-time reset token (shown once):",
                                      "โทเคนรีเซ็ตรหัสผ่านแบบครั้งเดียว (แสดงครั้งเดียว):",
                                    )}
                                  </p>
                                  <Input value={generatedResetToken} readOnly />
                                  <p className="text-sm text-muted-foreground">
                                    {tr(language, "Expires in", "หมดอายุใน")}{" "}
                                    {generatedResetTokenTTL ?? "-"}{" "}
                                    {tr(language, "seconds", "วินาที")}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCopyGeneratedResetToken}
                                  >
                                    {tr(
                                      language,
                                      "Copy reset token",
                                      "คัดลอกโทเคนรีเซ็ต",
                                    )}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </SettingsDisclosure>
                        ) : null}
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      <SensitiveActionReauthDialog
        open={Boolean(sensitiveReauthRequest)}
        onOpenChange={closeSensitiveReauth}
        actionLabel={sensitiveReauthRequest?.actionLabel}
        onSuccess={async () => {
          const nextAction = pendingSensitiveReauthRef.current;
          pendingSensitiveReauthRef.current = null;
          setSensitiveReauthRequest(null);
          await nextAction?.run();
        }}
      />
    </main>
  );
}
