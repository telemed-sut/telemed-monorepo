export const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "doctor", label: "Doctor" },
  { value: "medical_student", label: "Medical Student" },
] as const;

export const ROLE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label])
);

export const ROLE_LABEL_MAP_TH: Record<string, string> = {
  admin: "ผู้ดูแลระบบ",
  doctor: "แพทย์",
  medical_student: "นักศึกษาแพทย์",
};

export const PRIVILEGED_ROLE_LABEL_MAP: Record<string, string> = {
  platform_super_admin: "Platform super admin",
  security_admin: "Security admin",
  hospital_admin: "Hospital admin",
};

export const PRIVILEGED_ROLE_LABEL_MAP_TH: Record<string, string> = {
  platform_super_admin: "ผู้ดูแลระบบแพลตฟอร์ม",
  security_admin: "ผู้ดูแลความปลอดภัย",
  hospital_admin: "ผู้ดูแลโรงพยาบาล",
};

function humanizeRoleLabel(role: string): string {
  return role
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function getRoleLabel(role: string, language: "en" | "th" = "en"): string {
  if (!role) return "";
  if (language === "th") {
    return ROLE_LABEL_MAP_TH[role] ?? humanizeRoleLabel(role);
  }
  return ROLE_LABEL_MAP[role] ?? humanizeRoleLabel(role);
}

export function getPrivilegedRoleLabel(role: string, language: "en" | "th" = "en"): string {
  if (!role) return "";
  if (language === "th") {
    return PRIVILEGED_ROLE_LABEL_MAP_TH[role] ?? humanizeRoleLabel(role);
  }
  return PRIVILEGED_ROLE_LABEL_MAP[role] ?? humanizeRoleLabel(role);
}

export const CLINICAL_ROLES = new Set([
  "doctor",
]);

export const CARE_TEAM_ASSIGNMENT_ROLES = new Set([
  "doctor",
  "medical_student",
]);

export function canManageUsers(role: string | null | undefined): boolean {
  return role === "admin";
}

export function canViewClinicalData(role: string | null | undefined): boolean {
  return role === "admin" || role === "doctor" || role === "medical_student";
}

export function canWriteClinicalData(role: string | null | undefined): boolean {
  return role === "admin" || role === "doctor";
}

export function isMedicalStudentRole(role: string | null | undefined): boolean {
  return role === "medical_student";
}
