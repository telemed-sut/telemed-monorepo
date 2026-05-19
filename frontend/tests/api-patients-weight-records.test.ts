import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetchMock, invalidateCacheMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiFetch: apiFetchMock,
  appendPagination: vi.fn(),
  invalidateCache: invalidateCacheMock,
  MAX_QUERY_LIMIT: 200,
}));

describe("patient weight record API helpers", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    invalidateCacheMock.mockReset();
  });

  it("always fetches weight records fresh", async () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    const { fetchPatientWeightRecords } = await import("@/lib/api-patients");

    await fetchPatientWeightRecords("patient-1", "token-1");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/patients/patient-1/weight-records",
      { method: "GET", skipCache: true },
      "token-1"
    );
  });

  it("always fetches vitals trends fresh for manual sync", async () => {
    apiFetchMock.mockResolvedValue({ patient_id: "patient-1", days: 30, trends: [] });
    const { fetchPatientVitalsTrends } = await import("@/lib/api-patients");

    await fetchPatientVitalsTrends("patient-1", 30, "token-1");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/patients/patient-1/trends/vitals?days=30",
      { method: "GET", skipCache: true },
      "token-1"
    );
  });

  it("invalidates weight and trend caches after deleting a weight record", async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const { deletePatientWeightRecord } = await import("@/lib/api-patients");

    await deletePatientWeightRecord("patient-1", "record-1", "token-1");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/patients/patient-1/weight-records/record-1",
      { method: "DELETE" },
      "token-1"
    );
    expect(invalidateCacheMock).toHaveBeenCalledWith("/patients/patient-1/weight-records");
    expect(invalidateCacheMock).toHaveBeenCalledWith("/patients/patient-1/trends/vitals");
  });
});
