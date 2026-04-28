import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("renders audit log status labels from the status contract field", async () => {
    mockFetchAuditLogs.mockResolvedValue({
      items: [
        {
          id: "log-1",
          user_id: "user-1",
          user_email: "doctor@example.com",
          user_name: "Doctor Example",
          action: "user_update",
          status: "success",
          resource_type: "user",
          resource_id: "user-1",
          details: null,
          ip_address: "127.0.0.1",
          is_break_glass: false,
          break_glass_reason: null,
          old_values: null,
          new_values: null,
          created_at: new Date().toISOString(),
        },
      ],
      limit: 50,
      next_cursor: null,
    });

    const { AuditLogsContent } = await import("@/components/dashboard/audit-logs-content");
    render(<AuditLogsContent />);

    expect(await screen.findByText("doctor@example.com")).toBeInTheDocument();
    expect(await screen.findByText("Success")).toBeInTheDocument();
  });
});
