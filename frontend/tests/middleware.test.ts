import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";

describe("frontend proxy CSP", () => {
  it("allows dashboard routes to connect to Azure Blob Storage for heart sound playback and upload", () => {
    const request = new NextRequest("http://localhost:3000/patients/patient-1/heart-sound");

    const response = proxy(request);
    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).toContain("connect-src 'self' https://*.blob.core.windows.net");
    expect(csp).toContain("media-src 'self' blob: https://*.blob.core.windows.net");
  });
});
