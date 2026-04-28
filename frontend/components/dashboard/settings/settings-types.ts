import type { AppLanguage } from "@/store/language-config";

export type SettingsPanelId = "general" | "account" | "security" | "admin";

export type SettingsLanguage = AppLanguage;

export interface SensitiveReauthRequest {
  actionLabel: string;
  run: () => Promise<void>;
}
