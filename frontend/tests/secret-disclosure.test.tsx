import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SecretDisclosure } from "@/components/auth/secret-disclosure";

describe("SecretDisclosure", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides the secret by default and reveals it only when requested", () => {
    render(
      <SecretDisclosure
        label="Setup key"
        value="SECRET123"
        showLabel="Show setup key"
        hideLabel="Hide setup key"
      />
    );

    expect(screen.getByRole("button", { name: "Show setup key" })).toBeInTheDocument();
    expect(screen.queryByText("Setup key: SECRET123")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show setup key" }));

    expect(screen.getByText("Setup key: SECRET123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide setup key" }));

    expect(screen.queryByText("Setup key: SECRET123")).not.toBeInTheDocument();
  });
});
