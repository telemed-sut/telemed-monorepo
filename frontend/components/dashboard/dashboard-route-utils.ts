import type { AppLanguage } from "@/store/language-config";

export const DASHBOARD_HOME_HREF = "/overview";

const pageTitles: Record<AppLanguage, Record<string, string>> = {
  en: {
    "/overview": "Overview",
    "/": "Overview",
    "/patients": "Patients",
    "/users": "Users",
    "/meetings": "Meetings",
    "/device-operations": "Device Operations",
    "/audit-logs": "Audit Logs",
    "/device-registry": "Device Registry",
    "/profile": "Profile",
    "/settings": "Settings",
    "/device-monitor": "Device Monitor",
  },
  th: {
    "/overview": "ภาพรวม",
    "/": "ภาพรวม",
    "/patients": "ผู้ป่วย",
    "/users": "ผู้ใช้",
    "/meetings": "การนัดหมาย",
    "/device-operations": "ปฏิบัติการอุปกรณ์",
    "/audit-logs": "บันทึก Audit",
    "/device-registry": "ทะเบียนอุปกรณ์",
    "/profile": "โปรไฟล์",
    "/settings": "ตั้งค่า",
    "/device-monitor": "มอนิเตอร์อุปกรณ์",
  },
};

const dashboardFallbackTitles: Record<AppLanguage, string> = {
  en: "Dashboard",
  th: "แดชบอร์ด",
};

export function normalizeDashboardHref(pathname: string): string {
  if (!pathname || pathname === "/") {
    return DASHBOARD_HOME_HREF;
  }

  return pathname;
}

export function isWorkspaceTabRoute(pathname: string): boolean {
  const normalizedPathname = normalizeDashboardHref(pathname);

  if (normalizedPathname.startsWith("/patients/")) {
    return true;
  }

  if (normalizedPathname.startsWith("/meetings/call/")) {
    return true;
  }

  return false;
}

export function getPatientWorkspaceHrefs(patientId: string): string[] {
  const encodedPatientId = encodeURIComponent(patientId);

  return [
    `/patients/${encodedPatientId}`,
    `/patients/${encodedPatientId}/heart-sound`,
    `/patients/${encodedPatientId}/dense`,
  ];
}

export function getDashboardPageTitle(
  pathname: string,
  language: AppLanguage
): string {
  const normalizedPathname = normalizeDashboardHref(pathname);

  if (normalizedPathname === "/patients") {
    return pageTitles[language]["/patients"];
  }

  if (normalizedPathname.startsWith("/patients/")) {
    if (normalizedPathname.endsWith("/heart-sound")) {
      return language === "th" ? "เสียงหัวใจ" : "Heart Sound";
    }

    return normalizedPathname.endsWith("/dense")
      ? language === "th"
        ? "โหมดโฟกัสทางคลินิก"
        : "Clinical Focus Mode"
      : language === "th"
        ? "พื้นที่ทำงานผู้ป่วย"
        : "Patient Workspace";
  }

  return (
    pageTitles[language][normalizedPathname] ?? dashboardFallbackTitles[language]
  );
}
