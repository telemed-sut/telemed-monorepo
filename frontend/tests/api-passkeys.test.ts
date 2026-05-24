import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();
const startAuthenticationMock = vi.fn();
const startRegistrationMock = vi.fn();
const browserSupportsWebAuthnAutofillMock = vi.fn();
const cancelCeremonyMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthnAutofill: browserSupportsWebAuthnAutofillMock,
  startAuthentication: startAuthenticationMock,
  startRegistration: startRegistrationMock,
  WebAuthnAbortService: {
    cancelCeremony: cancelCeremonyMock,
  },
}));

describe("api-passkeys", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    startAuthenticationMock.mockReset();
    startRegistrationMock.mockReset();
    browserSupportsWebAuthnAutofillMock.mockReset();
    cancelCeremonyMock.mockReset();
  });

  it("requests fresh registration options without using the GET cache", async () => {
    apiFetchMock.mockResolvedValue({ temp_sid: "reg-1" });
    const { getPasskeyRegistrationOptions } = await import("@/lib/api-passkeys");

    await getPasskeyRegistrationOptions();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/passkeys/register-options",
      { skipCache: true },
      undefined,
    );
  });

  it("passes the active session marker for authenticated passkey management calls", async () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    const { listPasskeys, deletePasskey, dismissPasskeyOnboarding } =
      await import("@/lib/api-passkeys");

    await listPasskeys("__cookie_session__");
    await deletePasskey("passkey-1", "__cookie_session__");
    await dismissPasskeyOnboarding("__cookie_session__");

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      "/passkeys",
      {},
      "__cookie_session__",
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      "/passkeys/passkey-1",
      expect.objectContaining({ method: "DELETE" }),
      "__cookie_session__",
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      3,
      "/passkeys/onboarding/dismiss",
      expect.objectContaining({ method: "POST" }),
      "__cookie_session__",
    );
  });

  it("requests fresh login options without using the GET cache", async () => {
    apiFetchMock.mockResolvedValue({ temp_sid: "login-1" });
    const { getPasskeyLoginOptions } = await import("@/lib/api-passkeys");

    await getPasskeyLoginOptions();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/passkeys/login-options",
      { skipCache: true },
    );
  });

  it("requests fresh login options for a specific email without using the GET cache", async () => {
    apiFetchMock.mockResolvedValue({ temp_sid: "login-2" });
    const { getPasskeyLoginOptions } = await import("@/lib/api-passkeys");

    await getPasskeyLoginOptions("doctor@example.com");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/passkeys/login-options?email=doctor%40example.com",
      { skipCache: true },
    );
  });

  it("starts conditional passkey login with browser autofill enabled", async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        temp_sid: "login-3",
        challenge: "challenge",
      })
      .mockResolvedValueOnce({
        access_token: "token",
        user: { id: "user-1", email: "doctor@example.com" },
      });
    startAuthenticationMock.mockResolvedValue({
      id: "credential-id",
      rawId: "credential-id",
      response: {
        authenticatorData: "auth-data",
        clientDataJSON: "client-data",
        signature: "signature",
      },
      type: "public-key",
      clientExtensionResults: {},
    });

    const { startConditionalPasskeyLogin } = await import("@/lib/api-passkeys");

    await startConditionalPasskeyLogin();

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      "/passkeys/login-options",
      { skipCache: true },
    );
    expect(startAuthenticationMock).toHaveBeenCalledWith({
      optionsJSON: { challenge: "challenge" },
      useBrowserAutofill: true,
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      "/passkeys/login-verify?temp_sid=login-3",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("carries the active session marker through passkey registration", async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        temp_sid: "reg-2",
        challenge: "challenge",
      })
      .mockResolvedValueOnce({ ok: true });
    startRegistrationMock.mockResolvedValue({
      id: "credential-id",
      rawId: "credential-id",
      response: {
        attestationObject: "attestation-object",
        clientDataJSON: "client-data",
        transports: ["internal"],
      },
      type: "public-key",
      clientExtensionResults: {},
    });

    const { registerNewPasskey } = await import("@/lib/api-passkeys");

    await registerNewPasskey("MacBook", "__cookie_session__");

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      "/passkeys/register-options",
      { skipCache: true },
      "__cookie_session__",
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      "/passkeys/register-verify?temp_sid=reg-2",
      expect.objectContaining({ method: "POST" }),
      "__cookie_session__",
    );
  });
});
