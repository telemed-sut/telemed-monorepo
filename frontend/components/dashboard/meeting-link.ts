export type MeetingLinkMode = "off" | "jitsi" | "internal" | "template";

const DEFAULT_MODE: MeetingLinkMode = "off";

function toMode(value: string | undefined): MeetingLinkMode {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "jitsi") return "jitsi";
  if (normalized === "internal") return "internal";
  if (normalized === "template") return "template";
  return DEFAULT_MODE;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTemplateLink(template: string, key: string, origin: string): string {
  return template.replaceAll("{id}", key).replaceAll("{origin}", origin);
}

function getOrigin(origin?: string): string {
  if (origin) return origin;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export function getMeetingLinkMode(): MeetingLinkMode {
  return toMode(process.env.NEXT_PUBLIC_MEETING_LINK_MODE);
}

export function resolveMeetingRoomValue(
  manualRoom: string,
  options?: { origin?: string }
): string | undefined {
  const normalizedManual = manualRoom.trim();
  if (normalizedManual) return normalizedManual;

  const mode = getMeetingLinkMode();
  if (mode === "off") return undefined;

  const origin = getOrigin(options?.origin);
  const key = slugify(createKey());

  if (mode === "jitsi") {
    const prefix = slugify(process.env.NEXT_PUBLIC_MEETING_JITSI_PREFIX || "telemed");
    return `https://meet.jit.si/${prefix}-${key}`;
  }

  if (mode === "internal") {
    if (!origin) return `/meet/${key}`;
    return `${origin}/meet/${key}`;
  }

  const template = process.env.NEXT_PUBLIC_MEETING_LINK_TEMPLATE;
  if (mode === "template" && template?.trim()) {
    return buildTemplateLink(template.trim(), key, origin);
  }

  return undefined;
}
