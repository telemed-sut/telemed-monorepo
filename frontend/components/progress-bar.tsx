"use client";

import { AppProgressBar } from "next-nprogress-bar";

export function ProgressBar() {
  return (
    <AppProgressBar
      height="2px"
      color="#7ac2f0"
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
