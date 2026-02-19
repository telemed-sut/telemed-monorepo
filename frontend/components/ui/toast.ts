import { createElement, type MouseEvent } from "react";
import { sileo, type SileoOptions, type SileoPosition } from "sileo";
import { getErrorMessage } from "@/lib/api";

type ToastOptions = Omit<SileoOptions, "title">;

const TOAST_FILL = {
  neutral: "#111214",
  success: "#0f1712",
  error: "#1a0f12",
  warning: "#1a160f",
  info: "#0f1520",
  action: "#101420",
} as const;

const TOAST_BUTTON_CLASS = {
  action: "!text-blue-100 !bg-blue-500/30 hover:!bg-blue-500/45",
  warning: "!text-amber-100 !bg-amber-500/28 hover:!bg-amber-500/42",
  error: "!text-red-100 !bg-red-500/30 hover:!bg-red-500/45",
} as const;

const TOAST_DESCRIPTION_CLASS = "!text-neutral-100/95";
const TOAST_DESCRIPTION_WITH_DISMISS_CLASS = "relative block w-full !pr-10 !pt-1";
const TOAST_DISMISS_BUTTON_BASE_CLASS =
  "z-20 inline-flex items-center justify-center rounded-full border text-[11px] font-semibold leading-none shadow-sm transition";
const TOAST_DISMISS_BUTTON_CLASS = {
  neutral: "border-white/15 bg-white/10 text-white/90 hover:bg-white/20",
  success: "border-emerald-300/25 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35",
  error: "border-rose-300/25 bg-rose-500/22 text-rose-100 hover:bg-rose-500/38",
  warning: "border-amber-300/30 bg-amber-500/22 text-amber-100 hover:bg-amber-500/38",
  info: "border-sky-300/25 bg-sky-500/22 text-sky-100 hover:bg-sky-500/38",
  action: "border-blue-300/25 bg-blue-500/22 text-blue-100 hover:bg-blue-500/38",
} as const;

const joinClassNames = (...classes: Array<string | undefined>) =>
  classes.filter(Boolean).join(" ");

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

const withDismissControlByClass = (
  options: ToastOptions,
  dismissButtonClass: string
): {
  options: ToastOptions;
  bindId: (id: string) => void;
} => {
  let toastId = "";
  const dismissButton = createElement(
    "a",
    {
      href: "#",
      "data-sileo-button": true,
      className: joinClassNames(TOAST_DISMISS_BUTTON_BASE_CLASS, dismissButtonClass),
      style: {
        position: "absolute",
        top: 8,
        right: 8,
        width: 20,
        height: 20,
        minWidth: 20,
        padding: 0,
        marginTop: 0,
      },
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (toastId) {
          sileo.dismiss(toastId);
        }
      },
      "aria-label": "Close notification",
    },
    "✕"
  );

  return {
    options: {
      ...options,
      description: createElement(
        "div",
        { className: TOAST_DESCRIPTION_WITH_DISMISS_CLASS },
        options.description,
        dismissButton
      ),
    },
    bindId: (id: string) => {
      toastId = id;
    },
  };
};

const withPreset = (
  options: ToastOptions | undefined,
  fill: string,
  buttonClass?: string
): ToastOptions => {
  const styles = {
    ...options?.styles,
    description: joinClassNames(TOAST_DESCRIPTION_CLASS, options?.styles?.description),
    button: buttonClass
      ? joinClassNames(buttonClass, options?.styles?.button)
      : options?.styles?.button,
  };

  return {
    ...options,
    fill: options?.fill ?? fill,
    styles,
  };
};

const buildToastOptions = (title: string, options?: ToastOptions): SileoOptions => ({
  title,
  ...options,
});

const showWithDismiss = (
  show: (opts: SileoOptions) => string,
  title: string,
  options: ToastOptions | undefined,
  fill: string,
  buttonClass?: string,
  dismissButtonClass: string = TOAST_DISMISS_BUTTON_CLASS.neutral
) => {
  const resolvedOptions = withDefaultDescription(title, options);
  const { options: resolved, bindId } = withDismissControlByClass(
    withPreset(resolvedOptions, fill, buttonClass),
    dismissButtonClass
  );
  const id = show(buildToastOptions(title, resolved));
  bindId(id);
  return id;
};

const toast = {
  message: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.show,
      title,
      options,
      TOAST_FILL.neutral,
      undefined,
      TOAST_DISMISS_BUTTON_CLASS.neutral
    ),
  success: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.success,
      title,
      options,
      TOAST_FILL.success,
      undefined,
      TOAST_DISMISS_BUTTON_CLASS.success
    ),
  error: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.error,
      title,
      options,
      TOAST_FILL.error,
      TOAST_BUTTON_CLASS.error,
      TOAST_DISMISS_BUTTON_CLASS.error
    ),
  warning: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.warning,
      title,
      options,
      TOAST_FILL.warning,
      undefined,
      TOAST_DISMISS_BUTTON_CLASS.warning
    ),
  info: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.info,
      title,
      options,
      TOAST_FILL.info,
      undefined,
      TOAST_DISMISS_BUTTON_CLASS.info
    ),
  action: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.action,
      title,
      options,
      TOAST_FILL.action,
      TOAST_BUTTON_CLASS.action,
      TOAST_DISMISS_BUTTON_CLASS.action
    ),
  warningAction: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.warning,
      title,
      options,
      TOAST_FILL.warning,
      TOAST_BUTTON_CLASS.warning,
      TOAST_DISMISS_BUTTON_CLASS.warning
    ),
  destructiveAction: (title: string, options?: ToastOptions) =>
    showWithDismiss(
      sileo.error,
      title,
      options,
      TOAST_FILL.error,
      TOAST_BUTTON_CLASS.error,
      TOAST_DISMISS_BUTTON_CLASS.error
    ),
  apiError: (
    title: string,
    error: unknown,
    fallback: string = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
    options?: ToastOptions
  ) =>
    showWithDismiss(
      sileo.error,
      title,
      {
        ...options,
        description: options?.description ?? getErrorMessage(error, fallback),
      },
      TOAST_FILL.error,
      TOAST_BUTTON_CLASS.error,
      TOAST_DISMISS_BUTTON_CLASS.error
    ),
  dismiss: (id: string) => sileo.dismiss(id),
  clear: (position?: SileoPosition) => sileo.clear(position),
  promise: sileo.promise,
};

export { toast };
export type { ToastOptions };
