import type { ZegoUIKitPrebuilt } from "@zegocloud/zego-uikit-prebuilt";

export type ZegoUIKitPrebuiltInstance = ZegoUIKitPrebuilt;
export type ZegoUIKitPrebuiltStatic = typeof ZegoUIKitPrebuilt;

declare global {
  interface Window {
    ZegoUIKitPrebuilt?: ZegoUIKitPrebuiltStatic;
  }
}

let zegoModulePromise: Promise<ZegoUIKitPrebuiltStatic> | null = null;

export async function loadZegoUIKitPrebuilt(): Promise<ZegoUIKitPrebuiltStatic> {
  if (typeof window === "undefined") {
    throw new Error("Browser environment is required.");
  }

  if (window.ZegoUIKitPrebuilt) {
    return window.ZegoUIKitPrebuilt;
  }

  if (!zegoModulePromise) {
    zegoModulePromise = import("@zegocloud/zego-uikit-prebuilt")
      .then((mod) => {
        if (!mod.ZegoUIKitPrebuilt) {
          throw new Error("ZEGO UIKit bundle loaded but export is missing.");
        }
        window.ZegoUIKitPrebuilt = mod.ZegoUIKitPrebuilt;
        return mod.ZegoUIKitPrebuilt;
      })
      .catch((error: unknown) => {
        zegoModulePromise = null;
        throw error instanceof Error
          ? error
          : new Error("Unable to load ZEGO UIKit bundle.");
      });
  }

  return zegoModulePromise;
}
