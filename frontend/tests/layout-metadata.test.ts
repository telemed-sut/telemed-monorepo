import { describe, expect, it } from "vitest";

import { metadata, viewport } from "@/app/layout";

describe("layout metadata", () => {
  it("publishes social preview metadata and icons", () => {
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: "/og-image.png",
        width: 1200,
        height: 630,
      }),
    ]);
    expect(metadata.twitter).toEqual(
      expect.objectContaining({
        card: "summary_large_image",
        images: ["/og-image.png"],
      })
    );
    expect(metadata.icons).toEqual(
      expect.objectContaining({
        icon: expect.arrayContaining([expect.objectContaining({ url: "/favicon.ico" })]),
      })
    );
  });

  it("exports a mobile-friendly viewport", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      themeColor: "#0f172a",
    });
  });
});
