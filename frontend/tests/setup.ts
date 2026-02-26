import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, vi } from "vitest";

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeAll(() => {
  const originalError = console.error;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const [firstArg] = args;
    if (
      typeof firstArg === "string" &&
      firstArg.includes("An update to") &&
      firstArg.includes("not wrapped in act(...)")
    ) {
      return;
    }
    originalError(...(args as Parameters<typeof console.error>));
  });
});

afterAll(() => {
  consoleErrorSpy?.mockRestore();
});
