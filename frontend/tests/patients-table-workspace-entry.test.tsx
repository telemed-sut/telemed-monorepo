import type { HTMLAttributes, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPush,
  mockPrefetch,
  mockReplace,
  mockFetchPatients,
  mockAuthState,
  mockLanguageState,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPrefetch: vi.fn(),
  mockReplace: vi.fn(),
  mockFetchPatients: vi.fn(),
  mockAuthState: {
    token: "test-token",
    role: "doctor",
    clearToken: vi.fn(),
  },
  mockLanguageState: {
    language: "en",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: mockPrefetch,
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => "/patients",
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (selector: (state: typeof mockLanguageState) => unknown) => selector(mockLanguageState),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  LazyMotion: ({ children }: { children: ReactNode }) => <>{children}</>,
  domAnimation: {},
  m: {
    tr: (props: HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />,
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchPatients: mockFetchPatients,
    createPatient: vi.fn(),
    updatePatient: vi.fn(),
    deletePatient: vi.fn(),
    generatePatientRegistrationCode: vi.fn(),
  };
});

describe("patients table workspace entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPatients.mockResolvedValue({
      items: [
        {
          id: "patient-1",
          first_name: "John",
          last_name: "Doe",
          date_of_birth: "1990-01-01",
          gender: "male",
          phone: "0812345678",
          email: "john@example.com",
          address: "Bangkok",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the patient workspace from the patient name button", async () => {
    const { PatientsTable } = await import("@/components/dashboard/patients-table");
    render(<PatientsTable />);

    await waitFor(() => expect(mockFetchPatients).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", { name: "Open John Doe workspace" })
    );

    expect(mockPush).toHaveBeenCalledWith("/patients/patient-1");
  });
});
