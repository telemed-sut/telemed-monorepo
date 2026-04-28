"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api";
import {
  deletePasskey,
  isPasskeyCeremonyCancelled,
  listPasskeys,
  registerNewPasskey,
  type PasskeyOut,
} from "@/lib/api-passkeys";

import type { SensitiveReauthRequest, SettingsLanguage } from "./settings-types";
import { tr } from "./settings-utils";

interface UseSettingsSecurityOptions {
  token: string | null;
  hydrated: boolean;
  language: SettingsLanguage;
  isAdmin: boolean;
  mfaAuthenticatedAt: string | null;
  sensitiveReauthOpen: boolean;
  dismissValidationToast: (id: string) => void;
  showValidationToastOnce: (id: string, title: string) => void;
  handleSensitiveActionError: (
    error: unknown,
    request: SensitiveReauthRequest,
  ) => boolean;
}

export function useSettingsSecurity({
  token,
  hydrated,
  language,
}: UseSettingsSecurityOptions) {
  const [passkeys, setPasskeys] = useState<PasskeyOut[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [securitySectionOpen, setSecuritySectionOpen] = useState<
    "passkeys" | null
  >("passkeys");

  const showGenericError = useCallback(
    (error: unknown) => {
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
    },
    [language],
  );

  const loadPasskeys = useCallback(async () => {
    if (!token) return;
    setPasskeyLoading(true);
    try {
      const response = await listPasskeys();
      setPasskeys(response.items);
    } catch (error: unknown) {
      showGenericError(error);
    } finally {
      setPasskeyLoading(false);
    }
  }, [showGenericError, token]);

  useEffect(() => {
    if (!hydrated || !token) return;
    void loadPasskeys();
  }, [hydrated, loadPasskeys, token]);

  const securityHeaderSummary = useMemo(() => {
    if (passkeyLoading) {
      return tr(language, "Loading passkeys", "กำลังโหลด Passkeys");
    }
    return tr(
      language,
      `${passkeys.length} passkeys registered`,
      `ลงทะเบียน Passkey แล้ว ${passkeys.length} รายการ`,
    );
  }, [language, passkeyLoading, passkeys.length]);

  const handleRegisterPasskey = useCallback(async () => {
    if (!token || passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      const name = `${tr(language, "My Device", "อุปกรณ์ของฉัน")} (${new Date().toLocaleDateString()})`;
      await registerNewPasskey(name);
      toast.success(
        tr(language, "Passkey registered successfully", "ลงทะเบียน Passkey สำเร็จแล้ว"),
      );
      await loadPasskeys();
    } catch (error: unknown) {
      if (isPasskeyCeremonyCancelled(error)) {
        return;
      }
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
  }, [language, loadPasskeys, passkeyBusy, token]);

  const handleDeletePasskey = useCallback(
    async (passkeyId: string) => {
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
    },
    [language, loadPasskeys, passkeyBusy, token],
  );

  return {
    passkeys,
    passkeyLoading,
    passkeyBusy,
    securitySectionOpen,
    setSecuritySectionOpen,
    securityHeaderSummary,
    handleRegisterPasskey,
    handleDeletePasskey,
    refreshPasskeys: loadPasskeys,
  };
}
