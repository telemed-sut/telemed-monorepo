"use client";

import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import type { ComponentProps } from "react";

import { TOAST_DEFAULTS } from "@/components/ui/toast";

type ToasterProps = ComponentProps<typeof GooeyToaster>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <GooeyToaster
      position="bottom-right"
      offset="24px"
      theme="light"
      closeButton="top-left"
      closeOnEscape
      showProgress
      spring={TOAST_DEFAULTS.spring}
      bounce={TOAST_DEFAULTS.bounce}
      duration={TOAST_DEFAULTS.duration}
      {...props}
    />
  );
};

export { Toaster };
