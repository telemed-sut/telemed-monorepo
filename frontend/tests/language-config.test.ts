import { describe, expect, it } from "vitest";

import { detectDefaultLanguage, resolveAppLanguage } from "@/store/language-config";

describe("language config", () => {
  it("defaults to Thai when no preference is stored", () => {
    expect(resolveAppLanguage(undefined)).toBe("th");
  });

  it("respects an explicit saved language", () => {
    expect(resolveAppLanguage("en")).toBe("en");
    expect(resolveAppLanguage("th")).toBe("th");
  });

  it("detects English browsers without changing the Thai default", () => {
    expect(detectDefaultLanguage("en-US")).toBe("en");
    expect(detectDefaultLanguage("th-TH")).toBe("th");
    expect(detectDefaultLanguage(undefined)).toBe("th");
  });
});
