import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/language-store", () => ({
  useLanguageStore: (
    selector: (state: { language: "th" | "en" }) => unknown
  ) => selector({ language: "th" }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";

describe("UI accessibility regressions", () => {
  it("localizes the sheet close button label", () => {
    render(
      <Sheet open>
        <SheetContent>
          <div>เนื้อหา</div>
        </SheetContent>
      </Sheet>
    );

    expect(screen.getByText("ปิด")).toHaveClass("sr-only");
  });

  it("keeps the sidebar rail keyboard reachable", () => {
    render(
      <SidebarProvider>
        <SidebarRail />
      </SidebarProvider>
    );

    expect(
      screen.getByRole("button", { name: "สลับแถบด้านข้าง" })
    ).not.toHaveAttribute("tabindex", "-1");
  });
});
