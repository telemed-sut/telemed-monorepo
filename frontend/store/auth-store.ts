import { create } from "zustand";
import { jwtDecode } from "jwt-decode";

const STORAGE_KEY = "patient-app.token";

/** Refresh token 5 minutes before expiry */
const REFRESH_BUFFER_SECONDS = 300;

interface AuthPayload {
  sub?: string;  // user ID
  role?: string;
  exp?: number;
  [key: string]: any;
}

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  hydrated: boolean;
  setToken: (token: string) => void;
  clearToken: () => void;
  hydrate: () => void;
  /** Returns seconds until token expires, or 0 if expired/missing */
  getTokenTTL: () => number;
  /** Returns true if the token will expire within REFRESH_BUFFER_SECONDS */
  isTokenExpiringSoon: () => boolean;
}

const readStoredToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
};

const getPayloadFromToken = (token: string | null): { role: string | null; userId: string | null } => {
  if (!token) return { role: null, userId: null };
  try {
    const decoded = jwtDecode<AuthPayload>(token);
    return {
      role: decoded.role || null,
      userId: decoded.sub || null,
    };
  } catch (error) {
    return { role: null, userId: null };
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  role: null,
  userId: null,
  hydrated: false,
  setToken: (token) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, token);
    }
    const { role, userId } = getPayloadFromToken(token);
    set({ token, role, userId, hydrated: true });
  },
  clearToken: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ token: null, role: null, userId: null, hydrated: true });
  },
  hydrate: () => {
    const stored = readStoredToken();
    const { role, userId } = getPayloadFromToken(stored);
    set({ token: stored, role, userId, hydrated: true });
  },
  getTokenTTL: () => {
    const { token } = get();
    if (!token) return 0;
    try {
      const decoded = jwtDecode<AuthPayload>(token);
      if (!decoded.exp) return 0;
      const now = Math.floor(Date.now() / 1000);
      return Math.max(decoded.exp - now, 0);
    } catch {
      return 0;
    }
  },
  isTokenExpiringSoon: () => {
    return get().getTokenTTL() < REFRESH_BUFFER_SECONDS;
  },
}));

