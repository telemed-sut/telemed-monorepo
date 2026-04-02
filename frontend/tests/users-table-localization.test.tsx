import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchUsers,
  mockFetchUserInvites,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchUsers: vi.fn(),
  mockFetchUserInvites: vi.fn(),
  mockAuthState: {
    token: "test-token",
    role: "admin",
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en" as "en" | "th",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector?: (state: typeof mockAuthState) => unknown) =>
    typeof selector === "function" ? selector(mockAuthState) : mockAuthState,
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) =>
    selector(mockLanguageState),
}));

vi.mock("@/hooks/use-local-storage", () => ({
  useLocalStorage: (_key: string, initialValue: unknown) => [
    initialValue,
    vi.fn(),
  ],
}));

vi.mock("@/components/dashboard/data-table-view-options", () => ({
  DataTableViewOptions: () => <div data-testid="data-table-view-options" />,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    action: vi.fn(),
    destructiveAction: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchUsers: mockFetchUsers,
    fetchUserInvites: mockFetchUserInvites,
    deleteUser: vi.fn(),
    restoreUser: vi.fn(),
    bulkDeleteUsers: vi.fn(),
    bulkRestoreUsers: vi.fn(),
    purgeDeletedUsers: vi.fn(),
    createUserInvite: vi.fn(),
    resendUserInvite: vi.fn(),
    revokeUserInvite: vi.fn(),
    verifyUser: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
  };
});

describe("UsersTable localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguageState.language = "en";
    mockAuthState.role = "admin";
    mockFetchUsers.mockResolvedValue({
      items: [
        {
          id: "user-1",
          email: "doctor@example.com",
          first_name: "Somchai",
          last_name: "Jaidee",
          role: "doctor",
          is_active: true,
          verification_status: "verified",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: null,
          deleted_by: null,
          privileged_roles: [],
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });
    mockFetchUserInvites.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders visible users management copy in Thai", async () => {
    mockLanguageState.language = "th";

    const { UsersTable } = await import("@/components/dashboard/users-table");
    render(<UsersTable />);

    await waitFor(() => expect(mockFetchUsers).toHaveBeenCalled());

    expect(screen.getByText("การจัดการผู้ใช้")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ค้นหาผู้ใช้...")).toBeInTheDocument();
    expect(screen.getByText("ตัวกรอง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เชิญ/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ล้างถาวร/i })).toBeInTheDocument();
    expect(screen.getByText("ใช้งาน")).toBeInTheDocument();
    expect(screen.getByText("ลบแล้ว")).toBeInTheDocument();
    expect(screen.getByText("ทั้งหมด")).toBeInTheDocument();
  });
});
