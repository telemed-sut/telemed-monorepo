const PROTECTED_CLIENT_STATE_REGISTRY_KEY = "telemed.protected-client-state._keys";
const PROTECTED_CLIENT_STATE_FALLBACK_PREFIXES = [
  "month-calendar-popover-composer:",
  "month-calendar-popover-invitees:",
  "meetings-create-event-draft:",
];

type ProtectedStorageArea = "session" | "local";

let protectedClientStateRegistry: Set<string> | null = null;

function encodeRegistryEntry(key: string, storageArea: ProtectedStorageArea): string {
  return `${storageArea}:${key}`;
}

function decodeRegistryEntry(entry: string): { key: string; storageArea: ProtectedStorageArea } | null {
  const separatorIndex = entry.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const storageArea = entry.slice(0, separatorIndex);
  const key = entry.slice(separatorIndex + 1);
  if (!key || (storageArea !== "session" && storageArea !== "local")) {
    return null;
  }

  return {
    key,
    storageArea,
  };
}

function readProtectedClientStateRegistry(): Set<string> {
  if (protectedClientStateRegistry) {
    return new Set(protectedClientStateRegistry);
  }

  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const raw = window.sessionStorage.getItem(PROTECTED_CLIENT_STATE_REGISTRY_KEY);
    if (!raw) {
      protectedClientStateRegistry = new Set<string>();
      return new Set<string>();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      protectedClientStateRegistry = new Set<string>();
      window.sessionStorage.removeItem(PROTECTED_CLIENT_STATE_REGISTRY_KEY);
      return new Set<string>();
    }

    protectedClientStateRegistry = new Set(
      parsed.filter((value): value is string => typeof value === "string" && decodeRegistryEntry(value) !== null)
    );
    return new Set(protectedClientStateRegistry);
  } catch {
    protectedClientStateRegistry = new Set<string>();
    window.sessionStorage.removeItem(PROTECTED_CLIENT_STATE_REGISTRY_KEY);
    return new Set<string>();
  }
}

function writeProtectedClientStateRegistry(nextRegistry: Set<string>): void {
  protectedClientStateRegistry = new Set(nextRegistry);
  if (typeof window === "undefined") {
    return;
  }

  if (nextRegistry.size === 0) {
    window.sessionStorage.removeItem(PROTECTED_CLIENT_STATE_REGISTRY_KEY);
    return;
  }

  window.sessionStorage.setItem(
    PROTECTED_CLIENT_STATE_REGISTRY_KEY,
    JSON.stringify(Array.from(nextRegistry).sort())
  );
}

function registerProtectedClientStateKey(
  key: string,
  storageArea: ProtectedStorageArea = "session"
): void {
  const registry = readProtectedClientStateRegistry();
  registry.add(encodeRegistryEntry(key, storageArea));
  writeProtectedClientStateRegistry(registry);
}

function unregisterProtectedClientStateKey(
  key: string,
  storageArea: ProtectedStorageArea = "session"
): void {
  const registry = readProtectedClientStateRegistry();
  registry.delete(encodeRegistryEntry(key, storageArea));
  writeProtectedClientStateRegistry(registry);
}

function removeWithPrefixes(storage: Storage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }
    if (PROTECTED_CLIENT_STATE_FALLBACK_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      storage.removeItem(key);
    }
  }
}

export function readProtectedSessionItem(
  key: string,
  options?: { migrateLegacyLocalStorage?: boolean }
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const existingValue = window.sessionStorage.getItem(key);
    if (existingValue !== null) {
      registerProtectedClientStateKey(key, "session");
      return existingValue;
    }

    if (!options?.migrateLegacyLocalStorage) {
      return null;
    }

    const legacyValue = window.localStorage.getItem(key);
    if (legacyValue === null) {
      return null;
    }

    window.sessionStorage.setItem(key, legacyValue);
    registerProtectedClientStateKey(key, "session");
    window.localStorage.removeItem(key);
    unregisterProtectedClientStateKey(key, "local");
    return legacyValue;
  } catch {
    return null;
  }
}

export function writeProtectedSessionItem(key: string, value: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
      unregisterProtectedClientStateKey(key, "session");
      return;
    }

    window.sessionStorage.setItem(key, value);
    registerProtectedClientStateKey(key, "session");
  } catch {
    // no-op
  }
}

export function removeProtectedSessionItem(key: string): void {
  writeProtectedSessionItem(key, null);
}

export function clearProtectedClientStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  const registry = readProtectedClientStateRegistry();
  for (const entry of registry) {
    const decoded = decodeRegistryEntry(entry);
    if (!decoded) {
      continue;
    }

    const storage = decoded.storageArea === "local" ? window.localStorage : window.sessionStorage;
    storage.removeItem(decoded.key);
  }

  writeProtectedClientStateRegistry(new Set());
  window.sessionStorage.removeItem(PROTECTED_CLIENT_STATE_REGISTRY_KEY);
  removeWithPrefixes(window.sessionStorage);
  removeWithPrefixes(window.localStorage);
}
