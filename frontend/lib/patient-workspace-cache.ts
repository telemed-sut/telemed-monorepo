/**
 * Patient Workspace Cache
 *
 * A lightweight, LRU-style cache for patient workspace state that persists
 * only for the duration of the browser tab session.
 *
 * - Uses sessionStorage (tab-scoped, cleared on tab close)
 * - Cleared on logout via clearPatientWorkspaceCache()
 * - Per-patient and per-workspace
 * - Designed for fast workspace switching without PII persistence across sessions
 */

import type { HeartSoundRecord, Meeting, Patient } from "@/lib/api";

const CACHE_SCHEMA_VERSION = 2;
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const MEETINGS_CACHE_TTL_MS = 60 * 1000;
const HEART_SOUND_CACHE_TTL_MS = 60 * 1000;
const PATIENT_WORKSPACE_CACHE_KEY_PREFIX = "telemed.patient-workspace.";
const PATIENT_WORKSPACE_CACHE_REGISTRY_KEY = `${PATIENT_WORKSPACE_CACHE_KEY_PREFIX}_keys`;
let patientWorkspaceCacheRegistry: Set<string> | null = null;

type CacheEnvelope<T> = {
  version: number;
  data: T;
};

type PatientDetailCacheEntry = {
  patient: Patient | null;
  patientCachedAt: number | null;
  meetings: Meeting[];
  meetingsTotal: number;
  meetingsCachedAt: number | null;
};

type PatientHeartSoundCacheEntry = {
  patient: Patient | null;
  patientCachedAt: number | null;
  records: HeartSoundRecord[];
  recordsCachedAt: number | null;
};

export type PatientDetailCacheSnapshot = {
  patient: Patient | null;
  meetings: Meeting[];
  meetingsTotal: number;
};

export type PatientHeartSoundCacheSnapshot = {
  patient: Patient | null;
  records: HeartSoundRecord[];
};

function getStorageKey(
  scope: "detail" | "heart-sound",
  userId: string | null | undefined,
  patientId: string
) {
  return `${PATIENT_WORKSPACE_CACHE_KEY_PREFIX}${scope}.v${CACHE_SCHEMA_VERSION}:${userId ?? "anonymous"}:${patientId}`;
}

function isFresh(timestamp: number | null, ttlMs: number) {
  return Boolean(timestamp && Date.now() - timestamp < ttlMs);
}

function readEnvelope<T>(storageKey: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.version !== CACHE_SCHEMA_VERSION) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function writeEnvelope<T>(storageKey: string, data: T) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: CACHE_SCHEMA_VERSION,
        data,
      } satisfies CacheEnvelope<T>)
    );
    registerPatientWorkspaceCacheKey(storageKey);
  } catch {
    // Ignore cache write failures and keep the page usable.
  }
}

function readPatientWorkspaceCacheRegistry(options?: { preferStorage?: boolean }) {
  if (!options?.preferStorage && patientWorkspaceCacheRegistry) {
    return new Set(patientWorkspaceCacheRegistry);
  }

  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const raw = window.sessionStorage.getItem(PATIENT_WORKSPACE_CACHE_REGISTRY_KEY);
    if (!raw) {
      patientWorkspaceCacheRegistry = new Set<string>();
      return new Set<string>();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      patientWorkspaceCacheRegistry = new Set<string>();
      return new Set<string>();
    }

    patientWorkspaceCacheRegistry = new Set(
      parsed.filter((value): value is string => {
        return (
          typeof value === "string" &&
          value.startsWith(PATIENT_WORKSPACE_CACHE_KEY_PREFIX) &&
          value !== PATIENT_WORKSPACE_CACHE_REGISTRY_KEY
        );
      })
    );
    return new Set(patientWorkspaceCacheRegistry);
  } catch {
    return new Set<string>();
  }
}

function readPatientWorkspaceCacheRegistryFromStorage(storage: Storage) {
  try {
    const raw = storage.getItem(PATIENT_WORKSPACE_CACHE_REGISTRY_KEY);
    if (!raw) {
      return new Set<string>();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(
      parsed.filter((value): value is string => {
        return (
          typeof value === "string" &&
          value.startsWith(PATIENT_WORKSPACE_CACHE_KEY_PREFIX) &&
          value !== PATIENT_WORKSPACE_CACHE_REGISTRY_KEY
        );
      })
    );
  } catch {
    return new Set<string>();
  }
}

function writePatientWorkspaceCacheRegistry(keys: Set<string>) {
  patientWorkspaceCacheRegistry = new Set(keys);

  if (typeof window === "undefined") {
    return;
  }

  if (keys.size === 0) {
    window.sessionStorage.removeItem(PATIENT_WORKSPACE_CACHE_REGISTRY_KEY);
    return;
  }

  window.sessionStorage.setItem(
    PATIENT_WORKSPACE_CACHE_REGISTRY_KEY,
    JSON.stringify([...keys])
  );
}

function registerPatientWorkspaceCacheKey(storageKey: string) {
  if (typeof window === "undefined" || storageKey === PATIENT_WORKSPACE_CACHE_REGISTRY_KEY) {
    return;
  }

  const keys = readPatientWorkspaceCacheRegistry();
  if (keys.has(storageKey)) {
    return;
  }

  keys.add(storageKey);

  try {
    writePatientWorkspaceCacheRegistry(keys);
  } catch {
    // Ignore registry write failures and keep the page usable.
  }
}

function readDetailEntry(
  userId: string | null | undefined,
  patientId: string
): PatientDetailCacheEntry | null {
  return readEnvelope<PatientDetailCacheEntry>(
    getStorageKey("detail", userId, patientId)
  );
}

function readHeartSoundEntry(
  userId: string | null | undefined,
  patientId: string
): PatientHeartSoundCacheEntry | null {
  return readEnvelope<PatientHeartSoundCacheEntry>(
    getStorageKey("heart-sound", userId, patientId)
  );
}

export function readPatientDetailCache(
  userId: string | null | undefined,
  patientId: string
): PatientDetailCacheSnapshot | null {
  const entry = readDetailEntry(userId, patientId);
  if (!entry) {
    return null;
  }

  const patient = isFresh(entry.patientCachedAt, DETAIL_CACHE_TTL_MS)
    ? entry.patient
    : null;
  const hasFreshMeetings = isFresh(entry.meetingsCachedAt, MEETINGS_CACHE_TTL_MS);

  if (!patient && !hasFreshMeetings) {
    return null;
  }

  return {
    patient,
    meetings: hasFreshMeetings ? entry.meetings : [],
    meetingsTotal: hasFreshMeetings ? entry.meetingsTotal : 0,
  };
}

export function writePatientDetailCache(
  userId: string | null | undefined,
  patientId: string,
  patch: Partial<PatientDetailCacheEntry>
) {
  const existing =
    readDetailEntry(userId, patientId) ??
    ({
      patient: null,
      patientCachedAt: null,
      meetings: [],
      meetingsTotal: 0,
      meetingsCachedAt: null,
    } satisfies PatientDetailCacheEntry);

  writeEnvelope(getStorageKey("detail", userId, patientId), {
    ...existing,
    ...patch,
  } satisfies PatientDetailCacheEntry);
}

export function readPatientHeartSoundCache(
  userId: string | null | undefined,
  patientId: string
): PatientHeartSoundCacheSnapshot | null {
  const entry = readHeartSoundEntry(userId, patientId);
  if (!entry) {
    return null;
  }

  const patient = isFresh(entry.patientCachedAt, DETAIL_CACHE_TTL_MS)
    ? entry.patient
    : null;
  const hasFreshRecords = isFresh(entry.recordsCachedAt, HEART_SOUND_CACHE_TTL_MS);

  if (!patient && !hasFreshRecords) {
    return null;
  }

  return {
    patient,
    records: hasFreshRecords ? entry.records : [],
  };
}

export function writePatientHeartSoundCache(
  userId: string | null | undefined,
  patientId: string,
  patch: Partial<PatientHeartSoundCacheEntry>
) {
  const existing =
    readHeartSoundEntry(userId, patientId) ??
    ({
      patient: null,
      patientCachedAt: null,
      records: [],
      recordsCachedAt: null,
    } satisfies PatientHeartSoundCacheEntry);

  writeEnvelope(getStorageKey("heart-sound", userId, patientId), {
    ...existing,
    ...patch,
  } satisfies PatientHeartSoundCacheEntry);
}

export function clearPatientWorkspaceCache() {
  if (typeof window === "undefined") {
    return;
  }

  const registryKeys = new Set<string>([
    ...readPatientWorkspaceCacheRegistry({ preferStorage: true }),
    ...readPatientWorkspaceCacheRegistryFromStorage(window.localStorage),
  ]);
  if (registryKeys.size > 0) {
    for (const key of registryKeys) {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    }
    writePatientWorkspaceCacheRegistry(new Set());
    window.localStorage.removeItem(PATIENT_WORKSPACE_CACHE_REGISTRY_KEY);
    return;
  }

  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(PATIENT_WORKSPACE_CACHE_KEY_PREFIX)) {
      window.sessionStorage.removeItem(key);
    }
  }

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(PATIENT_WORKSPACE_CACHE_KEY_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}
