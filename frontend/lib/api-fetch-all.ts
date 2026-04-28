import { MAX_QUERY_LIMIT, clampLimit } from "./api-client";

// Re-export so consumers can verify alignment with backend caps
export { MAX_QUERY_LIMIT };

export const BULK_FETCH_DEFAULT_PAGE_SIZE = MAX_QUERY_LIMIT;
export const BULK_FETCH_DEFAULT_MAX_ITEMS = 5000;

export function normalizeMaxItems(maxItems?: number): number {
  if (!Number.isFinite(maxItems)) return BULK_FETCH_DEFAULT_MAX_ITEMS;
  return Math.max(1, Math.floor(maxItems as number));
}

export async function fetchAllPages<T>(
  fetchFn: (params: { page: number; limit: number }) => Promise<{ items: T[]; total: number }>,
  options?: { maxItems?: number; pageSize?: number },
): Promise<T[]> {
  const pageSize = clampLimit(options?.pageSize ?? BULK_FETCH_DEFAULT_PAGE_SIZE, MAX_QUERY_LIMIT);
  const maxItems = normalizeMaxItems(options?.maxItems);
  const maxPages = Math.ceil(maxItems / pageSize);
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchFn({ page, limit: pageSize });
    if (res.items.length === 0) break;

    const remaining = maxItems - items.length;
    items.push(...res.items.slice(0, remaining));
    if (items.length >= res.total || res.items.length < pageSize || items.length >= maxItems) {
      break;
    }
  }

  return items;
}
