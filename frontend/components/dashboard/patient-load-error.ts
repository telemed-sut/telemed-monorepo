import type { AppLanguage } from "@/store/language-config";

const ACCESS_DENIED_PATTERN =
  /not assigned to this patient|access denied|permission denied|forbidden|คุณไม่มีสิทธิ์|ยังไม่ได้รับมอบหมาย/i;
const PATIENT_NOT_FOUND_PATTERN =
  /user not found|patient not found|not found|ไม่พบข้อมูลผู้ใช้|ไม่พบผู้ป่วย/i;

function tr(language: AppLanguage, en: string, th: string) {
  return language === "th" ? th : en;
}

export function getPatientLoadErrorTitle(
  error: unknown,
  language: AppLanguage
) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: number }).status
      : undefined;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (status === 403 || ACCESS_DENIED_PATTERN.test(message)) {
    return tr(
      language,
      "You are not assigned to this patient. Contact admin to assign access.",
      "คุณยังไม่ได้รับมอบหมายผู้ป่วยรายนี้ โปรดติดต่อผู้ดูแลเพื่อขอสิทธิ์เข้าถึง"
    );
  }

  if (status === 404 || PATIENT_NOT_FOUND_PATTERN.test(message)) {
    return tr(language, "Patient not found", "ไม่พบผู้ป่วย");
  }

  return tr(language, "Failed to load patient", "โหลดข้อมูลผู้ป่วยไม่สำเร็จ");
}
