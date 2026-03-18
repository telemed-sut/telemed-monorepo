import type { Meeting, MeetingStatus } from "@/lib/api";
import type { AppLanguage } from "@/store/language-config";

export type LivePresenceTone = "waiting" | "active" | "offline" | "left";

export interface LivePresenceInfo {
  tone: LivePresenceTone;
  label: string;
}

function tr(language: AppLanguage, en: string, th: string) {
  return language === "th" ? th : en;
}

function hasExplicitLeave(
  leftAt?: string | null,
  lastSeenAt?: string | null
): boolean {
  if (!leftAt) return false;
  if (!lastSeenAt) return true;

  const leftTime = new Date(leftAt).getTime();
  const lastSeenTime = new Date(lastSeenAt).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(lastSeenTime)) return true;
  return leftTime >= lastSeenTime;
}

export function isPatientWaitingLive(meeting: Meeting): boolean {
  const presence = meeting.room_presence;
  if (!presence?.patient_online) return false;
  return (
    presence.state === "patient_waiting" ||
    presence.state === "doctor_left_patient_waiting"
  );
}

export function isDoctorLeftWhilePatientWaiting(meeting: Meeting): boolean {
  const presence = meeting.room_presence;
  if (!presence?.patient_online) return false;
  return presence.state === "doctor_left_patient_waiting";
}

export function getPresenceAwareStatus(meeting: Meeting): MeetingStatus {
  const presence = meeting.room_presence;
  if (!presence) return meeting.status;
  if (presence.state === "both_in_room") return "in_progress";
  if (isPatientWaitingLive(meeting)) return "waiting";
  if (
    (presence.state === "none" || presence.state === "doctor_only") &&
    (meeting.status === "waiting" || meeting.status === "in_progress")
  ) {
    return "scheduled";
  }
  return meeting.status;
}

export function getLivePresenceInfo(
  meeting: Meeting,
  language: AppLanguage
): LivePresenceInfo | null {
  const presence = meeting.room_presence;
  if (!presence) return null;

  if (
    presence.state === "patient_waiting" ||
    presence.state === "doctor_left_patient_waiting"
  ) {
    return {
      tone: "waiting",
      label: tr(language, "Patient is in the waiting room", "คนไข้อยู่ในห้องรอแล้ว"),
    };
  }

  if (presence.state === "both_in_room") {
    return {
      tone: "active",
      label: tr(language, "Doctor and patient in room", "หมอและคนไข้อยู่ในห้อง"),
    };
  }

  const patientExplicitlyLeft = hasExplicitLeave(
    presence.patient_left_at,
    presence.patient_last_seen_at
  );
  const patientWasInRoom = Boolean(
    presence.patient_joined_at || presence.patient_last_seen_at || presence.patient_left_at
  );
  if (patientExplicitlyLeft && !presence.patient_online) {
    return {
      tone: "left",
      label: tr(language, "Patient left room", "คนไข้ออกจากห้องแล้ว"),
    };
  }

  if (presence.state === "doctor_only" || (patientWasInRoom && !presence.patient_online)) {
    return {
      tone: "offline",
      label: tr(language, "Patient offline/disconnected", "คนไข้ออฟไลน์หรือหลุดการเชื่อมต่อ"),
    };
  }

  return null;
}
