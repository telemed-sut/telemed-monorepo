"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AudioLines,
  CircleAlert,
  CloudUpload,
  Files,
  Play,
  Stethoscope,
  UserRound,
  Volume2,
  X,
} from "lucide-react";

import type { AppLanguage } from "@/store/language-config";
import {
  fetchPatient,
  fetchPatientHeartSounds,
  type HeartSoundRecord,
  type Patient,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { HeartSoundInlinePlayer } from "@/components/dashboard/heart-sound-inline-player";
import { getPatientWorkspaceHrefs } from "@/components/dashboard/dashboard-route-utils";
import {
  readPatientHeartSoundCache,
  writePatientHeartSoundCache,
} from "@/lib/patient-workspace-cache";
import { preloadPatientDetailBundle } from "@/lib/patient-workspace-prefetch";

interface PatientHeartSoundContentProps {
  patientId: string;
}

type PanelKind = "anterior" | "posterior";
type AssignmentMode = "auto" | "manual";

type DisplayHeartSoundRecord = HeartSoundRecord & {
  draftFileName?: string;
  fileSizeBytes?: number;
  isDraft?: boolean;
};

type RecordsBanner = {
  title: string;
  message: string;
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

function getDemoRecordsBanner(language: AppLanguage): RecordsBanner {
  return {
    title: tr(language, "Built-in demo recordings are loaded", "กำลังแสดงไฟล์เสียงตัวอย่างในระบบ"),
    message: tr(
      language,
      "This patient does not have uploaded heart-sound files yet, so sample recordings were inserted to make the workspace immediately usable.",
      "ผู้ป่วยรายนี้ยังไม่มีไฟล์เสียงหัวใจที่อัปโหลดไว้ ระบบจึงใส่ไฟล์ตัวอย่างให้ก่อนเพื่อให้หน้านี้ใช้งานได้ทันที"
    ),
  };
}

function getDemoHeartSoundRecords(patientId: string): HeartSoundRecord[] {
  return [
    {
      id: "demo-sound-1",
      patient_id: patientId,
      device_id: "demo-device-a1",
      mac_address: "DE:MO:AA:01:10:01",
      position: 1,
      blob_url: "/heart-sound-samples/anterior-position-1.wav",
      storage_key: "samples/anterior-position-1.wav",
      mime_type: "audio/wav",
      duration_seconds: 4.0,
      recorded_at: "2026-03-27T05:12:00Z",
      created_at: "2026-03-27T05:12:00Z",
    },
    {
      id: "demo-sound-2",
      patient_id: patientId,
      device_id: "demo-device-a3",
      mac_address: "DE:MO:AA:03:10:03",
      position: 3,
      blob_url: "/heart-sound-samples/anterior-position-3.wav",
      storage_key: "samples/anterior-position-3.wav",
      mime_type: "audio/wav",
      duration_seconds: 3.4,
      recorded_at: "2026-03-27T05:18:00Z",
      created_at: "2026-03-27T05:18:00Z",
    },
    {
      id: "demo-sound-3",
      patient_id: patientId,
      device_id: "demo-device-p9a",
      mac_address: "DE:MO:PO:09:20:A1",
      position: 9,
      blob_url: "/heart-sound-samples/posterior-position-9-a.wav",
      storage_key: "samples/posterior-position-9-a.wav",
      mime_type: "audio/wav",
      duration_seconds: 4.2,
      recorded_at: "2026-03-27T05:24:00Z",
      created_at: "2026-03-27T05:24:00Z",
    },
    {
      id: "demo-sound-4",
      patient_id: patientId,
      device_id: "demo-device-p9b",
      mac_address: "DE:MO:PO:09:20:B2",
      position: 9,
      blob_url: "/heart-sound-samples/posterior-position-9-b.wav",
      storage_key: "samples/posterior-position-9-b.wav",
      mime_type: "audio/wav",
      duration_seconds: 3.1,
      recorded_at: "2026-03-27T05:26:00Z",
      created_at: "2026-03-27T05:26:00Z",
    },
    {
      id: "demo-sound-5",
      patient_id: patientId,
      device_id: "demo-device-p14",
      mac_address: "DE:MO:PO:14:30:01",
      position: 14,
      blob_url: "/heart-sound-samples/posterior-position-14.wav",
      storage_key: "samples/posterior-position-14.wav",
      mime_type: "audio/wav",
      duration_seconds: 4.0,
      recorded_at: "2026-03-27T05:30:00Z",
      created_at: "2026-03-27T05:30:00Z",
    },
  ];
}

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

function getPanelByPosition(position: number): PanelKind {
  return position <= 6 ? "anterior" : "posterior";
}

function buildPositionCounts(records: DisplayHeartSoundRecord[]) {
  return records.reduce<Record<number, number>>((acc, record) => {
    acc[record.position] = (acc[record.position] ?? 0) + 1;
    return acc;
  }, {});
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

  const renderPanel = (panel: PanelKind, label: string) => {
    const points = POSITION_META.filter((item) => item.panel === panel);
    const filesInPanel = points.reduce((sum, point) => sum + (positionCounts[point.id] ?? 0), 0);
    const positionsUsed = points.filter((point) => (positionCounts[point.id] ?? 0) > 0).length;

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
                "Use the surface view to jump directly to matching recordings in the table. The plain torso layout keeps each heart-sound point easy to scan.",
                "ใช้มุมมองผิวกายเพื่อกระโดดไปยังรายการเสียงในตารางได้ทันที ภาพ torso แบบเรียบช่วยให้มองหาตำแหน่งเสียงหัวใจแต่ละจุดได้ง่ายขึ้น"
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-sky-100 bg-[#f6fbfd] px-3 py-1.5 font-medium text-[#0f6f89]">
            {tr(language, "Mode", "โหมด")}:
            {" "}
            {tr(language, "Surface", "ผิวกาย")}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600">
            {usedPositions} {tr(language, "positions used", "ตำแหน่งที่มีข้อมูล")}
          </span>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">
            {recordedCount} {tr(language, "recordings", "ไฟล์เสียง")}
          </span>
          {activePosition ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={() => onPositionSelect(activePosition)}>
              <Play className="size-4" />
              {tr(language, `Jump to position ${activePosition}`, `ไปยังตำแหน่ง ${activePosition}`)}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {renderPanel("anterior", "Anterior")}
        {renderPanel("posterior", "Posterior")}
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
  const patientWorkspaceHrefs = useMemo(
    () => getPatientWorkspaceHrefs(patientId),
    [patientId]
  );
  const patientWorkspaceHref = patientWorkspaceHrefs[0];
  const denseModeHref = patientWorkspaceHrefs[2];
  const cachedSnapshot = useMemo(
    () => readPatientHeartSoundCache(userId, patientId),
    [patientId, userId]
  );
  const cachedRecords = useMemo(
    () => cachedSnapshot?.records ?? [],
    [cachedSnapshot]
  );
  const hasCachedRecords = Boolean(cachedSnapshot);
  const cachedUsesDemo = hasCachedRecords && cachedRecords.length === 0;

  const [patient, setPatient] = useState<Patient | null>(
    () => cachedSnapshot?.patient ?? null
  );
  const [records, setRecords] = useState<HeartSoundRecord[]>(
    () =>
      cachedUsesDemo
        ? getDemoHeartSoundRecords(patientId)
        : cachedRecords
  );
  const [draftRecords, setDraftRecords] = useState<DisplayHeartSoundRecord[]>([]);
  const [loading, setLoading] = useState(
    () => !(cachedSnapshot?.patient && hasCachedRecords)
  );
  const [patientError, setPatientError] = useState<string | null>(null);
  const [recordsBanner, setRecordsBanner] = useState<RecordsBanner | null>(
    () => (cachedUsesDemo ? getDemoRecordsBanner(language) : null)
  );
  const [usingDemoRecords, setUsingDemoRecords] = useState(cachedUsesDemo);
  const [activePosition, setActivePosition] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPanel, setUploadPanel] = useState<PanelKind>("anterior");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("auto");
  const [manualPosition, setManualPosition] = useState<number>(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const shouldScrollRef = useRef(false);
  const draftRecordsRef = useRef<DisplayHeartSoundRecord[]>([]);

  useEffect(() => {
    patientWorkspaceHrefs.forEach((href) => {
      router.prefetch(href);
    });
    void preloadPatientDetailBundle();
  }, [patientWorkspaceHrefs, router]);

  useEffect(() => {
    setPatient(cachedSnapshot?.patient ?? null);
    setRecords(
      cachedUsesDemo ? getDemoHeartSoundRecords(patientId) : cachedRecords
    );
    setUsingDemoRecords(cachedUsesDemo);
    setRecordsBanner(cachedUsesDemo ? getDemoRecordsBanner(language) : null);
    setLoading(!(cachedSnapshot?.patient && hasCachedRecords));
    setPatientError(null);
  }, [
    cachedSnapshot,
    cachedRecords,
    cachedUsesDemo,
    hasCachedRecords,
    language,
    patientId,
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
      setRecordsBanner(null);
      setUsingDemoRecords(false);
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

        try {
          const soundData = await fetchPatientHeartSounds(patientId, token);
          if (cancelled) {
            return;
          }
          if (soundData.items.length > 0) {
            setRecords(soundData.items);
            setUsingDemoRecords(false);
            writePatientHeartSoundCache(userId, patientId, {
              records: soundData.items,
              recordsCachedAt: Date.now(),
            });
          } else {
            setRecords(getDemoHeartSoundRecords(patientId));
            setUsingDemoRecords(true);
            setRecordsBanner(getDemoRecordsBanner(language));
            writePatientHeartSoundCache(userId, patientId, {
              records: [],
              recordsCachedAt: Date.now(),
            });
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
          setRecords(getDemoHeartSoundRecords(patientId));
          setUsingDemoRecords(true);
          setRecordsBanner({
            title: tr(language, "Built-in demo recordings are loaded", "กำลังแสดงไฟล์เสียงตัวอย่างในระบบ"),
            message:
              status === 404
                ? tr(
                    language,
                    "The live heart-sound endpoint is not ready yet, so sample recordings were loaded instead. You can review the layout and play audio immediately while backend setup continues.",
                    "endpoint รายการเสียงหัวใจจริงยังไม่พร้อม ระบบจึงโหลดไฟล์เสียงตัวอย่างแทน คุณสามารถตรวจ layout และกดฟังเสียงได้ทันทีระหว่างที่ backend กำลังตั้งค่า"
                  )
                : tr(
                    language,
                    "Live patient recordings could not be loaded right now, so sample recordings were loaded instead to keep the workspace usable.",
                    "ยังไม่สามารถโหลดไฟล์เสียงจริงของผู้ป่วยได้ในขณะนี้ ระบบจึงโหลดไฟล์เสียงตัวอย่างแทนเพื่อให้หน้ายังใช้งานต่อได้"
                  ),
          });
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
          err instanceof Error
            ? err.message
            : tr(language, "Failed to load patient", "โหลดข้อมูลผู้ป่วยไม่สำเร็จ")
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
    router,
    token,
    userId,
  ]);

  const displayRecords = useMemo<DisplayHeartSoundRecord[]>(() => {
    return [...draftRecords, ...records].sort((left, right) => {
      return new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime();
    });
  }, [draftRecords, records]);

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
      rowRefs.current[match.id]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setActiveRowId(match.id);
      shouldScrollRef.current = false;
      window.setTimeout(() => {
        setActiveRowId((current) => (current === match.id ? null : current));
      }, 1800);
    });
  }, [activePosition, visibleRecords]);

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
  };

  const queueSelectedFiles = () => {
    if (selectedFiles.length === 0) {
      return;
    }

    const assignedPositions =
      assignmentMode === "manual"
        ? Array.from({ length: selectedFiles.length }, () => manualPosition)
        : getAutoAssignedPositions(displayRecords, uploadPanel, selectedFiles.length);

    const nextDrafts = selectedFiles.map((file, index) =>
      createDraftRecord(file, patientId, assignedPositions[index], index)
    );

    setDraftRecords((current) => [...nextDrafts, ...current]);
    setSelectedFiles([]);
    setUploadOpen(false);
    setActivePosition(assignedPositions[0] ?? null);
    setManualPosition(assignedPositions[0] ?? manualPosition);
    shouldScrollRef.current = true;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
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
    <div className="flex-1 min-h-0 space-y-6 overflow-y-auto py-2">
      {recordsBanner ? (
        <section className="rounded-[28px] border border-sky-200 bg-sky-50/80 px-5 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl bg-sky-100 p-2 text-sky-700">
              <CircleAlert className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-sky-950">
                {recordsBanner.title}
              </p>
              <p className="text-sm leading-6 text-sky-900/80">
                {recordsBanner.message}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(236,254,255,0.96),rgba(255,255,255,0.98)_58%,rgba(236,253,245,0.9))] shadow-[0_22px_60px_rgba(15,23,42,0.06)]">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="border-transparent bg-[#0891B2]/10 text-[#0a6e87]">
                {tr(language, "Patient Workspace", "พื้นที่ทำงานผู้ป่วย")}
              </Badge>
              <Badge variant="outline" className="border-slate-300/80 bg-white/90 text-slate-700">
                {tr(language, "Heart Sound", "เสียงหัวใจ")}
              </Badge>
              {draftRecords.length > 0 ? (
                <Badge className="border-transparent bg-emerald-500/12 text-emerald-700">
                  {draftRecords.length} {tr(language, "queued", "รออัปโหลด")}
                </Badge>
              ) : null}
              {usingDemoRecords ? (
                <Badge className="border-transparent bg-sky-500/12 text-sky-700">
                  {tr(language, "Demo audio loaded", "โหลดเสียงตัวอย่างแล้ว")}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              <h1 className="text-[clamp(2rem,3.4vw,3.1rem)] font-semibold tracking-tight text-slate-900">
                {tr(language, "Heart Sound", "เสียงหัวใจ")}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                {tr(
                  language,
                  "Clinical review surface for uploaded heart-sound recordings. Select a position, inspect related files, and keep uploads organized by patient.",
                  "พื้นผิวการทำงานสำหรับตรวจสอบไฟล์เสียงหัวใจของผู้ป่วย เลือกตำแหน่ง ตรวจสอบไฟล์ที่เกี่ยวข้อง และจัดการอัปโหลดให้เป็นระเบียบตามผู้ป่วย"
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/92 px-3 py-1.5">
                <UserRound className="size-4 text-[#0891B2]" />
                {patient.first_name} {patient.last_name}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/92 px-3 py-1.5">
                <Volume2 className="size-4 text-[#0891B2]" />
                {displayRecords.length} {tr(language, "recordings", "ไฟล์เสียง")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/92 px-3 py-1.5">
                <Files className="size-4 text-emerald-600" />
                {positionSummary.length} {tr(language, "positions used", "ตำแหน่งที่มีข้อมูล")}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <Button
              variant={uploadOpen ? "default" : "outline"}
              className="min-w-[220px] rounded-2xl"
              onClick={() => setUploadOpen((current) => !current)}
            >
              <CloudUpload className="size-4" />
              {uploadOpen
                ? tr(language, "Hide upload panel", "ซ่อนแผงอัปโหลด")
                : tr(language, "Upload heart sound files", "อัปโหลดไฟล์เสียงหัวใจ")}
            </Button>
            <div className="flex gap-3">
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
                className="rounded-2xl"
                onClick={() => router.push(denseModeHref)}
                onFocus={() => router.prefetch(denseModeHref)}
                onMouseEnter={() => router.prefetch(denseModeHref)}
              >
                <Stethoscope className="size-4" />
                {tr(language, "Focus Mode", "Focus Mode")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_360px]">
        <div className="rounded-[32px] border border-slate-200/80 bg-white px-6 py-6 shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
          <HeartSoundReferenceMap
            language={language}
            activePosition={activePosition}
            onPositionSelect={jumpToPosition}
            positionCounts={positionCounts}
          />
        </div>

        <aside className="space-y-4">
          <section className="rounded-[32px] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                  {tr(language, "Selected position", "ตำแหน่งที่เลือก")}
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  {activePosition
                    ? tr(language, `Position ${activePosition}`, `ตำแหน่ง ${activePosition}`)
                    : tr(language, "No position selected", "ยังไม่ได้เลือกตำแหน่ง")}
                </h2>
              </div>
              {activePosition ? (
                <Badge className="border-transparent bg-[#0891B2]/12 text-[#0a6e87]">
                  {positionRecords.length} {tr(language, "files", "ไฟล์")}
                </Badge>
              ) : null}
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <p className="text-slate-600">
                {activePosition
                  ? tr(
                      language,
                      "Only recordings from this position are shown in the table below so you can review one point without other positions mixed in.",
                      "ตารางด้านล่างจะแสดงเฉพาะไฟล์เสียงของตำแหน่งนี้เท่านั้น เพื่อให้ตรวจทีละจุดได้โดยไม่มีตำแหน่งอื่นปะปน"
                    )
                  : tr(
                      language,
                      "Use the surface map to filter the table down to one auscultation point at a time.",
                      "ใช้แผนที่ผิวกายเพื่อกรองตารางให้เหลือทีละตำแหน่งที่ต้องการตรวจ"
                    )}
              </p>

              {activePosition ? (
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
              ) : null}

              {positionRecords.length > 0 ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {positionRecords.slice(0, 3).map((record) => (
                    <div key={record.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
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
                      <p className="mt-1 truncate text-sm font-medium text-slate-800">
                        {record.draftFileName || record.storage_key || record.mac_address}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[32px] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                  {tr(language, "Upload panel", "แผงอัปโหลด")}
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                  {tr(language, "Prepare files", "เตรียมไฟล์")}
                </h2>
              </div>
              <Button
                type="button"
                variant={uploadOpen ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => setUploadOpen((current) => !current)}
              >
                {uploadOpen ? tr(language, "Close", "ปิด") : tr(language, "Open", "เปิด")}
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {tr(language, "Patient-scoped uploads", "อัปโหลดเฉพาะผู้ป่วยรายนี้")}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {tr(
                        language,
                        "All prepared files stay inside this patient workspace. Positioning can be automatic or manually pinned.",
                        "ไฟล์ที่เตรียมไว้ทั้งหมดจะอยู่ภายในพื้นที่ทำงานของผู้ป่วยรายนี้ และสามารถจัดตำแหน่งแบบอัตโนมัติหรือกำหนดเองได้"
                      )}
                    </p>
                  </div>
                  <AudioLines className="mt-1 size-5 text-[#0891B2]" />
                </div>
              </div>

              {uploadOpen ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="heart-sound-files">
                      {tr(language, "Audio files", "ไฟล์เสียง")}
                    </Label>
                    <Input
                      id="heart-sound-files"
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        setSelectedFiles(files);
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{tr(language, "Recording side", "ด้านที่บันทึก")}</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["anterior", "posterior"] as PanelKind[]).map((panel) => (
                        <Button
                          key={panel}
                          type="button"
                          variant={uploadPanel === panel ? "default" : "outline"}
                          className="rounded-2xl"
                          onClick={() => {
                            setUploadPanel(panel);
                            if (panel === "anterior" && manualPosition > 6) {
                              setManualPosition(1);
                            }
                            if (panel === "posterior" && manualPosition <= 6) {
                              setManualPosition(7);
                            }
                          }}
                        >
                          {panel === "anterior" ? "Anterior" : "Posterior"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{tr(language, "Position assignment", "การกำหนดตำแหน่ง")}</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["auto", "manual"] as AssignmentMode[]).map((mode) => (
                        <Button
                          key={mode}
                          type="button"
                          variant={assignmentMode === mode ? "default" : "outline"}
                          className="rounded-2xl"
                          onClick={() => setAssignmentMode(mode)}
                        >
                          {mode === "auto"
                            ? tr(language, "Auto assign", "จัดให้อัตโนมัติ")
                            : tr(language, "Manual assign", "กำหนดเอง")}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      {assignmentMode === "auto"
                        ? tr(
                            language,
                            "Files will be distributed to the least-used positions on the selected side.",
                            "ไฟล์จะถูกกระจายไปยังตำแหน่งที่ใช้น้อยที่สุดของด้านที่เลือก"
                          )
                        : tr(
                            language,
                            "All selected files will be attached to the exact position you choose below.",
                            "ไฟล์ที่เลือกทั้งหมดจะถูกผูกกับตำแหน่งที่กำหนดด้านล่าง"
                          )}
                    </p>
                  </div>

                  {assignmentMode === "manual" ? (
                    <div className="space-y-2">
                      <Label>{tr(language, "Manual position", "ตำแหน่งที่กำหนดเอง")}</Label>
                      <div className="grid grid-cols-4 gap-2">
                        {PANEL_POSITIONS[uploadPanel].map((position) => (
                          <Button
                            key={position}
                            type="button"
                            variant={manualPosition === position ? "default" : "outline"}
                            className="rounded-2xl"
                            onClick={() => setManualPosition(position)}
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
                        <Label>{tr(language, "Selected files", "ไฟล์ที่เลือก")}</Label>
                        <span className="text-xs text-slate-500">
                          {selectedFiles.length} {tr(language, "files", "ไฟล์")}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {selectedFiles.map((file) => {
                          const key = `${file.name}-${file.size}`;
                          return (
                            <div key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2">
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

                  <Button
                    type="button"
                    className="w-full rounded-2xl"
                    disabled={selectedFiles.length === 0}
                    onClick={queueSelectedFiles}
                  >
                    <CloudUpload className="size-4" />
                    {selectedFiles.length === 0
                      ? tr(language, "Choose files first", "เลือกไฟล์ก่อน")
                      : tr(language, `Queue ${selectedFiles.length} files`, `เพิ่ม ${selectedFiles.length} ไฟล์เข้าคิว`)}
                  </Button>
                </div>
              ) : (
                <Button type="button" className="w-full rounded-2xl" onClick={() => setUploadOpen(true)}>
                  <CloudUpload className="size-4" />
                  {tr(language, "Open upload workflow", "เปิดขั้นตอนอัปโหลด")}
                </Button>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
              {tr(language, "Recorded files", "ไฟล์ที่บันทึกไว้")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {tr(language, "Position-aligned recording table", "ตารางไฟล์เสียงตามตำแหน่ง")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {activePosition
                ? tr(
                    language,
                    `Position ${activePosition} is active. Only matching recordings are shown below.`,
                    `ตำแหน่ง ${activePosition} ถูกเลือกอยู่ ตารางด้านล่างจะแสดงเฉพาะไฟล์ที่ตรงกัน`
                  )
                : tr(
                    language,
                    "Click a point above to filter this table down to the related recordings.",
                    "กดจุดด้านบนเพื่อกรองตารางให้เหลือเฉพาะไฟล์เสียงที่เกี่ยวข้อง"
                  )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {positionSummary.length > 0 ? (
              positionSummary.slice(0, 8).map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={activePosition === item.id ? "default" : "outline"}
                  size="sm"
                  className="rounded-full"
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
                variant="ghost"
                size="sm"
                className="rounded-full text-slate-600 hover:text-slate-900"
                onClick={clearPositionSelection}
              >
                <X className="size-4" />
                {tr(language, "Clear filter", "ล้างตัวกรอง")}
              </Button>
            ) : null}
          </div>
        </div>

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
                "Use the upload panel to begin attaching recordings to anterior or posterior positions.",
                "ใช้แผงอัปโหลดเพื่อเริ่มแนบไฟล์เสียงไปยังตำแหน่ง anterior หรือ posterior"
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-100/80 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <th className="px-6 py-4 font-medium">DATE/TIME</th>
                  <th className="px-6 py-4 font-medium">USER ID</th>
                  <th className="px-6 py-4 font-medium">MAC ADDRESS</th>
                  <th className="px-6 py-4 font-medium">POSITION</th>
                  <th className="px-6 py-4 font-medium">PLAY</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((record) => {
                  const isActive = activePosition === record.position;
                  const isJumpedRow = activeRowId === record.id;

                  return (
                    <tr
                      key={record.id}
                      ref={(node) => {
                        rowRefs.current[record.id] = node;
                      }}
                      className={cn(
                        "border-b border-slate-100 transition-colors last:border-b-0",
                        isActive && "bg-[#ecfeff]",
                        isJumpedRow && "bg-[#cffafe]"
                      )}
                    >
                      <td className="px-6 py-4 align-top font-medium text-slate-800">
                        <div className="space-y-1">
                          <div>{formatDateTime(record.recorded_at, language)}</div>
                          {record.isDraft ? (
                            <Badge className="border-transparent bg-amber-500/14 text-amber-700">
                              {tr(language, "Queued", "รออัปโหลด")}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top text-slate-600">
                        <span className="break-all">{record.patient_id}</span>
                      </td>
                      <td className="px-6 py-4 align-top text-slate-600">
                        <div className="space-y-1">
                          <div>{record.mac_address}</div>
                          {record.draftFileName ? (
                            <div className="truncate text-xs text-slate-500">{record.draftFileName}</div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <button
                          type="button"
                          onClick={() => jumpToPosition(record.position)}
                          className={cn(
                            "inline-flex min-w-12 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                            isActive
                              ? "border-[#0891B2] bg-[#0891B2] text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-[#0891B2]/30 hover:text-[#0a6e87]"
                          )}
                        >
                          {record.position}
                        </button>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="min-w-[280px]">
                          <HeartSoundInlinePlayer
                            src={record.blob_url}
                            isActive={playingRecordId === record.id}
                            onRequestPlay={() => setPlayingRecordId(record.id)}
                            onPlaybackStop={() =>
                              setPlayingRecordId((current) => (current === record.id ? null : current))
                            }
                          />
                          {(record.draftFileName || record.fileSizeBytes) && (
                            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                              <span className="truncate">{record.draftFileName}</span>
                              <span>{formatFileSize(record.fileSizeBytes)}</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
