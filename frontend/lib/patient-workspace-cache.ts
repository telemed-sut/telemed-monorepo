import type { HeartSoundRecord, Meeting, Patient } from "@/lib/api";

const CACHE_SCHEMA_VERSION = 1;
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const MEETINGS_CACHE_TTL_MS = 60 * 1000;
const HEART_SOUND_CACHE_TTL_MS = 60 * 1000;

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
  return `telemed.patient-workspace.${scope}.v${CACHE_SCHEMA_VERSION}:${userId ?? "anonymous"}:${patientId}`;
}

function isFresh(timestamp: number | null, ttlMs: number) {
  return Boolean(timestamp && Date.now() - timestamp < ttlMs);
}

function readEnvelope<T>(storageKey: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.version !== CACHE_SCHEMA_VERSION) {
      window.localStorage.removeItem(storageKey);
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
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: CACHE_SCHEMA_VERSION,
        data,
      } satisfies CacheEnvelope<T>)
    );
  } catch {
    // Ignore cache write failures and keep the page usable.
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
