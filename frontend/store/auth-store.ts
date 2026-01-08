import { create } from "zustand";
import { jwtDecode } from "jwt-decode";

const STORAGE_KEY = "patient-app.token";

interface AuthPayload {
  role?: string;
  exp?: number;
  [key: string]: any;
}

interface AuthState {
  token: string | null;
  role: string | null;
  hydrated: boolean;
  setToken: (token: string) => void;
  clearToken: () => void;
  hydrate: () => void;
}

const readStoredToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
};

const getRoleFromToken = (token: string | null): string | null => {
  if (!token) return null;
  try {
    const decoded = jwtDecode<AuthPayload>(token);
    return decoded.role || null;
  } catch (error) {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  hydrated: false,
  setToken: (token) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, token);
    }
    const role = getRoleFromToken(token);
    set({ token, role, hydrated: true });
  },
  clearToken: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ token: null, role: null, hydrated: true });
  },
  hydrate: () => {
    const stored = readStoredToken();
    const role = getRoleFromToken(stored);
    set({ token: stored, role, hydrated: true });
  },
}));
