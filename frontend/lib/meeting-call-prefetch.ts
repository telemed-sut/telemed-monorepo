import { preloadZegoUIKitPrebuilt } from "@/lib/zego-uikit";

let chromePrefetchPromise: Promise<void> | null = null;
const shouldSkipBundlePreload = process.env.NODE_ENV === "test";

export function preloadMeetingCallChrome() {
  if (shouldSkipBundlePreload) {
    return Promise.resolve();
  }
  if (!chromePrefetchPromise) {
    chromePrefetchPromise = import("@/components/dashboard/meeting-call-chrome")
      .then(() => undefined)
      .catch(() => undefined);
  }

  return chromePrefetchPromise;
}

export function preloadMeetingCallExperience() {
  if (!shouldSkipBundlePreload) {
    void preloadZegoUIKitPrebuilt();
  }
  return preloadMeetingCallChrome();
}
