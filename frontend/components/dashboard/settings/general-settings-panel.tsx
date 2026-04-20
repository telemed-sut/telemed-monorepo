"use client";

import { ChevronDown, ChevronUp, Palette, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  APPEARANCE_DENSITIES,
  APPEARANCE_THEMES,
  getAppearancePreviewPalette,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

import type { SettingsLanguage } from "./settings-types";
import {
  getAppearanceDensityCopy,
  getAppearanceThemeCopy,
  tr,
} from "./settings-utils";
import type { useSettingsAppearance } from "./use-settings-appearance";

interface GeneralSettingsPanelProps {
  language: SettingsLanguage;
  isModalPresentation: boolean;
  appearance: ReturnType<typeof useSettingsAppearance>;
  onOpenSecurity: () => void;
}

export function GeneralSettingsPanel({
  language,
  isModalPresentation,
  appearance,
  onOpenSecurity,
}: GeneralSettingsPanelProps) {
  const appearanceThemeCopy = getAppearanceThemeCopy(language);
  const appearanceDensityCopy = getAppearanceDensityCopy(language);

  return (
    <div className="space-y-4">
      {isModalPresentation ? (
        <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-border/70 bg-muted/18 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="size-4.5" />
              </span>
              <div className="min-w-0 overflow-hidden">
                <p className="break-words text-sm font-semibold text-foreground">
                  {tr(language, "Protect your account", "ปกป้องบัญชีของคุณ")}
                </p>
                <p className="mt-1 max-w-[46ch] break-words text-sm leading-6 text-muted-foreground">
                  {tr(
                    language,
                    "Review MFA and recovery options before choosing a daily theme.",
                    "ตรวจสอบ MFA และตัวเลือกกู้คืนก่อนเลือกธีมสำหรับใช้งานทุกวัน",
                  )}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:shrink-0"
              onClick={onOpenSecurity}
            >
              {tr(language, "Open security", "ไปที่ความปลอดภัย")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
          <div className="min-w-0 overflow-x-auto rounded-[1.5rem] border border-border/70 bg-muted/18 p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Palette className="size-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {tr(language, "Workspace look & feel", "บุคลิกของหน้าจอทำงาน")}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {tr(
                    language,
                    "Pick a theme and density that feel calm for daily tasks.",
                    "เลือกธีมและความหนาแน่นที่สบายตาสำหรับการใช้งานทุกวัน",
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="min-w-0 overflow-x-auto rounded-[1.5rem] border border-border/70 bg-background p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="size-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {tr(language, "Protect your account", "ปกป้องบัญชีของคุณ")}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {tr(
                    language,
                    "Open security settings to verify MFA and recovery options.",
                    "เปิดส่วนความปลอดภัยเพื่อตรวจสอบ MFA และตัวเลือกกู้คืน",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={onOpenSecurity}
                >
                  {tr(language, "Open security", "ไปที่ความปลอดภัย")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card
        size="sm"
        className="h-fit rounded-[1.5rem] border-border/70 bg-background shadow-none"
      >
        <Collapsible
          open={appearance.appearanceExpanded}
          onOpenChange={appearance.setAppearanceExpanded}
        >
          <CardHeader>
            <CollapsibleTrigger className="group -m-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer flex-col items-start gap-3 rounded-2xl p-2 text-left transition-[background-color,color] hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-row lg:justify-between">
              <span className="block min-w-0 overflow-hidden">
                <span className="block break-words text-[0.98rem] leading-normal font-medium">
                  {tr(language, "Appearance", "รูปลักษณ์การแสดงผล")}
                </span>
                <span
                  className={cn(
                    "block break-words text-[0.95rem] text-muted-foreground",
                    isModalPresentation && "max-w-[48ch] leading-6",
                  )}
                >
                  {tr(
                    language,
                    "Choose a theme and spacing that feel right for daily work.",
                    "เลือกธีมและระยะห่างที่สบายตาสำหรับการใช้งานประจำวัน",
                  )}
                </span>
              </span>
              <span className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground transition-[border-color,background-color,color,box-shadow] group-hover:bg-muted/70 group-hover:text-foreground lg:self-center">
                <span>
                  {appearance.appearanceExpanded
                    ? tr(language, "Hide", "ซ่อน")
                    : tr(language, "Show", "แสดง")}
                </span>
                {appearance.appearanceExpanded ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </span>
            </CollapsibleTrigger>
          </CardHeader>

          <CollapsibleContent className="overflow-hidden">
            <CardContent className="space-y-4 pt-0">
              <div
                className={cn(
                  "mx-auto grid gap-3",
                  isModalPresentation
                    ? "max-w-none xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start"
                    : "max-w-[1160px] xl:grid-cols-[minmax(0,720px)_340px] xl:items-start xl:justify-between",
                )}
              >
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">
                        {tr(language, "Theme", "ธีม")}
                      </p>
                      <span className="text-[11px] text-muted-foreground">
                        {tr(language, "6 curated themes", "ธีมคัดมาแล้ว 6 แบบ")}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "grid gap-2 sm:grid-cols-2",
                        isModalPresentation ? "2xl:grid-cols-3" : "xl:grid-cols-3",
                      )}
                    >
                      {APPEARANCE_THEMES.map((themeOption) => {
                        const previewPalette =
                          getAppearancePreviewPalette(themeOption);
                        const isDraftTheme =
                          appearance.appearanceDraft.theme === themeOption;
                        const isSavedTheme =
                          appearance.savedAppearance.theme === themeOption;

                        return (
                          <button
                            key={themeOption}
                            type="button"
                            onClick={() =>
                              appearance.updateAppearanceDraft(
                                "theme",
                                themeOption,
                              )
                            }
                            className={cn(
                              "rounded-xl border p-2 text-left transition-[border-color,background-color,box-shadow]",
                              isDraftTheme
                                ? "border-primary bg-primary/10 shadow-sm"
                                : isSavedTheme
                                  ? "border-primary/35 bg-primary/5"
                                  : "border-border bg-background hover:bg-muted/50",
                            )}
                          >
                            <div
                              className="mb-2 overflow-hidden rounded-lg border"
                              style={{
                                borderColor: previewPalette.border,
                                backgroundColor: previewPalette.page,
                                color: previewPalette.text,
                              }}
                            >
                              <div className="grid grid-cols-[34px_1fr]">
                                <div
                                  className="px-1.5 py-1.5"
                                  style={{
                                    backgroundColor: previewPalette.sidebar,
                                    borderRight: `1px solid ${previewPalette.border}`,
                                  }}
                                >
                                  <div
                                    className="h-1.5 rounded-full"
                                    style={{
                                      backgroundColor: previewPalette.accent,
                                      opacity: 0.95,
                                    }}
                                  />
                                  <div
                                    className="mt-1 h-1 rounded-full"
                                    style={{
                                      backgroundColor: previewPalette.accentSoft,
                                    }}
                                  />
                                  <div
                                    className="mt-1 h-1 rounded-full"
                                    style={{
                                      backgroundColor: previewPalette.panelMuted,
                                    }}
                                  />
                                </div>
                                <div className="space-y-1.5 p-1.5">
                                  <div className="flex items-center justify-between gap-1.5">
                                    <div
                                      className="h-1.5 w-9 rounded-full"
                                      style={{
                                        backgroundColor: previewPalette.text,
                                        opacity: 0.16,
                                      }}
                                    />
                                    <div
                                      className="h-3 w-5 rounded-full"
                                      style={{
                                        backgroundColor: previewPalette.accent,
                                      }}
                                    />
                                  </div>
                                  <div
                                    className="rounded-md border p-1.5"
                                    style={{
                                      borderColor: previewPalette.border,
                                      backgroundColor: previewPalette.panel,
                                    }}
                                  >
                                    <div
                                      className="h-1.5 w-10 rounded-full"
                                      style={{
                                        backgroundColor: previewPalette.text,
                                        opacity: 0.12,
                                      }}
                                    />
                                    <div className="mt-1.5 flex gap-1">
                                      <div
                                        className="h-3.5 flex-1 rounded-sm"
                                        style={{
                                          backgroundColor: previewPalette.accentSoft,
                                        }}
                                      />
                                      <div
                                        className="h-3.5 w-5 rounded-sm"
                                        style={{
                                          backgroundColor: previewPalette.panelMuted,
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold">
                                {appearanceThemeCopy[themeOption].title}
                              </p>
                              <div className="flex items-center gap-1">
                                {isSavedTheme ? (
                                  <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
                                    {tr(language, "Active", "ใช้งานอยู่")}
                                  </span>
                                ) : null}
                                {isDraftTheme && !isSavedTheme ? (
                                  <span className="rounded-full border border-primary/25 bg-background px-2 py-0.5 text-[10px] font-medium text-primary">
                                    {tr(language, "Selected", "ที่เลือก")}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                              {appearanceThemeCopy[themeOption].description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">
                      {tr(language, "Density", "ความหนาแน่น")}
                    </p>
                    <div className="grid max-w-[520px] gap-2 sm:grid-cols-2">
                      {APPEARANCE_DENSITIES.map((density) => (
                        <button
                          key={density}
                          type="button"
                          onClick={() =>
                            appearance.updateAppearanceDraft("density", density)
                          }
                          className={cn(
                            "rounded-2xl border px-3.5 py-2 text-left transition-[border-color,background-color,box-shadow]",
                            appearance.appearanceDraft.density === density
                              ? "border-primary bg-primary/10 shadow-sm"
                              : "border-border bg-background hover:bg-muted/50",
                          )}
                        >
                          <p className="text-sm font-semibold">
                            {appearanceDensityCopy[density].title}
                          </p>
                          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                            {appearanceDensityCopy[density].description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 rounded-2xl border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {tr(language, "Preview", "ตัวอย่าง")}
                      </p>
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        {tr(
                          language,
                          "Sidebar, cards, actions, and list spacing",
                          "Sidebar, cards, ปุ่ม และระยะห่างของรายการ",
                        )}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {
                        appearanceDensityCopy[appearance.appearanceDraft.density]
                          .title
                      }
                    </span>
                  </div>

                  <div
                    className="overflow-hidden rounded-[20px] border"
                    style={{
                      backgroundColor: appearance.appearancePreview.page,
                      borderColor: appearance.appearancePreview.border,
                      color: appearance.appearancePreview.text,
                    }}
                  >
                    <div className="grid min-h-[118px] grid-cols-[70px_1fr]">
                      <div
                        className="space-y-1.5 px-1.5 py-1.5"
                        style={{
                          backgroundColor: appearance.appearancePreview.sidebar,
                          borderRight: `1px solid ${appearance.appearancePreview.border}`,
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <div
                            className="size-5 rounded-xl"
                            style={{
                              backgroundColor: appearance.appearancePreview.accent,
                            }}
                          />
                          <div className="space-y-1">
                            <div
                              className="h-1.5 w-8 rounded-full"
                              style={{
                                backgroundColor: appearance.appearancePreview.text,
                                opacity: 0.18,
                              }}
                            />
                            <div
                              className="h-1 w-6 rounded-full"
                              style={{
                                backgroundColor: appearance.appearancePreview.text,
                                opacity: 0.1,
                              }}
                            />
                          </div>
                        </div>
                        <div
                          className="rounded-xl px-2 py-1 text-[10px] font-semibold"
                          style={{
                            backgroundColor: appearance.appearancePreview.accentSoft,
                            color: appearance.appearancePreview.text,
                          }}
                        >
                          {tr(language, "Patients", "ผู้ป่วย")}
                        </div>
                        <div
                          className="rounded-xl px-2 py-1 text-[10px]"
                          style={{
                            backgroundColor: appearance.appearancePreview.panelMuted,
                            color: appearance.appearancePreview.mutedText,
                          }}
                        >
                          {tr(language, "Meetings", "นัดหมาย")}
                        </div>
                      </div>

                      <div className="space-y-1.5 px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="space-y-1">
                            <div
                              className="h-1.5 w-16 rounded-full"
                              style={{
                                backgroundColor: appearance.appearancePreview.text,
                                opacity: 0.14,
                              }}
                            />
                            <div
                              className="h-1.5 w-24 rounded-full"
                              style={{
                                backgroundColor: appearance.appearancePreview.text,
                                opacity: 0.08,
                              }}
                            />
                          </div>
                          <div className="flex gap-1.5">
                            <div
                              className="rounded-full px-2.5 py-1.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: appearance.appearancePreview.accent,
                                color: appearance.appearancePreview.accentForeground,
                              }}
                            >
                              {tr(language, "New", "ใหม่")}
                            </div>
                            <div
                              className="rounded-full border px-2.5 py-1.5 text-[10px] font-semibold"
                              style={{
                                borderColor: appearance.appearancePreview.border,
                                backgroundColor: appearance.appearancePreview.panel,
                                color: appearance.appearancePreview.text,
                              }}
                            >
                              {tr(language, "Filter", "กรอง")}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {[0, 1].map((index) => (
                            <div
                              key={index}
                              className={cn(
                                "rounded-2xl border",
                                appearance.appearanceDraft.density === "compact"
                                  ? "p-1.5"
                                  : "p-2",
                              )}
                              style={{
                                backgroundColor: appearance.appearancePreview.panel,
                                borderColor: appearance.appearancePreview.border,
                              }}
                            >
                              <div
                                className="h-1.5 w-12 rounded-full"
                                style={{
                                  backgroundColor: appearance.appearancePreview.text,
                                  opacity: 0.14,
                                }}
                              />
                              <div className="mt-2 flex items-end gap-1">
                                {[20, 30, 24, 36].map((height, barIndex) => (
                                  <div
                                    key={barIndex}
                                    className="w-1.5 rounded-full"
                                    style={{
                                      height: Math.max(14, height - 6),
                                      backgroundColor:
                                        barIndex % 2 === 0
                                          ? appearance.appearancePreview.accent
                                          : appearance.appearancePreview.accentSoft,
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div
                          className="rounded-2xl border"
                          style={{
                            backgroundColor: appearance.appearancePreview.panel,
                            borderColor: appearance.appearancePreview.border,
                          }}
                        >
                          {[
                            tr(language, "Critical follow-up", "ติดตามด่วน"),
                            tr(language, "Medication review", "ทบทวนยา"),
                            tr(language, "Lab verified", "ยืนยันผลแลบ"),
                          ].map((label, index) => (
                            <div
                              key={label}
                              className={cn(
                                "flex items-center justify-between px-2.5",
                                appearance.appearanceDraft.density === "compact"
                                  ? "py-1.5"
                                  : "py-2",
                                index !== 2 && "border-b",
                              )}
                              style={{
                                borderColor: appearance.appearancePreview.border,
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className="size-2 rounded-full"
                                  style={{
                                    backgroundColor:
                                      index === 0
                                        ? "#ef7f6d"
                                        : index === 1
                                          ? appearance.appearancePreview.accent
                                          : "#6bb68d",
                                  }}
                                />
                                <span className="text-[11px] font-medium">
                                  {label}
                                </span>
                              </div>
                              <span
                                className="text-[10px]"
                                style={{
                                  color: appearance.appearancePreview.mutedText,
                                }}
                              >
                                {index === 0 ? "09:30" : index === 1 ? "13:00" : "Done"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      {appearance.hasAppearanceChanges
                        ? tr(
                            language,
                            "Changes are ready to apply.",
                            "พร้อมใช้งานเมื่อกดบันทึก",
                          )
                        : tr(
                            language,
                            "Saved appearance is already active.",
                            "กำลังใช้ค่าที่บันทึกไว้แล้ว",
                          )}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={appearance.handleResetAppearance}
                      >
                        {tr(language, "Reset", "รีเซ็ต")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={appearance.handleApplyAppearance}
                        disabled={
                          !appearance.appearanceReady ||
                          !appearance.hasAppearanceChanges
                        }
                      >
                        {tr(language, "Apply", "ใช้งาน")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
