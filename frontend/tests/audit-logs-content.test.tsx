import { cleanup, render, waitFor } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchAuditLogs,
  mockExportAuditLogs,
  mockToastError,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchAuditLogs: vi.fn(),
  mockExportAuditLogs: vi.fn(),
  mockToastError: vi.fn(),
  mockAuthState: {
    token: "test-token",
    hydrated: true,
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en" as "en" | "th",
  },
}));

function stripMotionProps<T extends Record<string, unknown>>(props: T) {
  const domProps = { ...props };
  delete domProps.animate;
  delete domProps.exit;
  delete domProps.initial;
  delete domProps.layout;
  delete domProps.layoutId;
  delete domProps.transition;
  delete domProps.variants;
  delete domProps.whileHover;
  delete domProps.whileTap;
  return domProps;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  LazyMotion: ({ children }: { children: ReactNode }) => <>{children}</>,
  domAnimation: {},
  m: {
    tr: ({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
      <tr {...stripMotionProps(props as Record<string, unknown>)}>{children}</tr>
    ),
  },
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) =>
    selector(mockLanguageState),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchAuditLogs: mockFetchAuditLogs,
    exportAuditLogs: mockExportAuditLogs,
    getRoleLabel: vi.fn((role: string) => role),
  };
});

describe("AuditLogsContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguageState.language = "en";
    mockFetchAuditLogs.mockRejectedValue(
      Object.assign(new Error("ไม่สามารถโหลด Audit Logs ได้"), { status: 500 })
    );
    mockExportAuditLogs.mockResolvedValue(new Blob(["ok"], { type: "text/csv" }));
  });

  afterEach(() => {
    cleanup();
  });

  it("shows localized English audit error copy instead of raw Thai API text", async () => {
    const { AuditLogsContent } = await import("@/components/dashboard/audit-logs-content");
    render(<AuditLogsContent />);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Failed to load audit logs", {
        description: "Unable to load audit logs",
      });
    });
  });
});
