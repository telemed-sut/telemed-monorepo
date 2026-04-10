import type {
  GoeyPromiseData,
  GoeyToastClassNames,
  GoeyToastOptions,
  GoeyToasterProps,
  GooeyToastAction,
} from "goey-toast";
import { gooeyToast } from "goey-toast";
import type { ReactNode } from "react";

import { getErrorMessage } from "@/lib/api";

type ToastPosition = NonNullable<GoeyToasterProps["position"]>;

type LegacyToastButton = {
  title: string;
  onClick: () => void;
  successLabel?: string;
};

type LegacyToastStyles = {
  title?: string;
  description?: string;
  badge?: string;
  button?: string;
};

interface ToastOptions extends Omit<GoeyToastOptions, "action" | "classNames"> {
  action?: GooeyToastAction;
  button?: LegacyToastButton;
  classNames?: GoeyToastClassNames;
  fill?: string;
  position?: ToastPosition;
  styles?: LegacyToastStyles;
}

const TOAST_DEFAULTS = {
  bounce: 0.3,
  duration: 6000,
  fillColor: "#ffffff",
  position: "bottom-right" as ToastPosition,
  showProgress: true,
  showTimestamp: true,
  spring: true,
  timing: {
    displayDuration: 6000,
  },
} as const;

const withDefaultDescription = (
  title: string,
  options: ToastOptions | undefined
): ToastOptions => {
  const hasDescription = Boolean(
    options && Object.prototype.hasOwnProperty.call(options, "description")
  );

  return {
    ...options,
    description: hasDescription ? options?.description : title,
  };
};

const mapLegacyAction = (
  button?: LegacyToastButton,
  action?: GooeyToastAction
): GooeyToastAction | undefined => {
  if (action) {
    return action;
  }

  if (!button) {
    return undefined;
  }

  return {
    label: button.title,
    onClick: button.onClick,
    successLabel: button.successLabel,
  };
};

const mapLegacyClassNames = (
  classNames?: GoeyToastClassNames,
  styles?: LegacyToastStyles
): GoeyToastClassNames | undefined => {
  const mapped = {
    ...classNames,
    title: [styles?.title, classNames?.title].filter(Boolean).join(" ") || undefined,
    description:
      [styles?.description, classNames?.description].filter(Boolean).join(" ") || undefined,
    icon: [styles?.badge, classNames?.icon].filter(Boolean).join(" ") || undefined,
    actionButton:
      [styles?.button, classNames?.actionButton].filter(Boolean).join(" ") || undefined,
  } satisfies GoeyToastClassNames;

  return Object.values(mapped).some(Boolean) ? mapped : undefined;
};

const normalizeDuration = (options?: ToastOptions): number => {
  const configuredDuration =
    options?.timing?.displayDuration ?? options?.duration ?? TOAST_DEFAULTS.duration;

  if (configuredDuration == null || configuredDuration <= 0) {
    return TOAST_DEFAULTS.duration;
  }

  return configuredDuration;
};

const buildOptions = (title: string, options?: ToastOptions): GoeyToastOptions => {
  const resolved = withDefaultDescription(title, options);
  const displayDuration = normalizeDuration(resolved);

  return {
    id: resolved.id,
    description: resolved.description as ReactNode,
    action: mapLegacyAction(resolved.button, resolved.action),
    icon: resolved.icon,
    classNames: mapLegacyClassNames(resolved.classNames, resolved.styles),
    fillColor: TOAST_DEFAULTS.fillColor,
    borderColor: resolved.borderColor,
    borderWidth: resolved.borderWidth,
    duration: displayDuration,
    timing: {
      displayDuration,
      ...resolved.timing,
    },
    preset: resolved.preset,
    spring: resolved.spring ?? TOAST_DEFAULTS.spring,
    bounce: resolved.bounce ?? TOAST_DEFAULTS.bounce,
    showProgress: resolved.showProgress ?? TOAST_DEFAULTS.showProgress,
    showTimestamp: resolved.showTimestamp ?? TOAST_DEFAULTS.showTimestamp,
    onDismiss: resolved.onDismiss,
    onAutoClose: resolved.onAutoClose,
  };
};

const toast = {
  message: (title: string, options?: ToastOptions) =>
    gooeyToast(title, buildOptions(title, options)),
  success: (title: string, options?: ToastOptions) =>
    gooeyToast.success(title, buildOptions(title, options)),
  error: (title: string, options?: ToastOptions) =>
    gooeyToast.error(title, buildOptions(title, options)),
  warning: (title: string, options?: ToastOptions) =>
    gooeyToast.warning(title, buildOptions(title, options)),
  info: (title: string, options?: ToastOptions) =>
    gooeyToast.info(title, buildOptions(title, options)),
  action: (title: string, options?: ToastOptions) =>
    gooeyToast(title, buildOptions(title, options)),
  warningAction: (title: string, options?: ToastOptions) =>
    gooeyToast.warning(title, buildOptions(title, options)),
  destructiveAction: (title: string, options?: ToastOptions) =>
    gooeyToast.error(title, buildOptions(title, options)),
  apiError: (
    title: string,
    error: unknown,
    fallback: string = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
    options?: ToastOptions
  ) =>
    gooeyToast.error(
      title,
      buildOptions(title, {
        ...options,
        description: options?.description ?? getErrorMessage(error, fallback),
      })
    ),
  dismiss: (id?: string | number) => {
    if (id == null) {
      gooeyToast.dismiss();
      return;
    }

    gooeyToast.dismiss(id);
  },
  clear: (position?: ToastPosition) => {
    if (position) {
      gooeyToast.dismiss();
      return;
    }

    gooeyToast.dismiss();
  },
  promise: <T>(
    promiseOrFactory: Promise<T> | (() => Promise<T>),
    options: GoeyPromiseData<T>
  ) => {
    const promise =
      typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;

    return gooeyToast.promise(promise, {
      ...options,
      showTimestamp: options.showTimestamp ?? TOAST_DEFAULTS.showTimestamp,
      timing: {
        displayDuration:
          options.timing?.displayDuration ?? TOAST_DEFAULTS.timing.displayDuration,
      },
      bounce: options.bounce ?? TOAST_DEFAULTS.bounce,
      spring: options.spring ?? TOAST_DEFAULTS.spring,
      fillColor: TOAST_DEFAULTS.fillColor,
    });
  },
};

export { toast, TOAST_DEFAULTS };
export type { ToastOptions };
