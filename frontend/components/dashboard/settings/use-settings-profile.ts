"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/ui/toast";
import {
  fetchAccessProfile,
  fetchCurrentUser,
  getErrorMessage,
  updateUser,
  type AccessProfile,
  type UserMe,
} from "@/lib/api";

import type { SettingsLanguage } from "./settings-types";
import { formatDateTime, tr } from "./settings-utils";

interface RouterLike {
  replace: (href: string) => void;
}

interface UseSettingsProfileOptions {
  token: string | null;
  userId: string | null;
  hydrated: boolean;
  authCurrentUser: UserMe | null;
  setAuthCurrentUser: (user: UserMe | null) => void;
  clearToken: () => void;
  getTokenTTL: () => number;
  router: RouterLike;
  language: SettingsLanguage;
  ssoProvider: string | null;
  mfaVerified: boolean;
  mfaAuthenticatedAt: string | null;
}

export function useSettingsProfile({
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
}: UseSettingsProfileOptions) {
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);
  const [accessProfile, setAccessProfile] = useState<AccessProfile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [tokenTTL, setTokenTTL] = useState(() => getTokenTTL());

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
  }, [
    clearToken,
    hydrated,
    loadAccessProfile,
    router,
    setAuthCurrentUser,
    token,
    userId,
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTokenTTL(getTokenTTL());
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [getTokenTTL]);

  const ttlLabel = useMemo(() => {
    if (!tokenTTL) return tr(language, "Expired", "หมดอายุแล้ว");
    const minutes = Math.floor(tokenTTL / 60);
    const seconds = tokenTTL % 60;
    return `${minutes}m ${seconds}s`;
  }, [language, tokenTTL]);

  const hasProfileChanges = useMemo(() => {
    if (!currentUser) return false;

    return (
      firstName !== (currentUser.first_name || "") ||
      lastName !== (currentUser.last_name || "")
    );
  }, [currentUser, firstName, lastName]);

  const hasPrivilegedAccess = accessProfile?.has_privileged_access ?? false;
  const privilegedAccessCodename = accessProfile?.access_class ?? null;
  const privilegedAccessProtected =
    hasPrivilegedAccess && !accessProfile?.access_class_revealed;
  const canManagePrivilegedAdmins =
    accessProfile?.can_manage_privileged_admins ?? false;

  const loginMethodSummary = ssoProvider
    ? tr(language, "Organization SSO", "Organization SSO")
    : tr(language, "Local password", "รหัสผ่านภายใน");

  const sessionVerificationSummary = mfaVerified
    ? tr(language, "Verified", "ยืนยันแล้ว")
    : tr(language, "Not verified", "ยังไม่ได้ยืนยัน");

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

  return {
    profileLoading,
    profileSaving,
    currentUser,
    accessProfile,
    firstName,
    lastName,
    setFirstName,
    setLastName,
    ttlLabel,
    loginMethodSummary,
    sessionVerificationSummary,
    mfaAuthenticatedAtLabel: formatDateTime(mfaAuthenticatedAt, language),
    ssoProvider,
    hasProfileChanges,
    hasPrivilegedAccess,
    privilegedAccessCodename,
    privilegedAccessProtected,
    canManagePrivilegedAdmins,
    handleResetProfile,
    handleSaveProfile,
  };
}
