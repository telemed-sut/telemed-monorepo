"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DrawerPosition = "right" | "left" | "top" | "bottom";

const DrawerContext = React.createContext<{ position: DrawerPosition }>({
  position: "bottom",
});

const directionMap: Record<
  DrawerPosition,
  DrawerPrimitive.Root.Props["swipeDirection"]
> = {
  bottom: "down",
  left: "left",
  right: "right",
  top: "up",
};

function Drawer({
  swipeDirection,
  position = "bottom",
  ...props
}: DrawerPrimitive.Root.Props & {
  position?: DrawerPosition;
}) {
  return (
    <DrawerContext.Provider value={{ position }}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        swipeDirection={swipeDirection ?? directionMap[position]}
        {...props}
      />
    </DrawerContext.Provider>
  );
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerPortal(props: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerBackdrop({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:opacity-0 data-starting-style:opacity-0",
        className
      )}
      data-slot="drawer-backdrop"
      {...props}
    />
  );
}

function DrawerViewport({
  className,
  position,
  ...props
}: DrawerPrimitive.Viewport.Props & {
  position: DrawerPosition;
}) {
  return (
    <DrawerPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 flex touch-none",
        position === "bottom" && "items-end justify-center",
        position === "top" && "items-start justify-center",
        position === "right" && "justify-end",
        position === "left" && "justify-start",
        className
      )}
      data-slot="drawer-viewport"
      {...props}
    />
  );
}

function DrawerPopup({
  className,
  children,
  showCloseButton = false,
  showBar = false,
  position: positionProp,
  ...props
}: DrawerPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  showBar?: boolean;
  position?: DrawerPosition;
}) {
  const { position: contextPosition } = React.useContext(DrawerContext);
  const position = positionProp ?? contextPosition;

  return (
    <DrawerPortal>
      <DrawerBackdrop />
      <DrawerViewport position={position}>
        <DrawerPrimitive.Popup
          className={cn(
            "relative flex max-h-full min-h-0 min-w-0 flex-col border bg-popover text-popover-foreground shadow-lg outline-none will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:duration-300 data-starting-style:duration-300",
            position === "bottom" &&
              "max-h-[88dvh] w-full rounded-t-2xl border-b-0 data-ending-style:translate-y-full data-starting-style:translate-y-full",
            position === "top" &&
              "max-h-[88dvh] w-full rounded-b-2xl border-t-0 data-ending-style:-translate-y-full data-starting-style:-translate-y-full",
            position === "right" &&
              "h-full w-[min(92vw,680px)] rounded-l-2xl border-r-0 data-ending-style:translate-x-full data-starting-style:translate-x-full",
            position === "left" &&
              "h-full w-[min(92vw,680px)] rounded-r-2xl border-l-0 data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
            showBar && (position === "bottom" || position === "top") && "pt-3",
            className
          )}
          data-slot="drawer-popup"
          {...props}
        >
          {showBar ? <DrawerBar position={position} /> : null}
          {children}
          {showCloseButton ? (
            <DrawerPrimitive.Close
              aria-label="Close"
              className="absolute right-3 top-3"
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <XIcon />
            </DrawerPrimitive.Close>
          ) : null}
        </DrawerPrimitive.Popup>
      </DrawerViewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-6 pb-3", className)}
      data-slot="drawer-header"
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t bg-muted/60 p-4 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="drawer-footer"
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      className={cn("text-xl font-semibold leading-none text-foreground", className)}
      data-slot="drawer-title"
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      data-slot="drawer-description"
      {...props}
    />
  );
}

function DrawerPanel({
  className,
  children,
  scrollable = true,
  ...props
}: React.ComponentProps<"div"> & {
  scrollable?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-5 p-6 pt-2",
        scrollable && "overflow-y-auto overscroll-contain scroll-smooth [-webkit-overflow-scrolling:touch]",
        className
      )}
      data-slot="drawer-panel"
      {...props}
    >
      {children}
    </div>
  );
}

function DrawerBar({
  className,
  position: positionProp,
  ...props
}: React.ComponentProps<"div"> & {
  position?: DrawerPosition;
}) {
  const { position: contextPosition } = React.useContext(DrawerContext);
  const position = positionProp ?? contextPosition;
  const horizontal = position === "left" || position === "right";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute flex touch-none items-center justify-center p-3 before:rounded-full before:bg-input",
        horizontal
          ? "inset-y-0 before:h-12 before:w-1"
          : "inset-x-0 before:h-1 before:w-12",
        position === "top" && "bottom-0",
        position === "bottom" && "top-0",
        position === "left" && "right-0",
        position === "right" && "left-0",
        className
      )}
      data-slot="drawer-bar"
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPopup,
  DrawerViewport,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerPanel,
  DrawerBar,
};
