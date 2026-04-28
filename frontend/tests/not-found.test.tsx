import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("NotFound", () => {
  it("renders bilingual recovery actions", () => {
    render(<NotFound />);

    expect(screen.getByText("ไม่พบหน้าที่คุณต้องการ")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The page you requested does not exist, has moved, or requires a valid session."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "กลับไปหน้าเข้าสู่ระบบ" })
    ).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "ไปที่แดชบอร์ด" })).toHaveAttribute(
      "href",
      "/overview"
    );
  });
});
