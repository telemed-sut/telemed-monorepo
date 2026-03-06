const INVISIBLE_SEARCH_CHAR_PATTERN = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_SEARCH_CHAR_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function includesSearchQuery(value: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return normalizeSearchText(value).includes(normalizedQuery);
}
