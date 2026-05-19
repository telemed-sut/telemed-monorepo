import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("NotFound", () => {
  it("renders a minimal home recovery action", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(
      screen
        .getByRole("img", {
          name: "ภาพประกอบหน้า 404 ไม่พบหน้าที่ต้องการ",
        })
        .getAttribute("src")
    ).toContain("not-found-illustration-transparent.png");
    expect(screen.getByRole("link", { name: "กลับไปหน้าหลัก" })).toHaveAttribute(
      "href",
      "/overview"
    );
  });
});
