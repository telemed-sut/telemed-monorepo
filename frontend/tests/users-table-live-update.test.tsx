import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReplace,
  mockFetchUsers,
  mockFetchUserInvites,
  mockDeleteUser,
  mockPurgeDeletedUser,
  mockVerifyUser,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockFetchUsers: vi.fn(),
  mockFetchUserInvites: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockPurgeDeletedUser: vi.fn(),
  mockVerifyUser: vi.fn(),
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
    destructiveAction: vi.fn((_title: string, options?: { button?: { onClick?: () => void } }) => {
      options?.button?.onClick?.();
    }),
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
    deleteUser: mockDeleteUser,
    purgeDeletedUser: mockPurgeDeletedUser,
    restoreUser: vi.fn(),
    bulkDeleteUsers: vi.fn(),
    bulkRestoreUsers: vi.fn(),
    purgeDeletedUsers: vi.fn(),
    createUserInvite: vi.fn(),
    resendUserInvite: vi.fn(),
    revokeUserInvite: vi.fn(),
    verifyUser: mockVerifyUser,
    createUser: vi.fn(),
    updateUser: vi.fn(),
  };
});

const baseUser = {
  id: "user-1",
  email: "doctor@example.com",
  first_name: "Somchai",
  last_name: "Jaidee",
  role: "doctor",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  deleted_by: null,
  privileged_roles: [],
};

describe("UsersTable immediate live updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguageState.language = "en";
    mockAuthState.role = "admin";
    mockDeleteUser.mockResolvedValue(undefined);
    mockPurgeDeletedUser.mockResolvedValue({
      message: "Deleted medical student permanently.",
      purged_user_id: "user-1",
    });
    mockVerifyUser.mockResolvedValue(undefined);
    mockFetchUsers.mockResolvedValue({
      items: [],
      total: 0,
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

  it("updates verification badge immediately after verify", async () => {
    const user = userEvent.setup();
    const { UsersTable } = await import("@/components/dashboard/users-table");

    render(
      <UsersTable
        initialUsers={[{ ...baseUser, verification_status: "unverified" }]}
        initialTotal={1}
        initialSeedKey={1}
        initialSeedReady
      />
    );

    await waitFor(() =>
      expect(screen.getByText("doctor@example.com")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    await user.click(await screen.findByText("Verify"));

    await waitFor(() =>
      expect(mockVerifyUser).toHaveBeenCalledWith("user-1", "test-token")
    );
    expect(screen.getByText("verified")).toBeInTheDocument();
  });

  it("removes the row immediately after delete", async () => {
    const user = userEvent.setup();
    const { UsersTable } = await import("@/components/dashboard/users-table");

    render(
      <UsersTable
        initialUsers={[{ ...baseUser, verification_status: "verified" }]}
        initialTotal={1}
        initialSeedKey={1}
        initialSeedReady
      />
    );

    await waitFor(() =>
      expect(screen.getByText("doctor@example.com")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    await user.click(await screen.findByText("Delete"));

    await waitFor(() =>
      expect(mockDeleteUser).toHaveBeenCalledWith("user-1", "test-token")
    );
    await waitFor(() =>
      expect(screen.queryByText("doctor@example.com")).not.toBeInTheDocument()
    );
  });

  it("shows permanent delete for deleted medical students and removes the row immediately", async () => {
    const user = userEvent.setup();
    const { UsersTable } = await import("@/components/dashboard/users-table");

    render(
      <UsersTable
        initialUsers={[
          {
            ...baseUser,
            role: "medical_student",
            email: "student@example.com",
            deleted_at: "2026-01-02T00:00:00.000Z",
          },
        ]}
        initialTotal={1}
        initialSeedKey={1}
        initialSeedReady
      />
    );

    await waitFor(() =>
      expect(screen.getByText("student@example.com")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    await user.click(await screen.findByText("Delete Permanently"));

    await waitFor(() =>
      expect(mockPurgeDeletedUser).toHaveBeenCalledWith("user-1", "test-token")
    );
    await waitFor(() =>
      expect(screen.queryByText("student@example.com")).not.toBeInTheDocument()
    );
  });
});
