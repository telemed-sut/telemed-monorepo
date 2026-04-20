"use client";

import { useCallback, useRef, useState } from "react";

import { isRecentSensitiveSessionError } from "@/lib/sensitive-session";

import type { SensitiveReauthRequest } from "./settings-types";

export function useSettingsSensitiveReauth() {
  const pendingSensitiveReauthRef = useRef<SensitiveReauthRequest | null>(null);
  const [sensitiveReauthRequest, setSensitiveReauthRequest] =
    useState<SensitiveReauthRequest | null>(null);

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

  const handleSensitiveReauthSuccess = useCallback(async () => {
    const nextAction = pendingSensitiveReauthRef.current;
    pendingSensitiveReauthRef.current = null;
    setSensitiveReauthRequest(null);
    await nextAction?.run();
  }, []);

  return {
    sensitiveReauthRequest,
    closeSensitiveReauth,
    handleSensitiveActionError,
    handleSensitiveReauthSuccess,
  };
}
