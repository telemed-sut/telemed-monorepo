"use client";

import { AppProgressBar } from "next-nprogress-bar";

export function ProgressBar() {
  return (
    <AppProgressBar
      height="2px"
      color="var(--med-primary-light)"
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
