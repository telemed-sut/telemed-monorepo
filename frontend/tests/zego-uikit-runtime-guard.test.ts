import { describe, expect, it, vi } from "vitest";

import {
  destroyZegoInstanceSafely,
  installZegoRuntimeErrorGuard,
  isZegoTelemetryCreateSpanNullError,
} from "@/lib/zego-uikit";

describe("ZEGO runtime error guard", () => {
  it("recognizes the SDK telemetry createSpan null error", () => {
    expect(
      isZegoTelemetryCreateSpanNullError(
        new TypeError("Cannot read properties of null (reading 'createSpan')")
      )
    ).toBe(true);
    expect(isZegoTelemetryCreateSpanNullError(new Error("network failed"))).toBe(false);
  });

  it("suppresses delayed SDK telemetry errors after the call page unmounts", () => {
    installZegoRuntimeErrorGuard();

    const event = new Event("error", { cancelable: true });
    Object.defineProperty(event, "error", {
      value: new TypeError("Cannot read properties of null (reading 'createSpan')"),
    });
    const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalled();
  });

  it("wraps ZEGO destroy timers so delayed createSpan errors do not escape", () => {
    vi.useFakeTimers();
    const instance = {
      destroy: vi.fn(() => {
        window.setTimeout(() => {
          throw new TypeError(
            "Cannot read properties of null (reading 'createSpan')"
          );
        }, 300);
      }),
    };

    expect(() => destroyZegoInstanceSafely(instance)).not.toThrow();
    expect(() => vi.runAllTimers()).not.toThrow();

    vi.useRealTimers();
  });
});
