"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AudioLines,
  Activity,
  CircleAlert,
  CloudUpload,
  Files,
  Square,
  Stethoscope,
  UserRound,
  Volume2,
  X,
} from "lucide-react";

import type { AppLanguage } from "@/store/language-config";
import {
  fetchPatient,
  fetchPatientHeartSounds,
  fetchDeviceLiveSessions,
  fetchDeviceInventory,
  completeDeviceExamSession,
  getErrorMessage,
  API_BASE_URL,
  type HeartSoundRecord,
  type Patient,
  type DeviceLiveSessionItem,
  uploadPatientHeartSound,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { HeartSoundInlinePlayer } from "@/components/dashboard/heart-sound-inline-player";
import { getPatientLoadErrorTitle } from "@/components/dashboard/patient-load-error";
import { getPatientWorkspaceHrefs } from "@/components/dashboard/dashboard-route-utils";
import {
  readPatientHeartSoundCache,
  writePatientHeartSoundCache,
} from "@/lib/patient-workspace-cache";
import { preloadPatientDetailBundle } from "@/lib/patient-workspace-prefetch";

interface PatientHeartSoundContentProps {
  patientId: string;
}

type PatientHeartSoundPatient = Pick<Patient, "id" | "first_name" | "last_name">;
type PanelKind = "anterior" | "posterior";
type AssignmentMode = "auto" | "manual";

type DisplayHeartSoundRecord = HeartSoundRecord & {
  draftFileName?: string;
  fileSizeBytes?: number;
  isDraft?: boolean;
};

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const SURFACE_MAP_ARTWORK_PATH = "/heart-sound-map/torso-surface-map.png";

const POSITION_META = [
  { id: 1, label: "1", panel: "anterior", top: "24%", left: "31%" },
  { id: 2, label: "2", panel: "anterior", top: "24%", left: "69%" },
  { id: 3, label: "3", panel: "anterior", top: "44%", left: "31%" },
  { id: 4, label: "4", panel: "anterior", top: "44%", left: "69%" },
  { id: 5, label: "5", panel: "anterior", top: "65%", left: "34%" },
  { id: 6, label: "6", panel: "anterior", top: "65%", left: "66%" },
  { id: 7, label: "7", panel: "posterior", top: "21%", left: "34%" },
  { id: 8, label: "8", panel: "posterior", top: "21%", left: "66%" },
  { id: 9, label: "9", panel: "posterior", top: "40%", left: "43%" },
  { id: 10, label: "10", panel: "posterior", top: "40%", left: "57%" },
  { id: 11, label: "11", panel: "posterior", top: "58%", left: "38%" },
  { id: 12, label: "12", panel: "posterior", top: "58%", left: "62%" },
  { id: 13, label: "13", panel: "posterior", top: "77%", left: "30%" },
  { id: 14, label: "14", panel: "posterior", top: "77%", left: "70%" },
] as const;

const PANEL_POSITIONS: Record<PanelKind, number[]> = {
  anterior: [1, 2, 3, 4, 5, 6],
  posterior: [7, 8, 9, 10, 11, 12, 13, 14],
};
const MAX_HEART_SOUND_UPLOAD_BYTES = 50 * 1024 * 1024;
const HEART_SOUND_AUTO_REFRESH_INTERVAL_MS = 5000;

function formatDateTime(value: string, language: AppLanguage) {
  return new Date(value).toLocaleString(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) {
    return null;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getUploadSizeError(language: AppLanguage, rejectedFiles: File[]) {
  if (rejectedFiles.length === 0) {
    return null;
  }

  const maxSize = formatFileSize(MAX_HEART_SOUND_UPLOAD_BYTES);
  if (rejectedFiles.length === 1) {
    return tr(
      language,
      `${rejectedFiles[0].name} exceeds the ${maxSize} limit and was not added.`,
      `${rejectedFiles[0].name} มีขนาดเกิน ${maxSize} จึงไม่ได้ถูกเพิ่มเข้าคิว`
    );
  }

  return tr(
    language,
    `${rejectedFiles.length} files exceed the ${maxSize} limit and were not added.`,
    `${rejectedFiles.length} ไฟล์มีขนาดเกิน ${maxSize} จึงไม่ได้ถูกเพิ่มเข้าคิว`
  );
}

function getHeartSoundUploadErrorMessage(language: AppLanguage, error: unknown) {
  const message = getErrorMessage(
    error,
    tr(
      language,
      "Unable to upload heart-sound files right now.",
      "ยังไม่สามารถอัปโหลดไฟล์เสียงหัวใจได้ในขณะนี้"
    ),
    language
  );

  if (/blob storage cors|frontend origin in blob storage cors/i.test(message)) {
    return tr(
      language,
      "Azure Blob Storage is blocking browser uploads for this origin. Add this frontend URL to the storage account CORS rules, then try again.",
      "Azure Blob Storage กำลังบล็อกการอัปโหลดจากเว็บโดเมนนี้อยู่ กรุณาเพิ่ม URL ของ frontend นี้ในกฎ CORS ของ storage account แล้วลองใหม่อีกครั้ง"
    );
  }

  return message;
}

function getPanelByPosition(position: number): PanelKind {
  return position <= 6 ? "anterior" : "posterior";
}

function buildPositionCounts(records: DisplayHeartSoundRecord[]) {
  return records.reduce<Record<number, number>>((acc, record) => {
    acc[record.position] = (acc[record.position] ?? 0) + 1;
    return acc;
  }, {});
}

function getPanelLabel(language: AppLanguage, panel: PanelKind) {
  return tr(
    language,
    panel === "anterior" ? "Anterior" : "Posterior",
    panel === "anterior" ? "ด้านหน้า" : "ด้านหลัง"
  );
}

function getRecordSource(
  record: DisplayHeartSoundRecord,
  language: AppLanguage,
  showSystemDetails: boolean
) {
  if (record.isDraft) {
    return {
      primary: tr(language, "Queued upload", "รออัปโหลด"),
      secondary: record.draftFileName ?? record.storage_key,
    };
  }

  if (!showSystemDetails) {
    return {
      primary:
        record.draftFileName ||
        record.storage_key ||
        tr(language, "Recorded file", "ไฟล์ที่บันทึก"),
      secondary: null,
    };
  }

  return {
    primary: record.device_id || tr(language, "Recorder device", "อุปกรณ์บันทึก"),
    secondary:
      record.mac_address && record.mac_address !== "PENDING"
        ? `MAC ${record.mac_address}`
        : record.storage_key,
  };
}

function getScrollBehavior() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "smooth" as const;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? ("auto" as const)
    : ("smooth" as const);
}

function getAutoAssignedPositions(
  existingRecords: DisplayHeartSoundRecord[],
  panel: PanelKind,
  count: number
) {
  const positions = PANEL_POSITIONS[panel];
  const counts = buildPositionCounts(existingRecords);
  const assignments: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const nextPosition = [...positions].sort((left, right) => {
      const countDiff = (counts[left] ?? 0) - (counts[right] ?? 0);
      if (countDiff !== 0) {
        return countDiff;
      }
      return left - right;
    })[0];

    assignments.push(nextPosition);
    counts[nextPosition] = (counts[nextPosition] ?? 0) + 1;
  }

  return assignments;
}

function createDraftRecord(
  file: File,
  patientId: string,
  position: number,
  sequence: number
): DisplayHeartSoundRecord {
  const nowIso = new Date(Date.now() + sequence).toISOString();

  return {
    id: `draft-${file.name}-${sequence}-${Math.random().toString(36).slice(2, 8)}`,
    patient_id: patientId,
    device_id: "queued-upload",
    mac_address: "PENDING",
    position,
    blob_url: URL.createObjectURL(file),
    storage_key: `local-draft/${file.name}`,
    mime_type: file.type || "audio/mpeg",
    duration_seconds: null,
    recorded_at: nowIso,
    created_at: nowIso,
    draftFileName: file.name,
    fileSizeBytes: file.size,
    isDraft: true,
  };
}

function HeartSoundReferenceMap({
  language,
  activePosition,
  onPositionSelect,
  positionCounts,
}: {
  language: AppLanguage;
  activePosition: number | null;
  onPositionSelect: (position: number) => void;
  positionCounts: Record<number, number>;
}) {
  const renderGuides = (panel: PanelKind) =>
    panel === "anterior" ? (
      <>
        <path
          d="M31 24 H69 M31 44 H69 M34 65 H66 M31 24 V65 M69 24 V44"
          stroke="#66b9cd"
          strokeDasharray="4 4"
          strokeLinecap="round"
          strokeWidth="1.35"
          opacity="0.88"
          fill="none"
        />
      </>
    ) : (
      <>
        <path
          d="M34 21 H66 M43 40 H57 M43 40 L38 58 M57 40 L62 58 M38 58 H62 M30 77 H70"
          stroke="#66b9cd"
          strokeDasharray="4 4"
          strokeLinecap="round"
          strokeWidth="1.35"
          opacity="0.88"
          fill="none"
        />
      </>
    );

  const renderPanel = (panel: PanelKind) => {
    const points = POSITION_META.filter((item) => item.panel === panel);
    const filesInPanel = points.reduce((sum, point) => sum + (positionCounts[point.id] ?? 0), 0);
    const positionsUsed = points.filter((point) => (positionCounts[point.id] ?? 0) > 0).length;
    const label = getPanelLabel(language, panel);

    return (
      <section className="overflow-hidden rounded-[30px] border border-[#dcecf0] bg-[linear-gradient(180deg,#ffffff_0%,#f7fcfd_100%)] shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-[#f3fbfd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0f6f89]">
              {label}
            </div>
            <p className="text-sm text-slate-500">
              {tr(
                language,
                panel === "anterior" ? "Front torso surface map" : "Back torso surface map",
                panel === "anterior" ? "แผนที่ผิวกายด้านหน้า" : "แผนที่ผิวกายด้านหลัง"
              )}
            </p>
          </div>

          <div className="flex gap-2 text-xs">
            <div className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">
              {filesInPanel} {tr(language, "files", "ไฟล์")}
            </div>
            <div className="rounded-full border border-sky-100 bg-[#f6fbfd] px-3 py-1.5 font-medium text-[#0f6f89]">
              {positionsUsed} {tr(language, "positions", "ตำแหน่ง")}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div className="relative min-h-[380px] overflow-hidden rounded-[28px] border border-[#e3eff2] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_38%),linear-gradient(180deg,#fbfeff_0%,#f5fafb_100%)]">
            <div className="absolute inset-[5%]">
              <div className="absolute inset-0 rounded-[24px] bg-white/75" />
              <div
                className="absolute inset-0 bg-no-repeat"
                style={{
                  backgroundImage: `url(${SURFACE_MAP_ARTWORK_PATH})`,
                  backgroundPosition: panel === "anterior" ? "0% 48%" : "100% 48%",
                  backgroundSize: "200% auto",
                }}
                aria-hidden="true"
              />

              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                {renderGuides(panel)}
              </svg>

              {points.map((point) => {
                const isActive = activePosition === point.id;
                const count = positionCounts[point.id] ?? 0;

                return (
                  <button
                    key={point.id}
                    type="button"
                    onClick={() => onPositionSelect(point.id)}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 hover:-translate-y-[54%] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200",
                      "flex h-11 w-11 items-center justify-center border text-sm font-semibold shadow-[0_10px_24px_rgba(8,145,178,0.14)]",
                      isActive
                        ? "border-[#0f7a9a] bg-[#0f95b8] text-white"
                        : count > 0
                          ? "border-[#59bed5] bg-[#dff8fc] text-[#0f718b]"
                          : "border-[#d7e9ee] bg-white text-[#56788b]"
                    )}
                    style={{ top: point.top, left: point.left }}
                    aria-label={tr(language, `Jump to position ${point.id}`, `ไปยังตำแหน่ง ${point.id}`)}
                  >
                    {point.label}
                    {count > 0 ? (
                      <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border border-white bg-[#f3c74c] px-1 text-[10px] font-bold text-[#28434d] shadow-sm">
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.96))]" />
            <div className="absolute inset-x-0 bottom-4 text-center text-[clamp(1.25rem,1.8vw,1.65rem)] font-semibold tracking-tight text-[#1486a4]">
              {label}
            </div>
          </div>
        </div>
      </section>
    );
  };

  const recordedCount = Object.values(positionCounts).reduce((sum, count) => sum + count, 0);
  const usedPositions = Object.values(positionCounts).filter((count) => count > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0f6f89]">
            {tr(language, "Surface map", "แผนที่ผิวกาย")}
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {tr(language, "Choose an auscultation position", "เลือกตำแหน่งการฟังเสียง")}
            </h2>
            <p className="max-w-2xl text-sm text-slate-600">
              {tr(
                language,
                "Select a point to focus the review list on one listening position at a time.",
                "เลือกจุดบนแผนที่เพื่อโฟกัสรายการตรวจให้เหลือทีละตำแหน่ง"
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600">
            {usedPositions} {tr(language, "positions used", "ตำแหน่งที่มีข้อมูล")}
          </span>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">
            {recordedCount} {tr(language, "recordings", "ไฟล์เสียง")}
          </span>
          {activePosition ? (
            <>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 font-medium text-[#0f6f89]">
                {tr(language, `Position ${activePosition} selected`, `เลือกตำแหน่ง ${activePosition} อยู่`)}
              </span>
              <Button type="button" variant="outline" className="rounded-full" onClick={() => onPositionSelect(activePosition)}>
                <X className="size-4" />
                {tr(language, "Clear selection", "ล้างการเลือก")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {renderPanel("anterior")}
        {renderPanel("posterior")}
      </div>
    </div>
  );
}

export function PatientHeartSoundContent({
  patientId,
}: PatientHeartSoundContentProps) {
  const token = useAuthStore((state) => state.token);
  const clearToken = useAuthStore((state) => state.clearToken);
  const userId = useAuthStore((state) => state.userId);
  const language = useLanguageStore((state) => state.language);
  const router = useRouter();
  const showSystemDetails = true;
  const patientWorkspaceHrefs = useMemo(
    () => getPatientWorkspaceHrefs(patientId),
    [patientId]
  );
  const patientWorkspaceHref = patientWorkspaceHrefs[0];
  const denseModeHref = patientWorkspaceHrefs[2];
  const canUseProtectedCache = Boolean(token && userId);
  const cachedSnapshot = useMemo(
    () => (canUseProtectedCache ? readPatientHeartSoundCache(userId, patientId) : null),
    [canUseProtectedCache, patientId, userId]
  );
  const cachedRecords = useMemo(
    () => cachedSnapshot?.records ?? [],
    [cachedSnapshot]
  );
  const hasCachedRecords = Boolean(cachedSnapshot);

  const [patient, setPatient] = useState<PatientHeartSoundPatient | null>(
    () => cachedSnapshot?.patient ?? null
  );
  const [records, setRecords] = useState<HeartSoundRecord[]>(() => cachedRecords);
  const [simulatedRecords, setSimulatedRecords] = useState<HeartSoundRecord[]>([]);
  const [activeSession, setActiveSession] = useState<DeviceLiveSessionItem | null>(null);
  const [draftRecords, setDraftRecords] = useState<DisplayHeartSoundRecord[]>([]);
  const [loading, setLoading] = useState(
    () => !(cachedSnapshot?.patient && hasCachedRecords)
  );
  const [patientError, setPatientError] = useState<string | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [activePosition, setActivePosition] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPanel, setUploadPanel] = useState<PanelKind>("anterior");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("auto");
  const [manualPosition, setManualPosition] = useState<number>(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);
  const [isFinishingSession, setIsFinishingSession] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const shouldScrollRef = useRef(false);
  const draftRecordsRef = useRef<DisplayHeartSoundRecord[]>([]);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    patientWorkspaceHrefs.forEach((href) => {
      router.prefetch(href);
    });
    void preloadPatientDetailBundle();
  }, [patientWorkspaceHrefs, router]);

  useEffect(() => {
    setPatient(cachedSnapshot?.patient ?? null);
    setRecords(cachedRecords);
    setLoading(!(cachedSnapshot?.patient && hasCachedRecords));
    setPatientError(null);
    setRecordsError(null);
  }, [
    cachedSnapshot,
    cachedRecords,
    hasCachedRecords,
  ]);

  useEffect(() => {
    draftRecordsRef.current = draftRecords;
  }, [draftRecords]);

  useEffect(() => {
    return () => {
      draftRecordsRef.current.forEach((record) => {
        if (record.isDraft) {
          URL.revokeObjectURL(record.blob_url);
        }
      });
    };
  }, []);

  const applyFetchedHeartSounds = useCallback((items: HeartSoundRecord[]) => {
    setRecords(items);
    setRecordsError(null);
    writePatientHeartSoundCache(userId, patientId, {
      records: items,
      recordsCachedAt: Date.now(),
    });
  }, [patientId, userId]);

  const refreshHeartSounds = useCallback(
    async ({ clearRecordsOnError = false }: { clearRecordsOnError?: boolean } = {}) => {
      if (!token || refreshInFlightRef.current) {
        return;
      }

      refreshInFlightRef.current = true;
      try {
        const [soundData, liveData, inventoryData] = await Promise.all([
          fetchPatientHeartSounds(patientId, token),
          fetchDeviceLiveSessions(token, { staleAfterSeconds: 300 }),
          fetchDeviceInventory(token, { staleAfterSeconds: 600 }),
        ]);

        // Check if there is an active session for this specific patient
        // AND ensure the device still exists in inventory
        const currentActive = liveData.items.find(
          (s) => {
            const isTargetPatient = s.patient_id === patientId && (s.status === "active" || s.status === "stale");
            const deviceExists = inventoryData.items.some(d => d.device_id === s.device_id);
            return isTargetPatient && deviceExists;
          }
        );
        setActiveSession(currentActive || null);

        // Auto-highlight position if we have a live session and its position changed
        if (currentActive && currentActive.measurement_type === "heart_sound") {
          const latestRecord = soundData.items[0];
          // CRITICAL: Must match BOTH device_id AND session_id to be considered live for THIS patient
          if (latestRecord && 
              latestRecord.device_id === currentActive.device_id && 
              latestRecord.device_exam_session_id === currentActive.session_id) {
            
            const isRecent = Date.now() - new Date(latestRecord.recorded_at).getTime() < 30000;
            if (isRecent && activePosition !== latestRecord.position && !playingRecordId) {
              setActivePosition(latestRecord.position);
              shouldScrollRef.current = true;
            }
          }
        }

        applyFetchedHeartSounds(soundData.items);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }

        if (clearRecordsOnError) {
          setRecords([]);
        }
        setRecordsError(
          getErrorMessage(
            err,
            tr(
              language,
              "Unable to load heart-sound records right now.",
              "ยังไม่สามารถโหลดรายการไฟล์เสียงหัวใจได้ในขณะนี้"
            ),
            language
          )
        );
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [applyFetchedHeartSounds, clearToken, language, patientId, router, token, activePosition, playingRecordId]
  );

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }

    let cancelled = false;
    const hasCachedPatient = Boolean(cachedSnapshot?.patient);
    const hasCachedHeartSounds = hasCachedRecords;

    const load = async () => {
      if (!hasCachedPatient || !hasCachedHeartSounds) {
        setLoading(true);
      }
      setPatientError(null);
      setRecordsError(null);
      try {
        const patientData = await fetchPatient(patientId, token);
        if (cancelled) {
          return;
        }
        setPatient(patientData);
        writePatientHeartSoundCache(userId, patientId, {
          patient: patientData,
          patientCachedAt: Date.now(),
        });
        if (!cancelled) {
          await refreshHeartSounds({ clearRecordsOnError: true });
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const status = (err as { status?: number }).status;
        if (status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setPatientError(
          getPatientLoadErrorTitle(err, language)
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    cachedSnapshot?.patient,
    clearToken,
    hasCachedRecords,
    language,
    patientId,
    refreshHeartSounds,
    router,
    token,
    userId,
  ]);

  useEffect(() => {
    if (!token) {
      return;
    }

    // Phase 3: Real-time SSE Connection
    const streamUrl = `${API_BASE_URL}/patients/${patientId}/stream?token=${token}`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const eventData = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
        
        if (eventData.type === "new_heart_sound") {
          console.log("Phase 3: Real-time notification received via SSE!");
          // Immediately refresh to show the new record
          void refreshHeartSounds({ clearRecordsOnError: false });
        }
      } catch (e) {
        console.error("Failed to parse SSE message:", e);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("SSE Connection lost. Reconnecting or falling back to polling...", err);
    };

    const refreshVisibleRecords = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void refreshHeartSounds({ clearRecordsOnError: false });
    };

    // Polling is now a slow fallback (30s) because we have real-time SSE
    const intervalId = window.setInterval(
      refreshVisibleRecords,
      30000 
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshHeartSounds({ clearRecordsOnError: false });
      }
    };

    window.addEventListener("focus", refreshVisibleRecords);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      eventSource.close();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleRecords);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [patientId, refreshHeartSounds, token, activeSession]);

  const displayRecords = useMemo<DisplayHeartSoundRecord[]>(() => {
    return [...draftRecords, ...simulatedRecords, ...records].sort((left, right) => {
      return new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime();
    });
  }, [draftRecords, simulatedRecords, records]);

  const positionCounts = useMemo(() => buildPositionCounts(displayRecords), [displayRecords]);

  const positionRecords = useMemo(() => {
    if (!activePosition) {
      return [];
    }
    return displayRecords.filter((record) => record.position === activePosition);
  }, [activePosition, displayRecords]);

  const visibleRecords = useMemo(() => {
    return activePosition ? positionRecords : displayRecords;
  }, [activePosition, displayRecords, positionRecords]);

  const positionSummary = useMemo(() => {
    return POSITION_META.map((position) => ({
      ...position,
      count: positionCounts[position.id] ?? 0,
    })).filter((item) => item.count > 0);
  }, [positionCounts]);
  const prefetchPatientWorkspace = () => {
    router.prefetch(patientWorkspaceHref);
    void preloadPatientDetailBundle();
  };

  useEffect(() => {
    if (!activePosition || !shouldScrollRef.current) {
      return;
    }

    const match = visibleRecords[0];
    if (!match) {
      shouldScrollRef.current = false;
      return;
    }

    requestAnimationFrame(() => {
      const activeRow = rowRefs.current[match.id];
      if (activeRow && typeof activeRow.scrollIntoView === "function") {
        activeRow.scrollIntoView({
          behavior: getScrollBehavior(),
          block: "center",
        });
      }
      setActiveRowId(match.id);
      shouldScrollRef.current = false;
      window.setTimeout(() => {
        setActiveRowId((current) => (current === match.id ? null : current));
      }, 1800);
    });
  }, [activePosition, visibleRecords]);

  const handleFinishSession = useCallback(async () => {
    if (!token || !activeSession || isFinishingSession) return;
    
    setIsFinishingSession(true);
    try {
      await completeDeviceExamSession(token, activeSession.session_id, {
        notes: tr(language, "Finished by clinician from patient page.", "จบการตรวจโดยคุณหมอจากหน้าคนไข้"),
      });
      toast.success(tr(language, "Examination finished", "จบการตรวจเรียบร้อย"));
      setActiveSession(null);
      void refreshHeartSounds();
    } catch (e) {
      toast.error(tr(language, "Failed to finish session", "ไม่สามารถจบการตรวจได้"));
    } finally {
      setIsFinishingSession(false);
    }
  }, [token, activeSession, isFinishingSession, language, refreshHeartSounds]);

  const clearPositionSelection = () => {
    setActivePosition(null);
    setActiveRowId(null);
    shouldScrollRef.current = false;
  };

  const jumpToPosition = (position: number) => {
    if (activePosition === position) {
      clearPositionSelection();
      return;
    }

    setActivePosition(position);
    setManualPosition(position);
    setUploadPanel(getPanelByPosition(position));
    shouldScrollRef.current = true;
  };

  const removeSelectedFile = (targetName: string) => {
    setSelectedFiles((current) => current.filter((file) => `${file.name}-${file.size}` !== targetName));
    setUploadError(null);
  };

  const queueSelectedFiles = async () => {
    if (selectedFiles.length === 0 || !token) {
      return;
    }

    const assignedPositions =
      assignmentMode === "manual"
        ? Array.from({ length: selectedFiles.length }, () => manualPosition)
        : getAutoAssignedPositions(displayRecords, uploadPanel, selectedFiles.length);

    const nextDrafts = selectedFiles.map((file, index) =>
      createDraftRecord(file, patientId, assignedPositions[index], index)
    );
    const draftIds = new Set(nextDrafts.map((record) => record.id));

    setDraftRecords((current) => [...nextDrafts, ...current]);
    setUploadError(null);
    setIsUploading(true);

    try {
      for (const [index, file] of selectedFiles.entries()) {
        await uploadPatientHeartSound(
          patientId,
          {
            file,
            position: assignedPositions[index],
          },
          token
        );
      }

      await refreshHeartSounds({ clearRecordsOnError: true });
      setSelectedFiles([]);
      setUploadOpen(false);
      setActivePosition(assignedPositions[0] ?? null);
      setManualPosition(assignedPositions[0] ?? manualPosition);
      shouldScrollRef.current = true;

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      toast.success(
        tr(
          language,
          "Heart-sound files uploaded",
          "อัปโหลดไฟล์เสียงหัวใจเรียบร้อย"
        )
      );
    } catch (error) {
      const message = getHeartSoundUploadErrorMessage(language, error);
      setUploadError(message);
      toast.error(
        tr(language, "Upload failed", "อัปโหลดไม่สำเร็จ"),
        {
          description: message,
        }
      );
    } finally {
      setDraftRecords((current) =>
        current.filter((record) => !draftIds.has(record.id))
      );
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 space-y-6 overflow-y-auto py-2">
        <Skeleton className="h-32 rounded-[32px]" />
        <Skeleton className="h-[540px] rounded-[32px]" />
        <Skeleton className="h-[380px] rounded-[32px]" />
      </div>
    );
  }

  if (patientError || !patient) {
    return (
      <div className="rounded-[32px] border border-destructive/20 bg-white shadow-sm">
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="rounded-3xl bg-destructive/10 p-4 text-destructive">
            <CircleAlert className="size-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">
              {patientError || tr(language, "Patient not found", "ไม่พบผู้ป่วย")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr(language, "Unable to load patient data.", "ไม่สามารถโหลดข้อมูลผู้ป่วยได้")}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(patientWorkspaceHref)}
            onFocus={prefetchPatientWorkspace}
            onMouseEnter={prefetchPatientWorkspace}
          >
            <ArrowLeft className="size-4" />
            {tr(language, "Back to workspace", "กลับไปพื้นที่ทำงานผู้ป่วย")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 space-y-5 overflow-y-auto py-2">
      {activeSession && (
        <div className="flex items-center justify-between rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-slate-900">
                {tr(language, "Live Examination in Progress", "กำลังดำเนินการตรวจสด")}
              </p>
              <p className="text-xs text-slate-600">
                {tr(
                  language,
                  `Connected to device ${activeSession.device_display_name || activeSession.device_id}. New recordings will appear automatically.`,
                  `เชื่อมต่อกับเครื่อง ${activeSession.device_display_name || activeSession.device_id} แล้ว ไฟล์เสียงใหม่จะปรากฏโดยอัตโนมัติ`
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-[#0891B2] text-white animate-pulse">
              {tr(language, "LIVE", "สด")}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-xl border-sky-200 bg-white text-sky-700 hover:bg-sky-100"
              onClick={handleFinishSession}
              disabled={isFinishingSession}
            >
              {isFinishingSession ? (
                <div className="size-3.5 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
              <span className="ml-2">{tr(language, "Finish", "จบการตรวจ")}</span>
            </Button>
          </div>
        </div>
      )}

      <section className="rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_16px_38px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0f6f89]">
              {tr(language, "Heart sound workspace", "พื้นที่ตรวจเสียงหัวใจ")}
            </div>
            <div className="space-y-1">
              <h1 className="text-[clamp(1.85rem,3vw,2.5rem)] font-semibold tracking-tight text-slate-900">
                {tr(language, "Heart Sound", "เสียงหัวใจ")}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                {tr(
                  language,
                  "Select a listening position to review related recordings, then stage new uploads for this patient when needed.",
                  "เลือกตำแหน่งการฟังเพื่อดูไฟล์ที่เกี่ยวข้อง แล้วค่อยเตรียมอัปโหลดใหม่สำหรับผู้ป่วยรายนี้เมื่อจำเป็น"
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1.5">
                <UserRound className="size-4 text-[#0891B2]" />
                {patient.first_name} {patient.last_name}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1.5">
                <Volume2 className="size-4 text-[#0891B2]" />
                {displayRecords.length} {tr(language, "recordings", "ไฟล์เสียง")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1.5">
                <Files className="size-4 text-emerald-600" />
                {positionSummary.length} {tr(language, "positions used", "ตำแหน่งที่มีข้อมูล")}
              </span>
              {draftRecords.length > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-emerald-700">
                  <AudioLines className="size-4" />
                  {draftRecords.length} {isUploading
                    ? tr(language, "uploading", "กำลังอัปโหลด")
                    : tr(language, "queued", "รออัปโหลด")}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 lg:min-w-[240px] lg:items-end">
            {/* Dev Simulator Button */}
            {process.env.NODE_ENV === "development" && (
              <Button
                variant="secondary"
                className="w-full bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-200 rounded-2xl"
                onClick={async () => {
                  if (!token) return;
                  setIsUploading(true);
                  try {
                    console.log("Dev Sim: Simulating real-time signal...");
                    
                    // 1. Create a Mock Record that looks like a real one
                    const now = new Date().toISOString();
                    const mockId = `sim-${Date.now()}`;
                    const mockRecord: HeartSoundRecord = {
                      id: mockId,
                      patient_id: patientId,
                      device_id: activeSession?.device_id || "DEV-HEART-01",
                      mac_address: "SIM-ADDR-001",
                      position: activePosition || 1,
                      blob_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", // Use a real public mp3 for testing
                      storage_key: `simulated/${mockId}.mp3`,
                      mime_type: "audio/mpeg",
                      duration_seconds: 5.0,
                      recorded_at: now,
                      created_at: now,
                    };

                    // 2. Inject directly into simulated state so it's not overwritten by API refresh
                    setSimulatedRecords(current => [mockRecord, ...current]);
                    
                    // 3. Trigger UI effects (Map pulse and Auto-scroll)
                    setActivePosition(mockRecord.position);
                    shouldScrollRef.current = true;

                    toast.success("Dev Sim: Real-time signal injected!", {
                      description: `Simulated data added to position ${mockRecord.position} (Bypassing Azure)`
                    });
                  } catch (e) {
                    console.error("Dev Sim Error:", e);
                    toast.error("Dev Sim failed to inject data");
                  } finally {
                    setIsUploading(false);
                  }
                }}
              >
                <Activity className="size-4" />
                Dev Sim: Send Pulse
              </Button>
            )}

            <Button
              className="min-h-11 min-w-[240px] rounded-2xl"
              onClick={() => setUploadOpen((current) => !current)}
              disabled={isUploading}
            >
              <CloudUpload className="size-4" />
              {uploadOpen
                ? tr(language, "Hide upload panel", "ซ่อนแผงอัปโหลด")
                : tr(language, "Upload heart sound files", "อัปโหลดไฟล์เสียงหัวใจ")}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-2xl"
                onClick={() => router.push(patientWorkspaceHref)}
                onFocus={prefetchPatientWorkspace}
                onMouseEnter={prefetchPatientWorkspace}
              >
                <ArrowLeft className="size-4" />
                {tr(language, "Back", "กลับ")}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl"
                onClick={() => router.push(denseModeHref)}
                onFocus={() => router.prefetch(denseModeHref)}
                onMouseEnter={() => router.prefetch(denseModeHref)}
              >
                <Stethoscope className="size-4" />
                {tr(language, "Clinical focus mode", "โหมดโฟกัส")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_340px]">
        <div className="rounded-[30px] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
          <HeartSoundReferenceMap
            language={language}
            activePosition={activePosition}
            onPositionSelect={jumpToPosition}
            positionCounts={positionCounts}
          />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-[28px] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
            {activePosition ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                      {tr(language, "Selected position", "ตำแหน่งที่เลือก")}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                      {tr(language, `Position ${activePosition}`, `ตำแหน่ง ${activePosition}`)}
                    </h2>
                  </div>
                  <Badge className="border-transparent bg-[#0891B2]/12 text-[#0a6e87]">
                    {positionRecords.length} {tr(language, "files", "ไฟล์")}
                  </Badge>
                </div>

                <p className="text-sm leading-6 text-slate-600">
                  {tr(
                    language,
                    "The review list is now focused on this single listening point so you can compare takes without other positions mixed in.",
                    "รายการตรวจด้านล่างถูกกรองให้เหลือเฉพาะตำแหน่งนี้แล้ว เพื่อให้เทียบไฟล์แต่ละรอบได้โดยไม่มีตำแหน่งอื่นปะปน"
                  )}
                </p>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit rounded-full"
                  onClick={clearPositionSelection}
                >
                  <X className="size-4" />
                  {tr(language, "Show all positions", "แสดงทุกตำแหน่ง")}
                </Button>

                {positionRecords.length > 0 ? (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    {positionRecords.slice(0, 3).map((record) => {
                      const source = getRecordSource(record, language, showSystemDetails);
                      return (
                        <div key={record.id} className="rounded-2xl border border-slate-100 bg-slate-50/75 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                              {record.isDraft
                                ? tr(language, "Queued upload", "รออัปโหลด")
                                : tr(language, "Recorded", "บันทึกแล้ว")}
                            </span>
                            <span className="text-xs text-slate-500">
                              {formatDateTime(record.recorded_at, language)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm font-medium text-slate-800">{source.primary}</p>
                          {source.secondary ? (
                            <p className="mt-1 truncate text-xs text-slate-500">{source.secondary}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                  {tr(language, "Selection context", "บริบทการเลือก")}
                </p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  {tr(language, "Choose a point from the map", "เลือกจุดจากแผนที่")}
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  {tr(
                    language,
                    "Selecting any point will focus the review list and surface recent files for that position here.",
                    "เมื่อเลือกจุดใดบนแผนที่ รายการตรวจจะถูกโฟกัสเฉพาะตำแหน่งนั้น และพื้นที่นี้จะแสดงไฟล์ล่าสุดของตำแหน่งดังกล่าว"
                  )}
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-600">
                    {tr(language, "Next step", "ขั้นตอนถัดไป")}:
                    {" "}
                    {tr(language, "pick a position", "เลือกตำแหน่ง")}
                  </span>
                  <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1.5 font-medium text-[#0f6f89]">
                    {positionSummary.length} {tr(language, "positions available", "ตำแหน่งที่มีข้อมูล")}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[24px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                  {tr(language, "Upload workflow", "ขั้นตอนอัปโหลด")}
                </p>
                <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-slate-900">
                  {tr(language, "Upload files", "อัปโหลดไฟล์")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {tr(
                    language,
                    "Pick files, set side and assignment, then upload them into this patient workspace.",
                    "เลือกไฟล์ ตั้งค่าด้านและการกำหนดตำแหน่ง แล้วอัปโหลดเข้า workspace ของผู้ป่วยรายนี้",
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant={uploadOpen ? "default" : "outline"}
                size="sm"
                className="rounded-full shrink-0"
                onClick={() => setUploadOpen((current) => !current)}
                disabled={isUploading}
              >
                {uploadOpen ? tr(language, "Close", "ปิด") : tr(language, "Open", "เปิด")}
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {uploadOpen ? (
                <div className="space-y-3">
                  <div className="rounded-[18px] border border-dashed border-sky-200/90 bg-sky-50/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {selectedFiles.length > 0
                            ? tr(language, `${selectedFiles.length} files ready`, `${selectedFiles.length} ไฟล์พร้อมแล้ว`)
                            : tr(language, "Add audio files", "เพิ่มไฟล์เสียง")}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {tr(
                            language,
                            "Multiple audio files are supported in one upload batch.",
                            "รองรับการเลือกหลายไฟล์และอัปโหลดพร้อมกัน",
                          )}
                        </p>
                      </div>
                      <Button
                        type="button"
                        className="min-h-10 rounded-xl shrink-0"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        <CloudUpload className="size-4" />
                        {isUploading
                          ? tr(language, "Uploading...", "กำลังอัปโหลด...")
                          : tr(language, "Choose files", "เลือกไฟล์")}
                      </Button>
                    </div>
                    <Input
                      id="heart-sound-files"
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        const acceptedFiles = files.filter((file) => file.size <= MAX_HEART_SOUND_UPLOAD_BYTES);
                        const rejectedFiles = files.filter((file) => file.size > MAX_HEART_SOUND_UPLOAD_BYTES);

                        setSelectedFiles(acceptedFiles);
                        setUploadError(getUploadSizeError(language, rejectedFiles));
                      }}
                    />
                    {uploadError ? (
                      <p className="mt-3 text-sm font-medium text-destructive" role="alert">
                        {uploadError}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {tr(language, "Recording side", "ด้านที่บันทึก")}
                      </Label>
                      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/90 p-1">
                        {(["anterior", "posterior"] as PanelKind[]).map((panel) => (
                          <Button
                            key={panel}
                            type="button"
                            variant={uploadPanel === panel ? "default" : "ghost"}
                            className={cn(
                              "rounded-xl h-10",
                              uploadPanel === panel
                                ? "bg-[#0891B2] text-white hover:bg-[#0b86a5]"
                                : "text-slate-700 hover:bg-white",
                            )}
                            onClick={() => {
                              setUploadPanel(panel);
                              if (panel === "anterior" && manualPosition > 6) {
                                setManualPosition(1);
                              }
                              if (panel === "posterior" && manualPosition <= 6) {
                                setManualPosition(7);
                              }
                            }}
                            disabled={isUploading}
                          >
                            {getPanelLabel(language, panel)}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {tr(language, "Assignment", "การกำหนดตำแหน่ง")}
                      </Label>
                      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/90 p-1">
                        {(["auto", "manual"] as AssignmentMode[]).map((mode) => (
                          <Button
                            key={mode}
                            type="button"
                            variant={assignmentMode === mode ? "default" : "ghost"}
                            className={cn(
                              "rounded-xl h-10",
                              assignmentMode === mode
                                ? "bg-[#0891B2] text-white hover:bg-[#0b86a5]"
                                : "text-slate-700 hover:bg-white",
                            )}
                            onClick={() => setAssignmentMode(mode)}
                            disabled={isUploading}
                          >
                            {mode === "auto"
                              ? tr(language, "Auto", "อัตโนมัติ")
                              : tr(language, "Manual", "กำหนดเอง")}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {assignmentMode === "manual" ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {tr(language, "Manual position", "ตำแหน่งที่กำหนดเอง")}
                      </Label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {PANEL_POSITIONS[uploadPanel].map((position) => (
                          <Button
                            key={position}
                            type="button"
                            variant={manualPosition === position ? "default" : "outline"}
                            className={cn(
                              "h-10 rounded-xl",
                              manualPosition === position && "bg-slate-900 text-white hover:bg-slate-900/90",
                            )}
                            onClick={() => setManualPosition(position)}
                            disabled={isUploading}
                          >
                            {position}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedFiles.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {tr(language, "Selected files", "ไฟล์ที่เลือก")}
                        </Label>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {selectedFiles.length} {tr(language, "files", "ไฟล์")}
                        </span>
                      </div>
                      <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                        {selectedFiles.map((file) => {
                          const key = `${file.name}-${file.size}`;
                          return (
                            <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                                <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="rounded-full text-slate-500"
                                onClick={() => removeSelectedFile(key)}
                                disabled={isUploading}
                                aria-label={tr(language, "Remove file", "ลบไฟล์")}
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-[18px] border border-slate-200 bg-slate-50/70 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {assignmentMode === "auto"
                            ? tr(language, "Auto assignment is on", "เปิดการจัดตำแหน่งอัตโนมัติอยู่")
                            : tr(language, `Send all files to position ${manualPosition}`, `ส่งทุกไฟล์ไปตำแหน่ง ${manualPosition}`)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {assignmentMode === "auto"
                            ? tr(
                                language,
                                "Files will be distributed to the least-used positions on the selected side.",
                                "ไฟล์จะถูกกระจายไปยังตำแหน่งที่ใช้น้อยที่สุดของด้านที่เลือก",
                              )
                            : tr(
                                language,
                                "Every selected file will be uploaded to the exact position shown here.",
                                "ไฟล์ที่เลือกทั้งหมดจะถูกอัปโหลดไปยังตำแหน่งที่ระบุไว้นี้",
                              )}
                        </p>
                      </div>
                      <Button
                        type="button"
                        className="min-h-11 rounded-xl shrink-0"
                        disabled={selectedFiles.length === 0 || isUploading}
                        onClick={queueSelectedFiles}
                      >
                        <CloudUpload className="size-4" />
                        {isUploading
                          ? tr(language, "Uploading...", "กำลังอัปโหลด...")
                          : selectedFiles.length === 0
                          ? tr(language, "Choose files first", "เลือกไฟล์ก่อน")
                          : tr(language, `Upload ${selectedFiles.length}`, `อัปโหลด ${selectedFiles.length} ไฟล์`)}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {tr(language, "Compact upload panel is ready", "แผงอัปโหลดแบบกระชับพร้อมใช้งาน")}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {tr(
                          language,
                          "Open it when you want to add files for this patient.",
                          "เปิดเมื่อต้องการเพิ่มไฟล์ของผู้ป่วยรายนี้",
                        )}
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="min-h-10 rounded-xl shrink-0"
                      onClick={() => setUploadOpen(true)}
                      disabled={isUploading}
                    >
                      <CloudUpload className="size-4" />
                      {tr(language, "Open upload", "เปิดอัปโหลด")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
              {tr(language, "Recordings", "รายการไฟล์เสียง")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {tr(language, "Review list", "รายการตรวจ")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {activePosition
                ? tr(
                    language,
                    `Showing only recordings from position ${activePosition}.`,
                    `กำลังแสดงเฉพาะไฟล์จากตำแหน่ง ${activePosition}`
                  )
                : tr(
                    language,
                    "Choose a point above to narrow the review list to one listening position.",
                    "เลือกจุดด้านบนเพื่อกรองรายการตรวจให้เหลือเฉพาะตำแหน่งที่ต้องการ"
                  )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activePosition ? (
              <Badge className="border-transparent bg-slate-900 text-white">
                {tr(language, `Position ${activePosition} active`, `กำลังดูตำแหน่ง ${activePosition}`)}
              </Badge>
            ) : null}
            {positionSummary.length > 0 ? (
              positionSummary.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={activePosition === item.id ? "default" : "outline"}
                  size="sm"
                  className={cn("rounded-full", activePosition === item.id && "shadow-[0_0_0_4px_rgba(8,145,178,0.12)]")}
                  onClick={() => jumpToPosition(item.id)}
                >
                  {item.id}
                  <span className="ml-1 text-xs opacity-80">{item.count}</span>
                </Button>
              ))
            ) : (
              <Badge variant="outline" className="border-slate-200/80 bg-slate-50 text-slate-600">
                {tr(language, "No recordings yet", "ยังไม่มีไฟล์เสียง")}
              </Badge>
            )}
            {activePosition ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={clearPositionSelection}
              >
                <X className="size-4" />
                {tr(language, "Clear filter", "ล้างตัวกรอง")}
              </Button>
            ) : null}
          </div>
        </div>

        {recordsError ? (
          <div className="border-b border-amber-200/80 bg-amber-50/80 px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-amber-100 p-2 text-amber-700">
                <CircleAlert className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-950">
                  {tr(language, "Unable to load recordings", "ไม่สามารถโหลดรายการไฟล์เสียงได้")}
                </p>
                <p className="text-sm leading-6 text-amber-900/80">{recordsError}</p>
              </div>
            </div>
          </div>
        ) : null}

        {displayRecords.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#0891B2]/10 text-[#0891B2]">
              <Volume2 className="size-6" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-900">
              {tr(language, "No heart sound records yet", "ยังไม่มีข้อมูลเสียงหัวใจ")}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {tr(
                language,
                "Use the upload workflow to attach recordings to anterior or posterior positions.",
                "ใช้ขั้นตอนอัปโหลดเพื่อแนบไฟล์เสียงไปยังตำแหน่งด้านหน้าหรือด้านหลัง"
              )}
            </p>
            <Button
              type="button"
              className="mt-5 rounded-2xl"
              onClick={() => setUploadOpen(true)}
              disabled={isUploading}
            >
              <CloudUpload className="size-4" />
              {tr(language, "Open upload workflow", "เปิดขั้นตอนอัปโหลด")}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 px-4 py-4 lg:hidden">
              {visibleRecords.map((record) => {
                const isActive = activePosition === record.position;
                const isJumpedRow = activeRowId === record.id;
                const fileSize = formatFileSize(record.fileSizeBytes);

                return (
                  <article
                    key={record.id}
                    className={cn(
                      "rounded-[24px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
                      isActive && "border-sky-200 bg-sky-50/45",
                      isJumpedRow && "border-cyan-300 bg-cyan-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">
                          {formatDateTime(record.recorded_at, language)}
                        </p>
                        {record.isDraft ? (
                          <Badge className="border-transparent bg-amber-500/14 text-amber-700">
                            {tr(language, "Queued", "รออัปโหลด")}
                          </Badge>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => jumpToPosition(record.position)}
                        className={cn(
                          "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200",
                          isActive
                            ? "border-[#0891B2] bg-[#0891B2] text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-[#0891B2]/30 hover:text-[#0a6e87]"
                        )}
                      >
                        {record.position}
                      </button>
                    </div>

                    {showSystemDetails ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                            {tr(language, "User ID", "รหัสผู้ใช้")}
                          </p>
                          <p className="break-all text-sm font-medium text-slate-900">
                            {record.patient_id}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                            {tr(language, "MAC Address", "ที่อยู่ MAC")}
                          </p>
                          <p className="break-all text-sm text-slate-600">
                            {record.mac_address}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4">
                      <HeartSoundInlinePlayer
                        src={record.blob_url}
                        isActive={playingRecordId === record.id}
                        onRequestPlay={() => setPlayingRecordId(record.id)}
                        onPlaybackStop={() =>
                          setPlayingRecordId((current) => (current === record.id ? null : current))
                        }
                      />
                    </div>

                    {(record.draftFileName || fileSize) && (
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                        <span className="truncate">{record.draftFileName}</span>
                        <span>{fileSize}</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_60px_-44px_rgba(15,23,42,0.45)] lg:block">
              <Table className="min-w-full border-separate border-spacing-0 text-sm">
                <TableHeader className="[&_tr]:border-b">
                  <TableRow className="sticky top-0 z-20 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70 hover:bg-transparent">
                    <TableHead className="h-12 min-w-[180px] px-6 text-left align-middle text-sm font-medium text-muted-foreground">
                      {tr(language, "Date / time", "วันเวลา")}
                    </TableHead>
                    {showSystemDetails ? (
                      <TableHead className="h-12 min-w-[220px] px-6 text-left align-middle text-sm font-medium text-muted-foreground">
                        {tr(language, "User ID", "รหัสผู้ใช้")}
                      </TableHead>
                    ) : null}
                    {showSystemDetails ? (
                      <TableHead className="h-12 min-w-[180px] px-6 text-left align-middle text-sm font-medium text-muted-foreground">
                        {tr(language, "MAC Address", "ที่อยู่ MAC")}
                      </TableHead>
                    ) : null}
                    <TableHead className="h-12 min-w-[120px] px-6 text-left align-middle text-sm font-medium text-muted-foreground">
                      {tr(language, "Position", "ตำแหน่ง")}
                    </TableHead>
                    <TableHead className="h-12 min-w-[360px] px-6 text-left align-middle text-sm font-medium text-muted-foreground">
                      {tr(language, "Playback", "การเล่นเสียง")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr:last-child]:border-0">
                  {visibleRecords.map((record) => {
                    const isActive = activePosition === record.position;
                    const isJumpedRow = activeRowId === record.id;
                    const fileSize = formatFileSize(record.fileSizeBytes);

                    return (
                      <TableRow
                        key={record.id}
                        ref={(node) => {
                          rowRefs.current[record.id] = node;
                        }}
                        className={cn(
                          "group border-b border-slate-100 transition-colors hover:bg-muted/30",
                          isActive && "bg-[#ecfeff] hover:bg-[#dff9ff]",
                          isJumpedRow && "bg-[#cffafe] hover:bg-[#c4f3ff]"
                        )}
                      >
                        <TableCell className="px-6 py-4 align-middle">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-800">
                              {formatDateTime(record.recorded_at, language)}
                            </div>
                            {record.isDraft ? (
                              <Badge className="border-transparent bg-amber-500/14 text-amber-700">
                                {tr(language, "Queued", "รออัปโหลด")}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        {showSystemDetails ? (
                          <TableCell className="px-6 py-4 align-middle text-slate-600">
                            <span className="block max-w-[240px] break-all">{record.patient_id}</span>
                          </TableCell>
                        ) : null}
                        {showSystemDetails ? (
                          <TableCell className="px-6 py-4 align-middle text-slate-600">
                            <div className="space-y-1">
                              <div>{record.mac_address}</div>
                              {record.draftFileName ? (
                                <div className="max-w-[180px] truncate text-xs text-slate-500">
                                  {record.draftFileName}
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                        <TableCell className="px-6 py-4 align-middle">
                          <button
                            type="button"
                            onClick={() => jumpToPosition(record.position)}
                            className={cn(
                              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200",
                              isActive
                                ? "border-[#0891B2] bg-[#0891B2] text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-[#0891B2]/30 hover:text-[#0a6e87]"
                            )}
                          >
                            {record.position}
                          </button>
                        </TableCell>
                        <TableCell className="px-6 py-4 align-middle">
                          <div className="min-w-[320px] max-w-[820px]">
                            <HeartSoundInlinePlayer
                              src={record.blob_url}
                              isActive={playingRecordId === record.id}
                              onRequestPlay={() => setPlayingRecordId(record.id)}
                              onPlaybackStop={() =>
                                setPlayingRecordId((current) => (current === record.id ? null : current))
                              }
                            />
                            {(record.draftFileName || fileSize) && (
                              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                                <span className="truncate">{record.draftFileName}</span>
                                <span>{fileSize}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
