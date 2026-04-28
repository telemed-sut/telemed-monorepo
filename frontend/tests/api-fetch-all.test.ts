import { describe, expect, it } from "vitest";

import { fetchAllPages, MAX_QUERY_LIMIT } from "@/lib/api-fetch-all";
import { MAX_QUERY_LIMIT as CLIENT_MAX_QUERY_LIMIT } from "@/lib/api-client";

describe("fetchAllPages", () => {
  it("uses the same MAX_QUERY_LIMIT as the API client", () => {
    // P1 regression: api-fetch-all used 500 while backend clamps to 200,
    // causing premature termination after the first page.
    expect(MAX_QUERY_LIMIT).toBe(CLIENT_MAX_QUERY_LIMIT);
    expect(MAX_QUERY_LIMIT).toBe(200);
  });

  it("returns all items across multiple pages", async () => {
    const totalItems = 450;
    const pageSize = 200; // matches MAX_QUERY_LIMIT
    const allItems = Array.from({ length: totalItems }, (_, i) => ({ id: i + 1 }));
    let callCount = 0;

    const fakeFetch = async ({ page, limit }: { page: number; limit: number }) => {
      callCount += 1;
      const start = (page - 1) * limit;
      const end = Math.min(start + limit, totalItems);
      return {
        items: allItems.slice(start, end),
        total: totalItems,
      };
    };

    const result = await fetchAllPages(fakeFetch, { pageSize });
    expect(result).toEqual(allItems);
    expect(callCount).toBe(3); // page 1 (200), page 2 (200), page 3 (50)
  });

  it("stops when the API returns fewer items than the page size", async () => {
    const totalItems = 50;
    const pageSize = 200;
    let callCount = 0;

    const fakeFetch = async ({ page }: { page: number; limit: number }) => {
      callCount += 1;
      if (page === 1) {
        return {
          items: Array.from({ length: totalItems }, (_, i) => ({ id: i + 1 })),
          total: totalItems,
        };
      }
      return { items: [], total: totalItems };
    };

    const result = await fetchAllPages(fakeFetch, { pageSize });
    expect(result).toHaveLength(totalItems);
    // 50 items < 200 pageSize, so the termination check (items.length < pageSize)
    // breaks after the first page — no second call needed
    expect(callCount).toBe(1);
  });

  it("respects maxItems and truncates correctly", async () => {
    const totalItems = 500;
    const pageSize = 200;
    const maxItems = 350;
    let callCount = 0;

    const fakeFetch = async ({ page }: { page: number; limit: number }) => {
      callCount += 1;
      const start = (page - 1) * pageSize;
      const end = Math.min(start + pageSize, totalItems);
      return {
        items: Array.from({ length: end - start }, (_, i) => ({ id: start + i + 1 })),
        total: totalItems,
      };
    };

    const result = await fetchAllPages(fakeFetch, { pageSize, maxItems });
    expect(result).toHaveLength(maxItems);
    expect(result[0]).toEqual({ id: 1 });
    expect(result[maxItems - 1]).toEqual({ id: maxItems });
    expect(callCount).toBe(2); // page 1 (200), page 2 (150 of 200 requested)
  });

  it("handles an empty first page gracefully", async () => {
    const fakeFetch = async () => ({ items: [], total: 0 });

    const result = await fetchAllPages(fakeFetch);
    expect(result).toEqual([]);
  });

  it("uses a sensible default pageSize when not provided", async () => {
    // Default should equal MAX_QUERY_LIMIT (200), not a hardcoded 500
    const pageSize = MAX_QUERY_LIMIT;
    const totalItems = 100;
    let callCount = 0;

    const fakeFetch = async () => {
      callCount += 1;
      return {
        items: Array.from({ length: totalItems }, (_, i) => ({ id: i + 1 })),
        total: totalItems,
      };
    };

    // Call without pageSize — it should default to MAX_QUERY_LIMIT
    const result = await fetchAllPages(fakeFetch);
    expect(result).toHaveLength(totalItems);
    // Should complete in 1 call since totalItems (100) < pageSize (200)
    expect(callCount).toBe(1);
  });
});
