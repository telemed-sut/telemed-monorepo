import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { apiFetch } from "./api-client";
import type { LoginResponse } from "./api-types";

export interface PasskeyOut {
  id: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface PasskeyListResponse {
  items: PasskeyOut[];
  total: number;
}

export function isPasskeyCeremonyCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as { name?: unknown; message?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";

  return (
    name === "NotAllowedError" ||
    name === "AbortError" ||
    message.includes("timed out or was not allowed")
  );
}

export async function getPasskeyRegistrationOptions(token?: string) {
  return apiFetch<PublicKeyCredentialCreationOptionsJSON & { temp_sid: string }>(
    "/passkeys/register-options",
    { skipCache: true },
    token,
  );
}

export async function verifyPasskeyRegistration(
  tempSid: string,
  name: string,
  registrationResponse: RegistrationResponseJSON,
  token?: string,
) {
  const query = `?temp_sid=${encodeURIComponent(tempSid)}`;
  return apiFetch(
    `/passkeys/register-verify${query}`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        registration_response: registrationResponse,
      }),
    },
    token,
  );
}

export async function getPasskeyLoginOptions(email?: string) {
  const query = email ? `?email=${encodeURIComponent(email)}` : "";
  return apiFetch<PublicKeyCredentialRequestOptionsJSON & { temp_sid: string }>(
    `/passkeys/login-options${query}`,
    { skipCache: true },
  );
}

export async function verifyPasskeyLogin(
  tempSid: string,
  authenticationResponse: AuthenticationResponseJSON,
): Promise<LoginResponse> {
  const query = `?temp_sid=${encodeURIComponent(tempSid)}`;
  return apiFetch<LoginResponse>(`/passkeys/login-verify${query}`, {
    method: "POST",
    body: JSON.stringify({
      authentication_response: authenticationResponse,
    }),
  });
}

export async function listPasskeys(token?: string) {
  return apiFetch<PasskeyListResponse>("/passkeys", {}, token);
}

export async function deletePasskey(passkeyId: string, token?: string) {
  return apiFetch(
    `/passkeys/${passkeyId}`,
    {
      method: "DELETE",
    },
    token,
  );
}

export async function dismissPasskeyOnboarding(token?: string) {
  return apiFetch(
    "/passkeys/onboarding/dismiss",
    {
      method: "POST",
    },
    token,
  );
}

/**
 * Higher-level helper to register a new Passkey
 */
export async function registerNewPasskey(
  name: string = "My Device",
  token?: string,
) {
  const optionsResp = await getPasskeyRegistrationOptions(token);
  const { temp_sid, ...options } = optionsResp;
  const regResp = await startRegistration({ optionsJSON: options });
  return await verifyPasskeyRegistration(temp_sid, name, regResp, token);
}

/**
 * Higher-level helper to login with a Passkey
 */
export async function loginWithPasskey(email?: string): Promise<LoginResponse> {
  const optionsResp = await getPasskeyLoginOptions(email);
  const { temp_sid, ...options } = optionsResp;
  const authResp = await startAuthentication({ optionsJSON: options });
  return await verifyPasskeyLogin(temp_sid, authResp);
}

export async function browserSupportsConditionalPasskeyLogin(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill();
}

export async function startConditionalPasskeyLogin(): Promise<LoginResponse> {
  const optionsResp = await getPasskeyLoginOptions();
  const { temp_sid, ...options } = optionsResp;
  const authResp = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill: true,
  });
  return await verifyPasskeyLogin(temp_sid, authResp);
}

export function cancelPasskeyCeremony() {
  WebAuthnAbortService.cancelCeremony();
}
