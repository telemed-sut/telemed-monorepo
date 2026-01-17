import { create } from "zustand";
import { jwtDecode } from "jwt-decode";

const STORAGE_KEY = "patient-app.token";

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

export const useAuthStore = create<AuthState>((set) => ({
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
}));

